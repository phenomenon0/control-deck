import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { __resetBus, getWarnings } from "./bus";
import {
  canvasBus,
  closeCanvas,
  openArtifactInCanvas,
  openCanvas,
  openPreviewInCanvas,
  toggleCanvas,
  type OpenArtifactRequest,
  type OpenCanvasRequest,
  type OpenPreviewRequest,
} from "./canvas";

beforeEach(() => __resetBus());
afterEach(() => __resetBus());

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("canvas topics over the workspace bus", () => {
  test("openCanvas delivers its payload to onOpen listeners", async () => {
    const seen: OpenCanvasRequest[] = [];
    const off = canvasBus.onOpen((req) => seen.push(req));

    openCanvas({ code: "print(1)", language: "python", title: "hi", autoRun: true });
    await wait(50);

    expect(seen).toEqual([{ code: "print(1)", language: "python", title: "hi", autoRun: true }]);
    off();
  });

  test("a burst delivers every event, in publish order", async () => {
    const seen: number[] = [];
    const off = canvasBus.onOpen((req) => seen.push(Number(req.code)));

    for (let i = 0; i < 25; i++) openCanvas({ code: String(i), language: "python" });
    await wait(50);

    expect(seen).toEqual(Array.from({ length: 25 }, (_, i) => i));
    off();
  });

  test("preview / artifact / toggle / close route to their own listeners", async () => {
    const previews: OpenPreviewRequest[] = [];
    const artifacts: OpenArtifactRequest[] = [];
    let toggles = 0;
    let closes = 0;
    const offs = [
      canvasBus.onPreview((r) => previews.push(r)),
      canvasBus.onArtifact((r) => artifacts.push(r)),
      canvasBus.onToggle(() => { toggles++; }),
      canvasBus.onClose(() => { closes++; }),
    ];

    openPreviewInCanvas({ html: "<b>1</b>", title: "p" });
    openArtifactInCanvas({ id: "a1", url: "/u", name: "img.png", mimeType: "image/png" });
    toggleCanvas();
    closeCanvas();
    await wait(50);

    expect(previews).toEqual([{ html: "<b>1</b>", title: "p" }]);
    expect(artifacts).toEqual([{ id: "a1", url: "/u", name: "img.png", mimeType: "image/png" }]);
    expect(toggles).toBe(1);
    expect(closes).toBe(1);
    for (const off of offs) off();
  });

  test("topics do not cross-talk", async () => {
    let opens = 0;
    const off = canvasBus.onOpen(() => { opens++; });

    openPreviewInCanvas({ html: "x" });
    openArtifactInCanvas({ id: "a", url: "u", name: "n", mimeType: "m" });
    toggleCanvas();
    closeCanvas();
    await wait(50);

    expect(opens).toBe(0);
    off();
  });

  test("unsubscribing stops delivery", async () => {
    let count = 0;
    const off = canvasBus.onOpen(() => { count++; });

    openCanvas({ code: "a", language: "python" });
    await wait(50);
    off();
    openCanvas({ code: "b", language: "python" });
    await wait(50);

    expect(count).toBe(1);
  });

  test("multiple listeners each receive every event", async () => {
    let a = 0;
    let b = 0;
    const offA = canvasBus.onToggle(() => { a++; });
    const offB = canvasBus.onToggle(() => { b++; });

    toggleCanvas();
    toggleCanvas();
    await wait(50);

    expect(a).toBe(2);
    expect(b).toBe(2);
    offA();
    offB();
  });

  test("publishing with no listeners does not throw (and warns in dev)", async () => {
    const dbg = spyOn(console, "debug").mockImplementation(() => {});
    try {
      expect(() => openCanvas({ code: "x", language: "python" })).not.toThrow();
      await wait(50);
      expect(dbg).toHaveBeenCalled();
    } finally {
      dbg.mockRestore();
    }
  });

  test("canvas topics are ungated — no watchdog throttle, no drops", async () => {
    let count = 0;
    const off = canvasBus.onOpen(() => { count++; });

    // 200 events in one synchronous burst: above any sane declared rate,
    // under the subscription backlog cap.
    for (let i = 0; i < 200; i++) openCanvas({ code: String(i), language: "python" });
    await wait(80);

    expect(count).toBe(200);
    expect(getWarnings()).toHaveLength(0);
    off();
  });
});
