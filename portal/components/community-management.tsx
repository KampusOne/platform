"use client";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PortalShell } from "./portal-shell";
import { TransientNotice } from "./transient-notice";
import { portalApi } from "@/lib/api";
type Details = {
  community: { name: string; level_code: string; archived_at: string | null };
  members: {
    user_id: string;
    display_name: string;
    username: string;
    matriculation_number: string;
    verified_at: string | null;
  }[];
  elections: {
    id: string;
    starts_at: string;
    ends_at: string;
    status: string;
    winner_name: string | null;
  }[];
  transfers: { id: string; username: string; status: string }[];
};
export function CommunityManagement({ id }: { id: string }) {
  const [data, setData] = useState<Details | null>(null),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [member, setMember] = useState("");
  const load = useCallback(async () => {
    try {
      setData(await portalApi<Details>("/v1/manage/communities/" + id));
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Could not load community");
    }
  }, [id]);
  useEffect(() => {
    let active = true;
    void portalApi<Details>("/v1/manage/communities/" + id)
      .then((value) => {
        if (active) setData(value);
      })
      .catch((error) => {
        if (active) setNotice(error.message);
      });
    return () => {
      active = false;
    };
  }, [id]);
  async function change(path: string, payload: unknown, method = "POST") {
    setBusy(true);
    try {
      await portalApi("/v1/manage/communities/" + id + path, {
        method,
        body: JSON.stringify(payload),
      });
      setNotice("Changes saved");
      setMember("");
      await load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Could not save changes");
    } finally {
      setBusy(false);
    }
  }
  function schedule(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void change("/elections", {
      startsAt: new Date(String(f.get("start"))).toISOString(),
      endsAt: new Date(String(f.get("end"))).toISOString(),
    });
  }
  const [{ initialStart, initialEnd }] = useState(() => {
    const now = Date.now();
    const local = (time: number) => {
      const date = new Date(time);
      return new Date(time - date.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16);
    };
    return {
      initialStart: local(now + 60000),
      initialEnd: local(now + 30 * 86400000),
    };
  });
  return (
    <PortalShell
      active="admin"
      eyebrow=""
      title={data?.community.name ?? "Community"}
      description=""
    >
      <TransientNotice message={notice} />
      <Link href="/admin/communities">All communities</Link>
      {!data ? (
        <div className="table-skeleton" aria-label="Loading community">
          <div />
          <div />
          <div />
        </div>
      ) : (
        <>
          <h2>Class members</h2>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Matriculation number</th>
                  <th>Membership</th>
                </tr>
              </thead>
              <tbody>
                {data.members.map((m) => (
                  <tr key={m.user_id}>
                    <td>
                      <Link href={"/admin/users/" + m.user_id}>
                        {m.display_name}
                      </Link>
                      <br />@{m.username}
                    </td>
                    <td>{m.matriculation_number ?? "Not provided"}</td>
                    <td>
                      {m.verified_at ? (
                        "Verified"
                      ) : (
                        <button
                          className="text-button"
                          onClick={() => setMember(m.user_id)}
                        >
                          Review
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {member ? (
            <form
              className="form-stack manage-form"
              onSubmit={(e) => {
                e.preventDefault();
                void change("/members/" + member + "/verify", {
                  evidence: new FormData(e.currentTarget).get("evidence"),
                });
              }}
            >
              <h3>Verify class membership</h3>
              <label>
                Student ID and cohort verification evidence
                <textarea
                  required
                  name="evidence"
                  minLength={20}
                  maxLength={2000}
                />
              </label>
              <button className="button" disabled={busy}>
                Verify member
              </button>
            </form>
          ) : null}
          <h2>Elections</h2>
          {data.elections.map((e) => (
            <form
              key={e.id}
              className="form-stack manage-form"
              onSubmit={(event) => {
                event.preventDefault();
                const f = new FormData(event.currentTarget);
                void change(
                  "/elections/" + e.id,
                  { action: f.get("action"), reason: f.get("reason") },
                  "PATCH",
                );
              }}
            >
              <p>
                {e.status} · {new Date(e.starts_at).toLocaleString()} –{" "}
                {new Date(e.ends_at).toLocaleString()}
              </p>
              {e.winner_name ? <p>Course rep: {e.winner_name}</p> : null}
              {e.status === "TIED" ? (
                <p>No winner was assigned. Schedule a new election.</p>
              ) : null}
              {e.status === "SCHEDULED" ? (
                <>
                  <label>
                    Action
                    <select name="action">
                      <option value="END">End voting and count ballots</option>
                      <option value="CANCEL">Cancel election</option>
                    </select>
                  </label>
                  <label>
                    Reason
                    <input required name="reason" minLength={3} />
                  </label>
                  <button className="button button--secondary" disabled={busy}>
                    Apply
                  </button>
                </>
              ) : null}
            </form>
          ))}
          {!data.elections.some((e) => e.status === "SCHEDULED") &&
          !data.community.archived_at ? (
            <form className="form-stack manage-form" onSubmit={schedule}>
              <h3>Schedule an election</h3>
              <label>
                Start (your local time)
                <input
                  required
                  name="start"
                  type="datetime-local"
                  defaultValue={initialStart}
                />
              </label>
              <label>
                End (your local time)
                <input
                  required
                  name="end"
                  type="datetime-local"
                  defaultValue={initialEnd}
                />
              </label>
              <button className="button" disabled={busy}>
                Schedule voting
              </button>
            </form>
          ) : null}
          {data.transfers.map((t) => (
            <form
              key={t.id}
              className="form-stack manage-form"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void change("/transfers/" + t.id, {
                  approve: f.get("decision") === "approve",
                  reason: f.get("reason"),
                });
              }}
            >
              <h3>Transfer to @{t.username}</h3>
              <p>
                {t.status === "ACCEPTED"
                  ? "Recipient accepted"
                  : "Awaiting recipient"}
              </p>
              <label>
                Decision
                <select name="decision">
                  <option value="reject">Cancel</option>
                  {t.status === "ACCEPTED" ? (
                    <option value="approve">Approve</option>
                  ) : null}
                </select>
              </label>
              <label>
                Reason
                <input required name="reason" minLength={3} />
              </label>
              <button className="button" disabled={busy}>
                Save decision
              </button>
            </form>
          ))}
          <form
            className="form-stack manage-form"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void change(
                "",
                {
                  levelCode: f.get("level"),
                  archive: f.get("archived") === "yes",
                  reason: f.get("reason"),
                },
                "PATCH",
              );
            }}
          >
            <h2>Cohort lifecycle</h2>
            <label>
              Current level
              <input
                required
                name="level"
                defaultValue={data.community.level_code}
              />
            </label>
            <label>
              Status
              <select
                name="archived"
                defaultValue={data.community.archived_at ? "yes" : "no"}
              >
                <option value="no">Active</option>
                <option value="yes">Archived · preserve history</option>
              </select>
            </label>
            <label>
              Reason
              <input required name="reason" minLength={3} />
            </label>
            <button className="button button--secondary" disabled={busy}>
              Update cohort
            </button>
          </form>
        </>
      )}
    </PortalShell>
  );
}
