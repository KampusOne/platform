import assert from "node:assert/strict";
import test from "node:test";
import { verifyWorkerDeploymentRecords } from "../server/scripts/verify-published-web-release.mjs";
import { verifyNativeApiBoundaries } from "../server/scripts/verify-native-release.mjs";

const sha = "a".repeat(40);
const records = () => ({ sourceSha: sha, mainSha: sha, repository: "KampusOne/platform",
  workerRuns: { workflow_runs: [{ id: 123, head_sha: sha, head_branch: "main", status: "completed", conclusion: "success",
    path: ".github/workflows/deploy-worker.yml", head_repository: { full_name: "KampusOne/platform" } }] } });

test("native testing releases require the current successful backend independently of web UI builds", () => {
  assert.deepEqual(verifyWorkerDeploymentRecords(records()), { workerRunId: "123" });
  const stale = records(); stale.mainSha = "b".repeat(40);
  assert.throws(() => verifyWorkerDeploymentRecords(stale), /current main/);
});
test("pending, failed, wrong-source, foreign and unrelated backend runs cannot authorize native delivery", () => {
  for (const change of [{ status: "in_progress" }, { conclusion: "failure" }, { head_sha: "b".repeat(40) },
    { head_repository: { full_name: "other/platform" } }, { path: ".github/workflows/other.yml" }, { head_branch: "preview" }]) {
    const input = records(); Object.assign(input.workerRuns.workflow_runs[0], change);
    assert.throws(() => verifyWorkerDeploymentRecords(input), /No matching successful Worker/);
  }
});
test("both native API origins require live readiness and private-route rejection", async () => {
  const requests = [];
  await verifyNativeApiBoundaries(async (url, options) => {
    requests.push(url);
    assert.equal(options.redirect, "error"); assert.equal(options.cache, "no-store");
    return new Response("", { status: url.endsWith("/health/ready") ? 200 : 401 });
  });
  assert.equal(requests.length, 4);
  for (const failure of ["https://platformp.divine-haze-54eb.workers.dev/health/ready", "https://mobile.kampusone.app/api/v1/account/guidelines"]) {
    await assert.rejects(verifyNativeApiBoundaries(async url => new Response("", {
      status: url === failure ? (url.endsWith("/health/ready") ? 503 : 200) : url.endsWith("/health/ready") ? 200 : 401,
    })), /Native API check failed/);
  }
});
