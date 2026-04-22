using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using FlaUI.Core;
using FlaUI.Core.AutomationElements;
using FlaUI.Core.Conditions;
using FlaUI.Core.Definitions;
using FlaUI.Core.EventHandlers;
using FlaUI.Core.Identifiers;
using FlaUI.Core.Input;

namespace ControlDeck.WinHost.Uia;

/// <summary>
/// UIA op implementations. Each method takes a JsonObject of params
/// (matching the wire protocol) and returns a JsonObject with
/// <c>{"ok": bool, "data"?: any, "error"?: string}</c>.
/// </summary>
public sealed partial class UiaSession
{
    private const int DefaultLocateLimit = 10;
    private const int HardLocateCap = 50;
    private const int DefaultTreeDepth = 20;
    private const int DefaultWaitTimeoutMs = 30_000;
    private const int MaxWaitTimeoutMs = 60_000;

    // ---------------------------------------------------------------
    //  locate
    // ---------------------------------------------------------------

    private JsonNode LocateImpl(JsonObject p)
    {
        var query = p["query"] as JsonObject ?? p;
        var name = query["name"]?.GetValue<string>();
        var role = query["role"]?.GetValue<string>();
        var appName = query["app"]?.GetValue<string>();
        var limit = Math.Min(HardLocateCap,
            query["limit"]?.GetValue<int>() ?? DefaultLocateLimit);

        var root = ResolveSearchRoot(appName);
        if (root is null)
        {
            return new JsonObject
            {
                ["ok"] = true,
                ["data"] = new JsonArray(),
            };
        }

        var hits = new List<(AutomationElement Element, int[] Path, string ProcessName)>();
        WalkAndFilter(root, new int[0], name, role, limit, hits, GetProcessName(root));

        var array = new JsonArray();
        foreach (var hit in hits)
        {
            array.Add(_handles.Register(hit.Element, hit.ProcessName, hit.Path));
        }

        return new JsonObject
        {
            ["ok"] = true,
            ["data"] = array,
        };
    }

    private AutomationElement? ResolveSearchRoot(string? appName)
    {
        var desktop = _automation.GetDesktop();
        if (string.IsNullOrEmpty(appName)) return desktop;

        // Prefer Win32 EnumWindows — UIA's desktop.FindAllChildren drops
        // some UWP top-level windows on Win11. FromHandle recovers the
        // UIA element for each HWND.
        foreach (var hwnd in Win32.EnumVisibleWindows())
        {
            var procName = Win32.GetProcessNameByHwnd(hwnd);
            var title = Win32.GetWindowTextSafe(hwnd);
            if (string.Equals(procName, appName, StringComparison.OrdinalIgnoreCase)
                || title.IndexOf(appName, StringComparison.OrdinalIgnoreCase) >= 0)
            {
                try
                {
                    var element = _automation.FromHandle(hwnd);
                    if (element is not null) return element;
                }
                catch { /* next candidate */ }
            }
        }

        // Last-resort: walk desktop children (covers controls that have
        // no native HWND, e.g. some overlay surfaces).
        foreach (var child in desktop.FindAllChildren())
        {
            try
            {
                var name = child.Properties.Name.ValueOrDefault ?? string.Empty;
                if (name.IndexOf(appName, StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    return child;
                }
            }
            catch { }
        }
        return null;
    }

    private static void WalkAndFilter(
        AutomationElement node,
        int[] path,
        string? nameFilter,
        string? roleFilter,
        int limit,
        List<(AutomationElement, int[], string)> hits,
        string processName)
    {
        if (hits.Count >= limit) return;
        if (Matches(node, nameFilter, roleFilter))
        {
            hits.Add((node, path, processName));
            if (hits.Count >= limit) return;
        }

        AutomationElement[] children;
        try { children = node.FindAllChildren(); }
        catch { return; }

        for (int i = 0; i < children.Length; i++)
        {
            if (hits.Count >= limit) return;
            var childPath = new int[path.Length + 1];
            Array.Copy(path, childPath, path.Length);
            childPath[path.Length] = i;
            WalkAndFilter(children[i], childPath, nameFilter, roleFilter, limit, hits, processName);
        }
    }

    private static bool Matches(AutomationElement element, string? nameFilter, string? roleFilter)
    {
        if (nameFilter is not null)
        {
            var name = HandleTable.SafeName(element);
            if (name.IndexOf(nameFilter, StringComparison.OrdinalIgnoreCase) < 0) return false;
        }
        if (roleFilter is not null)
        {
            var role = HandleTable.SafeRole(element);
            if (role.IndexOf(roleFilter, StringComparison.OrdinalIgnoreCase) < 0) return false;
        }
        return true;
    }

    private static string GetProcessName(AutomationElement element)
    {
        // Prefer HWND-based lookup — UIA's ProcessId for top-level windows
        // often returns the csrss subsystem PID, not the real owner.
        try
        {
            var hwnd = element.Properties.NativeWindowHandle.ValueOrDefault;
            if (hwnd != IntPtr.Zero)
            {
                var byHwnd = Win32.GetProcessNameByHwnd(hwnd);
                if (byHwnd != "unknown") return byHwnd;
            }
        }
        catch { }

        // Fallback to the UIA property path.
        try
        {
            var pid = element.Properties.ProcessId.Value;
            return Process.GetProcessById(pid).ProcessName;
        }
        catch
        {
            return "unknown";
        }
    }

    // ---------------------------------------------------------------
    //  tree
    // ---------------------------------------------------------------

    private JsonNode TreeImpl(JsonObject p)
    {
        var handleNode = p["handle"] as JsonObject;
        var depth = p["depth"]?.GetValue<int>() ?? DefaultTreeDepth;

        AutomationElement root;
        int[] rootPath;
        string processName;

        if (handleNode is not null && handleNode["id"]?.GetValue<string>() is string id)
        {
            var resolved = _handles.Resolve(id, _automation);
            if (resolved is null)
            {
                return new JsonObject { ["ok"] = false, ["error"] = "handle not found" };
            }
            root = resolved;
            var parts = id.Split("::", 2);
            processName = parts[0];
            rootPath = parts.Length > 1 && !string.IsNullOrEmpty(parts[1])
                ? parts[1].Split("/").Select(int.Parse).ToArray()
                : Array.Empty<int>();
        }
        else
        {
            // Desktop root by default; focus window would be nicer but
            // desktop makes it explicit what's being dumped.
            root = _automation.GetDesktop();
            rootPath = Array.Empty<int>();
            processName = GetProcessName(root);
        }

        var tree = BuildTreeNode(root, rootPath, processName, depth);
        return new JsonObject { ["ok"] = true, ["data"] = tree };
    }

    private JsonObject BuildTreeNode(
        AutomationElement element, int[] path, string processName, int remainingDepth)
    {
        var handle = _handles.Register(element, processName, path);
        var node = new JsonObject
        {
            ["handle"] = handle.DeepClone(),
            ["children"] = new JsonArray(),
        };

        if (remainingDepth <= 0) return node;

        AutomationElement[] children;
        try { children = element.FindAllChildren(); }
        catch { return node; }

        var childArray = (JsonArray)node["children"]!;
        for (int i = 0; i < children.Length; i++)
        {
            var childPath = new int[path.Length + 1];
            Array.Copy(path, childPath, path.Length);
            childPath[path.Length] = i;
            childArray.Add(BuildTreeNode(children[i], childPath, processName, remainingDepth - 1));
        }
        return node;
    }

    // ---------------------------------------------------------------
    //  click — cascade: Invoke → Toggle → SelectionItem → focus+Enter
    //  (mouse cascade is the Node-side fallback after the host bubbles
    //  "cannot" — keeps all SendInput in one place).
    // ---------------------------------------------------------------

    private JsonNode ClickImpl(JsonObject p)
    {
        var element = ResolveHandleOrThrow(p);

        var invoke = element.Patterns.Invoke.PatternOrDefault;
        if (invoke is not null)
        {
            try { invoke.Invoke(); return OkMethod("action"); }
            catch { /* fall through */ }
        }

        var toggle = element.Patterns.Toggle.PatternOrDefault;
        if (toggle is not null)
        {
            try { toggle.Toggle(); return OkMethod("action"); }
            catch { }
        }

        var selectionItem = element.Patterns.SelectionItem.PatternOrDefault;
        if (selectionItem is not null)
        {
            try { selectionItem.Select(); return OkMethod("action"); }
            catch { }
        }

        // focus + Enter
        try
        {
            element.Focus();
            Keyboard.Press(FlaUI.Core.WindowsAPI.VirtualKeyShort.ENTER);
            Keyboard.Release(FlaUI.Core.WindowsAPI.VirtualKeyShort.ENTER);
            return OkMethod("focus+enter");
        }
        catch { }

        // Mouse fallback is handled Node-side — the host signals so.
        return new JsonObject
        {
            ["ok"] = true,
            ["data"] = new JsonObject
            {
                ["method"] = "mouse-required",
                ["boundingRect"] = SerializeRect(element),
            },
        };
    }

    private static JsonObject SerializeRect(AutomationElement element)
    {
        try
        {
            var r = element.BoundingRectangle;
            return new JsonObject
            {
                ["x"] = r.X,
                ["y"] = r.Y,
                ["width"] = r.Width,
                ["height"] = r.Height,
            };
        }
        catch
        {
            return new JsonObject { ["x"] = 0, ["y"] = 0, ["width"] = 0, ["height"] = 0 };
        }
    }

    private static JsonObject OkMethod(string method) => new()
    {
        ["ok"] = true,
        ["data"] = new JsonObject { ["method"] = method },
    };

    // ---------------------------------------------------------------
    //  type
    // ---------------------------------------------------------------

    private JsonNode TypeImpl(JsonObject p)
    {
        var text = p["text"]?.GetValue<string>() ?? string.Empty;
        var handleNode = p["handle"] as JsonObject;

        if (handleNode is not null && handleNode["id"]?.GetValue<string>() is string id)
        {
            var element = _handles.Resolve(id, _automation);
            if (element is null)
            {
                return new JsonObject { ["ok"] = false, ["error"] = "handle not found" };
            }

            var value = element.Patterns.Value.PatternOrDefault;
            if (value is not null && !value.IsReadOnly.ValueOrDefault)
            {
                try { value.SetValue(text); return new JsonObject { ["ok"] = true }; }
                catch { /* fall through to keyboard */ }
            }

            try { element.Focus(); } catch { }
        }

        // Unicode keyboard injection — no handle needed; types at focus.
        Keyboard.Type(text);
        return new JsonObject { ["ok"] = true };
    }

    // ---------------------------------------------------------------
    //  focus
    // ---------------------------------------------------------------

    private JsonNode FocusImpl(JsonObject p)
    {
        var element = ResolveHandleOrThrow(p);
        try
        {
            element.Focus();
            return new JsonObject
            {
                ["ok"] = true,
                ["data"] = new JsonObject { ["focused"] = true },
            };
        }
        catch (Exception ex)
        {
            return new JsonObject
            {
                ["ok"] = true,
                ["data"] = new JsonObject { ["focused"] = false, ["reason"] = ex.Message },
            };
        }
    }

    // ---------------------------------------------------------------
    //  invoke — direct pattern dispatch (Windows extra)
    // ---------------------------------------------------------------

    private JsonNode InvokeImpl(JsonObject p)
    {
        var element = ResolveHandleOrThrow(p);
        var pattern = p["pattern"]?.GetValue<string>()
            ?? throw new Rpc.RpcException(-32602, "pattern required");
        var action = p["action"]?.GetValue<string>()
            ?? throw new Rpc.RpcException(-32602, "action required");
        var args = p["params"] as JsonObject ?? new JsonObject();

        switch (pattern)
        {
            case "Invoke":
                element.Patterns.Invoke.Pattern.Invoke();
                return new JsonObject { ["ok"] = true };

            case "Toggle":
                element.Patterns.Toggle.Pattern.Toggle();
                var state = element.Patterns.Toggle.Pattern.ToggleState.Value.ToString();
                return new JsonObject
                {
                    ["ok"] = true,
                    ["data"] = new JsonObject { ["state"] = state },
                };

            case "ExpandCollapse":
                var ec = element.Patterns.ExpandCollapse.Pattern;
                if (action.Equals("Expand", StringComparison.OrdinalIgnoreCase)) ec.Expand();
                else if (action.Equals("Collapse", StringComparison.OrdinalIgnoreCase)) ec.Collapse();
                else throw new Rpc.RpcException(-32602, $"unknown ExpandCollapse action: {action}");
                return new JsonObject { ["ok"] = true };

            case "RangeValue":
                var rv = element.Patterns.RangeValue.Pattern;
                if (action.Equals("SetValue", StringComparison.OrdinalIgnoreCase))
                {
                    var v = args["value"]?.GetValue<double>()
                        ?? throw new Rpc.RpcException(-32602, "value required");
                    rv.SetValue(v);
                }
                else throw new Rpc.RpcException(-32602, $"unknown RangeValue action: {action}");
                return new JsonObject { ["ok"] = true };

            case "Value":
                var vp = element.Patterns.Value.Pattern;
                if (action.Equals("SetValue", StringComparison.OrdinalIgnoreCase))
                {
                    var s = args["value"]?.GetValue<string>() ?? string.Empty;
                    vp.SetValue(s);
                }
                else throw new Rpc.RpcException(-32602, $"unknown Value action: {action}");
                return new JsonObject { ["ok"] = true };

            case "SelectionItem":
                var si = element.Patterns.SelectionItem.Pattern;
                if (action.Equals("Select", StringComparison.OrdinalIgnoreCase)) si.Select();
                else if (action.Equals("AddToSelection", StringComparison.OrdinalIgnoreCase))
                    si.AddToSelection();
                else if (action.Equals("RemoveFromSelection", StringComparison.OrdinalIgnoreCase))
                    si.RemoveFromSelection();
                else throw new Rpc.RpcException(-32602, $"unknown SelectionItem action: {action}");
                return new JsonObject { ["ok"] = true };

            case "Window":
                var wp = element.Patterns.Window.Pattern;
                if (action.Equals("Close", StringComparison.OrdinalIgnoreCase)) wp.Close();
                else throw new Rpc.RpcException(-32602, $"unknown Window action: {action}");
                return new JsonObject { ["ok"] = true };

            case "Scroll":
            case "ScrollItem":
                // Scroll takes horizontal+vertical amount params; omitted
                // until a concrete scenario justifies the API surface.
                throw new Rpc.RpcException(-32601, $"Scroll patterns not yet exposed");

            default:
                throw new Rpc.RpcException(-32601, $"unknown pattern: {pattern}");
        }
    }

    // ---------------------------------------------------------------
    //  wait_for — UIA event subscription (Windows extra)
    // ---------------------------------------------------------------

    private async Task<JsonNode?> WaitForImpl(JsonObject p)
    {
        var eventName = p["event"]?.GetValue<string>()
            ?? throw new Rpc.RpcException(-32602, "event required");
        var timeoutMs = Math.Min(
            MaxWaitTimeoutMs,
            p["timeoutMs"]?.GetValue<int>() ?? DefaultWaitTimeoutMs);
        var match = p["match"] as JsonObject;

        AutomationElement anchor = _automation.GetDesktop();
        if (p["handle"] is JsonObject handleNode
            && handleNode["id"]?.GetValue<string>() is string id)
        {
            anchor = _handles.Resolve(id, _automation) ?? anchor;
        }

        var tcs = new TaskCompletionSource<AutomationElement?>();
        IDisposable? subscription = null;

        try
        {
            subscription = eventName switch
            {
                "structure_changed" => anchor.RegisterStructureChangedEvent(
                    TreeScope.Subtree,
                    (sender, _, _) =>
                    {
                        if (MatchesAnchor(sender, match)) tcs.TrySetResult(sender);
                    }),
                "focus_changed" => _automation.RegisterFocusChangedEvent(sender =>
                {
                    if (MatchesAnchor(sender, match)) tcs.TrySetResult(sender);
                }),
                "property_changed" => RegisterPropertyChange(anchor, match, tcs),
                _ => throw new Rpc.RpcException(-32602, $"unknown event: {eventName}"),
            };

            var winner = await Task.WhenAny(tcs.Task, Task.Delay(timeoutMs)).ConfigureAwait(false);
            if (winner == tcs.Task)
            {
                var el = await tcs.Task.ConfigureAwait(false);
                var handle = el is null
                    ? null
                    : (JsonNode?)_handles.Register(el, GetProcessName(el), Array.Empty<int>());
                return new JsonObject
                {
                    ["ok"] = true,
                    ["data"] = new JsonObject
                    {
                        ["matched"] = true,
                        ["handle"] = handle?.DeepClone(),
                    },
                };
            }

            return new JsonObject
            {
                ["ok"] = true,
                ["data"] = new JsonObject { ["matched"] = false },
            };
        }
        finally
        {
            subscription?.Dispose();
        }
    }

    private static bool MatchesAnchor(AutomationElement? element, JsonObject? match)
    {
        if (element is null) return false;
        if (match is null) return true;
        var name = match["name"]?.GetValue<string>();
        var role = match["role"]?.GetValue<string>();
        var autoId = match["automationId"]?.GetValue<string>();
        if (name is not null
            && HandleTable.SafeName(element).IndexOf(name, StringComparison.OrdinalIgnoreCase) < 0)
            return false;
        if (role is not null
            && HandleTable.SafeRole(element).IndexOf(role, StringComparison.OrdinalIgnoreCase) < 0)
            return false;
        if (autoId is not null)
        {
            try
            {
                var id = element.Properties.AutomationId.ValueOrDefault ?? string.Empty;
                if (id.IndexOf(autoId, StringComparison.OrdinalIgnoreCase) < 0) return false;
            }
            catch { return false; }
        }
        return true;
    }

    private IDisposable RegisterPropertyChange(
        AutomationElement anchor, JsonObject? match, TaskCompletionSource<AutomationElement?> tcs)
    {
        // Default to Name property; caller can narrow via match.property.
        var propName = match?["property"]?.GetValue<string>() ?? "Name";
        PropertyId prop = propName switch
        {
            "Name" => _automation.PropertyLibrary.Element.Name,
            "IsEnabled" => _automation.PropertyLibrary.Element.IsEnabled,
            "IsOffscreen" => _automation.PropertyLibrary.Element.IsOffscreen,
            "BoundingRectangle" => _automation.PropertyLibrary.Element.BoundingRectangle,
            _ => _automation.PropertyLibrary.Element.Name,
        };

        return anchor.RegisterPropertyChangedEvent(
            TreeScope.Subtree,
            (sender, _, _) =>
            {
                if (MatchesAnchor(sender, match)) tcs.TrySetResult(sender);
            },
            prop);
    }

    // ---------------------------------------------------------------
    //  element_from_point (Windows extra)
    // ---------------------------------------------------------------

    private JsonNode ElementFromPointImpl(JsonObject p)
    {
        var x = p["x"]?.GetValue<int>() ?? throw new Rpc.RpcException(-32602, "x required");
        var y = p["y"]?.GetValue<int>() ?? throw new Rpc.RpcException(-32602, "y required");

        var element = _automation.FromPoint(new System.Drawing.Point(x, y));
        if (element is null)
        {
            return new JsonObject { ["ok"] = true, ["data"] = null };
        }

        var handle = _handles.Register(element, GetProcessName(element), Array.Empty<int>());
        return new JsonObject { ["ok"] = true, ["data"] = handle };
    }

    // ---------------------------------------------------------------
    //  read_text (Windows extra)
    // ---------------------------------------------------------------

    private JsonNode ReadTextImpl(JsonObject p)
    {
        var element = ResolveHandleOrThrow(p);
        var textPattern = element.Patterns.Text.PatternOrDefault;
        if (textPattern is null)
        {
            return new JsonObject
            {
                ["ok"] = false,
                ["error"] = "element has no TextPattern",
            };
        }

        var range = p["range"] as JsonObject;
        var documentRange = textPattern.DocumentRange;
        string text;
        if (range is not null
            && range["start"]?.GetValue<int>() is int start
            && range["end"]?.GetValue<int>() is int end
            && end > start)
        {
            var sub = documentRange.Clone();
            // Move endpoints by character offsets.
            sub.MoveEndpointByRange(
                FlaUI.Core.Definitions.TextPatternRangeEndpoint.Start,
                documentRange,
                FlaUI.Core.Definitions.TextPatternRangeEndpoint.Start);
            sub.Move(FlaUI.Core.Definitions.TextUnit.Character, start);
            text = sub.GetText(end - start);
        }
        else
        {
            text = documentRange.GetText(-1);
        }

        var result = new JsonObject { ["text"] = text };

        // Selection
        try
        {
            var selection = textPattern.GetSelection();
            if (selection is not null && selection.Length > 0)
            {
                var arr = new JsonArray();
                foreach (var sel in selection)
                {
                    arr.Add(new JsonObject
                    {
                        ["text"] = sel.GetText(-1),
                    });
                }
                result["selection"] = arr;
            }
        }
        catch { }

        return new JsonObject { ["ok"] = true, ["data"] = result };
    }

    // ---------------------------------------------------------------
    //  with_cache — batched cached subtree ops (Windows extra)
    // ---------------------------------------------------------------

    private JsonNode WithCacheImpl(JsonObject p)
    {
        // MVP: run the sub-ops in sequence without true UIA caching.
        // The wire-level batching still saves round-trips; a later
        // iteration wraps them in CacheRequest.Activate for the real
        // 10-100x speedup.
        var ops = p["ops"] as JsonArray
            ?? throw new Rpc.RpcException(-32602, "ops array required");

        var results = new JsonArray();
        foreach (var op in ops)
        {
            if (op is not JsonObject opNode)
            {
                results.Add(new JsonObject { ["ok"] = false, ["error"] = "non-object op" });
                continue;
            }
            var opName = opNode["op"]?.GetValue<string>();
            JsonNode result = opName switch
            {
                "locate" => LocateImpl(new JsonObject
                {
                    ["query"] = opNode["query"]?.DeepClone(),
                }),
                "tree" => TreeImpl(new JsonObject
                {
                    ["handle"] = p["handle"]?.DeepClone(),
                    ["depth"] = p["depth"]?.DeepClone(),
                }),
                "read_text" => ReadTextImpl(new JsonObject
                {
                    ["handle"] = opNode["handle"]?.DeepClone(),
                }),
                _ => new JsonObject { ["ok"] = false, ["error"] = $"unknown op: {opName}" },
            };
            results.Add(result);
        }

        return new JsonObject
        {
            ["ok"] = true,
            ["data"] = new JsonObject { ["results"] = results },
        };
    }

    // ---------------------------------------------------------------
    //  helpers
    // ---------------------------------------------------------------

    private AutomationElement ResolveHandleOrThrow(JsonObject p)
    {
        var handle = p["handle"] as JsonObject
            ?? throw new Rpc.RpcException(-32602, "handle required");
        var id = handle["id"]?.GetValue<string>()
            ?? throw new Rpc.RpcException(-32602, "handle.id required");
        var element = _handles.Resolve(id, _automation);
        if (element is null)
        {
            throw new Rpc.RpcException(-32000, $"element not found: {id}");
        }
        return element;
    }
}
