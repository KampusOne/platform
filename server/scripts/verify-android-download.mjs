import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const certificate = "FAC61745DC0903786FB9EDE62A962B399F7348F0BB6F899B8332667591033B9C";

export function verifyAndroidDownload({ sourceSha, app, build, nativeRelease, webRelease }) {
  if (!/^[a-f0-9]{40}$/.test(sourceSha ?? "") ||
      [build, nativeRelease, webRelease].some(receipt => receipt?.sourceSha !== sourceSha)) {
    throw new Error("The APK and both release receipts must match the current source.");
  }
  if (build.packageName !== app.android.package || build.versionName !== app.version ||
      build.versionCode !== app.android.versionCode || build.abi !== "arm64-v8a" ||
      !Number.isSafeInteger(build.targetSdkVersion) || build.targetSdkVersion < 36 ||
      build.certificateSha256?.replaceAll(":", "").toUpperCase() !== certificate ||
      !/^[a-f0-9]{64}$/.test(build.apkSha256 ?? "") ||
      !Number.isSafeInteger(build.apkSizeBytes) || build.apkSizeBytes <= 0) {
    throw new Error("The inspected APK identity, signer or byte receipt is invalid.");
  }
  if (nativeRelease.method !== "verified-native-source-and-worker" ||
      webRelease.method !== "verified-vercel-production-status" ||
      !/^\d+$/.test(String(nativeRelease.workerRunId ?? "")) ||
      nativeRelease.workerRunId !== webRelease.workerRunId) {
    throw new Error("Matching native and published web verification is required.");
  }
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [buildPath, nativePath, webPath] = process.argv.slice(2);
  if (!buildPath || !nativePath || !webPath) throw new Error("Three verified release receipts are required.");
  verifyAndroidDownload({
    sourceSha: process.env.BUILD_SHA,
    app: JSON.parse(readFileSync("mobile/app.json", "utf8")).expo,
    build: JSON.parse(readFileSync(buildPath, "utf8")),
    nativeRelease: JSON.parse(readFileSync(nativePath, "utf8")),
    webRelease: JSON.parse(readFileSync(webPath, "utf8")),
  });
  console.log("APK publication identity and release receipts match.");
}
