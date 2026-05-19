import { test, expect, chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

/**
 * Consent-panel UI spec.
 *
 * The dev box has Ollama installed, so the real probe reports
 * `missing.ollama: false` and the consent panel never renders there. To keep
 * the consent UI permanently covered, we mock `/api/onboarding/probe` to
 * report Ollama as missing and assert the panel + CTA wiring directly.
 */
test("consent panel renders, toggles, and posts consent on Get-me-running", async () => {
  test.setTimeout(45_000);
  await mkdir("/tmp/onboarding-shots", { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") console.log("[console.error]", msg.text());
  });
  page.on("pageerror", (err) => console.log("[pageerror]", err.message));

  // Stub the probe so the consent panel renders deterministically.
  await page.route("**/api/onboarding/probe", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        hardware: { backend: "cuda", gpu: { name: "Mock GPU", vramMb: 12288 }, ramGb: 32 },
        tier: "balanced",
        tierLabel: "Balanced",
        diskMb: 5000,
        llm: { id: "qwen3:8b", sizeMb: 4500, runner: "ollama" },
        stt: { id: "whisper", sizeMb: 100 },
        tts: { id: "kokoro", sizeMb: 100 },
        missing: {
          ollama: true,
          ollamaService: true,
          llmModel: true,
          voiceCore: false,
          sttEngine: false,
          ttsEngine: false,
        },
        installPlan: {
          platform: "linux",
          consent: {
            title: "Install Ollama for me",
            summary: "Runs the official Ollama install script. You'll see a system password prompt.",
            command_preview: "pkexec sh -c 'curl -fsSL https://ollama.com/install.sh | sh'",
            manual_fallback: "curl -fsSL https://ollama.com/install.sh | sh",
          },
        },
        done: false,
      }),
    });
  });

  // Capture the consent value the page posts to /run so we can assert wiring.
  let capturedRunBody: { consents?: { installOllama?: boolean }; tier?: string } | null = null;
  await page.route("**/api/onboarding/run", async (route) => {
    const req = route.request();
    if (req.method() === "POST") {
      try {
        capturedRunBody = JSON.parse(req.postData() ?? "{}");
      } catch {
        capturedRunBody = null;
      }
    }
    // Close the SSE stream immediately so the test doesn't hang.
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: "",
    });
  });

  await page.goto("http://localhost:3333/deck/onboarding", { waitUntil: "networkidle" });

  // Hardware card renders from the mock.
  await expect(page.getByText(/YOUR HARDWARE →/)).toBeVisible({ timeout: 10_000 });

  // Consent panel is visible with title, summary, and a checked-by-default checkbox.
  const consentPanel = page.getByTestId("consent-panel");
  await expect(consentPanel).toBeVisible();
  await expect(page.getByText("PERMISSION NEEDED")).toBeVisible();
  const checkbox = page.getByRole("checkbox", { name: /Install Ollama for me/ });
  await expect(checkbox).toBeVisible();
  await expect(checkbox).toBeChecked();

  // The disclosure expands to show the command_preview when checked.
  await page.getByRole("button", { name: /Show what will run/ }).click();
  await expect(page.getByText(/pkexec sh -c/)).toBeVisible();

  // Unchecking flips the preview to the manual_fallback (a self-rescue path).
  await checkbox.uncheck();
  await expect(checkbox).not.toBeChecked();
  await expect(page.getByText(/^curl -fsSL/)).toBeVisible();

  // Re-check and confirm the CTA wording matches the consent-granted branch.
  await checkbox.check();
  const cta = page.getByRole("button", { name: /Install Ollama & get me running/ });
  await expect(cta).toBeVisible();

  await page.screenshot({ path: "/tmp/onboarding-shots/consent-panel.png", fullPage: true });

  // Click the CTA and verify the run-body the page posts carries our consent.
  await cta.click();
  // Give the fetch a moment to fire — the route handler captures the body.
  await page.waitForTimeout(500);
  const body = capturedRunBody as { consents?: { installOllama?: boolean }; tier?: string } | null;
  expect(body).not.toBeNull();
  expect(body?.consents?.installOllama).toBe(true);

  await browser.close();
});
