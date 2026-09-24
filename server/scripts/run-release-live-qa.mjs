import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(process.cwd());
const serverDir = join(root, "server");
const configPath = join(serverDir, ".release-live-qa-wrangler.jsonc");
const outDir = join(serverDir, ".release-live-qa-dist");
const apiOrigin = "https://platformp.divine-haze-54eb.workers.dev";
const redPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAX0lEQVR4nO3PQQ0AIBDAMMC/50MEj4ZkVbDtWX87OuBVA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA9oFUoUBf3Xr7AgAAAAASUVORK5CYII=", "base64");

writeFileSync(configPath, JSON.stringify({
  name: "kampusone-release-live-qa-preview",
  main: "scripts/release-live-qa-worker.ts",
  compatibility_date: "2026-09-09"
}, null, 2));
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const fetchSafe = (url, options = {}) =>
  fetch(url, { ...options, redirect: "error", signal: options.signal ?? AbortSignal.timeout(90000) });

let cleanupUrl;
let cleanupHeaders;
let qaUserId;
let mediaId;
let accessToken;
let cleanupPassed = false;
let failure;
let summary = {
  statusHttp: null,
  statusEnabled: false,
  statusTextCapability: false,
  statusImageCapability: false,
  status: false,
  text: false,
  image: false,
  cleanup: false,
  textChars: 0,
  imageChars: 0,
};

try {
  const health = await fetchSafe(apiOrigin + "/health/ready");
  if (!health.ok) throw new Error("production_health");

  execFileSync("npx", [
    "--no-install", "wrangler", "deploy", "--dry-run",
    "--config", ".release-live-qa-wrangler.jsonc",
    "--outdir", ".release-live-qa-dist"
  ], { cwd: serverDir, stdio: "inherit" });

  const bundles = readdirSync(outDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && /\.(?:m?js)$/.test(entry.name))
    .map(entry => join(outDir, entry.name));
  if (bundles.length !== 1) throw new Error("qa_bundle");
  const bundle = readFileSync(bundles[0], "utf8");

  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token || !/^[a-f0-9]{32}$/i.test(account ?? "")) throw new Error("cloudflare_credentials");

  const cf = async (suffix, options = {}) => {
    const response = await fetchSafe(
      `https://api.cloudflare.com/client/v4/accounts/${account}${suffix}`,
      { ...options, headers: { Authorization: `Bearer ${token}`, ...(options.headers ?? {}) } }
    );
    if (!response.ok) throw new Error(`cloudflare_http_${response.status}`);
    const payload = await response.json();
    if (!payload.success) throw new Error("cloudflare_operation");
    return payload.result;
  };

  const settings = await cf("/workers/scripts/platformp/settings");
  const required = ["DATABASE_URL", "JWT_SECRET", "PRIVATE_BUCKET"];
  for (const name of required) {
    if (!settings.bindings?.some(binding => binding.name === name)) throw new Error("production_binding");
  }
  if (settings.bindings.find(binding => binding.name === "DATABASE_URL")?.type !== "secret_text") throw new Error("database_binding_type");
  if (settings.bindings.find(binding => binding.name === "JWT_SECRET")?.type !== "secret_text") throw new Error("jwt_binding_type");

  const session = await cf("/workers/scripts/platformp/subdomain/edge-preview");
  let sessionToken = session.token;
  let host = "platformp.divine-haze-54eb.workers.dev";
  if (session.exchange_url) {
    const exchange = new URL(session.exchange_url);
    if (
      exchange.protocol !== "https:" ||
      ![".cloudflarepreviews.com", ".workers.dev"].some(suffix => exchange.hostname.endsWith(suffix))
    ) throw new Error("preview_host");
    const response = await fetchSafe(exchange.href);
    if (response.ok) {
      const value = await response.json();
      if (typeof value.token === "string") sessionToken = value.token;
    }
    host = "platformp" + exchange.hostname.slice(exchange.hostname.indexOf("."));
  }
  if (typeof sessionToken !== "string") throw new Error("preview_session");

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
      { name: "QA_EXPIRES_AT", type: "plain_text", text: String(Date.now() + 180000) }
    ]
  }));
  form.set("qa.mjs", new Blob([bundle], { type: "application/javascript+module" }), "qa.mjs");
  form.set("wrangler-session-config", JSON.stringify({ workers_dev: true }));

  const preview = await cf("/workers/scripts/platformp/edge-preview", {
    method: "POST",
    body: form,
    headers: { "cf-preview-upload-config-token": sessionToken }
  });
  if (typeof preview.preview_token !== "string") throw new Error("preview_access");

  const previewHeaders = {
    "cf-workers-preview-token": preview.preview_token,
    "x-qa-token": qaToken
  };
  const setupUrl = `https://${host}/__release_live_qa/setup`;
  cleanupUrl = `https://${host}/__release_live_qa/cleanup`;
  cleanupHeaders = { ...previewHeaders, "Content-Type": "application/json" };

  const setupResponse = await fetchSafe(setupUrl, { method: "POST", headers: previewHeaders });
  const setup = await setupResponse.json().catch(() => ({}));
  if (!setupResponse.ok || setup.ok !== true || typeof setup.userId !== "string" || typeof setup.accessToken !== "string") {
    throw new Error(`setup_http_${setupResponse.status}`);
  }
  qaUserId = setup.userId;
  accessToken = setup.accessToken;

  const authHeaders = { Authorization: `Bearer ${accessToken}` };

  const statusResponse = await fetchSafe(apiOrigin + "/v1/ai/status", { headers: authHeaders });
  const status = await statusResponse.json().catch(() => ({}));
  summary.statusHttp = statusResponse.status;
  summary.statusEnabled = status.enabled === true;
  summary.statusTextCapability = status.capabilities?.text === true;
  summary.statusImageCapability = status.capabilities?.images === true;
  summary.status =
    statusResponse.status === 200 &&
    summary.statusEnabled &&
    summary.statusTextCapability &&
    summary.statusImageCapability &&
    !JSON.stringify(status).toLowerCase().includes("hugging face") &&
    !JSON.stringify(status).toLowerCase().includes("qwen");
  if (!summary.status) throw new Error("status_contract");

  const textResponse = await fetchSafe(apiOrigin + "/v1/ai/", {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: "study",
      tier: "standard",
      prompt: "Reply with one short sentence that explicitly includes the words voltage, current, and resistance while stating Ohm's law.",
      idempotencyKey: crypto.randomUUID(),
      consent: true,
    }),
    signal: AbortSignal.timeout(60000),
  });
  const textBody = await textResponse.json().catch(() => ({}));
  const textValue = typeof textBody.text === "string" ? textBody.text.trim() : "";
  summary.textChars = textValue.length;
  const normalizedText = textValue.toLowerCase();
  summary.text =
    textResponse.status === 200 &&
    textValue.length >= 20 &&
    normalizedText.includes("voltage") &&
    normalizedText.includes("current") &&
    normalizedText.includes("resistance");
  if (!summary.text) throw new Error(`text_http_${textResponse.status}`);

  const uploadForm = new FormData();
  uploadForm.set("kind", "resource");
  uploadForm.set("file", new File([redPng], "release-qa-red.png", { type: "image/png" }));
  const uploadResponse = await fetchSafe(apiOrigin + "/v1/media/", {
    method: "POST",
    headers: authHeaders,
    body: uploadForm,
    signal: AbortSignal.timeout(30000),
  });
  const upload = await uploadResponse.json().catch(() => ({}));
  mediaId = typeof upload.id === "string" ? upload.id : undefined;
  if (uploadResponse.status !== 201 || !mediaId) throw new Error(`upload_http_${uploadResponse.status}`);

  const imageResponse = await fetchSafe(apiOrigin + "/v1/ai/", {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: "study",
      tier: "standard",
      prompt: "Look at the attached image and answer with the single lowercase word for its dominant color.",
      mediaId,
      idempotencyKey: crypto.randomUUID(),
      consent: true,
    }),
    signal: AbortSignal.timeout(75000),
  });
  const imageBody = await imageResponse.json().catch(() => ({}));
  const imageValue = typeof imageBody.text === "string" ? imageBody.text.trim() : "";
  summary.imageChars = imageValue.length;
  summary.image = imageResponse.status === 200 && /\bred\b/i.test(imageValue);
  if (!summary.image) throw new Error(`image_http_${imageResponse.status}`);
} catch (error) {
  const message = error instanceof Error ? error.message : "";
  failure = /^[a-z_]+(?:_[1-5][0-9]{2})?$/.test(message) ? message : "qa_failed";
} finally {
  if (cleanupUrl && cleanupHeaders && qaUserId) {
    try {
      const response = await fetchSafe(cleanupUrl, {
        method: "POST",
        headers: cleanupHeaders,
        body: JSON.stringify({ userId: qaUserId, mediaId }),
        signal: AbortSignal.timeout(30000),
      });
      const value = await response.json().catch(() => ({}));
      cleanupPassed = response.ok && value.ok === true && value.cleanup === true;
    } catch {
      cleanupPassed = false;
    }
  } else {
    cleanupPassed = qaUserId ? false : true;
  }
  summary.cleanup = cleanupPassed;
  rmSync(configPath, { force: true });
  rmSync(outDir, { recursive: true, force: true });
}

if (failure || !summary.cleanup) {
  console.error("LIVE QA FAILED:", JSON.stringify({ ...summary, reason: failure ?? "cleanup_failed" }));
  process.exit(1);
}

console.log("PASS: authenticated production AI status, text inference, private image upload, image inference, and cleanup.");
console.log(JSON.stringify(summary));
