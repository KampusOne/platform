import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { previewApiRequest } from "./lib/preview-origin";

const surfaceBySubdomain: Record<string, string> = {
  admin: "/admin",
  agents: "/agents",
  engineering: "/engineering",
};

export function proxy(request: NextRequest) {
  const apiRequest = previewApiRequest(
    request.nextUrl.pathname, request.method, request.headers,
    {
      VERCEL_ENV: process.env.VERCEL_ENV,
      VERCEL_URL: process.env.VERCEL_URL,
      VERCEL_BRANCH_URL: process.env.VERCEL_BRANCH_URL,
    },
  );
  if (apiRequest.kind === "reject")
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Open this portal directly and try again." } },
      { status: 403, headers: { "Cache-Control": "private, no-store" } },
    );
  if (apiRequest.kind === "forward")
    return NextResponse.next({ request: { headers: apiRequest.headers } });

  const hostname = request.headers.get("host")?.split(":")[0] ?? "";
  const subdomain = hostname.split(".")[0] ?? "";
  // Separate deployments can use any owned subdomain without relying on its spelling.
  const configuredSurface = process.env.KAMPUSONE_PORTAL_SURFACE;
  const surface = (configuredSurface && surfaceBySubdomain[configuredSurface]) || surfaceBySubdomain[subdomain];

  if (
    surface &&
    Object.values(surfaceBySubdomain).some(
      (other) =>
        other !== surface &&
        (request.nextUrl.pathname === other ||
          request.nextUrl.pathname.startsWith(other + "/")),
    )
  )
    return new NextResponse("Not found", { status: 404 });

  if (!surface || request.nextUrl.pathname !== "/") {
    return NextResponse.next();
  }

  const destination = request.nextUrl.clone();
  destination.pathname = surface;
  return NextResponse.rewrite(destination);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|brand/).*)"],
};
