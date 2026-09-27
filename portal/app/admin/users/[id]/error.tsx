"use client";
import Link from "next/link";

export default function UserProfileError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="message-page" role="alert">
    <p className="eyebrow">User account</p>
    <h1>This profile could not be displayed.</h1>
    <p>The account is still available. Reload this profile, or return to the user workspace and choose it again.</p>
    <div className="form-actions">
      <button className="button button--primary" type="button" onClick={reset}>Reload profile</button>
      <Link className="button button--secondary" href="/admin/workspaces/users" prefetch={false}>Back to users</Link>
    </div>
  </main>;
}
