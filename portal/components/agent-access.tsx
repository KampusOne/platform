"use client";

import Image from "next/image";
import { type FormEvent, useState } from "react";

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
    <main className="auth-page agent-auth-page">
      <section className="auth-story agent-auth-story">
        <div className="auth-story__copy">
          <p className="eyebrow">One account · Student to agent</p>
          <h1>Bring what you know to campus.</h1>
          <p>
            Apply as a tutor, vendor, or rider with the KampusOne identity you
            already use as a student.
          </p>
        </div>
        <Image
          className="auth-story__image"
          src="/brand-scenes/tutorials.png"
          alt="Students learning together on campus"
          width={1024}
          height={1024}
          priority
        />
      </section>

      <section className="auth-panel agent-auth-panel">
        <div className="auth-panel__inner">
          <ol className="agent-auth-steps" aria-label="Agent access steps">
            <li aria-current={stage === "email" ? "step" : undefined}>Email</li>
            <li aria-current={stage === "code" ? "step" : undefined}>Code</li>
            <li>Agent setup</li>
          </ol>
          <p className="auth-panel__kicker">Same KampusOne account</p>
          <h2>{stage === "email" ? "Continue as an agent" : "Check your email"}</h2>
          <p className="muted">
            {stage === "email"
              ? "Enter the email connected to your KampusOne student account. No new password or separate agent account is needed."
              : `Enter the six-digit code sent for ${email}. It expires in 10 minutes.`}
          </p>

          <form className="form-stack" onSubmit={submit}>
            {stage === "email" ? (
              <label>
                KampusOne account email
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoFocus
                  required
                />
              </label>
            ) : (
              <label>
                Six-digit code
                <input
                  name="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  className="code-input"
                  autoFocus
                  required
                />
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
            Don’t have a KampusOne account yet? Create your student account in
            the KampusOne app first, then return here with the same email.
          </p>
        </div>
      </section>
    </main>
  );
}
