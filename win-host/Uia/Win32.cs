using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

namespace ControlDeck.WinHost.Uia;

/// <summary>
/// Minimal Win32 P/Invokes used to replace unreliable UIA tree-walks:
/// <list type="bullet">
///   <item>
///     <c>EnumWindows</c> + <c>IsWindowVisible</c> — reliably enumerate
///     top-level windows, including UWP apps that UIA's
///     <c>desktop.FindAllChildren()</c> sometimes drops on Win11.
///   </item>
///   <item>
///     <c>GetWindowThreadProcessId</c> + <c>QueryFullProcessImageName</c>
///     — return the real owning process name, not the "csrss" lie that
///     UIA's <c>Properties.ProcessId</c> path produces for top-level
///     windows.
///   </item>
/// </list>
/// </summary>
internal static class Win32
{
    public delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hwnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowTextW(IntPtr hwnd, StringBuilder buf, int maxChars);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowTextLengthW(IntPtr hwnd);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);

    [DllImport("user32.dll")]
    public static extern IntPtr GetShellWindow();

    [DllImport("kernel32.dll")]
    public static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);

    [DllImport("kernel32.dll")]
    public static extern bool CloseHandle(IntPtr hObject);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    public static extern bool QueryFullProcessImageNameW(
        IntPtr hProcess, uint flags, StringBuilder exeName, ref int size);

    private const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

    /// <summary>
    /// Returns all top-level visible windows with non-empty titles.
    /// Excludes the shell window itself (Program Manager / Progman).
    /// </summary>
    public static List<IntPtr> EnumVisibleWindows()
    {
        var shell = GetShellWindow();
        var buf = new StringBuilder(512);
        var results = new List<IntPtr>();

        EnumWindows((hwnd, _) =>
        {
            if (hwnd == shell) return true;
            if (!IsWindowVisible(hwnd)) return true;
            var len = GetWindowTextLengthW(hwnd);
            if (len == 0) return true;
            results.Add(hwnd);
            return true;
        }, IntPtr.Zero);

        return results;
    }

    /// <summary>
    /// Returns the owning process's short name (e.g. "notepad", "CalculatorApp").
    /// Falls back to "unknown" on failure.
    /// </summary>
    public static string GetProcessNameByHwnd(IntPtr hwnd)
    {
        try
        {
            GetWindowThreadProcessId(hwnd, out var pid);
            if (pid == 0) return "unknown";
            var hProc = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
            if (hProc == IntPtr.Zero) return "unknown";
            try
            {
                int cap = 1024;
                var exe = new StringBuilder(cap);
                if (!QueryFullProcessImageNameW(hProc, 0, exe, ref cap)) return "unknown";
                var full = exe.ToString();
                var slash = full.LastIndexOfAny(new[] { '\\', '/' });
                var basename = slash >= 0 ? full.Substring(slash + 1) : full;
                // Strip .exe suffix for a cleaner handle id.
                if (basename.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
                {
                    basename = basename.Substring(0, basename.Length - 4);
                }
                return basename;
            }
            finally { CloseHandle(hProc); }
        }
        catch { return "unknown"; }
    }

    public static string GetWindowTextSafe(IntPtr hwnd)
    {
        var len = GetWindowTextLengthW(hwnd);
        if (len <= 0) return string.Empty;
        var buf = new StringBuilder(len + 1);
        GetWindowTextW(hwnd, buf, buf.Capacity);
        return buf.ToString();
    }
}
