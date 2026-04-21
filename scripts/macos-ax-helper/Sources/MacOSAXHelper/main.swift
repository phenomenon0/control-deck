// macOS accessibility helper for Control Deck.
//
// Protocol: reads a single JSON command from stdin, writes a single JSON
// result to stdout. Mirrors the shape of scripts/atspi-helper.py so the
// lib/tools/native/macos-ax.ts adapter can treat both helpers identically.
//
// Ops:
//   {"op":"available"}                       -> {"ok":true,"data":{"trusted":bool}}
//   {"op":"locate","query":{...}}            -> {"ok":true,"data":[NodeHandle]}
//   {"op":"click","handle":NodeHandle}       -> {"ok":true,"data":{"method":"action"|"focus+enter"|"mouse"}}
//   {"op":"type","handle":NodeHandle?,"text":"..."} -> {"ok":true}
//   {"op":"tree","handle":NodeHandle?}       -> {"ok":true,"data":TreeNode}
//   {"op":"key","key":"Ctrl+Shift+t"}        -> {"ok":true}
//   {"op":"focus","handle":NodeHandle}       -> {"ok":true,"data":{"focused":bool}}
//   {"op":"focus_window","app_id":"com.apple.calculator"} -> {"ok":true,"data":{"dispatched":bool}}
//   {"op":"click_pixel","x":100,"y":200,"button":"left"} -> {"ok":true,"data":{"x":100,"y":200}}
//
// NodeHandle shape: {"id":"<pid>:<idx.idx.idx>","role":"...","name":"...","path":"..."}
//
// The id is reconstructable: the helper re-walks the element tree each call
// using the stored index path. Stale handles (index shifted, window closed)
// surface as "element not found" errors rather than crashes.

import Foundation
import AppKit
import ApplicationServices

// MARK: - JSON helpers

struct HelperResponse: Encodable {
    let ok: Bool
    let error: String?
    let data: JSONValue?

    static func success(_ value: JSONValue? = nil) -> HelperResponse {
        HelperResponse(ok: true, error: nil, data: value)
    }

    static func failure(_ message: String) -> HelperResponse {
        HelperResponse(ok: false, error: message, data: nil)
    }
}

indirect enum JSONValue: Encodable {
    case null
    case bool(Bool)
    case int(Int)
    case double(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .null: try container.encodeNil()
        case .bool(let v): try container.encode(v)
        case .int(let v): try container.encode(v)
        case .double(let v): try container.encode(v)
        case .string(let v): try container.encode(v)
        case .array(let a): try container.encode(a)
        case .object(let o): try container.encode(o)
        }
    }
}

func emit(_ response: HelperResponse) -> Never {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    if let data = try? encoder.encode(response),
       let s = String(data: data, encoding: .utf8) {
        FileHandle.standardOutput.write(Data((s + "\n").utf8))
    }
    exit(response.ok ? 0 : 1)
}

// MARK: - NodeHandle encoding

struct NodeHandle {
    let pid: pid_t
    let indexPath: [Int]
    let role: String?
    let name: String?

    var id: String {
        let path = indexPath.map(String.init).joined(separator: ".")
        return "\(pid):\(path)"
    }

    static func parse(_ id: String) -> (pid_t, [Int])? {
        let parts = id.split(separator: ":", maxSplits: 1)
        guard parts.count == 2, let pid = pid_t(parts[0]) else { return nil }
        let pathStr = String(parts[1])
        if pathStr.isEmpty { return (pid, []) }
        let indices = pathStr.split(separator: ".").compactMap { Int($0) }
        return (pid, indices)
    }

    func toJSON() -> JSONValue {
        var obj: [String: JSONValue] = ["id": .string(id)]
        if let r = role { obj["role"] = .string(r) }
        if let n = name { obj["name"] = .string(n) }
        let p = indexPath.map(String.init).joined(separator: "/")
        if !p.isEmpty { obj["path"] = .string(p) }
        return .object(obj)
    }
}

// MARK: - AX attribute helpers

func axString(_ element: AXUIElement, _ attr: String) -> String? {
    var value: AnyObject?
    guard AXUIElementCopyAttributeValue(element, attr as CFString, &value) == .success else {
        return nil
    }
    return value as? String
}

func axBool(_ element: AXUIElement, _ attr: String) -> Bool? {
    var value: AnyObject?
    guard AXUIElementCopyAttributeValue(element, attr as CFString, &value) == .success else {
        return nil
    }
    return value as? Bool
}

func axElement(_ element: AXUIElement, _ attr: String) -> AXUIElement? {
    var value: AnyObject?
    guard AXUIElementCopyAttributeValue(element, attr as CFString, &value) == .success else {
        return nil
    }
    guard let v = value, CFGetTypeID(v as CFTypeRef) == AXUIElementGetTypeID() else {
        return nil
    }
    return (v as! AXUIElement)
}

func axChildren(_ element: AXUIElement) -> [AXUIElement] {
    var value: AnyObject?
    guard AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &value) == .success,
          let arr = value as? [AXUIElement] else {
        return []
    }
    return arr
}

func axActions(_ element: AXUIElement) -> [String] {
    var arr: CFArray?
    guard AXUIElementCopyActionNames(element, &arr) == .success,
          let names = arr as? [String] else {
        return []
    }
    return names
}

// MARK: - Tree walk

func appElement(for pid: pid_t) -> AXUIElement {
    return AXUIElementCreateApplication(pid)
}

func descend(from root: AXUIElement, path: [Int]) -> AXUIElement? {
    var current = root
    for idx in path {
        let children = axChildren(current)
        guard idx >= 0, idx < children.count else { return nil }
        current = children[idx]
    }
    return current
}

func makeHandle(for element: AXUIElement, pid: pid_t, indexPath: [Int]) -> NodeHandle {
    return NodeHandle(
        pid: pid,
        indexPath: indexPath,
        role: axString(element, kAXRoleAttribute),
        name: axString(element, kAXTitleAttribute)
            ?? axString(element, kAXDescriptionAttribute)
            ?? axString(element, kAXValueAttribute)
    )
}

// MARK: - App resolution

func runningApps(matching query: String?) -> [NSRunningApplication] {
    let all = NSWorkspace.shared.runningApplications
        .filter { $0.processIdentifier > 0 }
    guard let q = query?.lowercased(), !q.isEmpty else { return all }
    return all.filter { app in
        if let b = app.bundleIdentifier?.lowercased(), b == q || b.contains(q) {
            return true
        }
        if let n = app.localizedName?.lowercased(), n == q || n.contains(q) {
            return true
        }
        return false
    }
}

// MARK: - Locate

func locate(query: [String: Any]) -> HelperResponse {
    let nameFilter = (query["name"] as? String)?.lowercased()
    let roleFilter = query["role"] as? String
    let appFilter = query["app"] as? String
    let limit = (query["limit"] as? Int) ?? 100

    let apps = runningApps(matching: appFilter)
    if apps.isEmpty {
        return .failure("no running app matched \(appFilter ?? "<all>")")
    }

    var results: [NodeHandle] = []
    for app in apps {
        let pid = app.processIdentifier
        let root = appElement(for: pid)
        var stack: [(AXUIElement, [Int])] = [(root, [])]
        while !stack.isEmpty, results.count < limit {
            let (el, pathSoFar) = stack.removeLast()
            let role = axString(el, kAXRoleAttribute)
            let name = axString(el, kAXTitleAttribute)
                ?? axString(el, kAXDescriptionAttribute)
            let roleOK = roleFilter.map { $0.caseInsensitiveCompare(role ?? "") == .orderedSame } ?? true
            let nameOK = nameFilter.map { (name ?? "").lowercased().contains($0) } ?? true
            if roleOK && nameOK && pathSoFar.count > 0 {
                // skip the root app element itself unless the caller asked for it
                results.append(makeHandle(for: el, pid: pid, indexPath: pathSoFar))
                if results.count >= limit { break }
            }
            let children = axChildren(el)
            // Depth-first walk; push in reverse so index 0 processes first.
            for (i, child) in children.enumerated().reversed() {
                stack.append((child, pathSoFar + [i]))
            }
        }
    }

    return .success(.array(results.map { $0.toJSON() }))
}

// MARK: - Click cascade

func resolveHandle(_ handleJSON: [String: Any]) -> (AXUIElement, NodeHandle)? {
    guard let idRaw = handleJSON["id"] as? String,
          let parsed = NodeHandle.parse(idRaw) else { return nil }
    let (pid, indices) = parsed
    let root = appElement(for: pid)
    guard let el = descend(from: root, path: indices) else { return nil }
    let handle = makeHandle(for: el, pid: pid, indexPath: indices)
    return (el, handle)
}

func clickElement(_ element: AXUIElement) -> String {
    // 1) Try AXPress action (works for almost all toolkit buttons, menu items).
    let actions = axActions(element)
    if actions.contains(kAXPressAction as String) {
        if AXUIElementPerformAction(element, kAXPressAction as CFString) == .success {
            return "action"
        }
    }
    for alt in [kAXShowMenuAction, kAXPickAction, kAXConfirmAction] {
        let name = alt as String
        if actions.contains(name) {
            if AXUIElementPerformAction(element, name as CFString) == .success {
                return "action"
            }
        }
    }

    // 2) Focus + Return key (works for text fields with default buttons)
    if AXUIElementSetAttributeValue(element, kAXFocusedAttribute as CFString, true as CFBoolean) == .success {
        postKeyEvent(keyCode: 0x24, flags: []) // kVK_Return
        return "focus+enter"
    }

    // 3) Fall back to a CGEvent synthetic mouse click at the element's
    //    position.  Needs the AXPosition + AXSize attributes.
    var posValue: AnyObject?
    var sizeValue: AnyObject?
    _ = AXUIElementCopyAttributeValue(element, kAXPositionAttribute as CFString, &posValue)
    _ = AXUIElementCopyAttributeValue(element, kAXSizeAttribute as CFString, &sizeValue)

    var point = CGPoint.zero
    var size = CGSize.zero
    if let p = posValue, CFGetTypeID(p as CFTypeRef) == AXValueGetTypeID() {
        AXValueGetValue(p as! AXValue, .cgPoint, &point)
    }
    if let s = sizeValue, CFGetTypeID(s as CFTypeRef) == AXValueGetTypeID() {
        AXValueGetValue(s as! AXValue, .cgSize, &size)
    }
    let clickPoint = CGPoint(x: point.x + size.width / 2.0, y: point.y + size.height / 2.0)
    postMouseClick(at: clickPoint)
    return "mouse"
}

func click(_ params: [String: Any]) -> HelperResponse {
    guard let handleRaw = params["handle"] as? [String: Any],
          let (element, _) = resolveHandle(handleRaw) else {
        return .failure("element not found for handle")
    }
    let method = clickElement(element)
    return .success(.object(["method": .string(method)]))
}

// MARK: - Type

func typeText(_ params: [String: Any]) -> HelperResponse {
    guard let text = params["text"] as? String else {
        return .failure("missing text")
    }
    if let handleRaw = params["handle"] as? [String: Any],
       let (element, _) = resolveHandle(handleRaw) {
        // Preferred: set AXValue directly. Avoids layout-dependent keycode
        // mapping and works instantly even for long strings.
        if AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, text as CFString) == .success {
            return .success()
        }
        // Next best: focus the element first, then drop through to CGEvent typing.
        _ = AXUIElementSetAttributeValue(element, kAXFocusedAttribute as CFString, true as CFBoolean)
    }
    postUnicodeString(text)
    return .success()
}

// MARK: - Tree

func treeSubtree(_ element: AXUIElement, pid: pid_t, indexPath: [Int], depth: Int) -> JSONValue {
    let handle = makeHandle(for: element, pid: pid, indexPath: indexPath)
    var children: [JSONValue] = []
    if depth > 0 {
        for (i, child) in axChildren(element).enumerated() {
            children.append(treeSubtree(child, pid: pid, indexPath: indexPath + [i], depth: depth - 1))
        }
    }
    return .object([
        "handle": handle.toJSON(),
        "children": .array(children),
    ])
}

func tree(_ params: [String: Any]) -> HelperResponse {
    let depth = (params["depth"] as? Int) ?? 20
    if let handleRaw = params["handle"] as? [String: Any],
       let idRaw = handleRaw["id"] as? String,
       let (pid, indices) = NodeHandle.parse(idRaw) {
        let root = appElement(for: pid)
        guard let el = descend(from: root, path: indices) else {
            return .failure("element not found for handle")
        }
        return .success(treeSubtree(el, pid: pid, indexPath: indices, depth: depth))
    }
    // No handle → use the frontmost app
    guard let front = NSWorkspace.shared.frontmostApplication else {
        return .failure("no frontmost application")
    }
    let root = appElement(for: front.processIdentifier)
    return .success(treeSubtree(root, pid: front.processIdentifier, indexPath: [], depth: depth))
}

// MARK: - Keys / CGEvent

// macOS virtual keycodes for common named keys (from Carbon Events.h).
let namedKeyCodes: [String: CGKeyCode] = [
    "return": 0x24, "enter": 0x24,
    "tab": 0x30,
    "space": 0x31,
    "delete": 0x33, "backspace": 0x33,
    "escape": 0x35,
    "left": 0x7B, "right": 0x7C, "down": 0x7D, "up": 0x7E,
    "home": 0x73, "end": 0x77, "pageup": 0x74, "pagedown": 0x79,
    "f1": 0x7A, "f2": 0x78, "f3": 0x63, "f4": 0x76, "f5": 0x60, "f6": 0x61,
    "f7": 0x62, "f8": 0x64, "f9": 0x65, "f10": 0x6D, "f11": 0x67, "f12": 0x6F,
]

func parseKey(_ spec: String) -> (CGEventFlags, CGKeyCode?, String?)? {
    let parts = spec.split(separator: "+").map { $0.trimmingCharacters(in: .whitespaces) }
    guard !parts.isEmpty else { return nil }
    var flags: CGEventFlags = []
    for mod in parts.dropLast() {
        switch mod.lowercased() {
        case "ctrl", "control": flags.insert(.maskControl)
        case "shift": flags.insert(.maskShift)
        case "alt", "option": flags.insert(.maskAlternate)
        case "cmd", "command", "super", "meta": flags.insert(.maskCommand)
        default: return nil
        }
    }
    let primary = parts.last!
    if let code = namedKeyCodes[primary.lowercased()] {
        return (flags, code, nil)
    }
    if primary.count == 1 {
        return (flags, nil, primary)
    }
    return nil
}

func postKeyEvent(keyCode: CGKeyCode, flags: CGEventFlags) {
    let src = CGEventSource(stateID: .combinedSessionState)
    if let down = CGEvent(keyboardEventSource: src, virtualKey: keyCode, keyDown: true) {
        down.flags = flags
        down.post(tap: .cgSessionEventTap)
    }
    if let up = CGEvent(keyboardEventSource: src, virtualKey: keyCode, keyDown: false) {
        up.flags = flags
        up.post(tap: .cgSessionEventTap)
    }
}

func postUnicodeString(_ text: String) {
    let src = CGEventSource(stateID: .combinedSessionState)
    // Chunk so each event fits in a single keyboard event buffer (macOS caps
    // per-event strings around 20 UTF-16 code units, but we split by
    // individual characters to be safe with composed graphemes).
    for scalar in text.unicodeScalars {
        var chars = [UniChar](repeating: 0, count: 2)
        var count = 0
        let utf16 = String(scalar).utf16
        for ch in utf16 where count < 2 {
            chars[count] = ch
            count += 1
        }
        if let down = CGEvent(keyboardEventSource: src, virtualKey: 0, keyDown: true) {
            down.keyboardSetUnicodeString(stringLength: count, unicodeString: chars)
            down.post(tap: .cgSessionEventTap)
        }
        if let up = CGEvent(keyboardEventSource: src, virtualKey: 0, keyDown: false) {
            up.keyboardSetUnicodeString(stringLength: count, unicodeString: chars)
            up.post(tap: .cgSessionEventTap)
        }
    }
}

func key(_ params: [String: Any]) -> HelperResponse {
    guard let spec = params["key"] as? String,
          let (flags, keyCode, fallbackChar) = parseKey(spec) else {
        return .failure("unknown key spec: \(params["key"] ?? "<nil>")")
    }
    if let code = keyCode {
        postKeyEvent(keyCode: code, flags: flags)
        return .success()
    }
    if let ch = fallbackChar {
        // Use unicode path for a single char; can't combine with modifier
        // flags via keyboardSetUnicodeString — macOS routes those through the
        // input method instead, so Ctrl+L (for example) becomes a raw "l"
        // with no modifier. Fall back to virtual keycode lookup for ASCII.
        if flags.isEmpty {
            postUnicodeString(ch)
            return .success()
        }
        if let ascii = ch.lowercased().unicodeScalars.first?.value, ascii < 128 {
            let keycode = asciiToKeyCode(Character(UnicodeScalar(ascii)!))
            if let kc = keycode {
                postKeyEvent(keyCode: kc, flags: flags)
                return .success()
            }
        }
    }
    return .failure("could not dispatch key: \(spec)")
}

func asciiToKeyCode(_ c: Character) -> CGKeyCode? {
    // US-English ANSI keycode table. Good enough for Ctrl+<letter> combos;
    // for full i18n coverage we'd query the current keyboard layout via
    // TISCopyCurrentKeyboardInputSource and translate through UCKeyTranslate.
    // Left as a TODO — none of the current tool callers send non-ASCII combos.
    let map: [Character: CGKeyCode] = [
        "a": 0x00, "s": 0x01, "d": 0x02, "f": 0x03, "h": 0x04, "g": 0x05, "z": 0x06,
        "x": 0x07, "c": 0x08, "v": 0x09, "b": 0x0B, "q": 0x0C, "w": 0x0D, "e": 0x0E,
        "r": 0x0F, "y": 0x10, "t": 0x11, "1": 0x12, "2": 0x13, "3": 0x14, "4": 0x15,
        "6": 0x16, "5": 0x17, "9": 0x19, "7": 0x1A, "8": 0x1C, "0": 0x1D,
        "o": 0x1F, "u": 0x20, "i": 0x22, "p": 0x23, "l": 0x25, "j": 0x26, "k": 0x28,
        "n": 0x2D, "m": 0x2E, ",": 0x2B, ".": 0x2F, "/": 0x2C, ";": 0x29, "'": 0x27,
        "[": 0x21, "]": 0x1E, "`": 0x32, "\\": 0x2A, "-": 0x1B, "=": 0x18,
    ]
    return map[c]
}

// MARK: - Mouse

func postMouseClick(at point: CGPoint, button: CGMouseButton = .left) {
    let src = CGEventSource(stateID: .combinedSessionState)
    let (downType, upType): (CGEventType, CGEventType) = {
        switch button {
        case .left: return (.leftMouseDown, .leftMouseUp)
        case .right: return (.rightMouseDown, .rightMouseUp)
        default: return (.otherMouseDown, .otherMouseUp)
        }
    }()
    if let move = CGEvent(mouseEventSource: src, mouseType: .mouseMoved,
                          mouseCursorPosition: point, mouseButton: button) {
        move.post(tap: .cgSessionEventTap)
    }
    if let down = CGEvent(mouseEventSource: src, mouseType: downType,
                          mouseCursorPosition: point, mouseButton: button) {
        down.post(tap: .cgSessionEventTap)
    }
    if let up = CGEvent(mouseEventSource: src, mouseType: upType,
                        mouseCursorPosition: point, mouseButton: button) {
        up.post(tap: .cgSessionEventTap)
    }
}

func clickPixel(_ params: [String: Any]) -> HelperResponse {
    guard let x = params["x"] as? Double ?? (params["x"] as? Int).map(Double.init),
          let y = params["y"] as? Double ?? (params["y"] as? Int).map(Double.init) else {
        return .failure("click_pixel requires numeric x,y")
    }
    let button: CGMouseButton = {
        switch (params["button"] as? String)?.lowercased() {
        case "right": return .right
        case "middle": return .center
        default: return .left
        }
    }()
    postMouseClick(at: CGPoint(x: x, y: y), button: button)
    return .success(.object(["x": .double(x), "y": .double(y)]))
}

// MARK: - Focus

func focus(_ params: [String: Any]) -> HelperResponse {
    guard let handleRaw = params["handle"] as? [String: Any],
          let (element, _) = resolveHandle(handleRaw) else {
        return .failure("element not found for handle")
    }
    let result = AXUIElementSetAttributeValue(
        element, kAXFocusedAttribute as CFString, true as CFBoolean)
    let focused = (result == .success)
    if !focused {
        let actions = axActions(element)
        if actions.contains(kAXRaiseAction as String) {
            _ = AXUIElementPerformAction(element, kAXRaiseAction as CFString)
        }
    }
    return .success(.object(["focused": .bool(focused)]))
}

// MARK: - Focus window

func focusWindow(_ params: [String: Any]) -> HelperResponse {
    guard let appId = params["app_id"] as? String else {
        return .failure("missing app_id")
    }
    let apps = NSRunningApplication.runningApplications(withBundleIdentifier: appId)
    let match = apps.first ?? runningApps(matching: appId).first
    guard let target = match else {
        return .failure("no running app matches \(appId)")
    }
    let dispatched = target.activate(options: [.activateAllWindows])
    return .success(.object([
        "dispatched": .bool(dispatched),
        "log": .string("activated pid=\(target.processIdentifier)"),
    ]))
}

// MARK: - Dispatch

func dispatch(_ request: [String: Any]) -> HelperResponse {
    guard let op = request["op"] as? String else {
        return .failure("missing op")
    }
    switch op {
    case "available":
        let trusted = AXIsProcessTrusted()
        return .success(.object(["trusted": .bool(trusted)]))
    case "locate":
        let query = request["query"] as? [String: Any] ?? [:]
        return locate(query: query)
    case "click":
        return click(request)
    case "type":
        return typeText(request)
    case "tree":
        return tree(request)
    case "key":
        return key(request)
    case "focus":
        return focus(request)
    case "focus_window":
        return focusWindow(request)
    case "click_pixel":
        return clickPixel(request)
    default:
        return .failure("unknown op \(op)")
    }
}

// MARK: - Entry

let stdin = FileHandle.standardInput
let input = stdin.readDataToEndOfFile()
if input.isEmpty {
    emit(.failure("empty stdin"))
}
guard let parsed = try? JSONSerialization.jsonObject(with: input, options: []) as? [String: Any] else {
    emit(.failure("invalid json on stdin"))
}
emit(dispatch(parsed))
