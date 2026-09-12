"use client";

import Image from "next/image";
import { type FormEvent, useState } from "react";

import authStudyIllustration from "../../mobile/assets/illustrations/auth-study-v2.png";
import { type Session, PortalApiError, webAuth } from "@/lib/api";

type Stage = "email" | "code";

function messageFrom(error: unknown) {
  return error instanceof PortalApiError
    ? error.message
    : "Something interrupted the request. Please try again.";
}

export function AgentAccess({
  onAuthenticated,
}: {
  onAuthenticated(session: Session): void;
}) {
  const [stage, setStage] = useState<Stage>("email");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (stage === "email") {
        const nextEmail = String(form.get("email")).trim().toLowerCase();
        await webAuth.requestEmailCode(nextEmail);
        setEmail(nextEmail);
        setStage("code");
        setNotice(
          "If this belongs to a verified KampusOne account, a six-digit code is on its way.",
        );
        return;
      }
      onAuthenticated(
        await webAuth.verifyEmailCode(email, String(form.get("code"))),
      );
    } catch (caught) {
      setError(messageFrom(caught));
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await webAuth.requestEmailCode(email);
      setNotice(
        "If this belongs to a verified KampusOne account, a new code is on its way.",
      );
    } catch (caught) {
      setError(messageFrom(caught));
    } finally {
      setBusy(false);
    }
  }

  function changeEmail() {
    setStage("email");
    setNotice("");
    setError("");
  }

  return (
    <main className="agent-login-page">
      <section className="agent-login-shell" aria-labelledby="agent-access-title">
        <a
          className="agent-auth-back"
          href="https://kampusone.app"
          aria-label="Back to KampusOne"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </a>

        <header className="agent-login-heading">
          <h1 id="agent-access-title">
            {stage === "email" ? "Continue as an agent" : "Check your email"}
          </h1>
          <p>
            {stage === "email"
              ? "Use the email connected to your KampusOne student account. No separate agent account is needed."
              : `Enter the six-digit code sent for ${email}. It expires in 10 minutes.`}
          </p>
        </header>

        <Image
          className="agent-login-illustration"
          src={authStudyIllustration}
          alt=""
          aria-hidden="true"
          preload
        />

        <form className="form-stack agent-login-form" onSubmit={submit}>
          {stage === "email" ? (
            <label>
              Email address
              <span className="agent-login-input">
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <path d="M4 6.75h16v10.5H4z" />
                  <path d="m4.75 7.5 7.25 5 7.25-5" />
                </svg>
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  placeholder="Enter your email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoFocus
                  required
                />
              </span>
            </label>
          ) : (
            <label>
              Verification code
              <span className="agent-login-input">
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <circle cx="8" cy="12" r="3.25" />
                  <path d="M11.25 12H20m-3 0v3m-3-3v2" />
                </svg>
                <input
                  name="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  className="code-input"
                  placeholder="000000"
                  autoFocus
                  required
                />
              </span>
            </label>
          )}
          {notice && (
            <p className="form-notice" role="status" aria-live="polite">
              {notice}
            </p>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button
            className="button button--primary button--wide"
            disabled={busy}
          >
            {busy
              ? "Please wait…"
              : stage === "email"
                ? "Send my code"
                : "Verify and continue"}
          </button>
        </form>

        {stage === "code" && (
          <div className="agent-auth-actions">
            <button type="button" className="text-button" disabled={busy} onClick={changeEmail}>
              Use another email
            </button>
            <button type="button" className="text-button" disabled={busy} onClick={() => void resend()}>
              Send a new code
            </button>
          </div>
        )}
        <p className="agent-auth-help">
          New to KampusOne? Create your student account in the KampusOne app
          first, then return here with the same email.
        </p>
      </section>
    </main>
  );
}
