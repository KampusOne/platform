"use client";

import Image from "next/image";
import { type FormEvent, useState } from "react";

import { PortalApiError, portalApi } from "@/lib/api";

type Scalar = string | number | null;

export type CommerceProduct = {
  id: string;
  university_id: string;
  name: string;
  description: string;
  category: string;
  price_kobo: Scalar;
  stock_quantity: Scalar;
  image_url: string | null;
  status: string;
  submitted_at: string | null;
  moderation_note: string | null;
  preparation_minutes: Scalar;
  package_weight_grams: Scalar;
  package_length_cm: Scalar;
  package_width_cm: Scalar;
  package_height_cm: Scalar;
  bicycle_delivery_eligible: boolean;
  listing_revision: Scalar;
  moderated_revision: Scalar;
  reviewed_at: string | null;
  vendor_name: string;
  listing_rules: string | null;
};

export type CommerceStorefront = {
  vendor_profile_id: string;
  university_id: string;
  display_name: string;
  description: string | null;
  contact_phone_e164: string | null;
  pickup_location: string | null;
  pickup_instructions: string | null;
  opening_hours: Record<string, unknown>;
  default_preparation_minutes: Scalar;
  status: string;
  submitted_at: string | null;
  listing_revision: Scalar;
  moderated_revision: Scalar;
  reviewed_at: string | null;
  review_note: string | null;
  updated_at: string;
  vendor_email: string;
};

const money = (value: Scalar) =>
  new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0,
  }).format(Number(value ?? 0) / 100);
const date = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("en-NG", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "—";
const label = (value: string) =>
  value.toLowerCase().replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
const statusTone = (status: string) =>
  ["APPROVED", "PUBLISHED"].includes(status)
    ? "live"
    : status === "SUBMITTED"
      ? "pending"
      : ["NEEDS_CORRECTION", "REJECTED", "SUSPENDED"].includes(status)
        ? "attention"
        : "planned";

function DecisionForm({
  kind,
  id,
  decisions,
  busy,
  onSubmit,
}: {
  kind: "product" | "storefront";
  id: string;
  decisions: Array<{ value: string; label: string }>;
  busy: boolean;
  onSubmit(event: FormEvent<HTMLFormElement>, id: string): void;
}) {
  return (
    <form className="form-stack moderation-form" onSubmit={(event) => onSubmit(event, id)}>
      <div className="form-grid">
        <label>
          Decision
          <select name="status" defaultValue={decisions[0]?.value}>
            {decisions.map((decision) => (
              <option value={decision.value} key={decision.value}>{decision.label}</option>
            ))}
          </select>
        </label>
        <label>
          Review note
          <input name="note" minLength={3} maxLength={2000} required placeholder="Document the evidence and next step." />
        </label>
      </div>
      <p className="field-help">
        {kind === "product"
          ? "Approval is tied to this listing revision; later material edits automatically require a new review."
          : "Approval publishes these trust details. Suspension blocks catalogue changes and new checkout."}
      </p>
      <button className="button button--primary" disabled={busy}>
        {busy ? "Recording…" : "Record decision"}
      </button>
    </form>
  );
}

export function CommerceModeration({
  products,
  storefronts,
  onChanged,
}: {
  products: CommerceProduct[];
  storefronts: CommerceStorefront[];
  onChanged(): void;
}) {
  const [busyId, setBusyId] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function review(
    event: FormEvent<HTMLFormElement>,
    kind: "products" | "storefronts",
    id: string,
  ) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusyId(id);
    setNotice("");
    setError("");
    try {
      await portalApi(`/v1/admin/operations/${kind}/${id}/review`, {
        method: "POST",
        body: JSON.stringify({ status: form.get("status"), note: form.get("note") }),
      });
      setNotice(`${kind === "products" ? "Product" : "Storefront"} decision recorded in the audit trail.`);
      onChanged();
    } catch (caught) {
      setError(
        caught instanceof PortalApiError
          ? caught.message
          : "The moderation decision could not be recorded.",
      );
    } finally {
      setBusyId("");
    }
  }

  const pendingStorefronts = storefronts.filter((item) => item.status === "SUBMITTED").length;
  const pendingProducts = products.filter((item) => item.status === "SUBMITTED").length;
  return (
    <section className="commerce-moderation">
      <div className="panel-heading moderation-heading">
        <div>
          <p className="section-kicker">Marketplace control</p>
          <h2>Storefront and product moderation</h2>
          <p>Review the public trust profile before individual listings. Every decision is institution-scoped and audited.</p>
        </div>
        <div className="moderation-counts" aria-label="Moderation queue counts">
          <span><strong>{pendingStorefronts}</strong> storefronts</span>
          <span><strong>{pendingProducts}</strong> products</span>
        </div>
      </div>
      <div className="commerce-feedback" aria-live="polite">
        {notice && <p className="form-notice">{notice}</p>}
        {error && <p className="form-error">{error}</p>}
      </div>
      <div className="dashboard-grid dashboard-grid--equal">
        <article className="panel moderation-queue">
          <div className="panel-heading">
            <div><p className="section-kicker">Trust profiles</p><h3>Vendor storefronts</h3></div>
            <span className="data-label">{storefronts.length} records</span>
          </div>
          {!storefronts.length && (
            <div className="empty-row"><strong>No storefronts awaiting oversight</strong><span>Submitted vendor trust profiles will appear here.</span></div>
          )}
          {storefronts.map((storefront) => {
            const decisions = storefront.status === "SUBMITTED"
              ? [
                  { value: "APPROVED", label: "Approve storefront" },
                  { value: "NEEDS_CORRECTION", label: "Request correction" },
                  { value: "SUSPENDED", label: "Suspend storefront" },
                ]
              : storefront.status === "APPROVED"
                ? [{ value: "SUSPENDED", label: "Suspend storefront" }]
                : storefront.status === "SUSPENDED"
                  ? [{ value: "NEEDS_CORRECTION", label: "Return for correction" }]
                  : [];
            return (
              <details className="review-item moderation-item" key={storefront.vendor_profile_id} open={storefront.status === "SUBMITTED"}>
                <summary>
                  <span><strong>{storefront.display_name}</strong><small>{storefront.vendor_email} · revision {String(storefront.listing_revision)}</small></span>
                  <span className={`state-badge state-badge--${statusTone(storefront.status)}`}>{label(storefront.status)}</span>
                </summary>
                <dl className="detail-list">
                  <div><dt>Contact</dt><dd>{storefront.contact_phone_e164 ?? "Incomplete"}</dd></div>
                  <div><dt>Pickup</dt><dd>{storefront.pickup_location ?? "Incomplete"}</dd></div>
                  <div><dt>Hours</dt><dd>{String(storefront.opening_hours.summary ?? "Incomplete")}</dd></div>
                  <div><dt>Preparation</dt><dd>{String(storefront.default_preparation_minutes)} min</dd></div>
                  <div><dt>Submitted</dt><dd>{date(storefront.submitted_at)}</dd></div>
                </dl>
                <p className="moderation-description">{storefront.description ?? "No public description supplied."}</p>
                {storefront.pickup_instructions && <div className="review-note"><strong>Pickup instruction</strong><p>{storefront.pickup_instructions}</p></div>}
                {storefront.review_note && <div className="review-note"><strong>Previous review note</strong><p>{storefront.review_note}</p></div>}
                {!!decisions.length && (
                  <DecisionForm kind="storefront" id={storefront.vendor_profile_id} decisions={decisions} busy={busyId === storefront.vendor_profile_id} onSubmit={(event, id) => void review(event, "storefronts", id)} />
                )}
              </details>
            );
          })}
        </article>

        <article className="panel moderation-queue">
          <div className="panel-heading">
            <div><p className="section-kicker">Catalogue review</p><h3>Vendor products</h3></div>
            <span className="data-label">{products.length} records</span>
          </div>
          {!products.length && (
            <div className="empty-row"><strong>No products awaiting oversight</strong><span>Submitted listings and recent review outcomes will appear here.</span></div>
          )}
          {products.map((product) => (
            <details className="review-item moderation-item" key={product.id} open={product.status === "SUBMITTED"}>
              <summary>
                <span className="moderation-product-title">
                  {product.image_url ? <Image src={product.image_url} alt="" width={44} height={44} unoptimized /> : <span className="product-placeholder">{product.name.slice(0, 1)}</span>}
                  <span><strong>{product.name}</strong><small>{product.vendor_name} · {product.category} · revision {String(product.listing_revision)}</small></span>
                </span>
                <span className={`state-badge state-badge--${statusTone(product.status)}`}>{label(product.status)}</span>
              </summary>
              <p className="moderation-description">{product.description}</p>
              <dl className="detail-list">
                <div><dt>Price / stock</dt><dd>{money(product.price_kobo)} · {String(product.stock_quantity)}</dd></div>
                <div><dt>Preparation</dt><dd>{String(product.preparation_minutes)} min</dd></div>
                <div><dt>Package</dt><dd>{String(product.package_weight_grams ?? "—")} g · {String(product.package_length_cm ?? "—")} × {String(product.package_width_cm ?? "—")} × {String(product.package_height_cm ?? "—")} cm</dd></div>
                <div><dt>Bicycle eligible</dt><dd>{product.bicycle_delivery_eligible ? "Confirmed" : "Not confirmed"}</dd></div>
                <div><dt>Submitted</dt><dd>{date(product.submitted_at)}</dd></div>
              </dl>
              {product.listing_rules && <div className="policy-warning"><strong>Category policy</strong><p>{product.listing_rules}</p></div>}
              {product.moderation_note && <div className="review-note"><strong>Previous review note</strong><p>{product.moderation_note}</p></div>}
              {product.status === "SUBMITTED" && (
                <DecisionForm
                  kind="product"
                  id={product.id}
                  decisions={[
                    { value: "PUBLISHED", label: "Approve and publish" },
                    { value: "NEEDS_CORRECTION", label: "Request correction" },
                    { value: "REJECTED", label: "Reject listing" },
                  ]}
                  busy={busyId === product.id}
                  onSubmit={(event, id) => void review(event, "products", id)}
                />
              )}
            </details>
          ))}
        </article>
      </div>
    </section>
  );
}
