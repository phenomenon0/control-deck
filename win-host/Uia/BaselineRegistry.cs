using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using FlaUI.Core;
using FlaUI.Core.AutomationElements;

namespace ControlDeck.WinHost.Uia;

/// <summary>
/// Named "known-good state" snapshots. Agents capture a baseline
/// before a risky sequence, then restore it as their emergency
/// parachute when they land in an unexpected state.
///
/// A snapshot captures: foreground window, top-level windows with
/// titles + PIDs, modal depth. Restore closes everything above the
/// baseline modal depth using <see cref="FlaUI.Core.Patterns.IWindowPattern"/>;
/// hung windows (per <c>IsHungAppWindow</c>) are skipped to avoid
/// blocking the worker.
/// </summary>
public sealed class BaselineRegistry
{
    private readonly AutomationBase _automation;
    private readonly HandleTable _handles;
    private readonly ConcurrentDictionary<string, Baseline> _baselines = new();
    private long _seq;

    public BaselineRegistry(AutomationBase automation, HandleTable handles)
    {
        _automation = automation;
        _handles = handles;
    }

    public Baseline Capture(string? label)
    {
        var id = $"b_{Interlocked.Increment(ref _seq):x}";
        var windows = new List<BaselineWindow>();
        var desktop = _automation.GetDesktop();
        foreach (var child in desktop.FindAllChildren())
        {
            try
            {
                var title = HandleTable.SafeName(child);
                var pid = child.Properties.ProcessId.ValueOrDefault;
                windows.Add(new BaselineWindow
                {
                    Title = title,
                    Pid = pid,
                    IsModal = IsModal(child),
                });
            }
            catch
            {
                // Ignore windows that vanished mid-enumeration.
            }
        }

        var baseline = new Baseline
        {
            Id = id,
            Label = label,
            CapturedAt = DateTimeOffset.UtcNow,
            Windows = windows,
            ModalDepth = windows.Count(w => w.IsModal),
        };
        _baselines[id] = baseline;
        return baseline;
    }

    public RestoreResult Restore(string id, string strategy)
    {
        if (!_baselines.TryGetValue(id, out var baseline))
        {
            throw new InvalidOperationException($"baseline not found: {id}");
        }

        var closed = 0;
        var residual = new List<BaselineWindow>();
        var desktop = _automation.GetDesktop();

        foreach (var child in desktop.FindAllChildren())
        {
            int pid;
            string title;
            try
            {
                pid = child.Properties.ProcessId.ValueOrDefault;
                title = HandleTable.SafeName(child);
            }
            catch
            {
                continue;
            }

            // If this window wasn't in the baseline, it's new — close it.
            var wasInBaseline = baseline.Windows.Any(w => w.Pid == pid && w.Title == title);
            if (wasInBaseline) continue;

            if (IsHung(child))
            {
                residual.Add(new BaselineWindow { Title = title, Pid = pid, IsModal = false });
                continue;
            }

            try
            {
                var windowPattern = child.Patterns.Window.PatternOrDefault;
                if (windowPattern is not null)
                {
                    windowPattern.Close();
                    closed++;
                }
                else
                {
                    // No WindowPattern → try Escape at the focused element.
                    child.Focus();
                    FlaUI.Core.Input.Keyboard.Press(FlaUI.Core.WindowsAPI.VirtualKeyShort.ESCAPE);
                    FlaUI.Core.Input.Keyboard.Release(FlaUI.Core.WindowsAPI.VirtualKeyShort.ESCAPE);
                    closed++;
                }
            }
            catch
            {
                residual.Add(new BaselineWindow { Title = title, Pid = pid, IsModal = false });
            }
        }

        // Optionally re-focus the baseline's foreground window.
        var focused = false;
        if (strategy == "close_modals_then_focus" && baseline.Windows.Any())
        {
            try
            {
                // Best-effort: look for a surviving window from the baseline and focus it.
                var first = desktop.FindAllChildren().FirstOrDefault(c =>
                {
                    try
                    {
                        var pid = c.Properties.ProcessId.ValueOrDefault;
                        var title = HandleTable.SafeName(c);
                        return baseline.Windows.Any(w => w.Pid == pid && w.Title == title);
                    }
                    catch { return false; }
                });
                if (first is not null)
                {
                    first.Focus();
                    focused = true;
                }
            }
            catch { }
        }

        return new RestoreResult
        {
            Closed = closed,
            Focused = focused,
            Residual = residual,
        };
    }

    // -------------------------------------------------------------------
    //  helpers
    // -------------------------------------------------------------------

    private static bool IsModal(AutomationElement element)
    {
        try
        {
            var wp = element.Patterns.Window.PatternOrDefault;
            return wp?.IsModal.ValueOrDefault ?? false;
        }
        catch { return false; }
    }

    private static bool IsHung(AutomationElement element)
    {
        try
        {
            // Use the native handle via IUIAutomationElement → NativeWindowHandle.
            var hwnd = element.Properties.NativeWindowHandle.ValueOrDefault;
            if (hwnd == IntPtr.Zero) return false;
            return IsHungAppWindow(hwnd);
        }
        catch { return false; }
    }

    [DllImport("user32.dll")]
    private static extern bool IsHungAppWindow(IntPtr hwnd);

    // -------------------------------------------------------------------
    //  data types
    // -------------------------------------------------------------------

    public sealed class Baseline
    {
        public required string Id { get; init; }
        public string? Label { get; init; }
        public required DateTimeOffset CapturedAt { get; init; }
        public required List<BaselineWindow> Windows { get; init; }
        public required int ModalDepth { get; init; }
    }

    public sealed class BaselineWindow
    {
        public required string Title { get; init; }
        public required int Pid { get; init; }
        public required bool IsModal { get; init; }
    }

    public sealed class RestoreResult
    {
        public required int Closed { get; init; }
        public required bool Focused { get; init; }
        public required List<BaselineWindow> Residual { get; init; }
    }
}
