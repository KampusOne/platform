export const dynamic = "force-dynamic";

export function GET() {
  const revision = process.env.VERCEL_GIT_COMMIT_SHA ?? "";
  return Response.json(
    { version: /^[0-9a-f]{40}$/.test(revision) ? revision : "unconfigured" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
