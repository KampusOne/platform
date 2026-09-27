// No accounts, credentials, verification emails or valid mutation payloads.
// Native requests have no browser Origin header; verify that exact access path.
const api = "https://platformp.divine-haze-54eb.workers.dev";
for (const path of ["/health/live", "/v1/auth/login", "/v1/auth/register"]) {
  const start = Date.now();
  const response = await fetch(api + path, {
    method: path === "/health/live" ? "GET" : "POST",
    headers: { "Content-Type": "application/json", "X-Device-Label": "KampusOne mobile" },
    ...(path === "/health/live" ? {} : { body: "{}" }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json();
  const expected = path === "/health/live" ? response.status === 200 && body.status === "ok" : response.status === 400 && body.error?.code === "BAD_REQUEST";
  console.log(JSON.stringify({ path, status: response.status, code: body.error?.code, milliseconds: Date.now() - start, expected }));
  if (!expected) process.exitCode = 1;
}
