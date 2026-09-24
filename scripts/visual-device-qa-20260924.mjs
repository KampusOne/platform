import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const base = process.env.VISUAL_BASE_URL || "https://kampusone-mobile-preview.vercel.app";
const out = "visual-device-artifacts";
await mkdir(out, { recursive: true });

const fixtureUser = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "visual.qa@example.invalid",
  roles: [],
  universityId: null,
  operatorRoles: [],
};
const session = {
  accessToken: "visual-fixture-access-token",
  refreshToken: "visual-fixture-refresh-token",
  expiresIn: 900,
  refreshExpiresIn: 1800,
  user: fixtureUser,
};
const profile = {
  id: fixtureUser.id,
  email: fixtureUser.email,
  first_name: "Visual",
  last_name: "QA",
  display_name: "Visual QA",
  profile_image_url: null,
  university_id: null,
  university_name: null,
  onboarding_completed_at: "2026-09-24T00:00:00.000Z",
  settings: {},
};
const aiStatus = {
  enabled: true,
  historyDays: 90,
  maxFileBytes: 10485760,
  capabilities: { text: true, images: true, documents: true },
  tier: "standard",
  study: { limit: 5, remaining: 5 },
  subscription: { cadence: "monthly", checkoutEnabled: false, available: false },
};

const cases = [
  { name: "iphone", width: 390, height: 844, touch: true },
  { name: "android", width: 412, height: 915, touch: true },
  { name: "desktop", width: 1440, height: 900, touch: false },
];

const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const device of cases) {
    const context = await browser.newContext({
      viewport: { width: device.width, height: device.height },
      hasTouch: device.touch,
      isMobile: device.touch,
      deviceScaleFactor: device.touch ? 2 : 1,
    });
    const page = await context.newPage();
    const consoleErrors = [];
    const pageErrors = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.route("**/api/v1/auth/refresh", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(session) });
    });
    await page.route("**/api/v1/student/me", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ profile, operatorRoles: [] }) });
    });
    await page.route("**/api/v1/ai/status", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(aiStatus) });
    });
    await page.route("**/api/v1/ai", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          requestId: "22222222-2222-4222-8222-222222222222",
          threadId: "22222222-2222-4222-8222-222222222222",
          tier: "standard",
          cards: [],
          actions: [],
          text: "Visual processing check complete.",
        }),
      });
    });

    const response = await page.goto(base + "/ai", { waitUntil: "domcontentloaded", timeout: 45000 });
    if (!response || response.status() >= 400) throw new Error(`${device.name}: navigation HTTP ${response?.status() ?? "none"}`);

    const composer = page.getByLabel("Message KampusOne AI");
    await composer.waitFor({ state: "visible", timeout: 30000 });
    await page.getByLabel("AI plan: Standard").waitFor({ state: "visible", timeout: 10000 });
    await page.getByLabel("Attach image or document").waitFor({ state: "visible", timeout: 10000 });

    const text = await page.locator("body").innerText();
    for (const expected of ["Ask", "Summary & Notes", "Standard", "AI can make mistakes"]) {
      if (!text.includes(expected)) throw new Error(`${device.name}: missing ${expected}`);
    }

    const geometry = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      rootWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      hasFrameworkOverlay: Boolean(document.querySelector("[data-nextjs-dialog], .vite-error-overlay, #webpack-dev-server-client-overlay")),
      bodyTextLength: document.body.innerText.trim().length,
    }));
    if (geometry.hasFrameworkOverlay) throw new Error(`${device.name}: framework error overlay`);
    if (geometry.bodyTextLength < 40) throw new Error(`${device.name}: page rendered too little content`);
    if (geometry.rootWidth > geometry.viewportWidth + 2 || geometry.bodyWidth > geometry.viewportWidth + 2) {
      throw new Error(`${device.name}: horizontal overflow ${geometry.rootWidth}/${geometry.viewportWidth}`);
    }

    await page.screenshot({ path: `${out}/ai-${device.name}.png`, fullPage: true });

    await page.getByLabel("AI plan: Standard").click();
    await page.getByText("Choose your plan", { exact: true }).waitFor({ state: "visible", timeout: 5000 });
    const panelText = await page.locator("body").innerText();
    if (!panelText.includes("Standard") || !panelText.includes("Pro")) throw new Error(`${device.name}: plan sheet incomplete`);
    await page.screenshot({ path: `${out}/ai-${device.name}-plans.png`, fullPage: true });
    await page.getByLabel("Close panel").last().click();

    await composer.fill("Test processing state");
    await page.getByLabel("Send message").click();
    await page.getByText("Working on it…", { exact: true }).waitFor({ state: "visible", timeout: 5000 });
    await page.screenshot({ path: `${out}/ai-${device.name}-working.png`, fullPage: true });
    await page.getByText("Visual processing check complete.", { exact: true }).waitFor({ state: "visible", timeout: 10000 });

    if (pageErrors.length) throw new Error(`${device.name}: page errors: ${pageErrors.join(" | ")}`);
    const meaningfulConsoleErrors = consoleErrors.filter((value) => !/favicon|Failed to load resource.*404/i.test(value));
    if (meaningfulConsoleErrors.length) throw new Error(`${device.name}: console errors: ${meaningfulConsoleErrors.join(" | ")}`);

    results.push({
      device: device.name,
      viewport: `${device.width}x${device.height}`,
      overflow: false,
      composer: true,
      planSheet: true,
      processingState: true,
      pageErrors: 0,
      consoleErrors: 0,
    });
    await context.close();
  }
} finally {
  await browser.close();
}

console.log("PASS: production mobile bundle rendered cleanly across device viewports.");
console.log(JSON.stringify(results));
