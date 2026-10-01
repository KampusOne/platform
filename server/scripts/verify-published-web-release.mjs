import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const projects = ["kampusone-platform-preview", "kampusone-mobile-preview"];
export const productionHosts = {
  agents: "https://agents.kampusone.app",
  admin: "https://a7f3c9e1b6d2f8a4c5e9b1d7f3a6c2e8.kampusone.app",
  mobile: "https://kampusone-mobile-preview.vercel.app",
};

export function verifyDeploymentRecords({ sourceSha, mainSha, repository, workerRuns, statuses }) {
  if (!/^[0-9a-f]{40}$/.test(sourceSha) || sourceSha !== mainSha) {
    throw new Error("The release must match the current main revision");
  }
  const worker = workerRuns.workflow_runs?.find((run) =>
    run.head_sha === sourceSha && run.head_branch === "main" &&
    run.status === "completed" && run.conclusion === "success" &&
    run.path === ".github/workflows/deploy-worker.yml" &&
    run.head_repository?.full_name === repository);
  if (!worker) throw new Error("No matching successful Worker deployment");
  if (statuses.sha !== sourceSha) throw new Error("Vercel status revision mismatch");
  const deploymentUrls = projects.map((project) => {
    const status = statuses.statuses?.find((entry) => entry.context === `Vercel – ${project}`);
    if (status?.state !== "success") throw new Error(`Missing successful deployment: ${project}`);
    const url = new URL(status.target_url);
    if (url.protocol !== "https:" || url.host !== "vercel.com" || url.username || url.password || url.search || url.hash ||
        !new RegExp(`^/warriorpikins-projects/${project}/[A-Za-z0-9]+$`).test(url.pathname)) {
      throw new Error(`Untrusted deployment URL: ${project}`);
    }
    return url.href;
  });
  return { workerRunId: String(worker.id), portalUrl: deploymentUrls[0], mobileUrl: deploymentUrls[1] };
}

export async function verifyProductionAliases(sourceSha, fetcher = fetch) {
  const checks = [
    [productionHosts.agents + "/", 200],
    [productionHosts.admin + "/", 200],
    [productionHosts.mobile + "/", 200],
    [productionHosts.agents + "/portal-version.json", 200, sourceSha],
    [productionHosts.admin + "/portal-version.json", 200, sourceSha],
    [productionHosts.mobile + "/app-version.json", 200, sourceSha],
    [productionHosts.agents + "/api/v1/account/guidelines", 401],
    [productionHosts.mobile + "/api/v1/account/guidelines", 401],
  ];
  await Promise.all(checks.map(async ([url, expectedStatus, expectedVersion]) => {
    const response = await fetcher(url, { redirect: "error", signal: AbortSignal.timeout(20000), cache: "no-store" });
    if (response.status !== expectedStatus) throw new Error(`Production check failed: ${url} returned ${response.status}`);
    if (expectedVersion) {
      const payload = await response.json();
      if (payload.version !== expectedVersion) throw new Error(`Published revision mismatch: ${url}`);
    } else {
      await response.body?.cancel();
    }
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [workerPath, statusPath, outputPath] = process.argv.slice(2);
  if (!workerPath || !statusPath || !outputPath) throw new Error("Worker records, Vercel statuses, and receipt path are required");
  const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (sourceSha !== process.env.RELEASE_SHA) throw new Error("Checked-out revision mismatch");
  const mainSha = execFileSync("git", ["ls-remote", "--heads", "origin", "main"], { encoding: "utf8" }).split(/\s+/)[0];
  const records = verifyDeploymentRecords({ sourceSha, mainSha, repository: process.env.GITHUB_REPOSITORY,
    workerRuns: JSON.parse(readFileSync(workerPath, "utf8")), statuses: JSON.parse(readFileSync(statusPath, "utf8")) });
  await verifyProductionAliases(sourceSha);
  if (!/^\d+$/.test(process.env.RELEASE_RUN_ID ?? "")) throw new Error("Invalid release run ID");
  writeFileSync(outputPath, JSON.stringify({ sourceSha, runId: process.env.RELEASE_RUN_ID, ...records,
    verifiedAt: new Date().toISOString(), method: "verified-vercel-production-status" }, null, 2) + "\n");
  console.log(`Verified Worker and production web aliases for ${sourceSha}`);
}
