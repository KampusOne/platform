"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { portalApi } from "@/lib/api";
import { useAdminContext } from "./admin-context";
import { PortalShell } from "./portal-shell";
import styles from "./broadcast-workspace.module.css";

const base = "/v1/admin/broadcasts";
const failure = (error: unknown) => error instanceof Error ? error.message : "This action could not be completed. Please try again.";
const when = (value?: string | null) => value ? new Date(value).toLocaleString() : "—";
type Kind = "OPERATIONAL" | "MARKETING";
type Role = "ALL" | "STUDENT" | "AGENT" | "VENDOR" | "TUTOR" | "RIDER" | "BUYER" | "STAFF";
type Recipient = { id: string; email: string; display_name: string | null };
type Segment = { role: Role; userIds: string[]; facultyId?: string; departmentId?: string; agentStatus?: "ACTIVE" | "PAUSED" | "SUSPENDED" };
type Draft = { personaId: string; kind: Kind; subject: string; body: string; segment: Segment };
type Campaign = { id: string; institution_id: string | null; persona_id: string; kind: Kind; subject: string; body: string; segment: Segment; revision: number; status: string; scheduled_at: string | null; display_name: string; reviewed_snapshot_id: string | null; created_at: string };
type Summary = Pick<Campaign, "id" | "kind" | "subject" | "revision" | "status" | "scheduled_at" | "created_at">;
type Template = { id: string; name: string; kind: Kind; subject: string; body: string };
type Persona = { id: string; display_name: string; active: boolean };
type Settings = { enabled: boolean; max_per_day: number; max_per_minute: number; postal_address: string | null };
type Segments = { faculties: { id: string; name: string }[]; departments: { id: string; name: string; faculty_id: string }[] };
type Configuration = { segments?: Segments; settings: Settings; personas: Persona[]; provider: { sendingConfigured: boolean; webhookConfigured: boolean; unsubscribeConfigured: boolean }; disclosure: string };
type Preview = { snapshotId: string; revision: number; eligibleCount: number; excludedCount: number; suppressedCount?: number; notOptedInCount?: number; expiresAt: string; scope: string | null; subject: string; body: string; sender: string; sample: { userId: string; name: string | null; email: string }[]; message?: string };
type Detail = { campaign: Campaign; delivery: { is_test: boolean; status: string; count: number }[]; events: { event_type: string; occurred_at: string; received_at: string }[]; review?: Preview | null };
function draftFrom(campaign?: Campaign, personas: Persona[] = []): Draft {
  return campaign ? { personaId: campaign.persona_id, kind: campaign.kind, subject: campaign.subject, body: campaign.body, segment: campaign.segment } : { personaId: personas.find(p => p.active)?.id ?? "", kind: "OPERATIONAL", subject: "", body: "", segment: { role: "ALL", userIds: [] } };
}

export function BroadcastWorkspace() {
  const { scope } = useAdminContext();
  return <ScopedBroadcastWorkspace key={scope} />;
}
function ScopedBroadcastWorkspace() {
  const { scopedPath, can, scopeLabel } = useAdminContext();
  const [bundle, setBundle] = useState<(Configuration & { campaigns: Summary[]; templates: Template[] }) | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (!can("broadcasts.view")) return;
    let active = true;
    void Promise.all([portalApi<Configuration>(scopedPath(base + "/settings")), portalApi<{ campaigns: Summary[] }>(scopedPath(base)), portalApi<{ templates: Template[] }>(scopedPath(base + "/templates")), portalApi<Segments>(scopedPath(base + "/segments"))]).then(([config, campaigns, templates, segments]) => { if (active) { setBundle({ ...config, ...campaigns, ...templates, segments }); setError(""); } }).catch(caught => { if (active) setError(failure(caught)); });
    return () => { active = false; };
  }, [can, scopedPath, version]);
  function refresh(id?: string) { if (id) setSelected(id); setVersion(v => v + 1); }
  const listed = bundle?.campaigns.filter(c => `${c.subject} ${c.status} ${c.kind}`.toLowerCase().includes(query.toLowerCase())) ?? [];
  return <PortalShell active="admin" eyebrow="Email & broadcasts" title="Campaigns" description="Prepare a message, review its recipients, and track delivery.">
    <p className="scope-caption">{scopeLabel}</p>
    {!can("broadcasts.view") ? <section className="state-panel"><h2>Campaign access required</h2><p>Your administrator has not granted this workspace.</p></section> : error ? <section className="state-panel state-panel--error" role="alert"><p>{error}</p><button className="button button--secondary" onClick={() => refresh()}>Retry loading</button></section> : !bundle ? <div className="table-skeleton" aria-label="Loading campaigns" aria-busy="true"><div /><div /><div /></div> : <>
      <div className={styles.provider}><span>{bundle.settings.enabled ? "Delivery enabled" : "Delivery paused"}</span><span>Sender: {bundle.provider.sendingConfigured ? "Configured" : "Not configured"}</span><span>Delivery events: {bundle.provider.webhookConfigured ? "Configured" : "Not configured"}</span><span>Email preferences: {bundle.provider.unsubscribeConfigured ? "Configured" : "Not configured"}</span></div>
      <div className={styles.layout}>
        <section aria-label="Campaign directory"><div className={styles.listHeader}><h2>Campaigns</h2><button className="text-button" onClick={() => refresh()}>Refresh</button></div><input className={`search-input ${styles.filter}`} aria-label="Filter campaigns" placeholder="Find a subject or status" value={query} onChange={e => setQuery(e.target.value)} />{can("broadcasts.manage") && <button className="button button--primary" onClick={() => setSelected("new")}>New draft</button>}
          <div className={`${styles.campaigns} ${styles.section}`}>{listed.map(c => <button key={c.id} className={styles.campaign} aria-current={selected === c.id ? "true" : undefined} onClick={() => setSelected(c.id)}><strong>{c.subject}</strong><small>{c.status.replaceAll("_", " ")} · {c.kind.toLowerCase()}</small><small>{c.scheduled_at ? `Scheduled ${when(c.scheduled_at)}` : when(c.created_at)}</small></button>)}{!listed.length && <p className={styles.empty}>{bundle.campaigns.length ? "No campaigns match this filter." : "No campaigns in this university scope. Start with a draft."}</p>}</div>
        </section>
        <section aria-label="Campaign workspace">{selected ? <CampaignPanel key={selected} id={selected} configuration={bundle} templates={bundle.templates} onSaved={refresh} /> : <div className={styles.empty}>Choose a campaign to inspect its message and delivery, or create a draft.</div>}</section>
      </div>
      <DeliveryControls key={JSON.stringify(bundle.settings) + bundle.personas.length} configuration={bundle} onSaved={() => refresh()} />
    </>}
  </PortalShell>;
}

function CampaignPanel({ id, configuration, templates, onSaved }: { id: string; configuration: Configuration; templates: Template[]; onSaved(id?: string): void }) {
  const { scopedPath } = useAdminContext();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (id === "new") return;
    let active = true;
    void portalApi<Detail>(scopedPath(`${base}/${id}`)).then(result => { if (active) { setDetail(result); setError(""); } }).catch(caught => { if (active) setError(failure(caught)); });
    return () => { active = false; };
  }, [id, scopedPath, version]);
  function reload(nextId?: string) { onSaved(nextId); setVersion(v => v + 1); }
  if (error) return <section className="state-panel state-panel--error" role="alert"><p>{error}</p><button className="button button--secondary" onClick={() => setVersion(v => v + 1)}>Retry campaign</button></section>;
  if (id !== "new" && !detail) return <div className={`table-skeleton ${styles.detailLoading}`} aria-busy="true" aria-label="Loading campaign"><div /><div /><div /></div>;
  return <CampaignForm key={detail ? `${detail.campaign.id}:${detail.campaign.revision}:${detail.campaign.status}:${version}` : "new"} initial={detail} configuration={configuration} templates={templates} onSaved={reload} />;
}

function RecipientSearch({ selected, onChange, single = false, disabled = false }: { selected: Recipient[]; onChange(values: Recipient[]): void; single?: boolean; disabled?: boolean }) {
  const { scopedPath } = useAdminContext();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Recipient[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function search() {
    if (query.trim().length < 2) return;
    setBusy(true); setError("");
    try { const response = await portalApi<{ users: Recipient[] }>(scopedPath(`${base}/recipients?q=${encodeURIComponent(query.trim())}`)); setResults(response.users); } catch (caught) { setError(failure(caught)); } finally { setBusy(false); }
  }
  return <div><div className="workspace-toolbar"><label className="workspace-search">Find a verified account<input value={query} disabled={disabled} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void search(); } }} placeholder="Name or email; at least two characters" /></label><button type="button" className="button button--secondary" disabled={disabled || busy || query.trim().length < 2} onClick={() => void search()}>{busy ? "Searching…" : "Find account"}</button></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className={styles.selected}>{selected.map(person => <span key={person.id}>{person.display_name || person.email || person.id}<button type="button" disabled={disabled} aria-label={`Remove ${person.display_name || person.email || person.id}`} onClick={() => onChange(selected.filter(r => r.id !== person.id))}>×</button></span>)}</div>
    {results && <div className={styles.searchResults}>{results.filter(person => !selected.some(r => r.id === person.id)).map(person => <div className={styles.searchResult} key={person.id}><span>{person.display_name || "Verified account"}<small>{person.email}</small></span><button className="text-button" type="button" disabled={disabled || (!single && selected.length >= 500)} onClick={() => { onChange(single ? [person] : [...selected, person]); if (single) setResults(null); }}>Select</button></div>)}{!results.length && <p className="field-help">No verified accounts matched in this university scope.</p>}</div>}
  </div>;
}

function CampaignForm({ initial, configuration, templates, onSaved }: { initial: Detail | null; configuration: Configuration; templates: Template[]; onSaved(id?: string): void }) {
  const { can, scopedPath, scopeLabel } = useAdminContext();
  const campaign = initial?.campaign;
  const [draft, setDraft] = useState<Draft>(() => draftFrom(campaign, configuration.personas));
  const [selectedUsers, setSelectedUsers] = useState<Recipient[]>(() => (campaign?.segment.userIds ?? []).map(id => ({ id, email: "", display_name: null })));
  const [audienceMode, setAudienceMode] = useState<"segment" | "selected">((campaign?.segment.userIds.length ?? 0) > 0 ? "selected" : "segment");
  const [preview, setPreview] = useState<Preview | null>(initial?.review ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [testUser, setTestUser] = useState<Recipient[]>([]);
  const [testConfirmed, setTestConfirmed] = useState(false);
  const [sendConfirmed, setSendConfirmed] = useState(false);
  const [cancelConfirmed, setCancelConfirmed] = useState(false);
  const [schedule, setSchedule] = useState("");
  const testRequest = useRef<{ key: string; id: string } | null>(null);
  const savedDraft = JSON.stringify(draftFrom(campaign, configuration.personas));
  const dirty = !campaign || JSON.stringify(draft) !== savedDraft;
  const editable = !campaign || ["DRAFT", "REVIEWED"].includes(campaign.status);
  const providerReady = Object.values(configuration.provider).every(Boolean);
  function update(change: Partial<Draft>) { setDraft(current => ({ ...current, ...change })); setPreview(null); setSendConfirmed(false); setTestConfirmed(false); setNotice(""); }
  function segment(change: Partial<Segment>) { update({ segment: { ...draft.segment, ...change } }); }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!can("broadcasts.manage") || !editable) return;
    if (audienceMode === "selected" && !selectedUsers.length) { setError("Select at least one account for an individual or selected-account message."); return; }
    setBusy("save"); setError(""); setNotice("");
    try {
      const result = await portalApi<{ id: string }>(scopedPath(campaign ? `${base}/${campaign.id}` : base), { method: campaign ? "PUT" : "POST", body: JSON.stringify({ ...draft, ...(campaign ? { revision: campaign.revision } : {}) }) });
      onSaved(result.id);
    } catch (caught) { setError(failure(caught)); } finally { setBusy(null); }
  }
  async function review() {
    if (!campaign || dirty) return;
    setBusy("review"); setError(""); setNotice(""); setSendConfirmed(false);
    try { const result = await portalApi<Preview>(scopedPath(`${base}/${campaign.id}/preview`), { method: "POST", body: JSON.stringify({ revision: campaign.revision }) }); setPreview(result); setNotice(result.message ?? "Audience reviewed. No email has been sent."); } catch (caught) { setError(failure(caught)); } finally { setBusy(null); }
  }
  async function sendTest() {
    const recipient = testUser[0];
    if (!campaign || dirty || !recipient || !testConfirmed) return;
    const key = `${campaign.id}:${campaign.revision}:${recipient.id}`;
    if (testRequest.current?.key !== key) testRequest.current = { key, id: crypto.randomUUID() };
    setBusy("test"); setError(""); setNotice("");
    try { const result = await portalApi<{ message: string }>(scopedPath(`${base}/${campaign.id}/test`), { method: "POST", body: JSON.stringify({ userId: recipient.id, requestId: testRequest.current.id, revision: campaign.revision, confirm: "SEND_TEST" }) }); setNotice(result.message); setTestConfirmed(false); } catch (caught) { setError(failure(caught)); } finally { setBusy(null); }
  }
  async function send() {
    if (!campaign || dirty || !preview || !sendConfirmed) return;
    setBusy("send"); setError(""); setNotice("");
    try {
      const scheduledAt = schedule ? new Date(schedule).toISOString() : undefined;
      await portalApi(scopedPath(`${base}/${campaign.id}/send`), { method: "POST", body: JSON.stringify({ snapshotId: preview.snapshotId, revision: preview.revision, recipientCount: preview.eligibleCount, confirm: "SEND_REVIEWED_CAMPAIGN", ...(scheduledAt ? { scheduledAt } : {}) }) });
      onSaved(campaign.id);
    } catch (caught) { setError(failure(caught)); } finally { setBusy(null); }
  }
  async function cancel() {
    if (!campaign || !cancelConfirmed) return;
    setBusy("cancel"); setError("");
    try { const response = await portalApi<{ message: string }>(scopedPath(`${base}/${campaign.id}/cancel`), { method: "POST" }); setNotice(response.message); onSaved(campaign.id); } catch (caught) { setError(failure(caught)); } finally { setBusy(null); }
  }
  return <div>
    <form className={`panel form-stack ${styles.editor}`} onSubmit={save}>
      <h2>{campaign ? campaign.subject : "New campaign draft"}</h2>
      <div className={styles.meta}><span>{scopeLabel}</span><span>{campaign ? `${campaign.status} · revision ${campaign.revision}` : "Unsaved draft"}</span>{campaign?.scheduled_at && <span>Scheduled {when(campaign.scheduled_at)}</span>}</div>
      {can("broadcasts.manage") && editable ? <>
        <fieldset disabled={Boolean(busy)} className="form-stack"><legend>Message</legend>
          <label>Start with a template<select defaultValue="" onChange={e => { const template = templates.find(t => t.id === e.target.value); if (template) update({ kind: template.kind, subject: template.subject, body: template.body }); }}><option value="">Choose a template</option>{templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
          <div className="form-grid"><label>Sender identity<select required value={draft.personaId} onChange={e => update({ personaId: e.target.value })}><option value="">Choose an active sender</option>{configuration.personas.filter(p => p.active || p.id === draft.personaId).map(p => <option key={p.id} value={p.id} disabled={!p.active}>{p.display_name}{p.active ? "" : " (inactive)"}</option>)}</select></label><label>Message purpose<select value={draft.kind} onChange={e => update({ kind: e.target.value as Kind })}><option value="OPERATIONAL">Account / service message</option><option value="MARKETING">Promotional / community news</option></select></label></div>
          <p className="field-help">{configuration.disclosure}</p>{draft.kind === "MARKETING" && <p className={styles.warning}>Only subscribers who opted in can receive promotional email. Suppressed addresses are excluded. Each message includes an unsubscribe link.</p>}
          <label>Subject<input required minLength={3} maxLength={160} value={draft.subject} onChange={e => update({ subject: e.target.value })} /></label>
          <label>Message<textarea required minLength={5} maxLength={20000} rows={10} value={draft.body} onChange={e => update({ body: e.target.value })} /></label>
        </fieldset>
        <fieldset disabled={Boolean(busy)} className="form-stack"><legend>Audience</legend>
          <label>Recipient selection<select value={audienceMode} onChange={e => { const mode = e.target.value as "segment" | "selected"; setAudienceMode(mode); setSelectedUsers([]); update({ segment: { role: "ALL", userIds: [] } }); }}><option value="segment">Filtered audience in {scopeLabel}</option><option value="selected">One or more selected accounts</option></select></label>
          {audienceMode === "selected" ? <RecipientSearch selected={selectedUsers} disabled={Boolean(busy)} onChange={users => { setSelectedUsers(users); segment({ userIds: users.map(u => u.id) }); }} /> : <>
            <div className="form-grid"><label>Account group<select value={draft.segment.role} onChange={e => { const next = { ...draft.segment, role: e.target.value as Role }; if (["AGENT", "VENDOR", "TUTOR", "RIDER"].includes(next.role)) next.agentStatus = "ACTIVE"; else delete next.agentStatus; update({ segment: next }); }}>{(["ALL", "STUDENT", "AGENT", "VENDOR", "TUTOR", "RIDER", "BUYER", "STAFF"] as Role[]).map(role => <option key={role} value={role}>{role === "ALL" ? "All eligible accounts" : role.charAt(0) + role.slice(1).toLowerCase() + "s"}</option>)}</select></label>{["AGENT", "VENDOR", "TUTOR", "RIDER"].includes(draft.segment.role) && <label>Agent status<select value={draft.segment.agentStatus ?? "ACTIVE"} onChange={e => { const next = { ...draft.segment }; if (e.target.value) next.agentStatus = e.target.value as "ACTIVE" | "PAUSED" | "SUSPENDED"; else delete next.agentStatus; update({ segment: next }); }}><option value="ACTIVE">Active</option><option value="PAUSED">Paused</option><option value="SUSPENDED">Suspended</option></select></label>}</div>
            <details><summary>Faculty or department filter</summary>{configuration.segments?.faculties.length ? <div className="form-grid"><label>Faculty<select value={draft.segment.facultyId ?? ""} onChange={e => { const next = { ...draft.segment }; delete next.departmentId; if (e.target.value) next.facultyId = e.target.value; else delete next.facultyId; update({ segment: next }); }}><option value="">All faculties</option>{configuration.segments.faculties.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label><label>Department<select value={draft.segment.departmentId ?? ""} onChange={e => { const next = { ...draft.segment }; if (e.target.value) next.departmentId = e.target.value; else delete next.departmentId; update({ segment: next }); }}><option value="">All departments</option>{configuration.segments.departments.filter(d => !draft.segment.facultyId || d.faculty_id === draft.segment.facultyId).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label></div> : <p className="field-help">Choose one university with published academic data to filter by its faculty or department.</p>}</details>
          </>}
          <p className="field-help">University scope: {scopeLabel}. Saving a draft or reviewing its audience sends no email.</p>
        </fieldset>
        <div className={styles.actions}><button className="button button--primary" disabled={Boolean(busy) || !dirty}>{busy === "save" ? "Saving draft…" : campaign ? "Save changes" : "Save draft"}</button>{campaign && <button className="button button--secondary" type="button" disabled={Boolean(busy) || dirty} onClick={() => void review()}>{busy === "review" ? "Preparing audience…" : "Review audience & message"}</button>}</div>
        {campaign && dirty && <p className="field-help">Save your changes before testing or reviewing this revision.</p>}
      </> : <div className={styles.readonly}><strong>{campaign?.display_name}</strong><p className={styles.body}>{campaign?.body}</p><p className="field-help">{editable ? "You have viewing access to this draft." : "Queued, completed and cancelled messages are preserved as recorded."}</p></div>}
    </form>
    {error && <p className={`form-error ${styles.notice}`} role="alert">{error}</p>}{notice && <p className={`workspace-notice ${styles.notice}`} role="status">{notice}</p>}
    {campaign && editable && can("broadcasts.send") && <section className={styles.section}><h3>Test with one selected account</h3><p className="field-help">A test is a real email. It targets only the account chosen below.</p><RecipientSearch single selected={testUser} disabled={Boolean(busy) || dirty} onChange={users => { setTestUser(users); setTestConfirmed(false); }} />{testUser[0] && <div className={styles.testRecipient}><strong>{testUser[0].display_name || "Selected account"}</strong><p>{testUser[0].email}</p><label className={styles.check}><input type="checkbox" checked={testConfirmed} disabled={Boolean(busy) || dirty} onChange={e => setTestConfirmed(e.target.checked)} />I confirm sending one test to this account for revision {campaign.revision} in {scopeLabel}.</label></div>}<div className={styles.actions}><button className="button button--secondary" disabled={Boolean(busy) || dirty || !testConfirmed || !testUser[0] || !providerReady || !configuration.settings.enabled} onClick={() => void sendTest()}>{busy === "test" ? "Queueing selected-account test…" : "Send one test email"}</button></div>{(!providerReady || !configuration.settings.enabled) && <p className={styles.warning}>Tests need configured email delivery and enabled delivery controls.</p>}</section>}
    {preview && !dirty && <section className={styles.section}><h3>Reviewed audience</h3><p className="scope-caption">{scopeLabel} · revision {preview.revision} · review expires {when(preview.expiresAt)}</p><div className={styles.counts}><div><strong>{preview.eligibleCount}</strong>Eligible recipients</div><div><strong>{preview.excludedCount}</strong>Excluded recipients</div>{preview.suppressedCount !== undefined && <div><strong>{preview.suppressedCount}</strong>Suppressed</div>}{preview.notOptedInCount !== undefined && <div><strong>{preview.notOptedInCount}</strong>Not subscribed</div>}</div><div className={styles.preview}><p className="field-help">From: {preview.sender}</p><h3>{preview.subject}</h3><p className={styles.body}>{preview.body}</p><p className="field-help">Official KampusOne team message.{draft.kind === "MARKETING" ? " The delivery template adds the mailing address and unsubscribe link." : ""}</p></div>
      <h3>Recipient sample</h3><div className={`table-scroll ${styles.table}`}><table className="operational-table"><thead><tr><th>Name</th><th>Email</th></tr></thead><tbody>{preview.sample.map(person => <tr key={person.userId}><td>{person.name || "Verified account"}</td><td>{person.email}</td></tr>)}</tbody></table>{!preview.sample.length && <p className="table-empty">No eligible recipients. Adjust the audience before sending.</p>}</div><p className="field-help">Up to 20 reviewed recipients shown. The final action targets all {preview.eligibleCount} eligible recipients in this saved review; preferences and suppression are checked again before delivery.</p>
      {can("broadcasts.send") && editable && <div className="form-stack"><label className={styles.schedule}>Optional send time (your local time)<input type="datetime-local" value={schedule} disabled={Boolean(busy)} onChange={e => { setSchedule(e.target.value); setSendConfirmed(false); }} /></label><label className={styles.check}><input type="checkbox" checked={sendConfirmed} disabled={Boolean(busy)} onChange={e => setSendConfirmed(e.target.checked)} />I reviewed the sender, message and {preview.eligibleCount} recipients for {scopeLabel}. I authorize {schedule ? "scheduled" : "immediate"} delivery of this revision.</label><div className={styles.actions}><button className="button button--primary" disabled={Boolean(busy) || !sendConfirmed || !preview.eligibleCount || !providerReady || !configuration.settings.enabled} onClick={() => void send()}>{busy === "send" ? "Queueing reviewed campaign…" : schedule ? `Schedule ${preview.eligibleCount} emails` : `Queue ${preview.eligibleCount} emails`}</button></div>{(!providerReady || !configuration.settings.enabled) && <p className={styles.warning}>Delivery is paused or its connection is incomplete. Your reviewed draft is retained.</p>}</div>}
    </section>}
    {initial && <section className={styles.section}><div className={styles.listHeader}><h3>Delivery status</h3><button className="text-button" disabled={Boolean(busy) || dirty} onClick={() => onSaved(campaign?.id)}>Refresh status</button></div><p className="field-help">Queued and provider-accepted messages are separate from confirmed delivery. A completed campaign means processing finished; inspect failures and delivery events below.</p><div className="table-scroll"><table className="operational-table"><thead><tr><th>Audience</th><th>State</th><th>Count</th></tr></thead><tbody>{initial.delivery.map(row => <tr key={`${row.is_test}:${row.status}`}><td>{row.is_test ? "Selected-account tests" : "Campaign"}</td><td>{row.status.replaceAll("_", " ")}</td><td>{row.count}</td></tr>)}</tbody></table>{!initial.delivery.length && <p className="table-empty">No queued messages or delivery attempts recorded.</p>}</div><details className={styles.section}><summary>Recent provider delivery events</summary><div className={`table-scroll ${styles.table}`}><table className="operational-table"><thead><tr><th>Event</th><th>Provider time</th><th>Received</th></tr></thead><tbody>{initial.events.map((event, i) => <tr key={`${event.received_at}:${i}`}><td>{event.event_type}</td><td>{when(event.occurred_at)}</td><td>{when(event.received_at)}</td></tr>)}</tbody></table>{!initial.events.length && <p className="table-empty">No delivery events received.</p>}</div></details></section>}
    {campaign && !["COMPLETED", "CANCELLED"].includes(campaign.status) && can("broadcasts.manage") && <details className={styles.cancel}><summary>Cancel this campaign</summary><p className={styles.warning}>Stop pending messages in {scopeLabel}. Email already accepted by the provider cannot be recalled.</p><label className={styles.check}><input type="checkbox" checked={cancelConfirmed} disabled={Boolean(busy)} onChange={e => setCancelConfirmed(e.target.checked)} />Cancel “{campaign.subject}” and its pending messages.</label><div className={styles.actions}><button className="button button--secondary" disabled={Boolean(busy) || !cancelConfirmed} onClick={() => void cancel()}>{busy === "cancel" ? "Cancelling…" : "Confirm cancellation"}</button></div></details>}
  </div>;
}

function DeliveryControls({ configuration, onSaved }: { configuration: Configuration; onSaved(): void }) {
  const { access, can, scopedPath } = useAdminContext();
  const [enabled, setEnabled] = useState(configuration.settings.enabled);
  const [perDay, setPerDay] = useState(configuration.settings.max_per_day);
  const [perMinute, setPerMinute] = useState(configuration.settings.max_per_minute);
  const [address, setAddress] = useState(configuration.settings.postal_address ?? "");
  const [displayName, setDisplayName] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  if (!access?.allUniversities || !can("broadcasts.manage")) return null;
  async function save(event: FormEvent) {
    event.preventDefault(); if (!confirmed) return; setBusy(true); setNotice("");
    try { await portalApi(scopedPath(base + "/settings"), { method: "PUT", body: JSON.stringify({ enabled, maxPerDay: perDay, maxPerMinute: perMinute, postalAddress: address }) }); setNotice("Delivery settings saved."); onSaved(); } catch (caught) { setNotice(failure(caught)); } finally { setBusy(false); }
  }
  async function persona(event: FormEvent) {
    event.preventDefault(); setBusy(true); setNotice("");
    try { await portalApi(scopedPath(base + "/personas"), { method: "POST", body: JSON.stringify({ displayName }) }); setDisplayName(""); setNotice("Official sender identity created."); onSaved(); } catch (caught) { setNotice(failure(caught)); } finally { setBusy(false); }
  }
  return <details className={`panel ${styles.controls}`}><summary>Platform delivery controls & sender identities</summary><p className={styles.warning}>These controls apply across all universities. Resuming delivery also resumes eligible messages already in the queue.</p>{notice && <p className="workspace-notice" role="status">{notice}</p>}
    <form className="form-stack" onSubmit={save}><fieldset className="form-stack" disabled={busy}><legend>Delivery controls</legend><label className={styles.check}><input type="checkbox" checked={enabled} onChange={e => { setEnabled(e.target.checked); setConfirmed(false); }} />Enable queued campaign delivery</label><div className="form-grid"><label>Maximum attempts each day<input type="number" required min={1} max={10000} value={perDay} onChange={e => { setPerDay(Number(e.target.value)); setConfirmed(false); }} /></label><label>Maximum attempts each minute<input type="number" required min={1} max={100} value={perMinute} onChange={e => { setPerMinute(Number(e.target.value)); setConfirmed(false); }} /></label></div><label>Organisation mailing address<textarea maxLength={500} value={address} onChange={e => { setAddress(e.target.value); setConfirmed(false); }} placeholder="Real address displayed in promotional email" /></label><label className={styles.check}><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />Apply these limits and {enabled ? "enable" : "pause"} campaign delivery for every university.</label><button className="button button--secondary" disabled={!confirmed || busy}>{busy ? "Saving controls…" : "Save platform delivery controls"}</button></fieldset></form>
    <form className="form-stack" onSubmit={persona}><fieldset className="form-stack" disabled={busy}><legend>New managed sender identity</legend><p className="field-help">The sender uses KampusOne’s configured email address and is disclosed as a team identity. It does not create an independent person or mailbox.</p><label>Public display name<input required minLength={2} maxLength={80} value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Jeffrey from KampusOne" /></label><button className="button button--secondary" disabled={busy}>{busy ? "Saving…" : "Create sender identity"}</button></fieldset></form>
  </details>;
}
