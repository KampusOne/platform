import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const EXPECTED_BLOB_SHA = "c5525e6c2be11a107da231b05d099edce0047b61";
const root = resolve(process.cwd());
const serverDir = join(root, "server");
const migrationPath = join(root, "database/neon/migrations/20260924000000_student_ai_profiles.sql");
const source = readFileSync(migrationPath);
const actualBlobSha = createHash("sha1")
  .update(`blob ${source.length}\0`)
  .update(source)
  .digest("hex");

if (actualBlobSha !== EXPECTED_BLOB_SHA) {
  throw new Error("Migration blob hash changed; refusing production migration.");
}

function splitSql(input) {
  const statements = [];
  let current = "";
  let single = false, double = false, line = false, block = false, dollar = null;
  for (let i = 0; i < input.length; i++) {
    const c = input[i], n = input[i + 1];
    if (line) {
      current += c;
      if (c === "\n") line = false;
      continue;
    }
    if (block) {
      current += c;
      if (c === "*" && n === "/") {
        current += n; i++; block = false;
      }
      continue;
    }
    if (dollar) {
      if (input.startsWith(dollar, i)) {
        current += dollar; i += dollar.length - 1; dollar = null;
      } else current += c;
      continue;
    }
    if (single) {
      current += c;
      if (c === "'" && n === "'") { current += n; i++; }
      else if (c === "'") single = false;
      continue;
    }
    if (double) {
      current += c;
      if (c === '"' && n === '"') { current += n; i++; }
      else if (c === '"') double = false;
      continue;
    }
    if (c === "-" && n === "-") { current += c + n; i++; line = true; continue; }
    if (c === "/" && n === "*") { current += c + n; i++; block = true; continue; }
    if (c === "'") { current += c; single = true; continue; }
    if (c === '"') { current += c; double = true; continue; }
    if (c === "$") {
      const match = input.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/);
      if (match) {
        dollar = match[0]; current += dollar; i += dollar.length - 1; continue;
      }
    }
    if (c === ";") {
      const text = current.trim();
      if (text) statements.push(text);
      current = "";
      continue;
    }
    current += c;
  }
  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements.filter((statement) => {
    const normalized = statement.replace(/--.*$/gm, "").trim().toLowerCase();
    return normalized !== "begin" && normalized !== "commit";
  });
}

const statements = splitSql(source.toString("utf8"));
if (statements.length !== 14) {
  throw new Error(`Expected 14 migration statements, found ${statements.length}; refusing production migration.`);
}

const workerPath = join(serverDir, ".approved-ai-migration-worker.ts");
const configPath = join(serverDir, ".approved-ai-migration-wrangler.jsonc");
const outDir = join(serverDir, ".approved-ai-migration-dist");

const workerSource = `
import { neon } from "@neondatabase/serverless";

const statements = ${JSON.stringify(statements)};
const requiredBase = [
  "app_private.ai_requests",
  "public.users",
  "public.universities",
  "public.timetable_entries",
  "public.student_alarms",
  "public.course_drafts"
];

function equalToken(expected: string, supplied: string) {
  if (!/^[a-f0-9]{64}$/.test(expected) || !/^[a-f0-9]{64}$/.test(supplied)) return false;
  let difference = 0;
  for (let i = 0; i < 64; i++) difference |= expected.charCodeAt(i) ^ supplied.charCodeAt(i);
  return difference === 0;
}

export default {
  async fetch(request: Request, env: { DATABASE_URL?: string; MIGRATION_TOKEN?: string; MIGRATION_EXPIRES_AT?: string }) {
    const reply = (body: unknown, status = 200) =>
      Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
    const url = new URL(request.url);
    const supplied = request.headers.get("x-migration-token") ?? "";
    const expiresAt = Number(env.MIGRATION_EXPIRES_AT);
    if (
      request.method !== "POST" ||
      url.pathname !== "/__approved_ai_migration" ||
      typeof env.MIGRATION_TOKEN !== "string" ||
      !equalToken(env.MIGRATION_TOKEN, supplied) ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= Date.now() ||
      expiresAt > Date.now() + 240000
    ) return new Response(null, { status: 404 });
    if (!env.DATABASE_URL) return reply({ ok: false, stage: "configuration_missing" }, 503);

    const sql = neon(env.DATABASE_URL, { fetchOptions: { cache: "no-store" } });

    const pre = await sql.query(
      \`select current_database() as database,
        to_regclass('app_private.ai_requests') is not null as ai_requests,
        to_regclass('public.users') is not null as users,
        to_regclass('public.universities') is not null as universities,
        to_regclass('public.timetable_entries') is not null as timetable_entries,
        to_regclass('public.student_alarms') is not null as student_alarms,
        to_regclass('public.course_drafts') is not null as course_drafts\`,
      []
    );
    const before = pre[0] as Record<string, unknown> | undefined;
    const baseOk = before?.database === "neondb" && requiredBase.every((name) => {
      const key = name.split(".").at(-1)!;
      return before?.[key] === true;
    });
    if (!baseOk) return reply({ ok: false, stage: "precondition_failed", before }, 409);

    const queries = [
      sql\`set local lock_timeout = '5s'\`,
      sql\`set local statement_timeout = '30s'\`,
      ...statements.map((statement) => sql\`\${sql.unsafe(statement)}\`)
    ];
    await sql.transaction(queries, { isolationLevel: "Serializable", readOnly: false });

    const verified = await sql.query(
      \`select
        current_database() as database,
        to_regclass('app_private.ai_subscriptions') is not null as ai_subscriptions,
        to_regclass('public.profile_follows') is not null as profile_follows,
        exists(
          select 1 from information_schema.columns
          where table_schema='public' and table_name='timetable_entries' and column_name='occurs_on'
        ) as occurs_on,
        to_regclass('public.timetable_weekly_unique') is not null as weekly_index,
        to_regclass('public.timetable_dated_unique') is not null as dated_index,
        exists(
          select 1 from pg_trigger
          where tgname='timetable_tools_sync'
            and tgrelid='public.timetable_entries'::regclass
            and not tgisinternal
        ) as timetable_trigger,
        exists(
          select 1
          from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname='app_private' and p.proname='sync_timetable_tools'
        ) as timetable_function\`,
      []
    );
    const after = verified[0] as Record<string, unknown> | undefined;
    const ok = after?.database === "neondb" &&
      ["ai_subscriptions","profile_follows","occurs_on","weekly_index","dated_index","timetable_trigger","timetable_function"]
        .every((key) => after?.[key] === true);
    return reply({ ok, stage: ok ? "verified" : "verification_failed", after }, ok ? 200 : 500);
  }
};
`;

writeFileSync(workerPath, workerSource);
writeFileSync(configPath, JSON.stringify({
  name: "approved-ai-migration-preview",
  main: ".approved-ai-migration-worker.ts",
  compatibility_date: "2026-09-09"
}, null, 2));
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

try {
  execFileSync("npx", [
    "--no-install", "wrangler", "deploy", "--dry-run",
    "--config", ".approved-ai-migration-wrangler.jsonc",
    "--outdir", ".approved-ai-migration-dist"
  ], { cwd: serverDir, stdio: "inherit" });

  const bundleCandidates = readdirSync(outDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(?:m?js)$/.test(entry.name))
    .map((entry) => join(outDir, entry.name));
  if (bundleCandidates.length !== 1) {
    throw new Error(`Expected exactly one Worker bundle, found ${bundleCandidates.length}.`);
  }
  const bundle = readFileSync(bundleCandidates[0], "utf8");

  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token || !/^[a-f0-9]{32}$/i.test(account ?? "")) {
    throw new Error("Cloudflare deployment credentials unavailable.");
  }

  const fetchSafe = (url, options = {}) =>
    fetch(url, { ...options, redirect: "error", signal: AbortSignal.timeout(45000) });
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
  const databaseBinding = settings.bindings?.find((binding) => binding.name === "DATABASE_URL");
  if (databaseBinding?.type !== "secret_text") {
    throw new Error("Production DATABASE_URL is missing or is not stored as a secret binding.");
  }

  const session = await cf("/workers/scripts/platformp/subdomain/edge-preview");
  let sessionToken = session.token;
  let host = "platformp.divine-haze-54eb.workers.dev";
  if (session.exchange_url) {
    const exchange = new URL(session.exchange_url);
    if (
      exchange.protocol !== "https:" ||
      ![".cloudflarepreviews.com", ".workers.dev"].some((suffix) => exchange.hostname.endsWith(suffix))
    ) throw new Error("Unexpected Cloudflare preview host.");
    const response = await fetchSafe(exchange.href);
    if (response.ok) {
      const data = await response.json();
      if (typeof data.token === "string") sessionToken = data.token;
    }
    host = "platformp" + exchange.hostname.slice(exchange.hostname.indexOf("."));
  }
  if (typeof sessionToken !== "string") throw new Error("Missing Cloudflare preview session token.");

  const migrationToken = randomBytes(32).toString("hex");
  const form = new FormData();
  form.set("metadata", JSON.stringify({
    main_module: "migration.mjs",
    compatibility_date: "2026-09-09",
    bindings: [
      { name: "DATABASE_URL", type: "inherit" },
      { name: "MIGRATION_TOKEN", type: "plain_text", text: migrationToken },
      { name: "MIGRATION_EXPIRES_AT", type: "plain_text", text: String(Date.now() + 180000) }
    ]
  }));
  form.set("migration.mjs", new Blob([bundle], { type: "application/javascript+module" }), "migration.mjs");
  form.set("wrangler-session-config", JSON.stringify({ workers_dev: true }));

  const preview = await cf("/workers/scripts/platformp/edge-preview", {
    method: "POST",
    body: form,
    headers: { "cf-preview-upload-config-token": sessionToken }
  });
  if (typeof preview.preview_token !== "string") throw new Error("Missing preview access token.");

  const response = await fetchSafe(`https://${host}/__approved_ai_migration`, {
    method: "POST",
    headers: {
      "cf-workers-preview-token": preview.preview_token,
      "x-migration-token": migrationToken
    }
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok !== true || result.stage !== "verified") {
    throw new Error(`Migration verification failed with HTTP ${response.status}; raw database errors withheld.`);
  }

  console.log("PASS: approved AI/profile migration applied to production and schema verification passed.");
  console.log(JSON.stringify(result.after));
} finally {
  rmSync(workerPath, { force: true });
  rmSync(configPath, { force: true });
  rmSync(outDir, { recursive: true, force: true });
}
