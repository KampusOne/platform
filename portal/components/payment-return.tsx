"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useForegroundPoll } from '@/lib/use-foreground-poll';

import { PortalApiError, portalApi } from "@/lib/api";
import { nativePaymentReturnUrl, validPaymentReference } from '../../packages/contracts/src/payment-links';

type PaymentStatus = {
  payment: {
    provider_reference: string;
    status:
      "CREATED" | "INITIALIZED" | "SUCCEEDED" | "FAILED" | "REQUIRES_REVIEW";
    resource_type: string;
    resource_id: string;
  };
};

export function PaymentReturn({ reference }: { reference: string }) {
  return <ReferencePaymentReturn key={reference} reference={reference}/>;
}
function ReferencePaymentReturn({ reference }: { reference: string }) {
  const appReturn=nativePaymentReturnUrl(reference);
  useEffect(()=>{if(validPaymentReference(reference))window.location.replace(appReturn);},[reference,appReturn]);
  const [payment, setPayment] = useState<PaymentStatus["payment"] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const check = useCallback(async (signal:AbortSignal) => {
    if (!reference) {
      setError("This return link does not include a payment reference.");
      setLoading(false);
      return 'done' as const;
    }
    setError("");
    setLoading(true);
    try {
      const result = await portalApi<PaymentStatus>(
        `/v1/payments/status/${encodeURIComponent(reference)}`,
        {signal,cache:'no-store'},
      );
      if(signal.aborted)return 'done' as const;
      setPayment(result.payment);
      return ['CREATED','INITIALIZED'].includes(result.payment.status)?'unchanged' as const:'done' as const;
    } catch (caught) {
      if(!signal.aborted)setError(
        caught instanceof PortalApiError
          ? caught.message
          : "KampusOne could not verify this payment yet.",
      );
      throw caught;
    } finally {
      setLoading(false);
    }
  }, [reference]);

  const poll=useForegroundPoll(reference,true,check,{intervalMs:2500,maxAttempts:6,immediate:true});

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
      ? payment?.resource_type === "RIDER_COMMISSION"
        ? "Your ride commission payment is confirmed. Return to Earnings to see your updated balance."
        : payment?.resource_type === "KIRA_SUBSCRIPTION"
          ? "Your monthly Kira Pro access is confirmed. Return to Kira to use your plan."
          : "Your purchase is confirmed. You can safely return to KampusOne."
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
          <a
            className="button button--primary"
            href={appReturn}
          >
            Open KampusOne
          </a>
          <button
            className="button button--secondary"
            disabled={loading}
            onClick={poll.restart}
          >
            {loading ? "Checking…" : "Check again"}
          </button>
          <Link className="text-link" href="/">
            Return to portal
          </Link>
        </div>
        {poll.exhausted&&!['SUCCEEDED','FAILED','REQUIRES_REVIEW'].includes(state??'')?<p role="status">Confirmation is still pending. Check again when you are ready.</p>:null}
        {!poll.available&&!state?<p role="status">Updates pause while offline or this tab is hidden. Reconnect to check your payment.</p>:null}
      </section>
    </main>
  );
}
