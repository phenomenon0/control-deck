using System;
using System.Buffers;
using System.IO;
using System.IO.Pipelines;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;

namespace ControlDeck.WinHost.Rpc;

/// <summary>
/// Reads LSP-style Content-Length-framed JSON-RPC requests from stdin,
/// dispatches them, writes responses to stdout. Matches what
/// windows-host-client.ts on the Node side expects.
/// </summary>
public sealed class StdioJsonRpcLoop
{
    private readonly RpcDispatcher _dispatcher;
    private readonly SemaphoreSlim _writeLock = new(1, 1);

    public StdioJsonRpcLoop(RpcDispatcher dispatcher)
    {
        _dispatcher = dispatcher;
    }

    public async Task RunAsync(CancellationToken cancel)
    {
        var stdin = Console.OpenStandardInput();
        var stdout = Console.OpenStandardOutput();
        var reader = PipeReader.Create(stdin);

        while (!cancel.IsCancellationRequested)
        {
            var result = await reader.ReadAsync(cancel).ConfigureAwait(false);
            var buffer = result.Buffer;

            while (TryReadMessage(ref buffer, out var payload))
            {
                // Dispatch without awaiting so concurrent calls don't
                // serialize behind each other. Errors in one request
                // mustn't kill the loop.
                _ = HandleAsync(payload, stdout);
            }

            reader.AdvanceTo(buffer.Start, buffer.End);

            if (result.IsCompleted) break;
        }

        await reader.CompleteAsync().ConfigureAwait(false);
    }

    private async Task HandleAsync(byte[] payload, Stream stdout)
    {
        JsonNode? request;
        try
        {
            request = JsonNode.Parse(payload);
        }
        catch (Exception ex)
        {
            await WriteErrorAsync(stdout, null, -32700, $"parse error: {ex.Message}").ConfigureAwait(false);
            return;
        }

        if (request is null)
        {
            await WriteErrorAsync(stdout, null, -32600, "empty request").ConfigureAwait(false);
            return;
        }

        var id = request["id"];
        var method = request["method"]?.GetValue<string>();
        var parameters = request["params"] as JsonObject;

        if (string.IsNullOrEmpty(method))
        {
            await WriteErrorAsync(stdout, id, -32600, "missing method").ConfigureAwait(false);
            return;
        }

        try
        {
            var response = await _dispatcher.DispatchAsync(method, parameters).ConfigureAwait(false);
            await WriteSuccessAsync(stdout, id, response).ConfigureAwait(false);
        }
        catch (RpcException rpcEx)
        {
            await WriteErrorAsync(stdout, id, rpcEx.Code, rpcEx.Message).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            await WriteErrorAsync(stdout, id, -32000, ex.Message).ConfigureAwait(false);
        }
    }

    private async Task WriteSuccessAsync(Stream stdout, JsonNode? id, JsonNode? result)
    {
        var response = new JsonObject
        {
            ["jsonrpc"] = "2.0",
            ["id"] = id?.DeepClone(),
            ["result"] = result?.DeepClone(),
        };
        await WriteAsync(stdout, response).ConfigureAwait(false);
    }

    private async Task WriteErrorAsync(Stream stdout, JsonNode? id, int code, string message)
    {
        var response = new JsonObject
        {
            ["jsonrpc"] = "2.0",
            ["id"] = id?.DeepClone(),
            ["error"] = new JsonObject
            {
                ["code"] = code,
                ["message"] = message,
            },
        };
        await WriteAsync(stdout, response).ConfigureAwait(false);
    }

    private async Task WriteAsync(Stream stdout, JsonObject message)
    {
        var json = message.ToJsonString();
        var body = Encoding.UTF8.GetBytes(json);
        var header = Encoding.ASCII.GetBytes($"Content-Length: {body.Length}\r\n\r\n");

        await _writeLock.WaitAsync().ConfigureAwait(false);
        try
        {
            await stdout.WriteAsync(header).ConfigureAwait(false);
            await stdout.WriteAsync(body).ConfigureAwait(false);
            await stdout.FlushAsync().ConfigureAwait(false);
        }
        finally
        {
            _writeLock.Release();
        }
    }

    /// <summary>
    /// Parses one Content-Length-framed message from the buffer, if a
    /// complete one is available. Advances <paramref name="buffer"/>
    /// past the consumed bytes on success.
    /// </summary>
    private static bool TryReadMessage(ref ReadOnlySequence<byte> buffer, out byte[] payload)
    {
        payload = Array.Empty<byte>();

        // Find "\r\n\r\n" separating headers from body.
        var reader = new SequenceReader<byte>(buffer);
        if (!reader.TryReadTo(out ReadOnlySequence<byte> headerSequence, "\r\n\r\n"u8, advancePastDelimiter: true))
        {
            return false;
        }

        var headerText = Encoding.ASCII.GetString(headerSequence);
        int contentLength = ParseContentLength(headerText);
        if (contentLength <= 0)
        {
            // Malformed header — skip past it so we don't loop on the same bytes.
            buffer = buffer.Slice(reader.Position);
            return false;
        }

        if (reader.Remaining < contentLength)
        {
            return false;
        }

        var bodySlice = reader.Sequence.Slice(reader.Position, contentLength);
        payload = bodySlice.ToArray();

        reader.Advance(contentLength);
        buffer = buffer.Slice(reader.Position);
        return true;
    }

    private static int ParseContentLength(string headerText)
    {
        foreach (var line in headerText.Split("\r\n", StringSplitOptions.RemoveEmptyEntries))
        {
            var colon = line.IndexOf(':');
            if (colon < 0) continue;
            var name = line.AsSpan(0, colon).Trim();
            if (!name.Equals("Content-Length", StringComparison.OrdinalIgnoreCase)) continue;
            var value = line.AsSpan(colon + 1).Trim();
            if (int.TryParse(value, out var len)) return len;
        }
        return -1;
    }
}

public sealed class RpcException : Exception
{
    public int Code { get; }

    public RpcException(int code, string message) : base(message)
    {
        Code = code;
    }
}
