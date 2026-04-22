using System.Text.Json.Nodes;
using ControlDeck.WinHost.Rpc;

namespace ControlDeck.WinHost.Uia;

public sealed partial class UiaSession
{
    internal JsonNode BaselineCaptureImpl(JsonObject p)
    {
        var label = p["label"]?.GetValue<string>();
        var baseline = _baselines.Capture(label);

        var windows = new JsonArray();
        foreach (var w in baseline.Windows)
        {
            windows.Add(new JsonObject
            {
                ["title"] = w.Title,
                ["pid"] = w.Pid,
                ["isModal"] = w.IsModal,
            });
        }

        return new JsonObject
        {
            ["ok"] = true,
            ["data"] = new JsonObject
            {
                ["baselineId"] = baseline.Id,
                ["label"] = baseline.Label,
                ["capturedAt"] = baseline.CapturedAt.ToUnixTimeMilliseconds(),
                ["windows"] = windows,
                ["modalDepth"] = baseline.ModalDepth,
            },
        };
    }

    internal JsonNode BaselineRestoreImpl(JsonObject p)
    {
        var id = p["baselineId"]?.GetValue<string>()
            ?? throw new RpcException(-32602, "baselineId required");
        var strategy = p["strategy"]?.GetValue<string>() ?? "close_modals";
        if (strategy != "close_modals" && strategy != "close_modals_then_focus")
        {
            throw new RpcException(-32602, $"invalid strategy: {strategy}");
        }

        var result = _baselines.Restore(id, strategy);

        var residual = new JsonArray();
        foreach (var r in result.Residual)
        {
            residual.Add(new JsonObject
            {
                ["title"] = r.Title,
                ["pid"] = r.Pid,
            });
        }

        return new JsonObject
        {
            ["ok"] = true,
            ["data"] = new JsonObject
            {
                ["closed"] = result.Closed,
                ["focused"] = result.Focused,
                ["residual"] = residual,
            },
        };
    }
}
