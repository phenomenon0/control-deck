using System;
using System.Diagnostics;
using System.Text.Json.Nodes;
using ControlDeck.WinHost.Rpc;

namespace ControlDeck.WinHost.Uia;

public sealed partial class UiaSession
{
    internal JsonNode LaunchImpl(JsonObject p)
    {
        var target = p["target"]?.GetValue<string>()
            ?? throw new RpcException(-32602, "target required");
        var args = p["args"]?.GetValue<string>();
        var explicitAumid = p["aumid"]?.GetValue<string>();
        var preferShell = p["preferShell"]?.GetValue<bool>() ?? false;

        // 1. If the caller passed an AUMID explicitly, or if the target
        //    resolves to a known UWP app, use IApplicationActivationManager.
        //    This is the only reliable way to wake UWP packages from a
        //    non-interactive subprocess chain on Win11.
        var aumid = explicitAumid ?? (preferShell ? null : UwpActivator.TryResolveAumid(target));
        if (!string.IsNullOrEmpty(aumid))
        {
            try
            {
                var pid = UwpActivator.Activate(aumid, args);
                return new JsonObject
                {
                    ["ok"] = true,
                    ["data"] = new JsonObject
                    {
                        ["via"] = "uwp_activator",
                        ["aumid"] = aumid,
                        ["pid"] = pid,
                    },
                };
            }
            catch (Exception ex)
            {
                // Fall through to ShellExecute if activation fails.
                Console.Error.WriteLine($"[launch] AUMID activate failed for {aumid}: {ex.Message} — falling back to ShellExecute");
            }
        }

        // 2. ShellExecute fallback — good for Win32 exes, URIs, files.
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = target,
                UseShellExecute = true,
                CreateNoWindow = false,
            };
            if (!string.IsNullOrEmpty(args)) psi.Arguments = args;

            var proc = Process.Start(psi);
            return new JsonObject
            {
                ["ok"] = true,
                ["data"] = new JsonObject
                {
                    ["via"] = "shell_execute",
                    ["pid"] = proc?.Id,
                    ["target"] = target,
                },
            };
        }
        catch (Exception ex)
        {
            return new JsonObject
            {
                ["ok"] = false,
                ["error"] = $"launch failed: {ex.Message}",
            };
        }
    }
}
