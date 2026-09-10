import Link from "next/link";

export default function NotFound() {
  return (
    <main className="message-page">
      <p className="eyebrow">404 · KampusOne</p>
      <h1>That workspace is not here.</h1>
      <p>The address may have changed or the workspace may be unavailable.</p>
      <Link href="/" className="button button--primary">Return home</Link>
    </main>
  );
}
