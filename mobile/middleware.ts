import { next } from "@vercel/functions/middleware";
import { previewApiRequest } from "../portal/lib/preview-origin";

/** Validate the browser's exact deployment origin before the existing API rewrite. */
export default function middleware(request: Request) {
  const decision = previewApiRequest(
    new URL(request.url).pathname, request.method, request.headers,
    {
      VERCEL_ENV: process.env.VERCEL_ENV ?? "",
      VERCEL_URL: process.env.VERCEL_URL ?? "",
      VERCEL_BRANCH_URL: process.env.VERCEL_BRANCH_URL ?? "",
    },
    "https://kampusone-mobile-preview.vercel.app",
  );
  if (decision.kind === "reject") return Response.json(
    { error: { code: "FORBIDDEN", message: "Open this KampusOne preview directly and try again." } },
    { status: 403, headers: { "Cache-Control": "private, no-store" } },
  );
  return decision.kind === "forward" ? next({ request: { headers: decision.headers } }) : next();
}

// Auth has small JSON bodies. Media continues through its existing streaming rewrite.
export const config = { matcher: "/api/v1/auth/:path*" };
