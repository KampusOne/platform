import Link from "next/link";

export default function NotFound() {
  return (
    <main className="message-page">
      <p className="eyebrow">404 · Platform preview</p>
      <h1>That workspace is not here.</h1>
      <p>The address may have changed, or this surface has not been opened yet.</p>
      <Link href="/" className="primary-link">Return to platform index</Link>
    </main>
  );
}
