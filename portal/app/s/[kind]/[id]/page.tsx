import Link from "next/link";
import { notFound } from "next/navigation";
import {
  androidDownloadUrl,
  validSharedPath,
} from "@/lib/app-link-association";
export const metadata = {
  title: "Open in KampusOne",
  description:
    "Open this campus conversation, profile or listing in KampusOne.",
};
export default async function SharedPage({
  params,
}: {
  params: Promise<{ kind: string; id: string }>;
}) {
  const { kind, id } = await params;
  if (!validSharedPath(kind, id)) notFound();
  const download = androidDownloadUrl(process.env.ANDROID_APK_DOWNLOAD_URL),
    label =
      {
        post: "conversation",
        profile: "profile",
        business: "business profile",
        product: "product",
        tutorial: "tutorial",
        material: "learning resource",
      }[kind] ?? "content";
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: "#FBF7F2",
      }}
    >
      <section style={{ maxWidth: 480, width: "100%", textAlign: "center" }}>
        <p
          style={{ fontWeight: 700, letterSpacing: ".06em", color: "#A8462E" }}
        >
          KAMPUSONE
        </p>
        <h1
          style={{
            fontFamily: "var(--font-lato)",
            fontSize: "clamp(28px,6vw,40px)",
            margin: "24px 0 12px",
            color: "#29231F",
          }}
        >
          Your campus, one tap away
        </h1>
        <p style={{ lineHeight: 1.65, color: "#71645C" }}>
          Open this {label} in the app. Sign in to follow, join the
          conversation, or explore the listing.
        </p>
        <a
          href={`kampusone://s/${kind}/${id}`}
          style={{
            display: "block",
            padding: 16,
            marginTop: 30,
            borderRadius: 14,
            background: "#A8462E",
            color: "white",
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          Open in KampusOne
        </a>
        {download ? (
          <a
            href={download}
            style={{
              display: "block",
              padding: 16,
              marginTop: 12,
              borderRadius: 14,
              border: "1px solid #D8C6B7",
              color: "#A8462E",
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            Download the Android app
          </a>
        ) : (
          <p style={{ color: "#71645C", fontSize: 13, marginTop: 20 }}>
            The new Android download will appear here when it is released.
          </p>
        )}
        <Link
          href="https://kampusone.app"
          style={{
            display: "inline-block",
            padding: 16,
            marginTop: 8,
            color: "#A8462E",
          }}
        >
          Visit the KampusOne website
        </Link>
        <p style={{ fontSize: 12, color: "#71645C", lineHeight: 1.6 }}>
          If the app does not open, check that it is installed and that opening
          supported links is enabled on your phone.
        </p>
      </section>
    </main>
  );
}
