import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const PORT = Number(process.env.PORT || 10000);
const DIST = join(process.cwd(), "mobile", "dist");
const API = "https://platformp.divine-haze-54eb.workers.dev";

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".ttf": "font/ttf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function safePath(pathname) {
  const cleaned = normalize(decodeURIComponent(pathname)).replace(/^([.][.][/\\])+/, "");
  return cleaned.startsWith("/") ? cleaned.slice(1) : cleaned;
}

function staticCandidate(pathname) {
  const relative = safePath(pathname);
  const candidates = pathname === "/"
    ? [join(DIST, "index.html")]
    : [
        join(DIST, relative),
        join(DIST, relative + ".html"),
        join(DIST, relative, "index.html"),
      ];
  return candidates.find((candidate) => {
    try { return existsSync(candidate) && statSync(candidate).isFile(); }
    catch { return false; }
  });
}

async function readBody(req) {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

async function proxy(req, res) {
  try {
    const targetPath = (req.url || "/").slice(4) || "/";
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (!value) continue;
      const lower = key.toLowerCase();
      if (["host", "origin", "referer", "content-length", "connection", "accept-encoding"].includes(lower)) continue;
      headers.set(key, Array.isArray(value) ? value.join(", ") : value);
    }
    headers.set("accept-encoding", "identity");

    const response = await fetch(API + targetPath, {
      method: req.method,
      headers,
      body: await readBody(req),
      redirect: "manual",
    });

    for (const [key, value] of response.headers) {
      const lower = key.toLowerCase();
      if (["content-length", "content-encoding", "transfer-encoding", "set-cookie"].includes(lower)) continue;
      res.setHeader(key, value);
    }
    if (typeof response.headers.getSetCookie === "function") {
      const cookies = response.headers.getSetCookie();
      if (cookies.length) res.setHeader("set-cookie", cookies);
    } else {
      const cookie = response.headers.get("set-cookie");
      if (cookie) res.setHeader("set-cookie", cookie);
    }

    res.statusCode = response.status;
    if (req.method === "HEAD") return res.end();
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    res.statusCode = 502;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: { code: "PREVIEW_PROXY_FAILED", message: "Preview API proxy failed." } }));
    console.error(error);
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://preview.local");
  if (url.pathname === "/healthz") {
    res.setHeader("content-type", "application/json; charset=utf-8");
    return res.end(JSON.stringify({ status: "ok" }));
  }
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return proxy(req, res);

  const file = staticCandidate(url.pathname);
  if (!file) {
    res.statusCode = 404;
    res.setHeader("content-type", "text/plain; charset=utf-8");
    return res.end("Not found");
  }

  const ext = extname(file).toLowerCase();
  res.setHeader("content-type", types[ext] || "application/octet-stream");
  if (ext === ".html" || file.endsWith("app-version.json")) res.setHeader("cache-control", "no-store");
  else if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/_expo/static/")) res.setHeader("cache-control", "public, max-age=31536000, immutable");
  else res.setHeader("cache-control", "public, max-age=300");

  createReadStream(file).pipe(res);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("KampusOne AI live preview listening on :" + PORT);
});
