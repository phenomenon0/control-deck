import fc from "fast-check";
import { describe, expect, test } from "bun:test";
import { parseFrames } from "./windows-host-client";

/**
 * Property-based + state-machine tests for the LSP-style Content-Length
 * frame parser. Model-based testing: an oracle (in-memory list of
 * "expected frames") is compared against the parser fed the same bytes
 * in arbitrary chunk sizes.
 *
 * The model is what the real host client does: concatenate incoming
 * chunks into a buffer, repeatedly extract complete frames, keep any
 * unconsumed tail for the next chunk.
 */

function frameOne(body: string): Buffer {
  const bodyBuf = Buffer.from(body, "utf8");
  const header = Buffer.from(`Content-Length: ${bodyBuf.length}\r\n\r\n`, "ascii");
  return Buffer.concat([header, bodyBuf]);
}

function frameMany(bodies: string[]): Buffer {
  return Buffer.concat(bodies.map(frameOne));
}

// ── properties ────────────────────────────────────────────────────

describe("parseFrames — property: single shot round-trip", () => {
  test("for any list of JSON-like bodies, one-shot parse recovers them in order", () => {
    fc.assert(
      fc.property(fc.array(fc.string({ minLength: 1, maxLength: 200 }), { maxLength: 20 }), (bodies) => {
        const bytes = frameMany(bodies);
        const { frames, remainder } = parseFrames(bytes);
        expect(frames).toEqual(bodies);
        expect(remainder.length).toBe(0);
      }),
      { numRuns: 100 },
    );
  });
});

describe("parseFrames — state machine: arbitrary chunk arrivals", () => {
  // Model: concatenating the chunks and running parseFrames once gives
  // the oracle result. We emulate the real client's behavior — call
  // parseFrames on each chunk, carry the remainder forward, accumulate
  // frames — and assert it matches the oracle.

  test("stream of bytes split into arbitrary chunks still yields the same frame sequence", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 100 }), { minLength: 1, maxLength: 15 }),
        fc.array(fc.integer({ min: 1, max: 40 }), { minLength: 1, maxLength: 30 }),
        (bodies, chunkSizes) => {
          const wire = frameMany(bodies);

          // Slice the wire into arbitrary chunks.
          const chunks: Buffer[] = [];
          let offset = 0;
          let chunkIdx = 0;
          while (offset < wire.length) {
            const size = chunkSizes[chunkIdx % chunkSizes.length];
            const end = Math.min(wire.length, offset + size);
            chunks.push(wire.slice(offset, end));
            offset = end;
            chunkIdx++;
          }

          // Feed them through parseFrames statefully.
          let accumulator = Buffer.alloc(0);
          const received: string[] = [];
          for (const chunk of chunks) {
            accumulator = Buffer.concat([accumulator, chunk]);
            const { frames, remainder } = parseFrames(accumulator);
            received.push(...frames);
            accumulator = Buffer.from(remainder);
          }

          expect(received).toEqual(bodies);
          expect(accumulator.length).toBe(0);
        },
      ),
      { numRuns: 150 },
    );
  });

  test("single-byte chunk arrivals still recover all frames", () => {
    fc.assert(
      fc.property(fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 1, maxLength: 8 }), (bodies) => {
        const wire = frameMany(bodies);

        let acc = Buffer.alloc(0);
        const received: string[] = [];
        for (let i = 0; i < wire.length; i++) {
          acc = Buffer.concat([acc, wire.slice(i, i + 1)]);
          const { frames, remainder } = parseFrames(acc);
          received.push(...frames);
          acc = Buffer.from(remainder);
        }
        expect(received).toEqual(bodies);
        expect(acc.length).toBe(0);
      }),
      { numRuns: 50 },
    );
  });
});

describe("parseFrames — property: partial never emits a fake frame", () => {
  test("any strict prefix of a complete stream emits at most N-1 frames where N is the number of complete frames in the prefix", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 2, maxLength: 8 }),
        fc.integer({ min: 1, max: 500 }),
        (bodies, prefixLen) => {
          const wire = frameMany(bodies);
          const truncated = wire.slice(0, Math.min(prefixLen, wire.length));
          const { frames } = parseFrames(truncated);
          // All emitted frames must match the start of `bodies` — never
          // emit half a message or a frame that the source never wrote.
          for (let i = 0; i < frames.length; i++) {
            expect(frames[i]).toBe(bodies[i]);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("parseFrames — remainder invariant", () => {
  test("frames + remainder always equal the original wire bytes", () => {
    fc.assert(
      fc.property(fc.array(fc.string({ minLength: 1, maxLength: 80 }), { maxLength: 10 }), (bodies) => {
        const wire = frameMany(bodies);
        const { frames, remainder } = parseFrames(wire);
        // Reconstruct the "consumed" bytes from the frames: each frame
        // had its own header + body in the wire, so summing framed
        // lengths + remainder.length should equal wire.length.
        const consumed = frames.reduce((sum, body) => sum + frameOne(body).length, 0);
        expect(consumed + remainder.length).toBe(wire.length);
      }),
      { numRuns: 100 },
    );
  });
});
