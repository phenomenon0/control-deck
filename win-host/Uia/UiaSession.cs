using System;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using FlaUI.Core;
using FlaUI.UIA3;

namespace ControlDeck.WinHost.Uia;

/// <summary>
/// Wraps FlaUI's <see cref="UIA3Automation"/> with an element cache
/// keyed by our wire-stable handle id (<c>"&lt;process_name&gt;::&lt;path&gt;"</c>).
///
/// Method stubs here are filled in by <see cref="UiaSession.Ops"/>
/// partial files (one per concern: locate, tree, click, type, focus,
/// invoke, events, text, cache). Keeps each concern reviewable on its
/// own.
/// </summary>
public sealed partial class UiaSession : IDisposable
{
    private readonly UIA3Automation _automation;
    private readonly HandleTable _handles;
    private readonly WatcherRegistry _watchers;
    private readonly BaselineRegistry _baselines;

    public UiaSession()
    {
        _automation = new UIA3Automation();
        _handles = new HandleTable();
        _watchers = new WatcherRegistry(_automation, _handles);
        _baselines = new BaselineRegistry(_automation, _handles);
    }

    public AutomationBase Automation => _automation;
    public HandleTable Handles => _handles;

    public void Dispose()
    {
        _watchers.Dispose();
        _automation.Dispose();
    }

    // --- JSON-RPC method surface (stubs filled in by partial files) -----

    public JsonNode Locate(JsonObject p) => LocateImpl(p);
    public JsonNode Click(JsonObject p) => ClickImpl(p);
    public JsonNode Type(JsonObject p) => TypeImpl(p);
    public JsonNode Tree(JsonObject p) => TreeImpl(p);
    public JsonNode Focus(JsonObject p) => FocusImpl(p);
    public JsonNode Invoke(JsonObject p) => InvokeImpl(p);
    public Task<JsonNode?> WaitForAsync(JsonObject p) => WaitForImpl(p);
    public JsonNode ElementFromPoint(JsonObject p) => ElementFromPointImpl(p);
    public JsonNode ReadText(JsonObject p) => ReadTextImpl(p);
    public JsonNode WithCache(JsonObject p) => WithCacheImpl(p);
    public JsonNode WatchInstall(JsonObject p) => WatchInstallImpl(p);
    public JsonNode WatchDrain(JsonObject p) => WatchDrainImpl(p);
    public JsonNode WatchRemove(JsonObject p) => WatchRemoveImpl(p);
    public JsonNode BaselineCapture(JsonObject p) => BaselineCaptureImpl(p);
    public JsonNode BaselineRestore(JsonObject p) => BaselineRestoreImpl(p);
    public JsonNode Launch(JsonObject p) => LaunchImpl(p);
}
