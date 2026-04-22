# WinAutomationHost

UI Automation sidecar for control-deck's Windows native adapter.

Electron spawns one long-lived instance; it speaks JSON-RPC 2.0 with
LSP-style `Content-Length` framing on stdio.

## Build

```powershell
dotnet publish -c Release -r win-x64 --self-contained -p:PublishSingleFile=true
```

Output: `bin/Release/net10.0-windows/win-x64/publish/WinAutomationHost.exe`
(single file, self-contained, ~20 MB).

Targets `net10.0-windows` because that's the current installed SDK
(10.0.107). `net8.0-windows` would also work if the .NET 8 targeting
pack were installed — change `<TargetFramework>` in the csproj if you
prefer LTS.

From the repo root, `bun run electron:win-host` wraps the same command
and copies the output into `electron/resources/win/`.

## Wire protocol

Per-message framing:

```
Content-Length: 128\r\n
\r\n
{"jsonrpc":"2.0","id":1,"method":"ping"}
```

Methods: `ping`, `locate`, `click`, `type`, `tree`, `focus`, `invoke`,
`wait_for`, `element_from_point`, `read_text`, `with_cache`, `shutdown`.

Handle id format: `"<process_name>::<path>"` where `path` is the
slash-separated index chain from the app's top-level window. Matches
the Linux adapter so one mental model spans platforms.
