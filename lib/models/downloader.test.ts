import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { cancelJob, enqueueDownloads, listJobs, type DownloadJob } from "./downloader";
import { getWeightFile, weightAbsolutePath, type WeightFile } from "./weights-catalog";

const originalFetch = globalThis.fetch;
const originalComfyDir = process.env.COMFY_DIR;
const root = await fs.mkdtemp(path.join(os.tmpdir(), "deck-weight-test-"));
process.env.COMFY_DIR = root;

const file = getWeightFile("sdxl-turbo-ckpt")!;
const originalFile: WeightFile = { ...file };

async function waitForTerminalJob(timeoutMs = 2_000): Promise<DownloadJob> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const job = listJobs()[0];
    if (job && ["done", "error", "cancelled"].includes(job.status)) return job;
    if (Date.now() >= deadline) throw new Error("download job did not settle");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function configureFile(overrides: Partial<WeightFile>) {
  Object.assign(file, {
    ...originalFile,
    filename: "tests/tiny.bin",
    url: "https://example.test/tiny.bin",
    approxBytes: 6,
    sha256: createHash("sha256").update("abcdef").digest("hex"),
    ...overrides,
  });
}

beforeEach(async () => {
  delete globalThis.__weightDownloader;
  await fs.rm(root, { recursive: true, force: true });
  await fs.mkdir(root, { recursive: true });
  configureFile({});
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  Object.assign(file, originalFile);
  if (originalFile.sha256 === undefined) delete file.sha256;
});

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
  if (originalComfyDir === undefined) delete process.env.COMFY_DIR;
  else process.env.COMFY_DIR = originalComfyDir;
});

describe("weight downloader safety", () => {
  test("rehashes a resumed prefix as a stream and atomically completes it", async () => {
    const destination = weightAbsolutePath(file);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(`${destination}.part`, "abc");
    globalThis.fetch = mock(async () => new Response("def", {
      status: 206,
      headers: { "content-length": "3" },
    })) as unknown as typeof fetch;

    const result = await enqueueDownloads([file.key]);
    expect(result.enqueued).toHaveLength(1);
    const job = await waitForTerminalJob();
    expect(job.status).toBe("done");
    expect(await fs.readFile(destination, "utf8")).toBe("abcdef");
    expect(await fs.stat(`${destination}.part`).catch(() => null)).toBeNull();
  });

  test("fails closed when an immutable Hub source has no trusted sha256 metadata", async () => {
    configureFile({
      url: `https://huggingface.co/test/repo/resolve/${"0".repeat(40)}/tiny.bin`,
      sha256: undefined,
      approxBytes: 3,
    });
    delete file.sha256;
    const fetchMock = mock(async () => new Response(null, { status: 302 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await enqueueDownloads([file.key]);
    const job = await waitForTerminalJob();
    expect(job.status).toBe("error");
    expect(job.error).toContain("no trusted sha256 metadata");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await fs.stat(weightAbsolutePath(file)).catch(() => null)).toBeNull();
  });

  test("repairs an installed file whose size does not match the catalog", async () => {
    const destination = weightAbsolutePath(file);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, "x");
    globalThis.fetch = mock(async () => new Response("abcdef", {
      status: 200,
      headers: { "content-length": "6" },
    })) as unknown as typeof fetch;

    const result = await enqueueDownloads([file.key]);
    expect(result.skipped).toEqual([]);
    const job = await waitForTerminalJob();
    expect(job.status).toBe("done");
    expect(await fs.readFile(destination, "utf8")).toBe("abcdef");
  });

  test("cancels an active stream and leaves its partial for resume", async () => {
    globalThis.fetch = mock(async (_input, init) => {
      const signal = init?.signal;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          signal?.addEventListener("abort", () => controller.error(new Error("aborted")));
        },
      });
      return new Response(body, { status: 200 });
    }) as unknown as typeof fetch;

    const result = await enqueueDownloads([file.key]);
    const id = result.enqueued[0]!.id;
    const deadline = Date.now() + 2_000;
    while (listJobs()[0]?.status !== "downloading") {
      if (Date.now() >= deadline) throw new Error("job never started downloading");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(cancelJob(id)).toBe(true);
    const job = await waitForTerminalJob();
    expect(job.status).toBe("cancelled");
  });
});
