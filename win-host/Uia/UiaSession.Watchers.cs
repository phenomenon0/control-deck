using System;
using System.Linq;
using System.Text.Json.Nodes;
using ControlDeck.WinHost.Rpc;

namespace ControlDeck.WinHost.Uia;

public sealed partial class UiaSession
{
    private const int MaxWatcherTtlMs = 1_800_000; // 30 minutes

    internal JsonNode WatchInstallImpl(JsonObject p)
    {
        var match = p["match"] as JsonObject
            ?? throw new RpcException(-32602, "match required");
        var action = p["action"]?.GetValue<string>() ?? "notify";
        if (action != "notify" && action != "dismiss_via_escape" && action != "invoke_button")
        {
            throw new RpcException(-32602, $"invalid action: {action}");
        }

        var ttl = p["ttlMs"]?.GetValue<int>() ?? 300_000;
        if (ttl > MaxWatcherTtlMs) ttl = MaxWatcherTtlMs;
        if (ttl < 1_000) ttl = 1_000;

        var rule = new WatcherRegistry.WatcherRule
        {
            Name = match["name"]?.GetValue<string>(),
            Role = match["role"]?.GetValue<string>(),
            AutomationId = match["automationId"]?.GetValue<string>(),
            App = match["app"]?.GetValue<string>(),
            Action = action,
            ButtonName = p["buttonName"]?.GetValue<string>(),
            Scope = p["scope"]?.GetValue<string>() ?? "desktop",
            TtlMs = ttl,
        };

        if (action == "invoke_button" && string.IsNullOrEmpty(rule.ButtonName))
        {
            throw new RpcException(-32602, "buttonName required when action=invoke_button");
        }

        var id = _watchers.Install(rule);
        return new JsonObject
        {
            ["ok"] = true,
            ["data"] = new JsonObject { ["watchId"] = id },
        };
    }

    internal JsonNode WatchDrainImpl(JsonObject p)
    {
        var watchId = p["watchId"]?.GetValue<string>();
        var delivered = _watchers.Drain(watchId);
        var events = new JsonArray();
        foreach (var ev in delivered)
        {
            events.Add(new JsonObject
            {
                ["watchId"] = ev.WatcherId,
                ["at"] = ev.At.ToUnixTimeMilliseconds(),
                ["kind"] = ev.Kind,
                ["actionTaken"] = ev.ActionTaken,
                ["error"] = ev.Error,
                ["element"] = ev.Handle.DeepClone(),
            });
        }
        return new JsonObject
        {
            ["ok"] = true,
            ["data"] = new JsonObject
            {
                ["events"] = events,
                ["activeWatchers"] = _watchers.ActiveCount,
            },
        };
    }

    internal JsonNode WatchRemoveImpl(JsonObject p)
    {
        var id = p["watchId"]?.GetValue<string>()
            ?? throw new RpcException(-32602, "watchId required");
        var removed = _watchers.Remove(id);
        return new JsonObject
        {
            ["ok"] = true,
            ["data"] = new JsonObject { ["removed"] = removed },
        };
    }
}
