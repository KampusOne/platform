export type RouteCachePolicy = {
  classification: "public-reference" | "tenant-reference" | "private-display" | "security" | "financial" | "volatile" | "private-operational" | "mutation";
  backend: "versioned-shared-value" | "versioned-shared-dependency" | "fresh";
  namespace?: string;
  authorization: string;
};

/** This is a policy manifest, never authorization middleware or a generic
 * response cache. Only audited route loaders call cachedVersionedRead(). */
export function routeCachePolicy(method: string, rawPath: string): RouteCachePolicy {
  const path = rawPath.replace(/\/$/, "");
  const auth = "Fresh session, tenant, role and object checks in source router";
  const shared: Record<string, { namespace: string; public: boolean }> = {
    "/v1/student/catalog": { namespace: "academic.catalog", public: true },
    "/v1/student/campus/places": { namespace: "campus.maps", public: false },
    "/v1/maps/campuses/:id": { namespace: "campus.maps", public: false },
    "/v1/maps/campuses/:id/places": { namespace: "campus.maps", public: false },
    "/v1/maps/campuses/:id/features": { namespace: "campus.maps", public: false },
    "/v1/agents/product-categories": { namespace: "commerce.categories", public: false },
    "/v1/notifications/sounds/default": { namespace: "notification.sounds", public: false },
    "/v1/website/articles": { namespace: "website.articles", public: true },
    "/v1/website/articles/:slug": { namespace: "website.articles", public: true },
  };
  const policy = shared[path];
  if (method === "GET" && policy) return {
    classification: policy.public ? "public-reference" : "tenant-reference",
    backend: "versioned-shared-value", namespace: policy.namespace,
    authorization: policy.public ? "Public published/reference projection; no user state" : auth,
  };
  if ((method === "POST" && path === "/v1/maps/route") || (method === "GET" && path === "/v1/website/config")) return {
    classification: path.includes("maps") ? "volatile" : "public-reference",
    backend: "versioned-shared-dependency", namespace: path.includes("maps") ? "campus.maps" : "website.settings",
    authorization: path.includes("maps") ? auth : "Public settings; latest APK manifest read fresh from R2",
  };
  if (method !== "GET" && method !== "HEAD") return { classification: "mutation", backend: "fresh", authorization: "Source router auth/signature/idempotency; no response reuse" };
  if (/^\/v1\/(?:auth|admin|manage|campus-admin|payout-setup|applications|trusted-vendors|discounts|usage)(?:\/|$)/.test(path) || /\/(?:capabilities|sessions|restrictions|permissions|roles|verification)(?:\/|$)/.test(path))
    return { classification: "security", backend: "fresh", authorization: auth };
  if (/^\/v1\/(?:payments|tutor-commerce)(?:\/|$)/.test(path) || /\/(?:orders|purchases|earnings|payouts|price-preview|subscription|delivery-status)(?:\/|$)/.test(path))
    return { classification: "financial", backend: "fresh", authorization: auth };
  if (/^\/v1\/(?:messages|notifications|ai|media|exams)(?:\/|$)/.test(path) || /^\/v1\/agents\/(?:deliveries|location|rider-presence)/.test(path))
    return { classification: "volatile", backend: "fresh", authorization: auth };
  if (/^\/v1\/(?:student|people|discovery|communities|calendar|learning)(?:\/|$)/.test(path))
    return { classification: "private-display", backend: "fresh", authorization: auth };
  if (path === "/v1/config/public" || path.startsWith("/health/") || path === "/" || path.startsWith("/v1/website/download"))
    return { classification: "public-reference", backend: "fresh", authorization: "Public, source-specific HTTP policy; latest release stays version aware" };
  return { classification: "private-operational", backend: "fresh", authorization: "Source-specific auth or capability; new routes default fresh" };
}
