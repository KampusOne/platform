import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const surfaceBySubdomain: Record<string, string> = {
  ops: "/admin",
  agents: "/agents",
  build: "/engineering",
};

const surfaceByEnvironment: Record<string, string> = {
  admin: "/admin",
  agents: "/agents",
  engineering: "/engineering",
};

const internalSurfacePaths = new Set(Object.values(surfaceByEnvironment));

export function proxy(request: NextRequest) {
  const hostname = request.headers.get("host")?.split(":")[0] ?? "";
  const subdomain = hostname.split(".")[0] ?? "";
  const configured = process.env.KAMPUSONE_PORTAL_SURFACE ?? "";
  const surface = surfaceByEnvironment[configured] ?? surfaceBySubdomain[subdomain];

  if (!surface) {
    return NextResponse.next();
  }

  if (internalSurfacePaths.has(request.nextUrl.pathname)) {
    const destination = request.nextUrl.clone();
    destination.pathname = "/";
    return NextResponse.redirect(destination);
  }

  if (request.nextUrl.pathname !== "/") return NextResponse.next();

  const destination = request.nextUrl.clone();
  destination.pathname = surface;
  return NextResponse.rewrite(destination);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|brand/|fonts/).*)"],
};
