import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const contractsPackage = new URL("../../packages/contracts/package.json", import.meta.url);
const contractsRoot = fileURLToPath(new URL(".", contractsPackage));
const requireFromContracts = createRequire(contractsPackage);

try {
  requireFromContracts.resolve("zod/package.json");
} catch {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const install = spawnSync(
    npmCommand,
    ["clean-install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", "--progress=false"],
    { cwd: contractsRoot, stdio: "inherit" },
  );

  if (install.status !== 0) {
    process.exit(install.status ?? 1);
  }
}
