// Synthetic API fixtures against the compiled production portal; no live campaign changes.
// Build the portal first. Requires Playwright; optionally set CAMPAIGN_TEST_CHROMIUM.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = createRequire(path.join(root, "portal/package.json"))("playwright");
const output = process.env.CAMPAIGN_TEST_OUTPUT ?? fs.mkdtempSync(path.join(os.tmpdir(), "kampusone-campaign-"));
fs.mkdirSync(output, { recursive: true });
const port = Number(process.env.CAMPAIGN_TEST_PORT ?? 3122);
assert(Number.isInteger(port) && port > 0 && port <= 65535);
const origin = `http://127.0.0.1:${port}`;
const log = fs.openSync(path.join(output, "next.log"), "w");
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], {
  cwd: path.join(root, "portal"), env: process.env, stdio: ["ignore", log, log],
});
const user = {
  id: "11111111-1111-4111-8111-111111111111", email: "campaign.fixture@example.test",
  roles: ["STUDENT"], operatorRoles: ["PLATFORM_ADMIN"], universityId: "22222222-2222-4222-8222-222222222222",
};
const results = { fixtureOnly: true, checks: [], pageErrors: [], mutations: [] };
let browser;
let mode = "loading";
let enabled = true;
let releaseLoad;
const firstLoad = new Promise(resolve => { releaseLoad = resolve; });
try {
  let ready = false;
  for (let index = 0; index < 100; index++) {
    if (server.exitCode !== null) throw new Error("Next server exited; inspect next.log");
    try { if ((await fetch(origin + "/admin/exclusive-campaign")).ok) { ready = true; break; } } catch { /* Wait for startup. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert(ready, "Production portal did not start");
  browser = await chromium.launch({ executablePath: process.env.CAMPAIGN_TEST_CHROMIUM, headless: true, args: ["--no-sandbox", "--single-process", "--disable-dev-shm-usage"] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  page.on("pageerror", error => results.pageErrors.push(error.message));
  await context.route("**/v1/**", async route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const send = (body, status = 200) => route.fulfill({
      status, contentType: "application/json",
      headers: { "access-control-allow-origin": origin, "access-control-allow-credentials": "true", "access-control-allow-headers": "Content-Type, Authorization, X-Device-Label", "access-control-allow-methods": "GET, POST, PATCH, OPTIONS" },
      body: JSON.stringify(body),
    });
    if (request.method() === "OPTIONS") return send({});
    if (pathname.endsWith("/auth/refresh")) return send({ accessToken: "fixture-token", refreshToken: "fixture-refresh", expiresIn: 3600, user });
    // The regression case: a valid flat permission snapshot without raw grants.
    if (pathname.endsWith("/admin/access")) return send({ permissions: ["agents.review"], universityIds: [user.universityId], allUniversities: true, universities: [{ id: user.universityId, name: "Campaign fixture campus" }] });
    if (pathname.endsWith("/admin/campaign")) {
      if (mode === "loading") await firstLoad;
      if (request.method() === "PATCH") {
        const body = request.postDataJSON();
        assert.equal(typeof body.enabled, "boolean");
        results.mutations.push(body);
        enabled = body.enabled;
        if (mode === "failed-change") return send({ error: { code: "PROVIDER_UNAVAILABLE", message: "Fixture: change response interrupted. Check campaign status." } }, 503);
        return send({ enabled, canManage: true });
      }
      if (mode === "malformed") return send({ enabled });
      if (mode === "error") return send({ error: { code: "PROVIDER_UNAVAILABLE", message: "Fixture: campaign check unavailable." } }, 503);
      return send({ enabled, canManage: mode !== "readonly" });
    }
    return send({});
  });
  const openButton = () => page.getByRole("button", { name: "Disable Exclusive page", exact: true });
  const closedButton = () => page.getByRole("button", { name: "Enable Exclusive page", exact: true });
  const retry = () => page.getByRole("button", { name: "Retry", exact: true });
  async function visible(locator) { await locator.waitFor({ state: "visible" }); }
  async function layout() { assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); }
  await page.goto(origin + "/admin/exclusive-campaign");
  await visible(page.getByText("Checking campaign status and your access…", { exact: true }));
  mode = "normal";
  releaseLoad();
  await visible(openButton());
  await layout();
  await page.screenshot({ path: path.join(output, "campaign-mobile-390.png"), fullPage: true });
  results.checks.push("Visible loading then authorized controls with no raw client grants at 390px");
  await openButton().click();
  await visible(closedButton());
  assert.equal(results.mutations.length, 1);
  assert.match(await page.getByRole("status").last().innerText(), /campaign is closed/);
  await closedButton().click();
  await visible(openButton());
  assert.equal(results.mutations.length, 2);
  results.checks.push("Enable and disable reflect the confirmed response and updated shared-link status");
  mode = "readonly";
  await page.reload();
  await visible(page.getByText(/You can view the campaign status/));
  assert.equal(await openButton().count(), 0);
  assert.equal(await closedButton().count(), 0);
  await layout();
  results.checks.push("Campus reviewer sees campaign status and a clear read-only message");
  mode = "malformed";
  await page.reload();
  await visible(retry());
  assert.match(await page.getByRole("region", { name: "Control the shared Exclusive link" }).getByRole("alert").innerText(), /could not be checked/);
  assert.equal(await openButton().count(), 0);
  mode = "normal";
  await retry().click();
  await visible(openButton());
  results.checks.push("Malformed capability response shows Retry and recovers without fabricated permission");
  mode = "error";
  await page.reload();
  await visible(retry());
  assert.match(await page.getByRole("region", { name: "Control the invitation page" }).getByRole("alert").innerText(), /campaign check unavailable/);
  mode = "normal";
  await retry().click();
  await visible(openButton());
  results.checks.push("Unavailable campaign API shows an actionable error and recovers");
  mode = "failed-change";
  await openButton().click();
  await visible(retry());
  assert.equal(await openButton().isDisabled(), true);
  assert.equal(results.mutations.length, 3);
  mode = "normal";
  await retry().click();
  await visible(closedButton());
  assert.equal(results.mutations.length, 3);
  results.checks.push("Interrupted change disables repeat submission; Retry reads actual status");
  await page.setViewportSize({ width: 1280, height: 900 });
  await layout();
  await page.screenshot({ path: path.join(output, "campaign-desktop-1280.png"), fullPage: true });
  results.checks.push("Desktop and mobile have no horizontal overflow");
  assert.deepEqual(results.pageErrors, []);
  fs.writeFileSync(path.join(output, "verification.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
} catch (error) {
  fs.writeFileSync(path.join(output, "failure.txt"), error.stack ?? String(error));
  throw error;
} finally {
  releaseLoad();
  if (browser) await browser.close();
  server.kill("SIGTERM");
  fs.closeSync(log);
}
