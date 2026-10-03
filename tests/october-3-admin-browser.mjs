// Fixture-only browser checks against the actual compiled Next application.
// Run in one process tree: node tests/october-3-admin-browser.mjs
// Requires Playwright plus its Chromium installation, or an explicit browser path.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const portalRequire = createRequire(path.join(root, "portal", "package.json"));
function loadPlaywright() {
  const modules = process.env.ADMIN_TEST_PLAYWRIGHT_MODULE ? [process.env.ADMIN_TEST_PLAYWRIGHT_MODULE] : ["playwright", "@playwright/test"];
  for (const module of modules) {
    for (const resolve of [require, portalRequire]) {
      try { const loaded = resolve(module); if (loaded.chromium) return loaded; } catch { /* Try the next installed module. */ }
    }
  }
  throw new Error("Install Playwright in the portal (npm --prefix portal install --no-save playwright) and its browser (npm --prefix portal exec -- playwright install chromium), or set ADMIN_TEST_PLAYWRIGHT_MODULE to an installed Playwright module.");
}
const { chromium } = loadPlaywright();
const output = process.env.ADMIN_TEST_OUTPUT ? path.resolve(process.env.ADMIN_TEST_OUTPUT) : fs.mkdtempSync(path.join(os.tmpdir(), "kampusone-admin-browser-"));
fs.mkdirSync(output, { recursive: true });
const portalPort = Number(process.env.ADMIN_TEST_PORT ?? 3112);
assert(Number.isInteger(portalPort) && portalPort > 0 && portalPort <= 65535, "ADMIN_TEST_PORT must be a valid port");
const portalOrigin = `http://127.0.0.1:${portalPort}`;
// The compiled portal's default local API is localhost:8787; build without a
// NEXT_PUBLIC_KAMPUSONE_API_URL override when running this fixture harness.
const apiOrigin = "http://127.0.0.1:8787";
const universityId = "22222222-2222-4222-8222-222222222222";
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const yesterday = new Date(Date.parse(`${today}T12:00:00+01:00`) - 86400000).toISOString().slice(0, 10);
const now = new Date().toISOString();
const state = { mode: "normal", expenses: [], acknowledgements: [], requests: [] };
const summary = () => ({ platform_revenue_kobo: 2370000, expenses_kobo: 140000 + state.expenses.reduce((sum, row) => sum + Number(row.amount_kobo), 0), commission_kobo: 1730000, vendor_proceeds_kobo: 29000000, marketplace_revenue_kobo: 1730000, gmv_kobo: 31800000, transactions_processed: 72, transactions_definition: "Visual fixture: confirmed payment records", profit_kobo: 2230000 - state.expenses.reduce((sum, row) => sum + Number(row.amount_kobo), 0), arr_kobo: null, arr_definition: "Monthly access is prepaid, with no recurring subscription contract.", definition: "Visual fixture only. Revenue and expense classifications exercise the portal; no live financial records are used.", breakdown: [{ account_code: "PLATFORM_COMMISSION", account_type: "REVENUE", amount_kobo: 1730000 }, { account_code: "KIRA_ACCESS_REVENUE", account_type: "REVENUE", amount_kobo: 640000 }, { account_code: "PAYSTACK_PROCESSING", account_type: "EXPENSE", amount_kobo: 140000 }] });
const daily = Array.from({ length: 30 }, (_, index) => ({ day: new Date(Date.parse(`${today}T12:00:00+01:00`) - (29 - index) * 86400000).toISOString().slice(0, 10), events: state.mode === "empty" ? 0 : (index % 5 + 1) * 7, active_users: state.mode === "empty" ? 0 : index % 4 + 2 }));
const user = { id: "11111111-1111-4111-8111-111111111111", email: "admin.fixture@example.test", roles: ["STUDENT"], universityId, operatorRoles: ["PLATFORM_ADMIN"] };
const api = http.createServer(async (req, res) => {
  const url = new URL(req.url, apiOrigin);
  state.requests.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams) });
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin ?? portalOrigin);
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Device-Label");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Content-Type", "application/json");
  const send = (data, status = 200) => { res.statusCode = status; res.end(JSON.stringify(data)); };
  if (req.method === "OPTIONS") return send({});
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : {};
  const route = url.pathname;
  if (route === "/v1/auth/refresh") return send({ accessToken: "fixture-access", refreshToken: "fixture-refresh", expiresIn: 3600, user });
  if (route === "/v1/admin/access") return send({ permissions: ["*"], grants: [{ permissions: ["*"], university_id: null }], universityIds: [universityId], allUniversities: true, universities: [{ id: universityId, name: "University of Benin · visual fixture" }] });
  if (route === "/v1/admin/reports/daily") {
    const day = url.searchParams.get("date") ?? today;
    const counts = { signups: 14, signed_in_users: 82, resumed_users: 29, active_users: 96, recorded_activities: 371, posts_created: 16, posts_published: 12, products_created: 7, product_updates: 11, sales_recorded: 19, coupons_created: 2, agents_approved: 3, messages_sent: 154, foreground_seconds: 72840 };
    return send({ ready: true, availableDays: [today, yesterday], report: { day, timeZone: "Africa/Lagos", generatedAt: now, provisional: day === today, counts, activity: [{ event_name: "screen_view", count: 190, users: 89 }, { event_name: "post_liked", count: 112, users: 67 }, { event_name: "community_opened", count: 69, users: 28 }], changes: [{ event_name: "post_published", count: 12 }, { event_name: "product_updated", count: 11 }, { event_name: "agent_approved", count: 3 }, { event_name: "coupon_created", count: 2 }], campaigns: [{ status: "DELIVERED", count: 82 }, { status: "PENDING", count: 7 }], finance: summary(), coverage: { definition: "Visual fixture: distinct accounts and recorded events inside the selected West Africa Time day. Historical gaps are not estimated.", recordChangesStartedAt: "2026-10-01T12:00:00Z", signinsStartedAt: "2026-10-01T12:00:00Z" } } });
  }
  if (route === "/v1/admin/finance/reporting/expenses") {
    assert.equal(req.method, "POST");
    assert.equal(body.universityId, universityId);
    assert.equal(body.amountKobo, 125000);
    const expense = { id: body.requestId, institution_id: body.universityId, category: body.category, description: body.description, incurred_on: body.incurredOn, amount_kobo: String(body.amountKobo) };
    if (!state.expenses.some(row => row.id === expense.id)) state.expenses.push(expense);
    return send({ expense }, 201);
  }
  if (route === "/v1/admin/finance/reporting") return send({ ready: true, summary: summary(), expenses: state.expenses, generatedAt: now });
  if (route === "/v1/admin/reports/workspace") {
    if (state.mode === "error") return send({ error: { code: "PROVIDER_UNAVAILABLE", message: "Visual fixture: message report interrupted. Retry insights." } }, 503);
    return send({ ready: true, categories: state.mode === "empty" ? [] : [{ label: "TEXT", value: 84 }, { label: "VOICE", value: 37 }, { label: "IMAGE", value: 21 }, { label: "VIDEO", value: 8 }], daily: daily.map(row => ({ ...row, events: state.mode === "empty" ? 0 : row.events })), definition: "Visual fixture: message records by format and West Africa Time day. Message bodies are not retrieved." });
  }
  if (route === "/v1/admin/reports/engagement") return send({ days: 30, generatedAt: now, definition: "Visual fixture: recorded account activity.", totals: { events: 371, active_users: 96, collection_started_at: "2026-10-01T12:00:00Z" }, daily, screens: [{ screen: "feed", views: 190, active_users: 89 }], universities: [{ name: "University of Benin · visual fixture", active_users: 96, events: 371 }], platforms: [{ platform: "android", active_users: 65, events: 237 }, { platform: "ios", active_users: 31, events: 134 }], interactions: [], platformReady: true, retention: { eligible_users: 70, returned_users: 43 } });
  if (route === "/v1/admin/reports/google-analytics") return send({ state: "setup_required", message: "Visual fixture: external analytics is not configured." });
  if (route === "/v1/usage/admin/today") return send({ ready: true, totals: { day: url.searchParams.get("date"), foreground_seconds: 72840, users: 96, samples: 401 }, users: [{ user_id: user.id, display_name: "Visual fixture account", username: "fixture", foreground_seconds: 780, platforms: ["android", "ios"] }], screens: [{ screen: "feed", foreground_seconds: 43500 }, { screen: "kira", foreground_seconds: 21240 }, { screen: "community", foreground_seconds: 8100 }], definition: "Visual fixture: measured foreground seconds, with no background extrapolation.", timeZone: "Africa/Lagos" });
  if (route === "/v1/admin/reports/milestones/acknowledge") { state.acknowledgements.push(body.key); return send({ acknowledged: true }); }
  if (route === "/v1/admin/reports/milestones") return send({ milestones: state.acknowledgements.length ? [] : [{ key: "signups:100", label: "100 accounts have joined KampusOne", value: 100, kind: "signups" }] });
  if (route === "/v1/admin/dashboard") return send({ metrics: { users: { total: 114, new_30d: 49, email_verified: 91, onboarded: 86 }, applications: { pending: 3, approved: 17, tutors: 4, vendors: 10, riders: 3 }, content: { published_posts: 31, draft_posts: 4, published_places: 9 }, commerce: { tutorial_bookings: 12, orders: 59, active_deliveries: 4, open_disputes: 1, payment_anomalies: 0 }, revenue: { tutorial_gmv_kobo: 6800000, store_gmv_kobo: 31800000, delivery_gmv_kobo: 810000, recognized_revenue_kobo: 2370000 } }, revenueTrend: daily.map(row => ({ day: row.day, gmv_kobo: row.events * 12500 })), queues: { applications: [] }, generatedAt: now });
  if (route === "/v1/auth/logout") return send({});
  return send({});
});
await new Promise((resolve, reject) => api.once("error", reject).listen(8787, "127.0.0.1", resolve));
const log = fs.openSync(path.join(output, "next.log"), "w");
const portal = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(portalPort)], { cwd: path.join(root, "portal"), env: { ...process.env, KAMPUSONE_API_ORIGIN: apiOrigin }, stdio: ["ignore", log, log] });
const browserPath = process.env.ADMIN_TEST_CHROMIUM;
const results = { fixtureOnly: true, definition: "Explicit local auth/report/finance fixtures against the actual compiled Next production portal. No live data or provider is exercised.", screenshots: [], checks: [], pageErrors: [], consoleErrors: [] };
let browser;
try {
  let ready = false;
  for (let index = 0; index < 80; index++) { if (portal.exitCode !== null) throw new Error(`Next failed to start; see ${path.join(output, "next.log")}`); try { if ((await fetch(`${portalOrigin}/admin`)).ok) { ready = true; break; } } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
  assert(ready, `Compiled Next portal did not become ready; see ${path.join(output, "next.log")}`);
  // Optional CLI smoke check; direct Playwright does not require agent-browser.
  const tryCli = process.env.ADMIN_TEST_TRY_AGENT_BROWSER === "1" && !process.env.ADMIN_TEST_SKIP_AGENT_BROWSER;
  const cli = tryCli ? spawnSync("npx", ["--yes", "agent-browser", "--session", "kampusone-admin-review", ...(browserPath ? ["--executable-path", browserPath] : []), "--args", "--no-sandbox,--single-process,--disable-dev-shm-usage", "open", `${portalOrigin}/admin`], { encoding: "utf8", timeout: 20000 }) : { status: null };
  if (tryCli) fs.writeFileSync(path.join(output, "agent-browser.log"), `${cli.stdout ?? ""}\n${cli.stderr ?? ""}\n${cli.error ?? ""}`);
  results.agentBrowser = { status: cli.status, skipped: !tryCli, verification: "Direct Playwright; server and browser remain in this process tree." };
  if (tryCli) spawnSync("npx", ["--yes", "agent-browser", "--session", "kampusone-admin-review", "close"], { encoding: "utf8", timeout: 5000 });
  browser = await chromium.launch({ executablePath: browserPath, headless: true, args: ["--no-sandbox", "--single-process", "--disable-dev-shm-usage", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  page.on("pageerror", error => results.pageErrors.push(String(error)));
  page.on("console", message => { if (message.type() === "error" && state.mode !== "error") results.consoleErrors.push(message.text()); });
  async function capture(name) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
    await page.screenshot({ path: path.join(output, `${name}-viewport.png`) });
    const check = await page.evaluate(() => ({ viewport: innerWidth, pageWidth: document.documentElement.scrollWidth, overflow: document.documentElement.scrollWidth > innerWidth, errorOverlay: !!document.querySelector("[data-nextjs-dialog]"), headings: [...document.querySelectorAll("h1,h2,h3")].map(element => element.textContent), overflowing: [...document.querySelectorAll("body *")].filter(element => { const rect = element.getBoundingClientRect(); return rect.width && (rect.right > innerWidth + 1 || rect.left < -1) && getComputedStyle(element).position !== "absolute"; }).slice(0, 8).map(element => ({ tag: element.tagName, class: element.className, text: element.textContent.slice(0, 60) })) }));
    results.screenshots.push(`${name}.png`); results.checks.push({ name, ...check });
    assert.equal(check.overflow, false, `${name} horizontal overflow: ${JSON.stringify(check.overflowing)}`);
    assert.equal(check.errorOverlay, false, `${name} Next error overlay`);
    for (const chart of await page.locator("svg.analytics-line-chart").all()) {
      const width = await chart.evaluate(element => element.viewBox.baseVal.width);
      assert.equal(width, check.viewport <= 650 ? 360 : 720, `${name} chart includes the full date range at this viewport`);
    }
    console.log(`Verified ${name}: width=${check.pageWidth}, headings=${check.headings.length}`);
  }
  await page.goto(`${portalOrigin}/admin`);
  await page.getByRole("heading", { name: "What happened on KampusOne" }).waitFor();
  await page.locator("p:visible").filter({ hasText: "Visual fixture only." }).first().waitFor();
  await page.getByRole("heading", { name: "A milestone worth celebrating" }).waitFor();
  results.reducedMotion = await page.locator("[class*=confetti]").first().evaluate(element => ({ display: getComputedStyle(element).display, animation: getComputedStyle(element).animationName }));
  assert.equal(results.reducedMotion.display, "none");
  await capture("overview-390");
  await page.setViewportSize({ width: 1280, height: 844 }); await capture("overview-1280");
  await page.getByRole("button", { name: "Dismiss milestone celebration" }).click();
  await page.goto(`${portalOrigin}/admin/reports`);
  await page.getByLabel("Report date", { exact: true }).waitFor();
  await page.getByLabel("Report date", { exact: true }).fill(yesterday);
  await page.getByText("Saved historical report.", { exact: false }).waitFor();
  assert(state.requests.some(request => request.path.endsWith("/reports/daily") && request.query.date === yesterday));
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export day", exact: true }).click();
  const download = await downloadEvent; await download.saveAs(path.join(output, "daily-export.csv"));
  assert(fs.readFileSync(path.join(output, "daily-export.csv"), "utf8").includes(`"${yesterday}","New accounts","14"`));
  await page.getByLabel("Usage date", { exact: true }).fill(yesterday);
  await page.getByText(`${yesterday} · West Africa Time`, { exact: false }).waitFor();
  await capture("daily-history-1280");
  await page.setViewportSize({ width: 390, height: 844 }); await capture("daily-history-390");
  await page.goto(`${portalOrigin}/admin/revenue`);
  await page.getByRole("heading", { name: "Record an operating expense" }).waitFor();
  await capture("revenue-390");
  await page.setViewportSize({ width: 1280, height: 844 }); await capture("revenue-1280");
  await page.locator("form").getByLabel("University").selectOption(universityId);
  await page.getByLabel("Amount · ₦", { exact: true }).fill("1250");
  await page.getByLabel("Description", { exact: true }).fill("Visual fixture hosting invoice");
  await page.getByRole("button", { name: "Record expense", exact: true }).click();
  await page.getByText("Visual fixture hosting invoice", { exact: true }).waitFor();
  await page.getByRole("status").filter({ hasText: "Expense recorded." }).waitFor();
  assert.equal(await page.locator("form fieldset").evaluate(element => getComputedStyle(element).borderTopWidth), "0px");
  assert.equal(state.expenses.length, 1);
  await page.getByLabel("Revenue · ₦", { exact: true }).fill("10000");
  await page.getByLabel("Expenses · ₦", { exact: true }).fill("12000");
  await page.locator("output").filter({ hasText: "Loss" }).waitFor();
  assert.match(await page.locator("output").textContent(), /2,000/);
  await capture("expense-recorded-1280");
  await page.goto(`${portalOrigin}/admin/messages-statistics`);
  await page.getByRole("heading", { name: "Messages by format" }).waitFor();
  await capture("messages-1280");
  const scopedResponse = page.waitForResponse(response => response.url().includes(`module=messages&universityId=${universityId}`));
  await page.getByLabel("University context", { exact: true }).selectOption(universityId);
  await page.locator(".scope-caption").getByText("University of Benin · visual fixture", { exact: true }).waitFor();
  await scopedResponse;
  await page.setViewportSize({ width: 390, height: 844 }); await capture("messages-scoped-390");
  state.mode = "empty"; await page.reload(); await page.getByText("No records in the last 30 days.").waitFor(); await capture("messages-empty-390");
  state.mode = "error"; await page.reload(); await page.getByRole("button", { name: "Retry insights" }).waitFor(); await capture("messages-error-390");
  state.mode = "normal"; await page.getByRole("button", { name: "Retry insights" }).click(); await page.getByRole("heading", { name: "Messages by format" }).waitFor(); await capture("messages-retried-390");
  results.expenseRecords = state.expenses.length;
  results.scopeVerified = state.requests.some(request => request.path.endsWith("/reports/workspace") && request.query.universityId === universityId);
  results.dailyExport = "daily-export.csv";
  const cliLog = path.join(output, "agent-browser.log");
  results.agentBrowserInitialFailure = fs.existsSync(cliLog) && fs.readFileSync(cliLog, "utf8").includes("Daemon process exited during startup");
  results.milestoneAcknowledged = state.acknowledgements.includes("signups:100");
  assert.equal(results.pageErrors.length, 0); assert.equal(results.consoleErrors.length, 0);
  fs.writeFileSync(path.join(output, "verification.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
  console.log(`Browser evidence: ${output}`);
} finally {
  if (browser) await browser.close();
  portal.kill("SIGTERM"); api.close();
}
