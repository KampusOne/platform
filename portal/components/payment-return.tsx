"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { PortalApiError, portalApi } from "@/lib/api";

type PaymentStatus = {
  payment: {
    provider_reference: string;
    status:
      | "CREATED"
      | "INITIALIZED"
      | "SUCCEEDED"
      | "FAILED"
      | "REQUIRES_REVIEW";
    resource_type: string;
    resource_id: string;
  };
};

export function PaymentReturn({ reference }: { reference: string }) {
  const [payment, setPayment] = useState<PaymentStatus["payment"] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(Boolean(reference));

  const check = useCallback(async () => {
    if (!reference) {
      setError("This return link does not include a payment reference.");
      setLoading(false);
      return null;
    }
    setError("");
    setLoading(true);
    try {
      const result = await portalApi<PaymentStatus>(
        `/v1/payments/status/${encodeURIComponent(reference)}`,
      );
      setPayment(result.payment);
      return result.payment;
    } catch (caught) {
      setError(
        caught instanceof PortalApiError
          ? caught.message
          : "KampusOne could not verify this payment yet.",
      );
      return null;
    } finally {
      setLoading(false);
    }
  }, [reference]);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    const poll = async () => {
      const result = await check();
      if (
        !active ||
        !result ||
        !["CREATED", "INITIALIZED"].includes(result.status) ||
        attempts >= 5
      )
        return;
      attempts += 1;
      timer = setTimeout(() => void poll(), 2500);
    };
    void poll();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [check]);

  const state = payment?.status;
  const heading =
    state === "SUCCEEDED"
      ? "Payment confirmed"
      : state === "REQUIRES_REVIEW"
        ? "Payment needs review"
        : state === "FAILED"
          ? "Payment was not completed"
          : error
            ? "We could not confirm this payment"
            : "Confirming your payment";
  const body =
    state === "SUCCEEDED"
      ? "Your booking or order is confirmed. You can safely return to KampusOne."
      : state === "REQUIRES_REVIEW"
        ? "Your payment evidence is safely recorded. Support must reconcile it before the purchase changes state."
        : state === "FAILED"
          ? "No purchase was confirmed. Return to KampusOne to start a new payment attempt."
          : error ||
            "The provider callback can arrive a few seconds after this page. This screen checks the server record—not the browser redirect alone.";

  return (
    <main className="payment-return-page">
      <section className="payment-return-card" aria-live="polite">
        <span
          className={`payment-return-icon payment-return-icon--${state === "SUCCEEDED" ? "success" : state === "REQUIRES_REVIEW" ? "review" : error || state === "FAILED" ? "error" : "pending"}`}
          aria-hidden="true"
        >
          {state === "SUCCEEDED" ? (
            "✓"
          ) : state === "REQUIRES_REVIEW" ? (
            "!"
          ) : error || state === "FAILED" ? (
            "×"
          ) : (
            <span className="spinner" />
          )}
        </span>
        <p className="eyebrow">Secure transaction status</p>
        <h1>{heading}</h1>
        <p>{body}</p>
        {reference && <small>Reference {reference}</small>}
        <div className="payment-return-actions">
          <a className="button button--primary" href="kampusone://purchases">
            Open KampusOne
          </a>
          <button
            className="button button--secondary"
            disabled={loading}
            onClick={() => void check()}
          >
            {loading ? "Checking…" : "Check again"}
          </button>
          <Link className="text-link" href="/">
            Return to portal
          </Link>
        </div>
      </section>
    </main>
  );
}
