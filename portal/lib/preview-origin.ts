type PreviewEnvironment = {
  VERCEL_ENV?: string;
  VERCEL_URL?: string;
  VERCEL_BRANCH_URL?: string;
};

type ProxyDecision =
  | { kind: "unchanged" }
  | { kind: "reject" }
  | { kind: "forward"; headers: Headers };

const portalOrigin = "https://kampusone-platform-preview.vercel.app";

/** Validate the browser boundary before forwarding through our canonical portal. */
export function previewApiRequest(
  pathname: string,
  method: string,
  headers: Headers,
  env: PreviewEnvironment,
): ProxyDecision {
  if (env.VERCEL_ENV !== "preview" || !pathname.startsWith("/api/"))
    return { kind: "unchanged" };

  // These exact hosts come from Vercel's server environment, never a request header.
  const ownHosts = [env.VERCEL_URL, env.VERCEL_BRANCH_URL].filter(
    (host): host is string => Boolean(host && /^[a-z0-9-]+\.vercel\.app$/.test(host)),
  );
  const host = headers.get("host");
  if (!host || !ownHosts.includes(host)) return { kind: "reject" };

  const origin = headers.get("origin");
  const fetchSite = headers.get("sec-fetch-site");
  if (
    (origin !== null && origin !== `https://${host}`) ||
    (fetchSite !== null && !["same-origin", "none"].includes(fetchSite)) ||
    (origin === null && !["GET", "HEAD", "OPTIONS"].includes(method))
  ) return { kind: "reject" };

  const forwarded = new Headers(headers);
  // Same-origin checks above replace the browser-side CSRF boundary for this
  // trusted reverse proxy. The Worker still authenticates sessions and roles.
  forwarded.set("origin", portalOrigin);
  // Hosting/session protection cookies belong only to Vercel, not the Worker.
  const sessionCookies = (headers.get("cookie") ?? "").split(";")
    .map(cookie => cookie.trim())
    .filter(cookie => /^(k1_access|k1_refresh)=/.test(cookie));
  if (sessionCookies.length) forwarded.set("cookie", sessionCookies.join("; "));
  else forwarded.delete("cookie");
  forwarded.delete("x-vercel-protection-bypass");
  return { kind: "forward", headers: forwarded };
}
