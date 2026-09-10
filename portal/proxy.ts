import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const surfaceBySubdomain: Record<string, string> = {
  admin: "/admin",
  agents: "/agents",
  engineering: "/engineering",
};

export function proxy(request: NextRequest) {
  const hostname = request.headers.get("host")?.split(":")[0] ?? "";
  const subdomain = hostname.split(".")[0] ?? "";
  const surface = surfaceBySubdomain[subdomain];

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
