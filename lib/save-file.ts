/**
 * saveFile — "save this" for chat artifacts/code/charts/html. Tries, in order:
 *   1. Electron native save dialog (deck:save-file IPC) — true save-to-disk.
 *   2. Web File System Access (showSaveFilePicker) — pick a location.
 *   3. Anchor download fallback — always works (incl. Storybook).
 *
 * Returns whether something was written (false on user-cancel).
 */

interface DeckBridge {
  invoke?: (channel: string, ...args: unknown[]) => Promise<unknown>;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return btoa(bin);
}

export async function saveFile(name: string, mimeType: string, content: string | Blob): Promise<{ saved: boolean; path?: string }> {
  if (typeof window === "undefined") return { saved: false };

  // 1. Electron native dialog.
  const deck = (window as unknown as { deck?: DeckBridge }).deck;
  if (deck?.invoke) {
    try {
      const isText = typeof content === "string";
      const payload = isText ? content : await blobToBase64(content);
      const res = (await deck.invoke("deck:save-file", { name, mimeType, content: payload, encoding: isText ? "utf8" : "base64" })) as
        | { ok?: boolean; filePath?: string }
        | undefined;
      if (res?.ok) return { saved: true, path: res.filePath };
      if (res && res.ok === false) return { saved: false }; // user cancelled the dialog
    } catch {
      /* channel missing / not electron → fall through */
    }
  }

  const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });

  // 2. File System Access API.
  const picker = (window as unknown as { showSaveFilePicker?: (o: { suggestedName?: string }) => Promise<{ createWritable: () => Promise<{ write: (b: Blob) => Promise<void>; close: () => Promise<void> }> }> }).showSaveFilePicker;
  if (picker) {
    try {
      const handle = await picker({ suggestedName: name });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return { saved: true };
    } catch (e) {
      if ((e as { name?: string })?.name === "AbortError") return { saved: false };
      /* else fall through to anchor */
    }
  }

  // 3. Anchor download.
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
  return { saved: true };
}

/** Save from a (possibly remote) URL — used for artifact urls. */
export function saveUrl(url: string, name: string): void {
  if (typeof document === "undefined") return;
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
}
