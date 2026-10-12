import assert from "node:assert/strict";
import test from "node:test";
import { verifyAndroidDownload } from "../server/scripts/verify-android-download.mjs";

function receipts() {
  const sourceSha = "a".repeat(40);
  return { sourceSha, app: { version: "0.3.26", android: { package: "app.kampusone.mobile", versionCode: 56 } },
    build: { sourceSha, packageName: "app.kampusone.mobile", versionName: "0.3.26", versionCode: 56,
      abi: "arm64-v8a", targetSdkVersion: 36, apkSizeBytes: 1234, apkSha256: "b".repeat(64),
      certificateSha256: "FAC61745DC0903786FB9EDE62A962B399F7348F0BB6F899B8332667591033B9C" },
    nativeRelease: { sourceSha, workerRunId: "123", method: "verified-native-source-and-worker" },
    webRelease: { sourceSha, workerRunId: "123", method: "verified-vercel-production-status" } };
}

test("the website may publish the inspected APK only with matching native and live web receipts", () => {
  assert.equal(verifyAndroidDownload(receipts()), true);
});
test("a stale or missing source receipt cannot replace the website download", () => {
  for (const key of ["build", "nativeRelease", "webRelease"]) {
    const input = receipts(); input[key].sourceSha = "c".repeat(40);
    assert.throws(() => verifyAndroidDownload(input), /match the current source/);
    delete input[key].sourceSha;
    assert.throws(() => verifyAndroidDownload(input), /match the current source/);
  }
});
test("a renamed, resigned, outdated or incomplete APK cannot be published", () => {
  for (const change of [{packageName:"other.app"},{versionName:"0.3.19"},{versionCode:55},
    {certificateSha256:"b".repeat(64)},{abi:"x86"},{targetSdkVersion:35},{apkSizeBytes:0},{apkSha256:"missing"}]) {
    const input = receipts(); Object.assign(input.build,change);
    assert.throws(() => verifyAndroidDownload(input), /APK identity/);
  }
});
test("native-only, unrelated or mismatched deployment proof cannot authorize website publication", () => {
  for (const change of [{method:"native-only"},{workerRunId:"456"},{workerRunId:""}]) {
    const input=receipts();Object.assign(input.webRelease,change);
    assert.throws(() => verifyAndroidDownload(input), /published web verification/);
  }
});
