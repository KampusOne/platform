"use client";
import Link from "next/link";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { portalApi } from "@/lib/api";
import { useAdminContext } from "./admin-context";
import { usePortalAuth } from "./auth-provider";
import { PortalShell } from "./portal-shell";
type Row = Record<string, string | number | boolean | null>;
type Rows = {
  ready?: boolean;
  rows: Row[];
  nextCursor?: string | null;
  total?: number;
  pageSize?: number;
};
function useRows(path: string, permission: string, version: number) {
  const { can } = useAdminContext(),
    key = `${path}:${version}`;
  const [value, setValue] = useState<{
    key: string;
    data?: Rows;
    error?: string;
  }>();
  useEffect(() => {
    if (!can(permission)) return;
    const controller = new AbortController();
    void portalApi<Rows>(path, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setValue({ key, data });
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setValue({
            key,
            error:
              e instanceof Error ? e.message : "This workspace could not load.",
          });
      });
    return () => controller.abort();
  }, [path, key, permission, can]);
  return value?.key === key ? value : undefined;
}
function Records({
  value,
  retry,
  children,
}: {
  value: ReturnType<typeof useRows>;
  retry: () => void;
  children: (data: Rows) => ReactNode;
}) {
  if (!value)
    return (
      <div
        className="table-skeleton"
        aria-busy="true"
        aria-label="Loading records"
      >
        <div />
        <div />
        <div />
      </div>
    );
  if (value.error)
    return (
      <section className="state-panel state-panel--error" role="alert">
        <p>{value.error}</p>
        <button className="button button--secondary" onClick={retry}>
          Retry
        </button>
      </section>
    );
  if (!value.data) return null;
  if (value.data.ready === false)
    return (
      <section className="state-panel">
        <h2>Awaiting the database update</h2>
        <p>
          This workspace will be available once the queued migration is applied.
        </p>
      </section>
    );
  return children(value.data);
}
const date = (value: unknown) =>
  value
    ? new Date(String(value)).toLocaleString("en-NG", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";
export function PrivateDocumentsWorkspace() {
  const { scope } = useAdminContext();
  return <DocumentsContent key={scope} />;
}
function DocumentsContent() {
  const { scope, scopeLabel, scopedPath, can } = useAdminContext();
  const [q, setQ] = useState(""),
    [cursors, setCursors] = useState<string[]>([""]),
    [version, setVersion] = useState(0),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [upload, setUpload] = useState<{ id: string; name: string } | null>(null),
    [file, setFile] = useState<File | null>(null),
    [title, setTitle] = useState(""),
    [collection, setCollection] = useState("Operations"),
    [description, setDescription] = useState(""),
    [archive, setArchive] = useState<Row | null>(null),
    [reason, setReason] = useState(""),
    [link, setLink] = useState<{ url: string; name: string } | null>(null);
  const path = scopedPath(
      `/v1/admin/documents?${new URLSearchParams({ q, before: cursors.at(-1) ?? "" })}`,
    ),
    value = useRows(path, "documents.view", version);
  useEffect(() => {
    if (!link) return;
    const clear = () => {
      if (document.hidden) setLink(null);
    };
    const timer = window.setTimeout(() => setLink(null), 90000);
    document.addEventListener("visibilitychange", clear);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", clear);
    };
  }, [link]);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || (!file && !upload)) return;
    setBusy(true);
    setNotice("");
    try {
      let stored = upload;
      if (!stored && file) {
        if (file.size > 10 * 1024 * 1024)
          throw new Error("Choose a document smaller than 10 MB.");
        const form = new FormData();
        form.append("kind", "operations-document");
        form.append("file", file);
        const r = await portalApi<{ id: string }>(scopedPath("/v1/media"), {
          method: "POST",
          body: form,
        });
        stored = { id: r.id, name: file.name };
        setUpload(stored);
      }
      await portalApi("/v1/admin/documents", {
        method: "POST",
        body: JSON.stringify({
          mediaId: stored!.id,
          universityId: scope || undefined,
          title,
          collection,
          description,
        }),
      });
      setFile(null);
      setUpload(null);
      setTitle("");
      setDescription("");
      setVersion((v) => v + 1);
      setNotice(
        "Document stored privately. Access follows staff permissions and university scope.",
      );
    } catch (e) {
      setNotice(
        e instanceof Error ? e.message : "Document could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function open(row: Row) {
    if (busy) return;
    setBusy(true);
    setLink(null);
    setNotice("");
    try {
      const r = await portalApi<{ url: string }>(
        `/v1/media/${row.media_id}/access`,
        { method: "POST" },
      );
      setLink({ url: r.url, name: String(row.title) });
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "File could not be opened.");
    } finally {
      setBusy(false);
    }
  }
  async function archiveDocument(e: FormEvent) {
    e.preventDefault();
    if (!archive || busy) return;
    setBusy(true);
    try {
      await portalApi(`/v1/admin/documents/${archive.id}/archive`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      setArchive(null);
      setReason("");
      setLink(null);
      setVersion((v) => v + 1);
      setNotice(
        "Document archived and access removed. The audit record and stored file are retained.",
      );
    } catch (e) {
      setNotice(
        e instanceof Error ? e.message : "Document could not be archived.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <PortalShell
      active="admin"
      eyebrow={scopeLabel}
      title="Operations documents"
      description="Private files for the team, organized by collection and university."
      actions={
        <button
          className="button button--secondary"
          onClick={() => setVersion((v) => v + 1)}
        >
          Refresh
        </button>
      }
    >
      {!can("documents.view") ? (
        <section className="state-panel">
          Your permissions do not include private documents.
        </section>
      ) : (
        <>
          {notice && (
            <p role="status" className="workspace-notice">
              {notice}
            </p>
          )}
          {link && (
            <div className="panel">
              <a
                className="button button--primary"
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open {link.name}
              </a>
              <p className="field-help">
                This private link expires after 90 seconds. Staff permissions
                are checked again when the file opens.
              </p>
            </div>
          )}
          {can("documents.manage") && value?.data?.ready !== false && (
            <section className="panel">
              <h2>Add a private document</h2>
              <form className="form-stack" onSubmit={save}>
                <fieldset disabled={busy}>
                  <legend>Document details</legend>
                  <label>
                    File
                    <input
                      type="file"
                      required={!upload && !file}
                      key={upload?.id ?? "new"}
                      accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.jpg,.jpeg,.png,.webp"
                      onChange={(e) => {
                        setFile(e.target.files?.[0] ?? null);
                        setUpload(null);
                      }}
                    />
                  </label>
                  {upload && (
                    <p className="field-help">
                      {upload.name} uploaded. Retry saving to keep this upload
                      without sending the file again.
                    </p>
                  )}
                  <label>
                    Title
                    <input
                      required
                      minLength={2}
                      maxLength={160}
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                    />
                  </label>
                  <label>
                    Collection
                    <input
                      required
                      minLength={2}
                      maxLength={60}
                      value={collection}
                      onChange={(e) => setCollection(e.target.value)}
                    />
                  </label>
                  <label>
                    Description
                    <textarea
                      maxLength={2000}
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                    />
                  </label>
                </fieldset>
                <button
                  className="button button--primary"
                  disabled={busy || (!file && !upload)}
                >
                  {busy ? "Saving…" : "Store privately"}
                </button>
              </form>
            </section>
          )}
          <div className="workspace-toolbar">
            <label className="workspace-search">
              Search title or collection
              <input
                type="search"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setCursors([""]);
                }}
                maxLength={120}
              />
            </label>
          </div>
          <Records value={value} retry={() => setVersion((v) => v + 1)}>
            {(data) => (
              <>
                <div className="table-scroll">
                  <table className="operational-table">
                    <thead>
                      <tr>
                        <th>Document</th>
                        <th>Collection</th>
                        <th>Uploaded by</th>
                        <th>Recorded</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.rows.map((row) => (
                        <tr key={String(row.id)}>
                          <td>
                            <strong>{row.title}</strong>
                            <small className="record-meta">
                              {row.original_name} ·{" "}
                              {Math.ceil(
                                Number(row.size_bytes) / 1024,
                              ).toLocaleString()}{" "}
                              KB
                            </small>
                            {row.description && <p>{row.description}</p>}
                          </td>
                          <td>{row.collection}</td>
                          <td>{row.created_by_name}</td>
                          <td>{date(row.created_at)}</td>
                          <td>
                            <div className="form-actions">
                              <button
                                className="text-button"
                                disabled={busy}
                                onClick={() => void open(row)}
                              >
                                Open file
                              </button>
                              {can("documents.manage") && (
                                <button
                                  className="text-button"
                                  disabled={busy}
                                  onClick={() => {
                                    setArchive(row);
                                    setReason("");
                                  }}
                                >
                                  Archive
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!data.rows.length && (
                    <p className="table-empty">
                      No matching private documents.
                    </p>
                  )}
                </div>
                <div className="workspace-pagination">
                  <span>Page {cursors.length}</span>
                  <button
                    className="button button--secondary"
                    disabled={cursors.length === 1 || busy}
                    onClick={() => setCursors((v) => v.slice(0, -1))}
                  >
                    Previous
                  </button>
                  <button
                    className="button button--secondary"
                    disabled={!data.nextCursor || busy}
                    onClick={() => setCursors((v) => [...v, data.nextCursor!])}
                  >
                    Next
                  </button>
                </div>
              </>
            )}
          </Records>
          {archive && (
            <section className="panel">
              <h2>Archive {archive.title}</h2>
              <form className="form-stack" onSubmit={archiveDocument}>
                <label>
                  Reason
                  <textarea
                    required
                    minLength={10}
                    maxLength={1000}
                    disabled={busy}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                <div className="form-actions">
                  <button
                    type="button"
                    className="button button--secondary"
                    disabled={busy}
                    onClick={() => setArchive(null)}
                  >
                    Cancel
                  </button>
                  <button className="button button--primary" disabled={busy}>
                    Archive document
                  </button>
                </div>
              </form>
            </section>
          )}
        </>
      )}
    </PortalShell>
  );
}
export function BlocklistWorkspace() {
  const { scope } = useAdminContext();
  return <BlocklistContent key={scope} />;
}
function BlocklistContent() {
  const { scopedPath, scopeLabel, can } = useAdminContext(),
    [page, setPage] = useState(1),
    [version, setVersion] = useState(0),
    value = useRows(
      scopedPath(`/v1/admin/blocklists?page=${page}`),
      "users.view",
      version,
    );
  return (
    <PortalShell
      active="admin"
      eyebrow={scopeLabel}
      title="Restrictions & blocklist"
      description="Current and scheduled account restrictions. Open a profile to review or remove a restriction."
      actions={
        <button
          className="button button--secondary"
          onClick={() => setVersion((v) => v + 1)}
        >
          Refresh
        </button>
      }
    >
      {!can("users.view") ? (
        <section className="state-panel">
          Your permissions do not include this list.
        </section>
      ) : (
        <Records value={value} retry={() => setVersion((v) => v + 1)}>
          {(data) => (
            <>
              <p className="scope-caption">
                {data.total?.toLocaleString()} restrictions · {scopeLabel}
              </p>
              <div className="table-scroll">
                <table className="operational-table">
                  <thead>
                    <tr>
                      <th>Account</th>
                      <th>Restriction</th>
                      <th>Reason</th>
                      <th>Starts</th>
                      <th>Ends</th>
                      <th>Review</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((row) => (
                      <tr key={String(row.id)}>
                        <td>
                          <strong>{row.display_name || row.email}</strong>
                          <small className="record-meta">
                            {row.username && `@${row.username}`} · {row.email}
                          </small>
                        </td>
                        <td>
                          {row.kind}
                          {Date.parse(String(row.starts_at)) > Date.now() && (
                            <small className="record-meta">Scheduled</small>
                          )}
                        </td>
                        <td>{row.reason}</td>
                        <td>{date(row.starts_at)}</td>
                        <td>
                          {row.ends_at ? date(row.ends_at) : "Until removed"}
                        </td>
                        <td>
                          <Link
                            className="text-link"
                            href={`/admin/users/${row.user_id}`}
                          >
                            Inspect account
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!data.rows.length && (
                  <p className="table-empty">
                    No active or scheduled restrictions in this scope.
                  </p>
                )}
              </div>
              <div className="workspace-pagination">
                <span>Page {page}</span>
                <button
                  className="button button--secondary"
                  disabled={page === 1}
                  onClick={() => setPage((v) => v - 1)}
                >
                  Previous
                </button>
                <button
                  className="button button--secondary"
                  disabled={page * 50 >= (data.total ?? 0)}
                  onClick={() => setPage((v) => v + 1)}
                >
                  Next
                </button>
              </div>
            </>
          )}
        </Records>
      )}
    </PortalShell>
  );
}
export function ManagedPublishersWorkspace() {
  const { scope } = useAdminContext();
  return <PublishersContent key={scope} />;
}
function PublishersContent() {
  const { scope, access, scopeLabel, scopedPath, can } = useAdminContext(),
    { user } = usePortalAuth(),
    [version, setVersion] = useState(0),
    [id, setId] = useState(""),
    [university, setUniversity] = useState(
      scope || access?.universities?.[0]?.id || "",
    ),
    [global, setGlobal] = useState(false),
    [active, setActive] = useState(true),
    [limit, setLimit] = useState(4),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const value = useRows(
      scopedPath("/v1/admin/managed-publishers"),
      "notifications.manage",
      version,
    ),
    canGlobal = Boolean(
      user?.operatorRoles.includes("PLATFORM_ADMIN") && access?.allUniversities,
    );
  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setNotice("");
    try {
      await portalApi(`/v1/admin/managed-publishers/${id}`, {
        method: "PUT",
        body: JSON.stringify({
          universityId: university,
          allUniversities: global,
          active,
          dailyLimit: limit,
          reason,
        }),
      });
      setVersion((v) => v + 1);
      setNotice(
        "Publisher policy saved and audited. It applies when the account publishes its next post.",
      );
      setReason("");
    } catch (e) {
      setNotice(
        e instanceof Error ? e.message : "Publisher policy could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <PortalShell
      active="admin"
      eyebrow={scopeLabel}
      title="Publisher notifications"
      description="Assign an account to send campus or platform updates when it publishes. Each recipient can mute newsletter push."
      actions={
        <button
          className="button button--secondary"
          onClick={() => setVersion((v) => v + 1)}
        >
          Refresh
        </button>
      }
    >
      {!can("notifications.manage") ? (
        <section className="state-panel">
          Your permissions do not include publisher policies.
        </section>
      ) : (
        <>
          {notice && (
            <p role="status" className="workspace-notice">
              {notice}
            </p>
          )}
          <Records value={value} retry={() => setVersion((v) => v + 1)}>
            {(data) => (
              <div className="table-scroll">
                <table className="operational-table">
                  <thead>
                    <tr>
                      <th>Publisher</th>
                      <th>Audience</th>
                      <th>State</th>
                      <th>Today</th>
                      <th>Updated</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((row) => (
                      <tr key={String(row.user_id)}>
                        <td>
                          <strong>{row.display_name || row.email}</strong>
                          <small className="record-meta">
                            @{row.username} · {row.email}
                          </small>
                        </td>
                        <td>
                          {row.all_universities
                            ? "All universities"
                            : (access?.universities?.find(
                                (u) => u.id === row.institution_id,
                              )?.name ?? "Campus")}
                        </td>
                        <td>{row.active ? "Active" : "Paused"}</td>
                        <td>
                          {row.alerts_today} / {row.daily_limit}
                        </td>
                        <td>{date(row.updated_at)}</td>
                        <td>
                          <button
                            className="text-button"
                            disabled={busy}
                            onClick={() => {
                              setId(String(row.user_id));
                              setUniversity(String(row.institution_id));
                              setGlobal(Boolean(row.all_universities));
                              setActive(Boolean(row.active));
                              setLimit(Number(row.daily_limit));
                              setReason("");
                            }}
                          >
                            Edit policy
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!data.rows.length && (
                  <p className="table-empty">
                    No accounts have been assigned in this scope.
                  </p>
                )}
              </div>
            )}
          </Records>
          {value?.data?.ready && (
            <section className="panel">
              <h2>{id ? "Review publisher policy" : "Assign a publisher"}</h2>
              <form className="form-stack" onSubmit={save}>
                <fieldset disabled={busy}>
                  <legend>Account and audience</legend>
                  <label>
                    Account ID
                    <input
                      required
                      value={id}
                      onChange={(e) => setId(e.target.value.trim())}
                      pattern="[a-fA-F0-9-]{36}"
                      placeholder="Copy the account ID from its profile URL"
                    />
                  </label>
                  {can("users.view") && (
                    <Link className="text-link" href="/admin/workspaces/users">
                      Find an account
                    </Link>
                  )}
                  <label>
                    Account’s university
                    <select
                      required
                      value={university}
                      onChange={(e) => setUniversity(e.target.value)}
                    >
                      <option value="">Choose university</option>
                      {access?.universities?.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {canGlobal && (
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        checked={global}
                        onChange={(e) => setGlobal(e.target.checked)}
                      />
                      Notify all universities for public posts
                    </label>
                  )}
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={active}
                      onChange={(e) => setActive(e.target.checked)}
                    />
                    Policy active
                  </label>
                  <label>
                    Maximum post alerts per day
                    <input
                      required
                      type="number"
                      min={1}
                      max={10}
                      value={limit}
                      onChange={(e) => setLimit(Number(e.target.value))}
                    />
                  </label>
                  <p className="field-help">
                    Daily limits reset at midnight in West Africa Time. Ordinary
                    explicit subscribers still receive posts when the broadcast
                    limit is reached. Changing a display name never grants this
                    policy.
                  </p>
                  <label>
                    Reason for this assignment or change
                    <textarea
                      required
                      minLength={10}
                      maxLength={1000}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </label>
                </fieldset>
                <button
                  className="button button--primary"
                  disabled={busy || !id || !university}
                >
                  {busy ? "Saving policy…" : "Save reviewed policy"}
                </button>
              </form>
            </section>
          )}
        </>
      )}
    </PortalShell>
  );
}
