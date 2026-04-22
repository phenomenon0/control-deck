using System;
using System.Threading;
using System.Threading.Tasks;
using ControlDeck.WinHost.Rpc;
using ControlDeck.WinHost.Uia;

namespace ControlDeck.WinHost;

/// <summary>
/// Entry point for WinAutomationHost — the UI Automation sidecar for
/// control-deck's Windows native adapter. Speaks JSON-RPC 2.0 with
/// Content-Length framing over stdio.
///
/// Parent process (Electron main) spawns one long-lived instance and
/// sends locate/click/type/tree/focus/invoke/wait_for/etc. requests.
/// </summary>
internal static class Program
{
    private static async Task<int> Main(string[] args)
    {
        // UIA lives on COM; MTA avoids the classic event deadlock.
        // Explicit call — .NET 8 apps default to MTA, but let's be
        // defensive in case this is ever called from a STA context.
        Thread.CurrentThread.TrySetApartmentState(ApartmentState.MTA);

        // Session wraps FlaUI's UIA3Automation and element cache. One
        // instance per process — UIA automation is thread-safe for
        // reads when using MTA.
        using var session = new UiaSession();
        var dispatcher = new RpcDispatcher(session);
        var loop = new StdioJsonRpcLoop(dispatcher);

        using var cts = new CancellationTokenSource();
        Console.CancelKeyPress += (_, e) =>
        {
            e.Cancel = true;
            cts.Cancel();
        };

        try
        {
            await loop.RunAsync(cts.Token);
            return 0;
        }
        catch (OperationCanceledException)
        {
            return 0;
        }
        catch (Exception ex)
        {
            await Console.Error.WriteLineAsync($"host fatal: {ex}");
            return 1;
        }
    }
}
