import type { MiddlewareHandler } from "hono";
import { secureHeaders } from "hono/secure-headers";
import type { Bindings, Variables } from "../types";

/** Keep secure defaults for JSON/auth routes, but allow authorized media bytes
 * to render in the separately hosted app and portals. This grants no file access:
 * the media route must finish authentication/authorization before returning 2xx.
 */
export const mediaAwareSecureHeaders: MiddlewareHandler<{ Bindings: Bindings; Variables: Variables }> = async (c, next) => {
  await secureHeaders()(c, next);
  // Public media routes explicitly opt in. Authenticated JSON and private files default to no-store.
  if (c.req.path.startsWith("/v1/") && !c.res.headers.has("Cache-Control"))
    c.header("Cache-Control", "private, no-store");
  if (
    c.res.ok && ["GET", "HEAD"].includes(c.req.method) &&
    /^\/v1\/media\/[0-9a-f-]{36}$/i.test(c.req.path) &&
    /^(image\/(jpeg|png|webp)|video\/(mp4|webm)|application\/pdf)(;|$)/i.test(c.res.headers.get("Content-Type") ?? "")
  ) {
    // Run AFTER secureHeaders: setting this only in the route gets overwritten.
    c.header("Cross-Origin-Resource-Policy", "cross-origin");
    if (c.res.headers.get("Content-Type")?.startsWith("application/pdf")) {
      c.header("Content-Disposition", `${c.req.query("download") === "1" ? "attachment" : "inline"}; filename="document.pdf"`);
    }
  }
};
