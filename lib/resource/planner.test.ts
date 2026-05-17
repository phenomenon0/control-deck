import { afterEach, describe, expect, test } from "bun:test";

import { __test as arbiterTest, listReservations } from "./arbiter";
import { __test as ledgerTest, type GpuMemory } from "./ledger";
import { runPlan } from "./planner";

const TOTAL = 24576;

function setFree(freeMb: number) {
  const mem: GpuMemory = {
    totalMb: TOTAL,
    usedMb: TOTAL - freeMb,
    freeMb,
    source: "nvidia-smi",
  };
  ledgerTest.setMemoryOverride(async () => mem);
}

afterEach(() => {
  arbiterTest.reset();
  ledgerTest.reset();
});

describe("planner.runPlan — happy path", () => {
  test("runs steps sequentially and returns each value", async () => {
    setFree(20_000);
    ledgerTest.setReserveOverride(2048);

    const order: string[] = [];
    const result = await runPlan([
      {
        lane: "image",
        estimateMb: 4000,
        reason: "step 1",
        run: async () => {
          order.push("a");
          return "alpha";
        },
      },
      {
        lane: "image",
        estimateMb: 4000,
        reason: "step 2",
        run: async () => {
          order.push("b");
          return "beta";
        },
      },
    ]);

    expect(result.ok).toBe(true);
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].status).toBe("ok");
    expect(result.steps[0].value).toBe("alpha");
    expect(result.steps[1].value).toBe("beta");
    expect(order).toEqual(["a", "b"]);
    // Every step released — no leftover reservations.
    expect(listReservations()).toHaveLength(0);
  });

  test("releases reservation even when run throws", async () => {
    setFree(20_000);
    ledgerTest.setReserveOverride(2048);

    const result = await runPlan(
      [
        {
          lane: "image",
          estimateMb: 4000,
          reason: "doomed",
          run: async () => {
            throw new Error("kaboom");
          },
        },
      ],
      { stopOnFailure: false },
    );

    expect(result.ok).toBe(false);
    expect(result.steps[0].status).toBe("failed");
    expect(result.steps[0].error).toContain("kaboom");
    expect(listReservations()).toHaveLength(0);
  });
});

describe("planner.runPlan — denial handling", () => {
  test("marks remaining steps skipped when stopOnFailure is true", async () => {
    setFree(1000);
    ledgerTest.setReserveOverride(2048);

    const result = await runPlan([
      {
        lane: "3d",
        estimateMb: 12_000,
        reason: "huge",
        evicts: "none",
        run: async () => "never",
      },
      {
        lane: "image",
        estimateMb: 1000,
        reason: "follow-up",
        run: async () => "never",
      },
    ]);

    expect(result.ok).toBe(false);
    expect(result.steps[0].status).toBe("denied");
    expect(result.steps[1].status).toBe("skipped");
  });

  test("continues when stopOnFailure is false", async () => {
    setFree(20_000);
    ledgerTest.setReserveOverride(2048);

    let secondRan = false;
    const result = await runPlan(
      [
        {
          lane: "image",
          estimateMb: 4000,
          reason: "first",
          run: async () => {
            throw new Error("oops");
          },
        },
        {
          lane: "image",
          estimateMb: 4000,
          reason: "second",
          run: async () => {
            secondRan = true;
            return "second-value";
          },
        },
      ],
      { stopOnFailure: false },
    );

    expect(result.ok).toBe(false);
    expect(secondRan).toBe(true);
    expect(result.steps[1].status).toBe("ok");
  });
});
