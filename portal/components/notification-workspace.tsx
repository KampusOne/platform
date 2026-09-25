"use client";
import { SoundCatalogue } from "./sound-catalogue";
import { useEffect, useState } from "react";
import { portalApi } from "@/lib/api";
import { useAdminContext } from "./admin-context";
import { PortalShell } from "./portal-shell";
type Device = { id: string; user_id: string; platform: string; label: string; build_version: string; display_name: string; updated_at: string };
type Attempt = { id: string; device_id: string; status: string; error_code: string | null; created_at: string; checked_at: string | null; observed_at: string | null };
export function NotificationWorkspace() {
  const { scope, scopeLabel, scopedPath, can } = useAdminContext();
  const [userId, setUserId] = useState("");
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Device | null>(null);
  const [data, setData] = useState<{ key: string; devices: Device[]; attempts: Attempt[] } | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [request, setRequest] = useState<{ deviceId: string; requestId: string } | null>(null);
  const key = JSON.stringify([scope, filter, version]);
  useEffect(() => {
    if (!can("notifications.test")) return;
    let active = true;
    const query = filter ? `?userId=${encodeURIComponent(filter)}` : "";
    void Promise.all([portalApi<{ devices: Device[] }>(scopedPath(`/v1/notifications/admin/devices${query}`)), portalApi<{ attempts: Attempt[] }>(scopedPath("/v1/notifications/admin/attempts"))]).then(([devices, attempts]) => { if (active) { setData({ key, devices: devices.devices, attempts: attempts.attempts }); setError(""); } }).catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "Devices could not be loaded."); });
    return () => { active = false; };
  }, [can, filter, key, scopedPath]);
  async function sendTest() {
    if (!selected || !data?.devices.some((device) => device.id === selected.id)) return;
    const payload = request?.deviceId === selected.id ? request : { deviceId: selected.id, requestId: crypto.randomUUID() };
    setRequest(payload); setBusy(true); setNotice("");
    try {
      const response = await portalApi<{ status: string }>("/v1/notifications/admin/test", { method: "POST", body: JSON.stringify(payload) });
      setNotice(`Test recorded: ${response.status.replaceAll("_", " ").toLowerCase()}. Check the provider receipt and ask the selected recipient to confirm device delivery.`); setSelected(null); setRequest(null); setVersion((value) => value + 1);
    } catch (caught) { setNotice(caught instanceof Error ? caught.message : "The test could not be confirmed. Retry uses the same request ID."); }
    finally { setBusy(false); }
  }
  async function receipt(id: string) {
    setBusy(true);
    try { const result = await portalApi<{ status: string }>(`/v1/notifications/admin/attempts/${id}/receipt`, { method: "POST" }); setNotice(`Provider receipt: ${result.status}. Device observation is tracked separately.`); setVersion((value) => value + 1); } catch (caught) { setNotice(caught instanceof Error ? caught.message : "Receipt could not be checked."); } finally { setBusy(false); }
  }
  const current = data?.key === key ? data : null;
  return <PortalShell active="admin" eyebrow="Selected-device testing" title="Notifications" description="Provider acceptance, provider receipt and device observation are separate states."><form className="workspace-toolbar" onSubmit={(event) => { event.preventDefault(); setFilter(userId); setSelected(null); }}><label>Account ID<input className="search-input" placeholder="Optional account UUID" value={userId} onChange={(event) => setUserId(event.target.value)} pattern="[0-9a-fA-F-]{36}" /></label><button className="button button--secondary">Find devices</button><button type="button" className="button button--secondary" onClick={() => setVersion((value) => value + 1)}>Refresh</button></form>{notice && <p className="workspace-notice" role="status">{notice}</p>}{error ? <section className="state-panel state-panel--error"><p>{error}</p><button className="button button--secondary" onClick={() => setVersion((value) => value + 1)}>Try again</button></section> : !current ? <div className="table-skeleton" aria-label="Loading devices"><div /><div /><div /></div> : <>
    <h2>Registered devices</h2><div className="table-scroll"><table className="operational-table"><thead><tr><th>Account</th><th>Device</th><th>Platform / build</th><th>Registration updated</th><th>Action</th></tr></thead><tbody>{current.devices.map((device) => <tr key={device.id}><td>{device.display_name || device.user_id}</td><td>{device.label || "Registered device"}</td><td>{device.platform} · {device.build_version || "Build not recorded"}</td><td>{new Date(device.updated_at).toLocaleString()}</td><td><button className="text-button" onClick={() => { setSelected(device); setRequest(null); }}>Review test</button></td></tr>)}</tbody></table>{!current.devices.length && <p className="table-empty">No registered devices in this scope. Use a supported native build to register a real device.</p>}</div>
    {selected && current.devices.some((device) => device.id === selected.id) && <section className="panel"><h2>Send one test notification?</h2><p><strong>{selected.display_name || selected.user_id}</strong> · {selected.label} · {selected.platform}</p><p className="scope-caption">{scopeLabel} · Only device {selected.id} will be targeted.</p><div className="form-actions"><button className="button button--secondary" disabled={busy} onClick={() => setSelected(null)}>Cancel</button><button className="button button--primary" disabled={busy} onClick={() => void sendTest()}>{busy ? "Sending selected-device test…" : "Send to this device"}</button></div></section>}
    <h2 className="workspace-subtitle">Delivery attempts</h2><div className="table-scroll"><table className="operational-table"><thead><tr><th>Requested</th><th>Provider state</th><th>Error</th><th>Device observation</th><th>Action</th></tr></thead><tbody>{current.attempts.map((attempt) => <tr key={attempt.id}><td>{new Date(attempt.created_at).toLocaleString()}</td><td>{attempt.status}</td><td>{attempt.error_code ?? "—"}</td><td>{attempt.observed_at ? `Recipient acknowledged ${new Date(attempt.observed_at).toLocaleString()}` : "Not observed"}</td><td><button className="text-button" disabled={busy || attempt.status !== "ACCEPTED"} onClick={() => void receipt(attempt.id)}>Check receipt</button></td></tr>)}</tbody></table>{!current.attempts.length && <p className="table-empty">No tests recorded.</p>}</div><p className="field-help">Native push tests require a registered native build. Browser notifications and local class reminders have different permission and delivery paths.</p>
    </>}<SoundCatalogue key={scope}/></PortalShell>;
}
