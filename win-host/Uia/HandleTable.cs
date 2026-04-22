using System;
using System.Collections.Concurrent;
using System.Linq;
using System.Text;
using System.Text.Json.Nodes;
using FlaUI.Core;
using FlaUI.Core.AutomationElements;

namespace ControlDeck.WinHost.Uia;

/// <summary>
/// Maps our wire-stable handle id (<c>"&lt;process_name&gt;::&lt;path&gt;"</c>)
/// to the live <see cref="AutomationElement"/>. The path is the index
/// of each node within its parent, rooted at the process's top window
/// — it matches the Linux adapter's scheme exactly so the LLM has one
/// mental model.
///
/// RuntimeIds are NOT used as the wire id because they live only for
/// the element's lifetime. The path is recoverable across process
/// lifetimes; we re-walk from the root on cache miss.
/// </summary>
public sealed class HandleTable
{
    private readonly ConcurrentDictionary<string, WeakReference<AutomationElement>> _cache = new();

    /// <summary>
    /// Register an element under a freshly minted id and return a wire
    /// handle (id + role + name + path).
    /// </summary>
    public JsonObject Register(AutomationElement element, string processName, int[] path)
    {
        var pathStr = string.Join("/", path);
        var id = $"{processName}::{pathStr}";
        _cache[id] = new WeakReference<AutomationElement>(element);

        return new JsonObject
        {
            ["id"] = id,
            ["role"] = SafeRole(element),
            ["name"] = SafeName(element),
            ["path"] = pathStr,
            ["bounds"] = SafeBounds(element),
        };
    }

    public static JsonNode SafeBounds(AutomationElement element)
    {
        try
        {
            var r = element.BoundingRectangle;
            if (r.IsEmpty) return null!;
            return new JsonObject
            {
                ["x"] = (int)r.X,
                ["y"] = (int)r.Y,
                ["width"] = (int)r.Width,
                ["height"] = (int)r.Height,
            };
        }
        catch
        {
            return null!;
        }
    }

    /// <summary>
    /// Look up the element for a handle id. Falls back to re-walking
    /// the tree from the process root if the weak ref has expired.
    /// </summary>
    public AutomationElement? Resolve(string id, AutomationBase automation)
    {
        if (_cache.TryGetValue(id, out var weak) && weak.TryGetTarget(out var el))
        {
            try
            {
                // Probe to detect zombie references (element gone).
                _ = el.Properties.ControlType.Value;
                return el;
            }
            catch
            {
                _cache.TryRemove(id, out _);
            }
        }

        // Fallback: re-walk from desktop root by process + path.
        var parts = id.Split("::", 2);
        if (parts.Length != 2) return null;
        var processName = parts[0];
        var path = parts[1].Split("/", StringSplitOptions.RemoveEmptyEntries);

        var desktop = automation.GetDesktop();
        AutomationElement? node = FindAppRoot(desktop, processName);
        if (node is null) return null;

        foreach (var seg in path)
        {
            if (!int.TryParse(seg, out var idx)) return null;
            var children = node.FindAllChildren();
            if (idx < 0 || idx >= children.Length) return null;
            node = children[idx];
        }

        if (node is not null)
        {
            _cache[id] = new WeakReference<AutomationElement>(node);
        }
        return node;
    }

    private static AutomationElement? FindAppRoot(AutomationElement desktop, string processName)
    {
        foreach (var child in desktop.FindAllChildren())
        {
            try
            {
                var pid = child.Properties.ProcessId.Value;
                var name = System.Diagnostics.Process.GetProcessById(pid).ProcessName;
                if (string.Equals(name, processName, StringComparison.OrdinalIgnoreCase))
                {
                    return child;
                }
            }
            catch
            {
                // Process may have exited between enumeration and lookup.
            }
        }
        return null;
    }

    public static string SafeRole(AutomationElement element)
    {
        try { return element.Properties.ControlType.Value.ToString().ToLowerInvariant(); }
        catch { return "unknown"; }
    }

    public static string SafeName(AutomationElement element)
    {
        try { return element.Properties.Name.ValueOrDefault ?? string.Empty; }
        catch { return string.Empty; }
    }
}
