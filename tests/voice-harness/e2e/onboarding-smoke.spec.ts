import { test, expect, chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

test("onboarding renders + probe loads", async () => {
  test.setTimeout(45_000);
  await mkdir("/tmp/onboarding-shots", { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") console.log("[console.error]", msg.text());
  });
  page.on("pageerror", (err) => console.log("[pageerror]", err.message));

  await page.goto("http://localhost:3333/deck/onboarding", { waitUntil: "networkidle" });

  // Hardware card should show the tier label.
  await expect(page.getByText(/YOUR HARDWARE →/)).toBeVisible({ timeout: 10_000 });
  // Missing list should appear.
  await expect(page.getByText("WHAT'S NEEDED")).toBeVisible();
  // CTA button.
  const cta = page.getByRole("button", { name: /Get me running|Install Ollama|Everything's ready/ });
  await expect(cta).toBeVisible();

  // Consent panel should mirror probe state. On this dev machine Ollama is
  // present, so no panel renders. On a fresh VM the panel appears and the
  // CTA flips to "Install Ollama & get me running".
  const probe = await page.evaluate(async () => {
    const r = await fetch("/api/onboarding/probe", { cache: "no-store" });
    return (await r.json()) as { missing: { ollama: boolean }; installPlan: { consent: { title: string } } | null };
  });
  if (probe.missing.ollama) {
    await expect(page.getByTestId("consent-panel")).toBeVisible();
    await expect(page.getByText("PERMISSION NEEDED")).toBeVisible();
    await expect(page.getByRole("checkbox", { name: probe.installPlan!.consent.title })).toBeVisible();
    await expect(page.getByRole("button", { name: /Install Ollama & get me running/ })).toBeVisible();
  } else {
    await expect(page.getByTestId("consent-panel")).toHaveCount(0);
  }

  await page.screenshot({ path: "/tmp/onboarding-shots/landing.png", fullPage: true });

  // Verify the gate redirect: visit /deck and confirm we end up at /deck/onboarding.
  // Clear both client (localStorage) and server (onboarding.done file) flags so
  // the gate has nothing to satisfy itself with. The test intentionally leaves
  // the done flag cleared — a fresh onboarding completion will set it again.
  await page.context().clearCookies();
  await page.evaluate(async () => {
    localStorage.removeItem("control-deck.onboarding.done");
    await fetch("/api/onboarding/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ done: false }),
    });
  });
  await page.goto("http://localhost:3333/deck");
  await page.waitForURL(/\/deck\/onboarding/, { timeout: 10_000 });
  await page.screenshot({ path: "/tmp/onboarding-shots/after-redirect.png", fullPage: true });

  await browser.close();
});
