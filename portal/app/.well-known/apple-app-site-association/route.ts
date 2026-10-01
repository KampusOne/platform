import { appleAssociation } from "@/lib/app-link-association";
export function GET() {
  const data = appleAssociation(process.env.APPLE_TEAM_ID);
  return data
    ? Response.json(data, {
        headers: { "Cache-Control": "public, max-age=300" },
      })
    : Response.json(
        { error: "Apple link verification is awaiting the signing team." },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
}
