import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync, copyFileSync } from "node:fs";
mkdirSync('public/maps',{recursive:true});
for(const name of ['maplibre-gl.mjs','maplibre-gl-shared.mjs','maplibre-gl-worker.mjs','maplibre-gl.css'])copyFileSync(`node_modules/maplibre-gl/dist/${name}`,`public/maps/${name}`);
const git = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
const version = process.env.VERCEL_GIT_COMMIT_SHA || (git.status === 0 ? git.stdout.trim() : `local-${Date.now()}`);
const result = spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", ["expo", "export", "--platform", "web", "--output-dir", "dist", "--max-workers", "2"], {
  stdio: "inherit", env: { ...process.env, EXPO_PUBLIC_BUILD_ID: version },
});
if (result.status !== 0) process.exit(result.status ?? 1);
writeFileSync("dist/app-version.json", JSON.stringify({ version }) + "\n");
