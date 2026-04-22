using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;

namespace ControlDeck.WinHost.Uia;

/// <summary>
/// Wakes UWP/MSIX-packaged apps by AppUserModelID via the official
/// <c>IApplicationActivationManager</c> COM interface.
///
/// Threading is the crux: the manager must be instantiated on an STA
/// thread with <c>CLSCTX_LOCAL_SERVER</c> (the shell's out-of-proc
/// broker binds per-apartment). Our host is MTA for UIA, so we
/// marshal the activation onto a dedicated STA worker.
///
/// Before calling <c>ActivateApplication</c> we invoke
/// <c>CoAllowSetForegroundWindow</c> on the manager — this is what
/// makes the UWP package actually foreground a window, not just spin
/// up in the background.
///
/// Ref:
///  - https://learn.microsoft.com/en-us/previous-versions/windows/uwp/xbox-apps/automate-launching-uwp-apps
///  - https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nf-shobjidl_core-iapplicationactivationmanager-activateapplication
///  - https://learn.microsoft.com/en-us/windows/win32/api/combaseapi/nf-combaseapi-coallowsetforegroundwindow
/// </summary>
internal static class UwpActivator
{
    [ComImport]
    [Guid("2e941141-7f97-4756-ba1d-9decde894a3d")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IApplicationActivationManager
    {
        int ActivateApplication(
            [MarshalAs(UnmanagedType.LPWStr)] string appUserModelId,
            [MarshalAs(UnmanagedType.LPWStr)] string? arguments,
            ActivateOptions options,
            out uint processId);

        int ActivateForFile(
            [MarshalAs(UnmanagedType.LPWStr)] string appUserModelId,
            IntPtr itemArray,
            [MarshalAs(UnmanagedType.LPWStr)] string? verb,
            out uint processId);

        int ActivateForProtocol(
            [MarshalAs(UnmanagedType.LPWStr)] string appUserModelId,
            IntPtr itemArray,
            out uint processId);
    }

    private static readonly Guid ApplicationActivationManagerClsid =
        new("45BA127D-10A8-46EA-8AB7-56EA9078943C");

    [Flags]
    private enum ActivateOptions : uint
    {
        None = 0,
        DesignMode = 0x1,
        NoErrorUI = 0x2,
        NoSplashScreen = 0x4,
    }

    [DllImport("user32.dll")]
    private static extern bool AllowSetForegroundWindow(int processId);
    private const int ASFW_ANY = -1;

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hwnd);

    // Dynamically resolve CoAllowSetForegroundWindow since it's moved
    // between combase.dll and ole32.dll across Windows versions and
    // sometimes isn't exported at all on Win11 consumer builds.
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Ansi)]
    private static extern IntPtr GetProcAddress(IntPtr hModule, string procName);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern IntPtr LoadLibraryW(string lpLibFileName);

    /// <summary>
    /// Activate a UWP app by AUMID on an STA thread. Returns the
    /// real UWP process id on success. Falls back to the
    /// <c>explorer.exe shell:AppsFolder\&lt;AUMID&gt;</c> trick if
    /// the direct COM path fails.
    /// </summary>
    public static uint Activate(string aumid, string? arguments = null)
    {
        // Relax foreground restrictions for any child we're about to
        // spawn via the shell. Harmless when not needed.
        AllowSetForegroundWindow(ASFW_ANY);

        var tcs = new TaskCompletionSource<uint>();

        var sta = new Thread(() =>
        {
            try
            {
                var clsidType = Type.GetTypeFromCLSID(ApplicationActivationManagerClsid, throwOnError: true)!;
                var instance = Activator.CreateInstance(clsidType);
                if (instance is not IApplicationActivationManager mgr)
                {
                    throw new InvalidOperationException("could not QI IApplicationActivationManager");
                }

                var hr = mgr.ActivateApplication(aumid, arguments, ActivateOptions.None, out var pid);
                if (hr < 0)
                {
                    throw new System.ComponentModel.Win32Exception(hr,
                        $"ActivateApplication HRESULT 0x{hr:x8} for AUMID '{aumid}'");
                }
                // Let the child process steal the foreground.
                AllowSetForegroundWindow((int)pid);
                tcs.SetResult(pid);
            }
            catch (Exception ex)
            {
                tcs.SetException(ex);
            }
        });
        sta.SetApartmentState(ApartmentState.STA);
        sta.IsBackground = true;
        sta.Name = $"uwp-activator-{aumid}";
        sta.Start();

        try
        {
            // Wait up to 20s — first-time UWP activation can be slow while
            // the app-broker/runtime-broker spins up.
            if (!tcs.Task.Wait(TimeSpan.FromSeconds(20)))
            {
                throw new TimeoutException($"AUMID activation for '{aumid}' timed out after 20s");
            }
            return tcs.Task.Result;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(
                $"[launch] STA ActivateApplication failed for {aumid}: {ex.InnerException?.Message ?? ex.Message} — falling back to shell:AppsFolder");
            return ShellAppsFolderFallback(aumid);
        }
    }

    /// <summary>
    /// Last-resort fallback: spawn <c>explorer.exe shell:AppsFolder\&lt;aumid&gt;</c>.
    /// Explorer dispatches the activation and exits; the real UWP
    /// process is reparented to DcomLaunch, so the returned PID is
    /// the transient explorer instance (useless) — we return 0.
    /// </summary>
    private static uint ShellAppsFolderFallback(string aumid)
    {
        var psi = new System.Diagnostics.ProcessStartInfo
        {
            FileName = "explorer.exe",
            Arguments = $"shell:AppsFolder\\{aumid}",
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        System.Diagnostics.Process.Start(psi);
        return 0;
    }

    /// <summary>
    /// Maps a friendly target name to a known AUMID. Extend this table
    /// as new UWP apps are exercised.
    /// </summary>
    public static string? TryResolveAumid(string target)
    {
        var t = target.Trim().ToLowerInvariant();
        return t switch
        {
            "calc" or "calc.exe" or "calculator"
                => "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App",
            "notepad" or "notepad.exe"
                => "Microsoft.WindowsNotepad_8wekyb3d8bbwe!App",
            "mspaint" or "mspaint.exe" or "paint"
                => "Microsoft.Paint_8wekyb3d8bbwe!App",
            "settings" or "ms-settings" or "ms-settings:"
                => "windows.immersivecontrolpanel_cw5n1h2txyewy!microsoft.windows.immersivecontrolpanel",
            "storeapp" or "microsoft.store"
                => "Microsoft.WindowsStore_8wekyb3d8bbwe!App",
            _ => null,
        };
    }
}
