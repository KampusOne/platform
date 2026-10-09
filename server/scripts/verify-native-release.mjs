import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { productionHosts, verifyWorkerDeploymentRecords } from "./verify-published-web-release.mjs";

const workerOrigin = "https://platformp.divine-haze-54eb.workers.dev";
const primaryOrigin = productionHosts.mobile + "/api";

/** The APK bundles its own UI. Require the matching backend and live API paths. */
export async function verifyNativeApiBoundaries(fetcher = fetch) {
  await Promise.all([workerOrigin, primaryOrigin].flatMap(origin => [
    [origin + "/health/ready", 200],
    [origin + "/v1/account/guidelines", 401],
  ]).map(async ([url, expectedStatus]) => {
    const response = await fetcher(url, { redirect: "error", signal: AbortSignal.timeout(20000), cache: "no-store" });
    if (response.status !== expectedStatus) throw new Error(`Native API check failed: ${url} returned ${response.status}`);
    await response.body?.cancel();
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [workerPath, outputPath] = process.argv.slice(2);
  if (!workerPath || !outputPath) throw new Error("Worker records and native release receipt path are required");
  const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (sourceSha !== process.env.RELEASE_SHA) throw new Error("Checked-out revision mismatch");
  const latestMain = () => execFileSync("git", ["ls-remote", "--heads", "origin", "main"], { encoding: "utf8" }).split(/\s+/)[0];
  const records = verifyWorkerDeploymentRecords({ sourceSha, mainSha: latestMain(), repository: process.env.GITHUB_REPOSITORY,
    workerRuns: JSON.parse(readFileSync(workerPath, "utf8")) });
  await verifyNativeApiBoundaries();
  if (latestMain() !== sourceSha) throw new Error("The native release was superseded during verification");
  if (!/^\d+$/.test(process.env.RELEASE_RUN_ID ?? "")) throw new Error("Invalid native release run ID");
  writeFileSync(outputPath, JSON.stringify({ sourceSha, runId: process.env.RELEASE_RUN_ID, ...records,
    apiPrimary: primaryOrigin, apiFallback: workerOrigin, verifiedAt: new Date().toISOString(), method: "verified-native-source-and-worker" }, null, 2) + "\n");
  console.log(`Verified current native source and deployed API for ${sourceSha}`);
}
