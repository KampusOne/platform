"use client";
import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";
import { PortalShell } from "./portal-shell";
import { TransientNotice } from "./transient-notice";
import { portalApi } from "@/lib/api";
type RecordRow = { id: string; [key: string]: string | number | null };
export type ManageSection =
  | "universities"
  | "trials"
  | "vendors"
  | "riders"
  | "support"
  | "communities";
const labels = {
  universities: "Universities",
  trials: "Free trials",
  vendors: "Vendors",
  riders: "Riders",
  support: "Support & appeals",
  communities: "Communities",
};
export function ManagePanel({ section }: { section: ManageSection }) {
  const [rows, setRows] = useState<RecordRow[]>([]);
  const [schools, setSchools] = useState<RecordRow[]>([]);
  const [scope, setScope] = useState("");
  const [status, setStatus] = useState("ALL");
  const [notice, setNotice] = useState("");
  const [settledQuery, setSettledQuery] = useState("");
  const [version, setVersion] = useState(0);
  const [selected, setSelected] = useState<RecordRow | null>(null);
  const [busy, setBusy] = useState(false);
  const queryKey = JSON.stringify([section, scope, status, version]);
  const loading = settledQuery !== queryKey;
  useEffect(() => {
    let alive = true;
    const path =
      section === "vendors" || section === "riders"
        ? "/v1/manage/agents?type=" +
          (section === "vendors" ? "VENDOR" : "RIDER")
        : "/v1/manage/" + section + "?";
    void portalApi<{ rows: RecordRow[] }>(
      path + "&universityId=" + scope + "&status=" + status,
    )
      .then((r) => {
        if (alive) setRows(r.rows);
      })
      .catch((e) => setNotice(e.message))
      .finally(() => {
        if (alive) setSettledQuery(queryKey);
      });
    return () => {
      alive = false;
    };
  }, [section, scope, status, version, queryKey]);
  useEffect(() => {
    void portalApi<{ rows: RecordRow[] }>("/v1/manage/universities")
      .then((r) => setSchools(r.rows))
      .catch(() => undefined);
  }, []);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      if (section === "universities" && !selected)
        await portalApi("/v1/manage/universities", {
          method: "POST",
          body: JSON.stringify({
            name: f.get("name"),
            slug: f.get("slug"),
            status: f.get("status"),
          }),
        });
      else if (section === "universities" && selected)
        await portalApi("/v1/manage/universities/" + selected.id, {
          method: "PATCH",
          body: JSON.stringify({ status: f.get("status") }),
        });
      else if (section === "trials" && selected)
        await portalApi("/v1/manage/trials/" + selected.id + "/revoke", {
          method: "POST",
          body: JSON.stringify({ reason: f.get("reason") }),
        });
      else if (section === "support" && selected)
        await portalApi("/v1/manage/support/" + selected.id, {
          method: "PATCH",
          body: JSON.stringify({
            reply: f.get("reply"),
            status: f.get("status"),
          }),
        });
      setNotice("Changes saved");
      setSelected(null);
      setVersion((v) => v + 1);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Could not save changes");
    } finally {
      setBusy(false);
    }
  }
  const columns =
    section === "universities"
      ? ["name", "status", "users", "agents"]
      : section === "trials"
        ? ["display_name", "email", "status", "claimed_at", "expires_at"]
        : section === "support"
          ? ["email", "subject", "category", "status"]
          : section === "communities"
            ? ["name", "admission_year", "current_level"]
            : ["display_name", "email", "status", "verified_at"];
  return (
    <PortalShell
      active="admin"
      eyebrow=""
      title={labels[section]}
      description=""
    >
      <TransientNotice message={notice} />
      <div className="table-toolbar">
        <label>
          University
          <select value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="">All universities</option>
            {schools.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        {section === "trials" ? (
          <label>
            Status
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              {["ALL", "ACTIVE", "EXPIRING", "EXPIRED", "REVOKED"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
        ) : null}
        <button
          className="button button--secondary"
          onClick={() => setVersion((v) => v + 1)}
        >
          Refresh
        </button>
      </div>
      {loading ? (
        <div className="table-skeleton" aria-label="Loading records">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} />
          ))}
        </div>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                {columns.map((key) => (
                  <th key={key}>{key.replaceAll("_", " ")}</th>
                ))}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  {columns.map((key) => (
                    <td key={key}>
                      {key.endsWith("_at") && row[key]
                        ? new Date(String(row[key])).toLocaleDateString()
                        : String(row[key] ?? "—")}
                    </td>
                  ))}
                  <td>
                    {["universities", "trials", "support"].includes(section) ? (
                      <button
                        className="text-button"
                        onClick={() => setSelected(row)}
                      >
                        Manage
                      </button>
                    ) : row.user_id ? (
                      <Link href={"/admin/users/" + row.user_id}>
                        Open account
                      </Link>
                    ) : (
                      <Link href={"/admin/communities/" + row.id}>Manage</Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length ? <p className="table-empty">No records yet</p> : null}
        </div>
      )}
      {section === "universities" || selected ? (
        <form className="form-stack manage-form" onSubmit={submit}>
          <h2>{selected ? "Manage record" : "Add university"}</h2>
          {section === "universities" ? (
            <>
              {!selected ? (
                <>
                  <label>
                    Name
                    <input required name="name" maxLength={160} />
                  </label>
                  <label>
                    University code
                    <input
                      required
                      name="slug"
                      pattern="[a-z0-9]+(-[a-z0-9]+)*"
                      placeholder="uniben"
                    />
                  </label>
                </>
              ) : null}
              <label>
                Status
                <select
                  name="status"
                  defaultValue={String(selected?.status ?? "PREPARING")}
                  key={selected?.id}
                >
                  {["CATALOGUED", "PREPARING", "LIVE", "PAUSED"].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
            </>
          ) : null}
          {section === "trials" ? (
            <label>
              Reason for revoking trial
              <textarea required name="reason" minLength={3} />
            </label>
          ) : null}
          {section === "support" ? (
            <>
              <p>{selected?.body}</p>
              <label>
                Reply
                <textarea required minLength={3} name="reply" />
              </label>
              <label>
                Status
                <select name="status">
                  <option>IN_REVIEW</option>
                  <option>RESOLVED</option>
                  <option>OPEN</option>
                </select>
              </label>
            </>
          ) : null}
          <div className="form-actions">
            {selected ? (
              <button
                type="button"
                className="button button--secondary"
                onClick={() => setSelected(null)}
              >
                Cancel
              </button>
            ) : null}
            <button className="button" disabled={busy}>
              Save
            </button>
          </div>
        </form>
      ) : null}
    </PortalShell>
  );
}
