import { androidAssociation } from "@/lib/app-link-association";
export function GET() {
  const data = androidAssociation(process.env.ANDROID_RELEASE_SHA256);
  return data
    ? Response.json(data, {
        headers: { "Cache-Control": "public, max-age=300" },
      })
    : Response.json(
        {
          error:
            "Android link verification is awaiting the release certificate.",
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
}
