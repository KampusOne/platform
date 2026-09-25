"use client";
import { useEffect, useState, type FormEvent } from "react";
import { portalApi } from "@/lib/api";
import { useAdminContext } from "./admin-context";
import { usePortalAuth } from "./auth-provider";
import { PortalShell } from "./portal-shell";
type Staff = { user_id: string; email: string; status: string; permissions: string[]; university_ids: string[]; all_universities: boolean; updated_at?: string };
export function StaffWorkspace() {
  const { access, can } = useAdminContext();
  const { user } = usePortalAuth();
  const canProvision = Boolean(user?.operatorRoles.includes("PLATFORM_ADMIN"));
  const [data, setData] = useState<{ staff: Staff[]; permissions: string[] } | null>(null);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const [userId, setUserId] = useState("");
  const [permissions, setPermissions] = useState<string[]>([]);
  const [universityIds, setUniversityIds] = useState<string[]>([]);
  const [allUniversities, setAllUniversities] = useState(false);
  const [status, setStatus] = useState("ACTIVE");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!can("staff.manage")) return;
    let active = true;
    void portalApi<{ staff: Staff[]; permissions: string[] }>("/v1/admin/staff").then((result) => { if (active) { setData(result); setError(""); } }).catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : "Staff accounts could not be loaded."); });
    return () => { active = false; };
  }, [can, version]);
  function edit(staff: Staff) { setUserId(staff.user_id); setPermissions(staff.permissions ?? []); setUniversityIds(staff.university_ids ?? []); setAllUniversities(staff.all_universities); setStatus(staff.status); setReason(""); setReview(false); }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!review) { setReview(true); return; }
    setBusy(true); setNotice("");
    try {
      await portalApi(`/v1/admin/staff/${userId}`, { method: "PUT", body: JSON.stringify({ permissions, universityIds, allUniversities, status, reason }) });
      setVersion((value) => value + 1); setReview(false); setNotice("Staff access updated and audited.");
    } catch (caught) { setNotice(caught instanceof Error ? caught.message : "Staff access could not be updated."); }
    finally { setBusy(false); }
  }
  const grouped = (data?.permissions ?? []).reduce<Record<string, string[]>>((groups, permission) => { const key = permission.split(".")[0]!; (groups[key] ??= []).push(permission); return groups; }, {});
  return <PortalShell active="admin" eyebrow="Provisioned access" title="Staff & permissions" description="Grant only the actions and universities a staff member needs.">
    {notice && <p className="workspace-notice" role="status">{notice}</p>}
    {error ? <section className="state-panel state-panel--error"><p>{error}</p><button className="button button--secondary" onClick={() => setVersion((value) => value + 1)}>Try again</button></section> : !data ? <div className="table-skeleton" aria-label="Loading staff"><div /><div /><div /></div> : <>
      <div className="table-scroll"><table className="operational-table"><thead><tr><th>Staff account</th><th>Status</th><th>Permissions</th><th>University scope</th><th>Action</th></tr></thead><tbody>{data.staff.map((staff) => <tr key={staff.user_id}><td>{staff.email}</td><td>{staff.status}</td><td>{staff.permissions.length} actions</td><td>{staff.all_universities ? "All universities" : `${staff.university_ids.length} universities`}</td><td><button className="text-button" disabled={!canProvision || staff.user_id === user?.id} onClick={() => edit(staff)}>Manage access</button></td></tr>)}</tbody></table>{!data.staff.length && <p className="table-empty">No custom staff grants. Existing provisioned operator roles remain active.</p>}</div>
      {canProvision ? <form className="panel form-stack" onSubmit={save}>
        <h2>{review ? "Review access change" : "Provision or update a staff account"}</h2>
        <label>Verified KampusOne account ID<input required pattern="[0-9a-fA-F-]{36}" value={userId} readOnly={review} onChange={(event) => setUserId(event.target.value)} placeholder="Account UUID from the user directory" /></label>
        <p className="field-help">The person must already have a verified KampusOne account. Provisioning does not send an invitation or create another identity.</p>
        <label>Account access<select value={status} disabled={review} onChange={(event) => setStatus(event.target.value)}><option value="ACTIVE">Active</option><option value="SUSPENDED">Suspended</option></select></label>
        <div className="permission-matrix">{Object.entries(grouped).map(([module, values]) => <fieldset key={module} disabled={review}><legend>{module}</legend>{values.map((permission) => <label className="checkbox" key={permission}><input type="checkbox" checked={permissions.includes(permission)} onChange={(event) => setPermissions(event.target.checked ? [...permissions, permission] : permissions.filter((item) => item !== permission))} />{permission.split(".").slice(1).join(" ")}</label>)}</fieldset>)}</div>
        <fieldset disabled={review}><legend>University scope</legend><label className="checkbox"><input type="checkbox" checked={allUniversities} onChange={(event) => setAllUniversities(event.target.checked)} />All universities</label>{!allUniversities && <div className="scope-checkboxes">{access?.universities?.map((university) => <label className="checkbox" key={university.id}><input type="checkbox" checked={universityIds.includes(university.id)} onChange={(event) => setUniversityIds(event.target.checked ? [...universityIds, university.id] : universityIds.filter((id) => id !== university.id))} />{university.name}</label>)}</div>}</fieldset>
        <label>Reason for this change<textarea required minLength={10} maxLength={1000} value={reason} readOnly={review} onChange={(event) => setReason(event.target.value)} /></label>
        {review && <p className="workspace-notice">You are granting {permissions.length} actions to account {userId}, {allUniversities ? "across all universities" : `within ${universityIds.length} selected universities`}. Access will be {status.toLowerCase()}.</p>}
        <div className="form-actions">{review && <button type="button" className="button button--secondary" onClick={() => setReview(false)}>Edit selection</button>}<button className="button button--primary" disabled={busy || userId === user?.id || (!allUniversities && !universityIds.length)}>{busy ? "Updating access…" : review ? "Confirm access change" : "Review change"}</button></div>
      </form> : <p className="workspace-notice">Only a provisioned platform administrator can change staff access.</p>}
    </>}
  </PortalShell>;
}
