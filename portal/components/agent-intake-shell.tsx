"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { usePortalAuth } from "./auth-provider";
import styles from "./agent-intake.module.css";

export function AgentIntakeShell({
  children,
  title,
  description,
  approved = false,
}: {
  children: ReactNode;
  title: string;
  description: string;
  approved?: boolean;
}) {
  const { user, signOut } = usePortalAuth();
  const [error, setError] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  return (
    <div className={styles.root}>
      <header className={styles.siteHeader}>
        <Link href="/agents" aria-label="KampusOne agents home">
          <Image
            src="/brand/kampusone-horizontal-ink.svg"
            alt="KampusOne"
            width={180}
            height={44}
            priority
            className={styles.logo}
          />
        </Link>
        <nav aria-label="Your agent account" className={styles.accountNav}>
          <Link href="/agents">Applications</Link>
          {approved && (
            <>
              <Link href="/agents/dashboard">Dashboard</Link>
              <Link href="/agents/payouts">Payouts</Link>
            </>
          )}
          <button
            type="button"
            disabled={signingOut}
            onClick={async () => {
              setSigningOut(true);
              setError("");
              try {
                await signOut();
              } catch (caught) {
                setError(
                  caught instanceof Error
                    ? caught.message
                    : "Sign out could not finish. Try again.",
                );
              } finally {
                setSigningOut(false);
              }
            }}
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </nav>
      </header>
      <main className={styles.main}>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <header className={styles.pageHeading}>
          <p className={styles.kicker}>KampusOne agents</p>
          <h1>{title}</h1>
          <p>{description}</p>
          <small className={styles.accountEmail}>{user?.email}</small>
        </header>
        {children}
      </main>
    </div>
  );
}
