import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const adminSurfaceSubdomain = "a7f3c9e1b6d2f8a4c5e9b1d7f3a6c2e8";

const surfaceBySubdomain: Record<string, string> = {
  [adminSurfaceSubdomain]: "/admin",
  agents: "/agents",
  engineering: "/engineering",
};

export function proxy(request: NextRequest) {
  const hostname = request.headers.get("host")?.split(":")[0] ?? "";
  const subdomain = hostname.split(".")[0] ?? "";
  if (subdomain === "admin") return new NextResponse("Not found", { status: 404 });
  const surface = surfaceBySubdomain[subdomain];

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
