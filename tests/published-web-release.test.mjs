import assert from "node:assert/strict";
import test from "node:test";
import { verifyDeploymentRecords, verifyProductionAliases, productionHosts } from "../server/scripts/verify-published-web-release.mjs";

const sha = "a".repeat(40);
function records() {
  return { sourceSha: sha, mainSha: sha, repository: "KampusOne/platform",
    workerRuns: { workflow_runs: [{ id: 123, head_sha: sha, head_branch: "main", status: "completed", conclusion: "success",
      path: ".github/workflows/deploy-worker.yml", head_repository: { full_name: "KampusOne/platform" } }] },
    statuses: { sha, statuses: ["kampusone-platform-preview", "kampusone-mobile-preview"].map((project) => ({
      context: `Vercel – ${project}`, state: "success", target_url: `https://vercel.com/warriorpikins-projects/${project}/AbC123` })) } };
}
function publishedResponse(url) {
  const version = url.endsWith("version.json");
  return new Response(version ? JSON.stringify({ version: sha }) : "", { status: url.includes("/api/") ? 401 : 200 });
}

test("a matching successful production release produces a receipt authority", () => {
  assert.equal(verifyDeploymentRecords(records()).workerRunId, "123");
});
test("stale main revisions and foreign status revisions cannot issue receipts", () => {
  const stale = records(); stale.mainSha = "b".repeat(40);
  assert.throws(() => verifyDeploymentRecords(stale), /current main/);
  const foreign = records(); foreign.statuses.sha = "b".repeat(40);
  assert.throws(() => verifyDeploymentRecords(foreign), /revision mismatch/);
});
test("failed, forked, or unrelated Worker runs cannot authorize the APK", () => {
  for (const change of [{ conclusion: "failure" }, { head_repository: { full_name: "other/platform" } },
    { head_sha: "b".repeat(40) }, { path: ".github/workflows/other.yml" }, { head_branch: "preview" }]) {
    const input = records(); Object.assign(input.workerRuns.workflow_runs[0], change);
    assert.throws(() => verifyDeploymentRecords(input), /No matching successful Worker/);
  }
});
test("both successful trusted Vercel project statuses are required", () => {
  const input = records(); input.statuses.statuses.pop();
  assert.throws(() => verifyDeploymentRecords(input), /Missing successful deployment/);
  for (const target_url of ["https://evil.example/deploy", "https://vercel.com/other-team/kampusone-platform-preview/AbC123",
    "https://vercel.com/warriorpikins-projects/kampusone-platform-preview/AbC123?redirect=evil",
    "https://user@vercel.com/warriorpikins-projects/kampusone-platform-preview/AbC123"]) {
    const untrusted = records(); untrusted.statuses.statuses[0].target_url = target_url;
    assert.throws(() => verifyDeploymentRecords(untrusted), /Untrusted deployment/);
  }
  const pending = records(); pending.statuses.statuses[0].state = "pending";
  assert.throws(() => verifyDeploymentRecords(pending), /Missing successful deployment/);
});
test("live aliases must serve this source while preserving anonymous API rejection", async () => {
  await verifyProductionAliases(sha, async (url, options) => {
    assert.equal(options.redirect, "error"); return publishedResponse(url);
  });
});
test("a stale admin alias or exposed mobile API blocks APK publication", async () => {
  await assert.rejects(verifyProductionAliases(sha, async (url) => url === productionHosts.admin + "/portal-version.json"
    ? Response.json({ version: "b".repeat(40) }) : publishedResponse(url)), /Published revision mismatch/);
  await assert.rejects(verifyProductionAliases(sha, async (url) => url === productionHosts.mobile + "/api/v1/account/guidelines"
    ? new Response("", { status: 200 }) : publishedResponse(url)), /Production check failed/);
});
