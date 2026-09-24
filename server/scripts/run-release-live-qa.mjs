import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(process.cwd());
const serverDir = join(root, "server");
const configPath = join(serverDir, ".release-live-qa-wrangler.jsonc");
const outDir = join(serverDir, ".release-live-qa-dist");
const apiOrigin = "https://platformp.divine-haze-54eb.workers.dev";

writeFileSync(configPath, JSON.stringify({
  name: "kampusone-release-live-qa-preview",
  main: "scripts/release-live-qa-worker.ts",
  compatibility_date: "2026-09-09"
}, null, 2));
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const fetchSafe = (url, options = {}) =>
  fetch(url, { ...options, redirect: "error", signal: AbortSignal.timeout(90000) });

try {
  const health = await fetchSafe(apiOrigin + "/health/ready");
  if (!health.ok) throw new Error("Production Worker health check failed.");

  execFileSync("npx", [
    "--no-install", "wrangler", "deploy", "--dry-run",
    "--config", ".release-live-qa-wrangler.jsonc",
    "--outdir", ".release-live-qa-dist"
  ], { cwd: serverDir, stdio: "inherit" });

  const bundles = readdirSync(outDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && /\.(?:m?js)$/.test(entry.name))
    .map(entry => join(outDir, entry.name));
  if (bundles.length !== 1) throw new Error(`Expected one QA Worker bundle, found ${bundles.length}.`);
  const bundle = readFileSync(bundles[0], "utf8");

  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token || !/^[a-f0-9]{32}$/i.test(account ?? "")) throw new Error("Cloudflare deployment credentials unavailable.");

  const cf = async (suffix, options = {}) => {
    const response = await fetchSafe(
      `https://api.cloudflare.com/client/v4/accounts/${account}${suffix}`,
      { ...options, headers: { Authorization: `Bearer ${token}`, ...(options.headers ?? {}) } }
    );
    if (!response.ok) throw new Error(`Cloudflare HTTP ${response.status}`);
    const payload = await response.json();
    if (!payload.success) throw new Error("Cloudflare operation failed.");
    return payload.result;
  };

  const settings = await cf("/workers/scripts/platformp/settings");
  const required = ["DATABASE_URL", "JWT_SECRET", "PRIVATE_BUCKET"];
  for (const name of required) {
    if (!settings.bindings?.some(binding => binding.name === name)) throw new Error(`Required production binding missing: ${name}`);
  }
  if (settings.bindings.find(binding => binding.name === "DATABASE_URL")?.type !== "secret_text") {
    throw new Error("DATABASE_URL must remain a secret binding.");
  }
  if (settings.bindings.find(binding => binding.name === "JWT_SECRET")?.type !== "secret_text") {
    throw new Error("JWT_SECRET must remain a secret binding.");
  }

  const session = await cf("/workers/scripts/platformp/subdomain/edge-preview");
  let sessionToken = session.token;
  let host = "platformp.divine-haze-54eb.workers.dev";
  if (session.exchange_url) {
    const exchange = new URL(session.exchange_url);
    if (
      exchange.protocol !== "https:" ||
      ![".cloudflarepreviews.com", ".workers.dev"].some(suffix => exchange.hostname.endsWith(suffix))
    ) throw new Error("Unexpected preview host.");
    const response = await fetchSafe(exchange.href);
    if (response.ok) {
      const value = await response.json();
      if (typeof value.token === "string") sessionToken = value.token;
    }
    host = "platformp" + exchange.hostname.slice(exchange.hostname.indexOf("."));
  }
  if (typeof sessionToken !== "string") throw new Error("Missing preview session.");

  const qaToken = randomBytes(32).toString("hex");
  const form = new FormData();
  form.set("metadata", JSON.stringify({
    main_module: "qa.mjs",
    compatibility_date: "2026-09-09",
    bindings: [
      { name: "DATABASE_URL", type: "inherit" },
      { name: "JWT_SECRET", type: "inherit" },
      { name: "PRIVATE_BUCKET", type: "inherit" },
      { name: "QA_TOKEN", type: "plain_text", text: qaToken },
      { name: "QA_EXPIRES_AT", type: "plain_text", text: String(Date.now() + 180000) },
      { name: "API_ORIGIN", type: "plain_text", text: apiOrigin }
    ]
  }));
  form.set("qa.mjs", new Blob([bundle], { type: "application/javascript+module" }), "qa.mjs");
  form.set("wrangler-session-config", JSON.stringify({ workers_dev: true }));

  const preview = await cf("/workers/scripts/platformp/edge-preview", {
    method: "POST",
    body: form,
    headers: { "cf-preview-upload-config-token": sessionToken }
  });
  if (typeof preview.preview_token !== "string") throw new Error("Missing preview access token.");

  const response = await fetchSafe(`https://${host}/__release_live_qa`, {
    method: "POST",
    headers: {
      "cf-workers-preview-token": preview.preview_token,
      "x-qa-token": qaToken
    }
  });
  const result = await response.json().catch(() => ({}));
  if (
    !response.ok ||
    result.ok !== true ||
    result.stage !== "verified" ||
    result.status !== true ||
    result.text !== true ||
    result.image !== true ||
    result.cleanup !== true
  ) {
    console.error("LIVE QA FAILED:", JSON.stringify({
      http: response.status,
      stage: result.stage ?? "unknown",
      reason: result.reason ?? "withheld",
      statusHttp: Number.isInteger(result.statusHttp) ? result.statusHttp : null,
      statusEnabled: result.statusEnabled === true,
      statusTextCapability: result.statusTextCapability === true,
      statusImageCapability: result.statusImageCapability === true,
      status: result.status === true,
      text: result.text === true,
      image: result.image === true,
      cleanup: result.cleanup === true
    }));
    process.exit(1);
  }

  console.log("PASS: authenticated production AI status, text inference, private image upload, image inference, and cleanup.");
  console.log(JSON.stringify({
    status: true,
    text: true,
    image: true,
    cleanup: true,
    textChars: result.textChars,
    imageChars: result.imageChars
  }));
} finally {
  rmSync(configPath, { force: true });
  rmSync(outDir, { recursive: true, force: true });
}
