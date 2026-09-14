// Run only on the authorized isolated staging stack. Never commit the token file.
import http from "k6/http";
import { check, sleep } from "k6";
import { SharedArray } from "k6/data";

const base = __ENV.STAGING_API_URL;
if (!base || __ENV.CONFIRM_STAGING_LOAD_TEST !== "YES")
  throw new Error("Explicit staging target and confirmation are required.");
if (
  !/^https:\/\/[a-z0-9.-]+(?::\d+)?$/.test(base) ||
  !new URL(base).hostname.includes("staging")
)
  throw new Error("Use a separately named staging host.");
const maximum = Number(__ENV.MAX_VUS || 100);
if (!Number.isInteger(maximum) || maximum < 1 || maximum > 10000)
  throw new Error("MAX_VUS must be between 1 and 10000.");
if (maximum > 100 && __ENV.CONFIRM_PROVIDER_CAPACITY !== "YES")
  throw new Error(
    "Confirm provider limits and an approved cost budget before scaling.",
  );
const users = new SharedArray("isolated staging sessions", () =>
  JSON.parse(open(__ENV.STAGING_SESSIONS_FILE)),
);
if (users.length < maximum)
  throw new Error(
    "Provide a distinct synthetic staging account for every virtual user.",
  );
export const options = {
  stages: [
    { duration: "2m", target: Math.max(1, Math.floor(maximum / 10)) },
    { duration: "3m", target: Math.max(1, Math.floor(maximum / 2)) },
    { duration: "5m", target: maximum },
    { duration: "10m", target: maximum },
    { duration: "2m", target: 0 },
  ],
  thresholds: {
    http_req_failed: [
      { threshold: "rate<0.01", abortOnFail: true, delayAbortEval: "2m" },
    ],
    "http_req_duration{kind:read}": ["p(95)<750", "p(99)<1500"],
  },
};
let session,
  renewAt = 0;
const paths = [
  "/v1/student/home",
  "/v1/student/timetable",
  "/v1/student/feed",
  "/v1/learning/courses",
  "/v1/account/capabilities",
];
export default function () {
  if (!session) session = { ...users[__VU - 1] };
  if (Date.now() >= renewAt) {
    const r = http.post(
      base + "/v1/auth/refresh",
      JSON.stringify({ refreshToken: session.refreshToken }),
      {
        headers: { "Content-Type": "application/json" },
        tags: { kind: "auth" },
        timeout: "15s",
      },
    );
    if (r.status !== 200) {
      check(r, { "session refreshed": (r) => r.status === 200 });
      sleep(10);
      return;
    }
    const value = r.json();
    session = {
      accessToken: value.accessToken,
      refreshToken: value.refreshToken,
    };
    renewAt = Date.now() + Math.max(30, value.expiresIn - 60) * 1000;
  }
  const path = paths[Math.floor(Math.random() * paths.length)];
  const response = http.get(base + path, {
    headers: { Authorization: "Bearer " + session.accessToken },
    tags: { kind: "read", name: path },
    timeout: "15s",
  });
  check(response, { "authorized response": (r) => r.status === 200 });
  sleep(3 + Math.random() * 7);
}
