"use client";

import Image from "next/image";
import { type FormEvent, useEffect, useState } from "react";

import { PortalApiError, portalApi } from "@/lib/api";

type Scalar = string | number | null;
type Storefront = {
  vendor_profile_id: string;
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
};
type Category = {
  id: string;
  name: string;
  listing_rules: string | null;
};
type Product = {
  id: string;
  name: string;
  description: string;
  category: string;
  category_id: string | null;
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
  listing_rules: string | null;
  updated_at: string;
};
type VendorOrder = {
  id: string;
  status: string;
  subtotal_kobo: Scalar;
  delivery_fee_kobo: Scalar;
  total_kobo: Scalar;
  zone_name: string | null;
  item_count: Scalar;
  created_at: string;
  updated_at: string;
};
type OrderDetail = {
  order: VendorOrder & {
    delivery_note: string | null;
    recipient_name: string | null;
    recipient_phone_e164: string | null;
    delivery_location: string | null;
    delivery_landmark: string | null;
    pricing_formula_version: string;
  };
  items: Array<{
    product_id: string;
    name: string;
    image_url: string | null;
    quantity: Scalar;
    unit_price_kobo: Scalar;
  }>;
  timeline: Array<{
    previous_status: string | null;
    status: string;
    source: string;
    note: string | null;
    occurred_at: string;
  }>;
  actionDueAt: string | null;
  actionPolicyStatus: string;
  serverTime: string;
};

const money = (value: Scalar) =>
  new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0,
  }).format(Number(value ?? 0) / 100);
const count = (value: Scalar) =>
  new Intl.NumberFormat("en-NG").format(Number(value ?? 0));
const date = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("en-NG", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "—";
const label = (value: string) =>
  value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/^./, (letter) => letter.toUpperCase());
const optionalNumber = (value: FormDataEntryValue | null) => {
  const text = String(value ?? "").trim();
  return text ? Number(text) : null;
};
const errorMessage = (caught: unknown, fallback: string) =>
  caught instanceof PortalApiError ? caught.message : fallback;

function useResource<T>(path: string, refreshKey: number) {
  const [state, setState] = useState<{
    completedKey: number;
    data: T | null;
    error: PortalApiError | null;
  }>({ completedKey: -1, data: null, error: null });
  useEffect(() => {
    let active = true;
    void portalApi<T>(path)
      .then((result) => {
        if (active) setState({ completedKey: refreshKey, data: result, error: null });
      })
      .catch((caught) => {
        if (!active) return;
        setState({
          completedKey: refreshKey,
          data: null,
          error: caught instanceof PortalApiError
            ? caught
            : new PortalApiError(500, "REQUEST_FAILED", "This store record could not load."),
        });
      });
    return () => {
      active = false;
    };
  }, [path, refreshKey]);
  return {
    data: state.data,
    loading: state.completedKey !== refreshKey,
    error: state.completedKey === refreshKey ? state.error : null,
  };
}

function StatusBadge({ status }: { status: string }) {
  const tone = ["APPROVED", "PUBLISHED", "READY", "DELIVERED"].includes(status)
    ? "live"
    : ["SUBMITTED", "PAID", "ACCEPTED", "IN_DELIVERY"].includes(status)
      ? "pending"
      : ["NEEDS_CORRECTION", "REJECTED", "SUSPENDED"].includes(status)
        ? "attention"
        : "planned";
  return <span className={`state-badge state-badge--${tone}`}>{label(status)}</span>;
}

function InlineState({ error }: { error: PortalApiError }) {
  return (
    <div className={`workspace-gate ${error.code === "NETWORK_UNAVAILABLE" ? "workspace-gate--offline" : ""}`}>
      <strong>{error.code === "NETWORK_UNAVAILABLE" ? "You appear to be offline" : "Store workspace unavailable"}</strong>
      <p>{error.message}</p>
      <span>No unsaved change was sent. Refresh when the connection is available.</span>
    </div>
  );
}

export function VendorStoreWorkspace({ onChanged }: { onChanged(): void }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const storefrontResource = useResource<{ storefront: Storefront | null }>(
    "/v1/agents/storefront",
    refreshKey,
  );
  const productsResource = useResource<{ products: Product[] }>(
    "/v1/agents/products",
    refreshKey,
  );
  const categoriesResource = useResource<{ categories: Category[] }>(
    "/v1/agents/product-categories",
    refreshKey,
  );
  const ordersResource = useResource<{ orders: VendorOrder[] }>(
    "/v1/agents/orders",
    refreshKey,
  );
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [orderDetail, setOrderDetail] = useState<OrderDetail | null>(null);
  const [orderLoading, setOrderLoading] = useState(false);
  const [orderError, setOrderError] = useState("");
  const [busyKey, setBusyKey] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [pickupCode, setPickupCode] = useState<{ orderId: string; code: string } | null>(null);

  const storefront = storefrontResource.data?.storefront ?? null;
  const products = productsResource.data?.products ?? [];
  const categories = categoriesResource.data?.categories ?? [];
  const orders = ordersResource.data?.orders ?? [];
  const selectedProduct = products.find((product) => product.id === selectedProductId) ?? null;
  const storeLocked = storefront?.status === "SUSPENDED";
  const storefrontApproved = storefront?.status === "APPROVED";

  function refresh(message?: string) {
    if (message) setNotice(message);
    setRefreshKey((value) => value + 1);
    onChanged();
  }

  async function saveStorefront(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusyKey("storefront-save");
    setError("");
    setNotice("");
    try {
      await portalApi("/v1/agents/storefront", {
        method: "PUT",
        body: JSON.stringify({
          displayName: form.get("displayName"),
          description: form.get("description"),
          contactPhoneE164: form.get("contactPhoneE164"),
          pickupLocation: form.get("pickupLocation"),
          pickupInstructions: form.get("pickupInstructions") || null,
          openingHours: { summary: form.get("openingHours") },
          defaultPreparationMinutes: Number(form.get("defaultPreparationMinutes")),
        }),
      });
      refresh(
        storefrontApproved
          ? "Changes saved. The storefront left public sale and now needs a fresh review."
          : "Storefront details saved.",
      );
    } catch (caught) {
      setError(errorMessage(caught, "Storefront details could not be saved."));
    } finally {
      setBusyKey("");
    }
  }

  async function submitStorefront() {
    setBusyKey("storefront-submit");
    setError("");
    setNotice("");
    try {
      await portalApi("/v1/agents/storefront/status", {
        method: "PATCH",
        body: JSON.stringify({ status: "SUBMITTED" }),
      });
      refresh("Storefront submitted for administrator review.");
    } catch (caught) {
      setError(errorMessage(caught, "The storefront could not be submitted."));
    } finally {
      setBusyKey("");
    }
  }

  async function saveProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const editing = selectedProduct !== null;
    setBusyKey("product-save");
    setError("");
    setNotice("");
    try {
      const payload: Record<string, unknown> = {
        name: form.get("name"),
        description: form.get("description"),
        categoryId: form.get("categoryId"),
        priceKobo: Math.round(Number(form.get("price")) * 100),
        imageUrl: form.get("imageUrl") || null,
        preparationMinutes: Number(form.get("preparationMinutes")),
        packageWeightGrams: optionalNumber(form.get("packageWeightGrams")),
        packageLengthCm: optionalNumber(form.get("packageLengthCm")),
        packageWidthCm: optionalNumber(form.get("packageWidthCm")),
        packageHeightCm: optionalNumber(form.get("packageHeightCm")),
        bicycleDeliveryEligible: form.get("bicycleDeliveryEligible") === "on",
      };
      if (!editing) payload.stockQuantity = Number(form.get("stockQuantity"));
      const result = await portalApi<{ id: string }>(
        editing ? `/v1/agents/products/${selectedProduct.id}` : "/v1/agents/products",
        {
          method: editing ? "PUT" : "POST",
          body: JSON.stringify(payload),
        },
      );
      if (!editing) {
        setSelectedProductId(result.id);
        formElement.reset();
      }
      refresh(
        editing && ["PUBLISHED", "PAUSED"].includes(selectedProduct.status)
          ? "Product changes saved. The listing now needs a fresh review before sale."
          : editing
            ? "Product changes saved."
            : "Product draft created.",
      );
    } catch (caught) {
      setError(errorMessage(caught, "The product could not be saved."));
    } finally {
      setBusyKey("");
    }
  }

  async function saveStock(event: FormEvent<HTMLFormElement>, productId: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusyKey(`stock-${productId}`);
    setError("");
    setNotice("");
    try {
      await portalApi(`/v1/agents/products/${productId}/stock`, {
        method: "PATCH",
        body: JSON.stringify({ stockQuantity: Number(form.get("stockQuantity")) }),
      });
      refresh("Stock updated without changing the product review state.");
    } catch (caught) {
      setError(errorMessage(caught, "Stock could not be updated."));
    } finally {
      setBusyKey("");
    }
  }

  async function changeProductStatus(
    productId: string,
    status: "SUBMITTED" | "PUBLISHED" | "PAUSED" | "ARCHIVED",
  ) {
    setBusyKey(`product-${productId}`);
    setError("");
    setNotice("");
    try {
      await portalApi(`/v1/agents/products/${productId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      refresh(
        status === "SUBMITTED"
          ? "Product submitted for review."
          : status === "PUBLISHED"
            ? "Product returned to sale."
            : status === "PAUSED"
              ? "Product paused. Existing orders are unchanged."
              : "Product archived.",
      );
    } catch (caught) {
      setError(errorMessage(caught, "The product status could not be changed."));
    } finally {
      setBusyKey("");
    }
  }

  async function openOrder(orderId: string) {
    setSelectedOrderId(orderId);
    setOrderDetail(null);
    setOrderError("");
    setOrderLoading(true);
    try {
      setOrderDetail(await portalApi<OrderDetail>(`/v1/agents/orders/${orderId}`));
    } catch (caught) {
      setOrderError(errorMessage(caught, "Order details could not be loaded."));
    } finally {
      setOrderLoading(false);
    }
  }

  async function changeOrderStatus(orderId: string, status: "ACCEPTED" | "READY") {
    setBusyKey(`order-${orderId}`);
    setError("");
    setNotice("");
    try {
      await portalApi(`/v1/agents/orders/${orderId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status, note: null }),
      });
      refresh(status === "ACCEPTED" ? "Order accepted." : "Order marked ready for rider pickup.");
      await openOrder(orderId);
    } catch (caught) {
      setError(errorMessage(caught, "The order action could not be completed."));
    } finally {
      setBusyKey("");
    }
  }

  async function revealPickupCode(orderId: string) {
    setBusyKey(`order-${orderId}`);
    setError("");
    try {
      const result = await portalApi<{ code: string }>(
        `/v1/agents/orders/${orderId}/pickup-code`,
      );
      setPickupCode({ orderId, code: result.code });
    } catch (caught) {
      setError(errorMessage(caught, "The pickup code could not be loaded."));
    } finally {
      setBusyKey("");
    }
  }

  return (
    <div className="commerce-workspace">
      <div className="commerce-feedback" aria-live="polite">
        {notice && <p className="form-notice">{notice}</p>}
        {error && <p className="form-error">{error}</p>}
      </div>

      <section className="dashboard-grid dashboard-grid--content">
        <article className="panel storefront-summary">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">Public trust profile</p>
              <h2>Your storefront</h2>
            </div>
            {storefront && <StatusBadge status={storefront.status} />}
          </div>
          {storefrontResource.loading && (
            <div className="commerce-loading"><span className="spinner" /><span>Loading storefront…</span></div>
          )}
          {storefrontResource.error && <InlineState error={storefrontResource.error} />}
          {!storefrontResource.loading && !storefrontResource.error && !storefront && (
            <div className="empty-row">
              <strong>Set up the storefront first</strong>
              <span>Students will see its name, pickup point, hours and verified contact details.</span>
            </div>
          )}
          {storefront && (
            <>
              <dl className="detail-list">
                <div><dt>Public name</dt><dd>{storefront.display_name}</dd></div>
                <div><dt>Pickup point</dt><dd>{storefront.pickup_location ?? "Incomplete"}</dd></div>
                <div><dt>Preparation default</dt><dd>{count(storefront.default_preparation_minutes)} min</dd></div>
                <div><dt>Listing revision</dt><dd>{count(storefront.listing_revision)}</dd></div>
              </dl>
              {storefront.review_note && (
                <div className="review-note">
                  <strong>Administrator feedback</strong>
                  <p>{storefront.review_note}</p>
                </div>
              )}
              {storefront.status === "SUBMITTED" && (
                <p className="field-help">Submitted {date(storefront.submitted_at)}. You can edit it, but doing so withdraws this review request.</p>
              )}
              {storefront.status === "APPROVED" && (
                <p className="field-help">Approved {date(storefront.reviewed_at)}. Material edits take the storefront out of sale until reviewed again.</p>
              )}
              {storeLocked && (
                <div className="policy-warning">
                  <strong>Storefront suspended</strong>
                  <p>New catalogue changes are blocked. Follow the administrator note before requesting correction.</p>
                </div>
              )}
            </>
          )}
        </article>

        <article className="panel">
          <p className="section-kicker">Storefront setup</p>
          <h2>{storefront ? "Keep trust details current" : "Introduce your campus store"}</h2>
          <form
            className="form-stack"
            key={storefront?.updated_at ?? "new-storefront"}
            onSubmit={saveStorefront}
          >
            <div className="form-grid">
              <label>
                Public store name
                <input name="displayName" minLength={2} maxLength={120} required defaultValue={storefront?.display_name ?? ""} disabled={storeLocked} />
              </label>
              <label>
                Verified contact
                <input name="contactPhoneE164" type="tel" pattern="\+234[789][0-9]{9}" placeholder="+2348031234567" required defaultValue={storefront?.contact_phone_e164 ?? ""} disabled={storeLocked} />
              </label>
            </div>
            <label>
              What you sell
              <textarea name="description" minLength={10} maxLength={2000} required defaultValue={storefront?.description ?? ""} disabled={storeLocked} />
            </label>
            <div className="form-grid">
              <label>
                Pickup location
                <input name="pickupLocation" minLength={5} maxLength={500} required defaultValue={storefront?.pickup_location ?? ""} disabled={storeLocked} />
              </label>
              <label>
                Default preparation (minutes)
                <input name="defaultPreparationMinutes" type="number" min="10" max="1440" required defaultValue={Number(storefront?.default_preparation_minutes ?? 60)} disabled={storeLocked} />
              </label>
            </div>
            <label>
              Opening hours
              <input name="openingHours" minLength={3} maxLength={160} required placeholder="Monday to Friday, 09:00–18:00" defaultValue={String(storefront?.opening_hours.summary ?? "")} disabled={storeLocked} />
            </label>
            <label>
              Pickup instructions <span className="optional-label">Optional</span>
              <textarea name="pickupInstructions" maxLength={1000} defaultValue={storefront?.pickup_instructions ?? ""} disabled={storeLocked} />
            </label>
            <div className="form-actions">
              <button className="button button--primary" disabled={Boolean(busyKey) || storeLocked}>
                {busyKey === "storefront-save" ? "Saving…" : "Save storefront"}
              </button>
              {storefront && ["DRAFT", "NEEDS_CORRECTION"].includes(storefront.status) && (
                <button className="button button--secondary" type="button" onClick={() => void submitStorefront()} disabled={Boolean(busyKey) || storeLocked}>
                  {busyKey === "storefront-submit" ? "Submitting…" : "Submit for review"}
                </button>
              )}
            </div>
          </form>
        </article>
      </section>

      <section className="dashboard-grid dashboard-grid--content product-operations">
        <article className="panel">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">Catalogue</p>
              <h2>Products and stock</h2>
            </div>
            <button className="button button--secondary button--small" onClick={() => setSelectedProductId(null)} disabled={storeLocked}>
              New product
            </button>
          </div>
          {productsResource.loading && (
            <div className="commerce-loading"><span className="spinner" /><span>Loading products…</span></div>
          )}
          {productsResource.error && <InlineState error={productsResource.error} />}
          {products.map((product) => (
            <div className={`inventory-row ${selectedProductId === product.id ? "inventory-row--selected" : ""}`} key={product.id}>
              <button className="inventory-product" onClick={() => setSelectedProductId(product.id)} aria-pressed={selectedProductId === product.id}>
                {product.image_url ? (
                  <Image src={product.image_url} alt="" width={52} height={52} unoptimized />
                ) : (
                  <span className="product-placeholder">{product.name.slice(0, 1)}</span>
                )}
                <span>
                  <strong>{product.name}</strong>
                  <small>{product.category} · {money(product.price_kobo)}</small>
                  <StatusBadge status={product.status} />
                </span>
              </button>
              <form className="stock-control" onSubmit={(event) => void saveStock(event, product.id)}>
                <label htmlFor={`stock-${product.id}`}>Stock</label>
                <input id={`stock-${product.id}`} name="stockQuantity" type="number" min="0" max="1000000" required defaultValue={Number(product.stock_quantity ?? 0)} disabled={storeLocked} />
                <button className="text-button" disabled={Boolean(busyKey) || storeLocked}>
                  {busyKey === `stock-${product.id}` ? "Saving…" : "Update"}
                </button>
              </form>
            </div>
          ))}
          {!productsResource.loading && !productsResource.error && !products.length && (
            <div className="empty-row"><strong>No product drafts yet</strong><span>Create the first item after saving your storefront.</span></div>
          )}
        </article>

        <article className="panel product-editor">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">{selectedProduct ? "Listing editor" : "New product"}</p>
              <h2>{selectedProduct ? selectedProduct.name : "Add a campus essential"}</h2>
            </div>
            {selectedProduct && <StatusBadge status={selectedProduct.status} />}
          </div>
          {selectedProduct?.moderation_note && (
            <div className="review-note"><strong>Review feedback</strong><p>{selectedProduct.moderation_note}</p></div>
          )}
          {selectedProduct && ["PUBLISHED", "PAUSED"].includes(selectedProduct.status) && (
            <div className="policy-warning"><strong>Material-change safety</strong><p>Editing price, description, category, image, preparation or package data removes this listing from sale until reviewed again. Use the stock control for inventory-only changes.</p></div>
          )}
          <form className="form-stack" key={selectedProduct?.updated_at ?? "new-product"} onSubmit={saveProduct}>
            <div className="form-grid">
              <label>
                Product name
                <input name="name" minLength={2} maxLength={160} required defaultValue={selectedProduct?.name ?? ""} disabled={storeLocked} />
              </label>
              <label>
                Approved category
                <select name="categoryId" required defaultValue={selectedProduct?.category_id ?? ""} disabled={storeLocked}>
                  <option value="" disabled>Select category</option>
                  {categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}
                </select>
              </label>
            </div>
            <label>
              Description
              <textarea name="description" minLength={10} maxLength={2000} required defaultValue={selectedProduct?.description ?? ""} disabled={storeLocked} />
            </label>
            <div className="form-grid">
              <label>
                Price (₦)
                <input name="price" type="number" min="0" step="1" required defaultValue={Number(selectedProduct?.price_kobo ?? 0) / 100} disabled={storeLocked} />
              </label>
              {selectedProduct ? (
                <label>
                  Stock quantity
                  <input type="number" value={Number(selectedProduct.stock_quantity ?? 0)} disabled readOnly />
                  <span className="field-help">Use the inventory stock control so concurrent orders cannot be overwritten.</span>
                </label>
              ) : (
                <label>
                  Opening stock quantity
                  <input name="stockQuantity" type="number" min="0" max="1000000" required defaultValue="0" disabled={storeLocked} />
                </label>
              )}
            </div>
            <div className="form-grid">
              <label>
                Preparation (minutes)
                <input name="preparationMinutes" type="number" min="10" max="1440" required defaultValue={Number(selectedProduct?.preparation_minutes ?? storefront?.default_preparation_minutes ?? 60)} disabled={storeLocked} />
              </label>
              <label>
                Package weight (grams)
                <input name="packageWeightGrams" type="number" min="1" max="50000" defaultValue={selectedProduct?.package_weight_grams ?? ""} disabled={storeLocked} />
              </label>
            </div>
            <fieldset className="package-fields" disabled={storeLocked}>
              <legend>Package dimensions in centimetres</legend>
              <label>Length<input name="packageLengthCm" type="number" min="1" max="200" step="0.1" defaultValue={selectedProduct?.package_length_cm ?? ""} /></label>
              <label>Width<input name="packageWidthCm" type="number" min="1" max="200" step="0.1" defaultValue={selectedProduct?.package_width_cm ?? ""} /></label>
              <label>Height<input name="packageHeightCm" type="number" min="1" max="200" step="0.1" defaultValue={selectedProduct?.package_height_cm ?? ""} /></label>
            </fieldset>
            <label>
              Image URL <span className="optional-label">Temporary</span>
              <input name="imageUrl" type="url" placeholder="https://…" defaultValue={selectedProduct?.image_url ?? ""} disabled={storeLocked} />
              <span className="field-help">Managed image upload remains unavailable until the R2 binding and validation pipeline are reviewed.</span>
            </label>
            <label className="checkbox">
              <input name="bicycleDeliveryEligible" type="checkbox" defaultChecked={selectedProduct?.bicycle_delivery_eligible ?? false} disabled={storeLocked} /> Package is safe for the bicycle-delivery pilot
            </label>
            {selectedProduct?.listing_rules && <p className="field-help"><strong>Category policy:</strong> {selectedProduct.listing_rules}</p>}
            {!categoriesResource.loading && !categories.length && <p className="form-error">An administrator must approve a product category before you can save a listing.</p>}
            <div className="form-actions">
              <button className="button button--primary" disabled={Boolean(busyKey) || storeLocked || !categories.length}>
                {busyKey === "product-save" ? "Saving…" : selectedProduct ? "Save changes" : "Save product draft"}
              </button>
              {selectedProduct && ["DRAFT", "NEEDS_CORRECTION"].includes(selectedProduct.status) && (
                <button className="button button--secondary" type="button" disabled={Boolean(busyKey) || storeLocked || !storefrontApproved} onClick={() => void changeProductStatus(selectedProduct.id, "SUBMITTED")}>
                  Submit for review
                </button>
              )}
              {selectedProduct?.status === "PUBLISHED" && <button className="button button--secondary" type="button" disabled={Boolean(busyKey) || storeLocked} onClick={() => void changeProductStatus(selectedProduct.id, "PAUSED")}>Pause sale</button>}
              {selectedProduct?.status === "PAUSED" && <button className="button button--secondary" type="button" disabled={Boolean(busyKey) || storeLocked} onClick={() => void changeProductStatus(selectedProduct.id, "PUBLISHED")}>Return to sale</button>}
              {selectedProduct && selectedProduct.status !== "ARCHIVED" && <button className="text-button text-button--danger" type="button" disabled={Boolean(busyKey) || storeLocked} onClick={() => void changeProductStatus(selectedProduct.id, "ARCHIVED")}>Archive</button>}
            </div>
            {selectedProduct && !storefrontApproved && ["DRAFT", "NEEDS_CORRECTION"].includes(selectedProduct.status) && <p className="field-help">The storefront must be approved before a product can be submitted.</p>}
          </form>
        </article>
      </section>

      <section className="panel order-operations">
        <div className="panel-heading">
          <div><p className="section-kicker">Fulfilment desk</p><h2>Customer orders</h2></div>
          <span className="data-label">{orders.length} orders</span>
        </div>
        {ordersResource.loading && <div className="commerce-loading"><span className="spinner" /><span>Loading orders…</span></div>}
        {ordersResource.error && <InlineState error={ordersResource.error} />}
        {!ordersResource.loading && !ordersResource.error && !orders.length && <div className="empty-row"><strong>No customer orders</strong><span>Paid orders will appear here with immutable delivery instructions.</span></div>}
        {!!orders.length && (
          <div className="order-console">
            <div className="order-queue" aria-label="Vendor orders">
              {orders.map((order) => (
                <button className="order-queue-item" aria-current={selectedOrderId === order.id ? "true" : undefined} key={order.id} onClick={() => void openOrder(order.id)}>
                  <span><strong>Order #{order.id.slice(0, 8)}</strong><small>{count(order.item_count)} item(s) · {date(order.created_at)}</small></span>
                  <span><strong>{money(order.total_kobo)}</strong><StatusBadge status={order.status} /></span>
                </button>
              ))}
            </div>
            <div className="order-inspector">
              {!selectedOrderId && <div className="empty-row"><strong>Select an order</strong><span>Open one to verify quantities and delivery instructions before acting.</span></div>}
              {orderLoading && <div className="commerce-loading"><span className="spinner" /><span>Loading order details…</span></div>}
              {orderError && <p className="form-error">{orderError}</p>}
              {orderDetail && !orderLoading && (
                <>
                  <div className="panel-heading"><div><p className="section-kicker">Order #{orderDetail.order.id.slice(0, 8)}</p><h3>{orderDetail.order.recipient_name ?? "Payment pending"}</h3></div><StatusBadge status={orderDetail.order.status} /></div>
                  {orderDetail.order.recipient_phone_e164 && (
                    <dl className="detail-list">
                      <div><dt>Contact</dt><dd><a href={`tel:${orderDetail.order.recipient_phone_e164}`}>{orderDetail.order.recipient_phone_e164}</a></dd></div>
                      <div><dt>Deliver to</dt><dd>{orderDetail.order.delivery_location}</dd></div>
                      <div><dt>Landmark</dt><dd>{orderDetail.order.delivery_landmark ?? "Not supplied"}</dd></div>
                      <div><dt>Zone</dt><dd>{orderDetail.order.zone_name ?? "Not assigned"}</dd></div>
                    </dl>
                  )}
                  {orderDetail.order.delivery_note && <div className="review-note"><strong>Buyer instruction</strong><p>{orderDetail.order.delivery_note}</p></div>}
                  <div className="order-lines">
                    {orderDetail.items.map((item) => (
                      <div key={item.product_id}><span><strong>{item.name}</strong><small>{count(item.quantity)} × {money(item.unit_price_kobo)}</small></span><strong>{money(Number(item.quantity ?? 0) * Number(item.unit_price_kobo ?? 0))}</strong></div>
                    ))}
                    <div className="order-total"><span>Delivery</span><strong>{money(orderDetail.order.delivery_fee_kobo)}</strong></div>
                    <div className="order-total"><span>Total</span><strong>{money(orderDetail.order.total_kobo)}</strong></div>
                  </div>
                  {orderDetail.actionPolicyStatus === "UNCONFIGURED" && (
                    <div className="policy-warning"><strong>No response deadline configured</strong><p>The order remains actionable, but the pilot has no approved vendor-response SLA yet. No countdown is fabricated.</p></div>
                  )}
                  <div className="form-actions">
                    {orderDetail.order.status === "PAID" && <button className="button button--primary" disabled={Boolean(busyKey)} onClick={() => void changeOrderStatus(orderDetail.order.id, "ACCEPTED")}>{busyKey === `order-${orderDetail.order.id}` ? "Accepting…" : "Accept order"}</button>}
                    {orderDetail.order.status === "ACCEPTED" && <button className="button button--primary" disabled={Boolean(busyKey)} onClick={() => void changeOrderStatus(orderDetail.order.id, "READY")}>{busyKey === `order-${orderDetail.order.id}` ? "Updating…" : "Mark ready"}</button>}
                    {orderDetail.order.status === "READY" && <button className="button button--secondary" disabled={Boolean(busyKey)} onClick={() => void revealPickupCode(orderDetail.order.id)}>Show rider pickup code</button>}
                    {pickupCode?.orderId === orderDetail.order.id && <strong className="handoff-code" aria-label={`Pickup code ${pickupCode.code}`}>{pickupCode.code}</strong>}
                  </div>
                  <details className="order-timeline"><summary>Order timeline</summary>{orderDetail.timeline.map((event, index) => <div key={`${event.occurred_at}-${index}`}><span className="status-dot" /><span><strong>{label(event.status)}</strong><small>{date(event.occurred_at)} · {label(event.source)}</small>{event.note && <p>{event.note}</p>}</span></div>)}</details>
                </>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
