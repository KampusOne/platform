"use client";
import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";
import { PortalShell } from "./portal-shell";
import { TransientNotice } from "./transient-notice";
import { portalApi } from "@/lib/api";
type Restriction = {
  id: string;
  kind: string;
  reason: string;
  revoked_at: string | null;
  ends_at: string | null;
};
type Activity = {
  id: string;
  title?: string;
  agent_type?: string;
  status: string;
  created_at?: string;
};
type Detail = {
  profile: { email: string; display_name: string; username: string };
  restrictions: Restriction[];
  posts: Activity[];
  orders: Activity[];
  applications: Activity[];
  streak: { current_days: number; longest_days: number } | null;
};
export function UserDetail({ id }: { id: string }) {
  const [data, setData] = useState<Detail | null>(null);
  const [notice, setNotice] = useState("");
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void portalApi<Detail>("/v1/manage/users/" + id)
      .then(setData)
      .catch((e) => setNotice(e.message));
  }, [id, version]);
  async function submit(
    e: FormEvent<HTMLFormElement>,
    action: "restriction" | "streak",
  ) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const body =
        action === "streak"
          ? { days: Number(f.get("days")), reason: f.get("reason") }
          : {
              kind: f.get("kind"),
              reason: f.get("reason"),
              endsAt: f.get("endsAt")
                ? new Date(String(f.get("endsAt"))).toISOString()
                : null,
            };
      await portalApi(
        "/v1/manage/users/" +
          id +
          (action === "streak" ? "/streak" : "/restrictions"),
        {
          method: action === "streak" ? "PATCH" : "POST",
          body: JSON.stringify(body),
        },
      );
      setVersion((v) => v + 1);
      setNotice("Changes saved");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Could not update account");
    } finally {
      setBusy(false);
    }
  }
  async function revoke(restrictionId: string) {
    try {
      await portalApi(
        "/v1/manage/users/" + id + "/restrictions/" + restrictionId,
        { method: "DELETE" },
      );
      setVersion((v) => v + 1);
      setNotice("Restriction removed");
    } catch (e) {
      setNotice(
        e instanceof Error ? e.message : "Could not remove restriction",
      );
    }
  }
  return (
    <PortalShell
      active="admin"
      eyebrow="User account"
      title={data?.profile.display_name ?? "Account"}
      description={data?.profile.email ?? ""}
    >
      <TransientNotice message={notice} />
      <Link href="/admin/users">← Users</Link>
      {data ? (
        <div className="user-detail-grid">
          <section>
            <h2>Activity</h2>
            {(["posts", "orders", "applications"] as const).map((key) => (
              <section key={key}>
                <h3>{key}</h3>
                {data[key].length ? (
                  data[key].map((item) => (
                    <div className="application-history__row" key={item.id}>
                      <span>
                        {item.title ?? item.agent_type ?? item.id.slice(0, 8)}
                      </span>
                      <span>{item.status}</span>
                    </div>
                  ))
                ) : (
                  <p className="muted">No {key} yet</p>
                )}
              </section>
            ))}
            <h2>Restrictions</h2>
            {data.restrictions.map((r) => (
              <div className="application-history__row" key={r.id}>
                <div>
                  <strong>{r.kind}</strong>
                  <p>{r.reason}</p>
                  <p>
                    {r.ends_at
                      ? new Date(r.ends_at).toLocaleString()
                      : "Permanent"}
                  </p>
                </div>
                {!r.revoked_at ? (
                  <button
                    className="button button--secondary"
                    onClick={() => void revoke(r.id)}
                  >
                    Lift restriction
                  </button>
                ) : (
                  <span>Removed</span>
                )}
              </div>
            ))}
          </section>
          <section>
            <form
              className="form-stack manage-form"
              onSubmit={(e) => void submit(e, "restriction")}
            >
              <h2>Account action</h2>
              <label>
                Action
                <select name="kind">
                  <option value="SUSPENDED">Temporary suspension</option>
                  <option value="BANNED">Permanent ban</option>
                </select>
              </label>
              <label>
                Suspension ends
                <input type="datetime-local" name="endsAt" />
              </label>
              <label>
                Reason
                <textarea required name="reason" minLength={3} />
              </label>
              <button className="button" disabled={busy}>
                Apply restriction
              </button>
            </form>
            <form
              className="form-stack manage-form"
              onSubmit={(e) => void submit(e, "streak")}
            >
              <h2>Streak</h2>
              <p>
                {data.streak?.current_days ?? 0} current ·{" "}
                {data.streak?.longest_days ?? 0} best
              </p>
              <label>
                Adjusted days
                <input required type="number" name="days" min={0} max={10000} />
              </label>
              <label>
                Reason
                <textarea required name="reason" minLength={3} />
              </label>
              <button className="button button--secondary" disabled={busy}>
                Save adjustment
              </button>
            </form>
          </section>
        </div>
      ) : (
        <div className="table-skeleton">
          <div />
          <div />
          <div />
        </div>
      )}
    </PortalShell>
  );
}
