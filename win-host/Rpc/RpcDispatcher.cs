using System;
using System.Reflection;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using ControlDeck.WinHost.Uia;

namespace ControlDeck.WinHost.Rpc;

/// <summary>
/// Routes JSON-RPC method calls to <see cref="UiaSession"/>. Methods
/// match the wire protocol exactly (snake_case):
///   ping, locate, click, type, tree, focus, key (no-op — Node side),
///   invoke, wait_for, element_from_point, read_text, with_cache,
///   shutdown.
/// </summary>
public sealed class RpcDispatcher
{
    private readonly UiaSession _session;

    public RpcDispatcher(UiaSession session)
    {
        _session = session;
    }

    public Task<JsonNode?> DispatchAsync(string method, JsonObject? parameters)
    {
        return method switch
        {
            "ping" => Task.FromResult<JsonNode?>(Ping()),
            "locate" => Task.FromResult<JsonNode?>(_session.Locate(parameters ?? new())),
            "click" => Task.FromResult<JsonNode?>(_session.Click(parameters ?? new())),
            "type" => Task.FromResult<JsonNode?>(_session.Type(parameters ?? new())),
            "tree" => Task.FromResult<JsonNode?>(_session.Tree(parameters ?? new())),
            "focus" => Task.FromResult<JsonNode?>(_session.Focus(parameters ?? new())),
            "invoke" => Task.FromResult<JsonNode?>(_session.Invoke(parameters ?? new())),
            "wait_for" => _session.WaitForAsync(parameters ?? new()),
            "element_from_point" => Task.FromResult<JsonNode?>(_session.ElementFromPoint(parameters ?? new())),
            "read_text" => Task.FromResult<JsonNode?>(_session.ReadText(parameters ?? new())),
            "with_cache" => Task.FromResult<JsonNode?>(_session.WithCache(parameters ?? new())),
            "watch_install" => Task.FromResult<JsonNode?>(_session.WatchInstall(parameters ?? new())),
            "watch_drain" => Task.FromResult<JsonNode?>(_session.WatchDrain(parameters ?? new())),
            "watch_remove" => Task.FromResult<JsonNode?>(_session.WatchRemove(parameters ?? new())),
            "baseline_capture" => Task.FromResult<JsonNode?>(_session.BaselineCapture(parameters ?? new())),
            "baseline_restore" => Task.FromResult<JsonNode?>(_session.BaselineRestore(parameters ?? new())),
            "launch" => Task.FromResult<JsonNode?>(_session.Launch(parameters ?? new())),
            "shutdown" => Task.FromResult<JsonNode?>(Shutdown()),
            _ => throw new RpcException(-32601, $"method not found: {method}"),
        };
    }

    private static JsonNode Ping()
    {
        var version = Assembly.GetExecutingAssembly().GetName().Version?.ToString() ?? "0.0.0";
        return new JsonObject
        {
            ["ok"] = true,
            ["version"] = version,
            ["platform"] = "win32",
        };
    }

    private static JsonNode Shutdown()
    {
        // Caller reads the response, then we exit after it flushes.
        // Delay on a background thread so the stdout write completes.
        _ = Task.Run(async () =>
        {
            await Task.Delay(100).ConfigureAwait(false);
            Environment.Exit(0);
        });
        return new JsonObject { ["ok"] = true };
    }
}
