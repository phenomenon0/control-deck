using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Text.Json.Nodes;
using System.Threading;
using FlaUI.Core;
using FlaUI.Core.AutomationElements;
using FlaUI.Core.Definitions;
using FlaUI.Core.EventHandlers;
using FlaUI.Core.Identifiers;

namespace ControlDeck.WinHost.Uia;

/// <summary>
/// Manages user-installed watchers for unexpected windows / dialogs.
///
/// Design rules (see docs/native-adapter/windows.md "Robust automation"):
///  - Subscribe to UIA WindowOpenedEvent + FocusChangedEvent on the
///    desktop root. Never StructureChangedEvent desktop-wide — firehose.
///  - Callbacks fire on FlaUI's MTA worker thread; do NO tree walks
///    inside them. Just enqueue the raw element reference.
///  - Match evaluation is lazy: happens at Drain() on the caller's
///    thread. Keeps callback residency &lt;1ms so the MTA worker doesn't
///    starve.
///  - Watchers have TTL; expired ones are pruned on each Drain call.
/// </summary>
public sealed class WatcherRegistry : IDisposable
{
    private readonly AutomationBase _automation;
    private readonly HandleTable _handles;
    private readonly ConcurrentDictionary<string, Watcher> _watchers = new();
    private readonly ConcurrentQueue<RawEvent> _eventQueue = new();

    private IDisposable? _windowOpenedHandler;
    private IDisposable? _focusChangedHandler;
    private long _seq;

    public WatcherRegistry(AutomationBase automation, HandleTable handles)
    {
        _automation = automation;
        _handles = handles;
        Attach();
    }

    public string Install(WatcherRule rule)
    {
        var id = $"w_{Interlocked.Increment(ref _seq):x}_{Guid.NewGuid():N}".Substring(0, 20);
        _watchers[id] = new Watcher
        {
            Id = id,
            Rule = rule,
            ExpiresAtTicks = DateTimeOffset.UtcNow.AddMilliseconds(rule.TtlMs).UtcTicks,
            DeliveredEvents = new ConcurrentQueue<DeliveredEvent>(),
        };
        return id;
    }

    public bool Remove(string id) => _watchers.TryRemove(id, out _);

    public List<DeliveredEvent> Drain(string? watchId)
    {
        PruneExpired();
        MatchPendingEvents();

        var results = new List<DeliveredEvent>();
        if (watchId is null)
        {
            foreach (var w in _watchers.Values)
            {
                DrainWatcher(w, results);
            }
        }
        else if (_watchers.TryGetValue(watchId, out var watcher))
        {
            DrainWatcher(watcher, results);
        }
        return results;
    }

    public int ActiveCount => _watchers.Count;

    public void Dispose()
    {
        _windowOpenedHandler?.Dispose();
        _focusChangedHandler?.Dispose();
        _watchers.Clear();
    }

    // -------------------------------------------------------------------
    //  UIA event subscriptions
    // -------------------------------------------------------------------

    private void Attach()
    {
        var desktop = _automation.GetDesktop();

        try
        {
            _windowOpenedHandler = desktop.RegisterAutomationEvent(
                _automation.EventLibrary.Window.WindowOpenedEvent,
                TreeScope.Subtree,
                OnWindowOpened);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[watcher] WindowOpenedEvent subscribe failed: {ex.Message}");
        }

        try
        {
            _focusChangedHandler = _automation.RegisterFocusChangedEvent(OnFocusChanged);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[watcher] FocusChangedEvent subscribe failed: {ex.Message}");
        }
    }

    private void OnWindowOpened(AutomationElement sender, EventId eventId)
    {
        // COM callback — MUST return fast. Enqueue and bail.
        if (_watchers.IsEmpty) return;
        _eventQueue.Enqueue(new RawEvent
        {
            Kind = RawEventKind.WindowOpened,
            Element = sender,
            At = DateTimeOffset.UtcNow,
        });
    }

    private void OnFocusChanged(AutomationElement sender)
    {
        if (_watchers.IsEmpty) return;
        _eventQueue.Enqueue(new RawEvent
        {
            Kind = RawEventKind.FocusChanged,
            Element = sender,
            At = DateTimeOffset.UtcNow,
        });
    }

    // -------------------------------------------------------------------
    //  matching (lazy, on drain)
    // -------------------------------------------------------------------

    private void MatchPendingEvents()
    {
        while (_eventQueue.TryDequeue(out var evt))
        {
            if (evt.Element is null) continue;
            foreach (var watcher in _watchers.Values)
            {
                if (!Matches(evt, watcher.Rule)) continue;
                HandleMatch(watcher, evt);
            }
        }
    }

    private static bool Matches(RawEvent evt, WatcherRule rule)
    {
        var el = evt.Element!;

        // Name / role / automationId filters — substring + case-insensitive.
        try
        {
            if (rule.Name is not null)
            {
                var name = HandleTable.SafeName(el);
                if (name.IndexOf(rule.Name, StringComparison.OrdinalIgnoreCase) < 0) return false;
            }
            if (rule.Role is not null)
            {
                var role = HandleTable.SafeRole(el);
                if (role.IndexOf(rule.Role, StringComparison.OrdinalIgnoreCase) < 0) return false;
            }
            if (rule.AutomationId is not null)
            {
                var auto = el.Properties.AutomationId.ValueOrDefault ?? string.Empty;
                if (auto.IndexOf(rule.AutomationId, StringComparison.OrdinalIgnoreCase) < 0) return false;
            }
            if (rule.App is not null)
            {
                var proc = Process.GetProcessById(el.Properties.ProcessId.Value).ProcessName;
                if (proc.IndexOf(rule.App, StringComparison.OrdinalIgnoreCase) < 0) return false;
            }
        }
        catch
        {
            // Element may have died between callback and match — don't count it.
            return false;
        }

        return true;
    }

    private void HandleMatch(Watcher watcher, RawEvent evt)
    {
        var el = evt.Element!;
        string actionTaken = "none";
        string? error = null;

        switch (watcher.Rule.Action)
        {
            case "notify":
                // no-op — agent will see the event on drain
                break;

            case "dismiss_via_escape":
                try
                {
                    el.Focus();
                    FlaUI.Core.Input.Keyboard.Press(FlaUI.Core.WindowsAPI.VirtualKeyShort.ESCAPE);
                    FlaUI.Core.Input.Keyboard.Release(FlaUI.Core.WindowsAPI.VirtualKeyShort.ESCAPE);
                    actionTaken = "dismissed";
                }
                catch (Exception ex)
                {
                    error = ex.Message;
                }
                break;

            case "invoke_button":
                try
                {
                    var buttonName = watcher.Rule.ButtonName ?? "OK";
                    var button = FindDescendantButton(el, buttonName);
                    if (button is not null)
                    {
                        var invoke = button.Patterns.Invoke.PatternOrDefault;
                        if (invoke is not null)
                        {
                            invoke.Invoke();
                            actionTaken = "invoked";
                        }
                        else
                        {
                            error = $"button '{buttonName}' found but has no InvokePattern";
                        }
                    }
                    else
                    {
                        error = $"button '{buttonName}' not found in dialog";
                    }
                }
                catch (Exception ex)
                {
                    error = ex.Message;
                }
                break;
        }

        var processName = "unknown";
        try { processName = Process.GetProcessById(el.Properties.ProcessId.Value).ProcessName; }
        catch { }

        watcher.DeliveredEvents.Enqueue(new DeliveredEvent
        {
            WatcherId = watcher.Id,
            At = evt.At,
            Handle = _handles.Register(el, processName, Array.Empty<int>()),
            Kind = evt.Kind.ToString(),
            ActionTaken = actionTaken,
            Error = error,
        });
    }

    private static AutomationElement? FindDescendantButton(AutomationElement root, string name)
    {
        try
        {
            var all = root.FindAllDescendants(cf => cf.ByControlType(ControlType.Button));
            foreach (var b in all)
            {
                var n = HandleTable.SafeName(b);
                if (n.Equals(name, StringComparison.OrdinalIgnoreCase)
                    || n.IndexOf(name, StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    return b;
                }
            }
        }
        catch { }
        return null;
    }

    private void DrainWatcher(Watcher w, List<DeliveredEvent> into)
    {
        while (w.DeliveredEvents.TryDequeue(out var ev))
        {
            into.Add(ev);
        }
    }

    private void PruneExpired()
    {
        var nowTicks = DateTimeOffset.UtcNow.UtcTicks;
        foreach (var (id, w) in _watchers.ToArray())
        {
            if (w.ExpiresAtTicks < nowTicks)
            {
                _watchers.TryRemove(id, out _);
            }
        }
    }

    // -------------------------------------------------------------------
    //  data types
    // -------------------------------------------------------------------

    public sealed class WatcherRule
    {
        public string? Name { get; set; }
        public string? Role { get; set; }
        public string? AutomationId { get; set; }
        public string? App { get; set; }
        /// <summary>"notify" | "dismiss_via_escape" | "invoke_button"</summary>
        public string Action { get; set; } = "notify";
        public string? ButtonName { get; set; }
        /// <summary>"desktop" | "app"</summary>
        public string Scope { get; set; } = "desktop";
        /// <summary>Millisecond TTL, default 5 minutes, cap 30 minutes.</summary>
        public int TtlMs { get; set; } = 300_000;
    }

    private sealed class Watcher
    {
        public required string Id { get; init; }
        public required WatcherRule Rule { get; init; }
        public required long ExpiresAtTicks { get; init; }
        public required ConcurrentQueue<DeliveredEvent> DeliveredEvents { get; init; }
    }

    private enum RawEventKind { WindowOpened, FocusChanged }

    private sealed class RawEvent
    {
        public RawEventKind Kind;
        public AutomationElement? Element;
        public DateTimeOffset At;
    }

    public sealed class DeliveredEvent
    {
        public required string WatcherId { get; init; }
        public required DateTimeOffset At { get; init; }
        public required JsonObject Handle { get; init; }
        public required string Kind { get; init; }
        public required string ActionTaken { get; init; }
        public string? Error { get; init; }
    }
}
