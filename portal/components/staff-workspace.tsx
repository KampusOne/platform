"use client";
import { useEffect, useState, type FormEvent } from "react";
import { portalApi } from "@/lib/api";
import { useAdminContext } from "./admin-context";
import { usePortalAuth } from "./auth-provider";
import { PortalShell } from "./portal-shell";
type Staff = {
  user_id: string;
  email: string;
  status: string;
  permissions: string[];
  university_ids: string[];
  all_universities: boolean;
  updated_at?: string;
};
type StaffList = {
  staff: Staff[];
  permissions: string[];
  ready?: boolean;
  message?: string;
};
export function StaffWorkspace() {
  const { access, can } = useAdminContext();
  const { user } = usePortalAuth();
  const canProvision = Boolean(user?.operatorRoles.includes("PLATFORM_ADMIN"));
  const [data, setData] = useState<StaffList | null>(null);
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
  const [mode, setMode] = useState<"create" | "existing">("create");
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [displayName, setDisplayName] = useState("");
  const [requestId, setRequestId] = useState("");
  const [created, setCreated] = useState<{
    email: string;
    password: string;
  } | null>(null);
  useEffect(() => {
    if (!created) return;
    const hide = () => setCreated(null),
      hidden = () => {
        if (document.hidden) hide();
      };
    const timer = window.setTimeout(hide, 120000);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [created]);
  useEffect(() => {
    if (!can("staff.manage") || !canProvision) return;
    let active = true;
    void portalApi<StaffList>("/v1/admin/staff")
      .then((result) => {
        if (active) {
          setData(result);
          setError("");
        }
      })
      .catch((caught: unknown) => {
        if (active)
          setError(
            caught instanceof Error
              ? caught.message
              : "Staff accounts could not be loaded.",
          );
      });
    return () => {
      active = false;
    };
  }, [can, canProvision, version]);
  function edit(staff: Staff) {
    setMode("existing");
    setCreated(null);
    setPassword("");
    setUserId(staff.user_id);
    setPermissions(staff.permissions ?? []);
    setUniversityIds(staff.university_ids ?? []);
    setAllUniversities(staff.all_universities);
    setStatus(staff.status);
    setReason("");
    setReview(false);
    setRequestId("");
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!review) {
      setRequestId(crypto.randomUUID());
      setReview(true);
      return;
    }
    setBusy(true);
    setNotice("");
    try {
      if (mode === "create") {
        await portalApi("/v1/admin/staff", {
          method: "POST",
          body: JSON.stringify({
            requestId,
            email,
            password,
            displayName,
            permissions,
            universityIds,
            allUniversities,
            reason,
          }),
        });
        setCreated({ email, password });
        setPassword("");
        setEmail("");
        setDisplayName("");
        setNotice(
          "Staff account created. Share the login privately with the intended staff member.",
        );
      } else {
        await portalApi(`/v1/admin/staff/${userId}`, {
          method: "PUT",
          body: JSON.stringify({
            permissions,
            universityIds,
            allUniversities,
            status,
            reason,
          }),
        });
        setNotice("Staff access updated and audited.");
      }
      setVersion((value) => value + 1);
      setReview(false);
      setRequestId("");
    } catch (caught) {
      setNotice(
        caught instanceof Error
          ? caught.message
          : "Staff access could not be updated.",
      );
    } finally {
      setBusy(false);
    }
  }
  const grouped = (data?.permissions ?? []).reduce<Record<string, string[]>>(
    (groups, permission) => {
      const key = permission.split(".")[0]!;
      (groups[key] ??= []).push(permission);
      return groups;
    },
    {},
  );
  return (
    <PortalShell
      active="admin"
      eyebrow="Provisioned access"
      title="Staff & permissions"
      description="Grant only the actions and universities a staff member needs."
    >
      {notice && (
        <p className="workspace-notice" role="status">
          {notice}
        </p>
      )}
      {created && (
        <section className="panel private-evidence">
          <h2>New staff login</h2>
          <dl className="detail-list">
            <div>
              <dt>Email</dt>
              <dd>{created.email}</dd>
            </div>
            <div>
              <dt>Password</dt>
              <dd className="identity-reveal">{created.password}</dd>
            </div>
          </dl>
          <p className="field-help">
            This panel hides after two minutes or when the tab is hidden. The
            account can sign in with this email and password; permissions remain
            separate.
          </p>
          <button
            type="button"
            className="button button--secondary"
            onClick={() => setCreated(null)}
          >
            Hide credentials
          </button>
        </section>
      )}
      {!canProvision ? (
        <section className="state-panel">
          A platform administrator manages staff accounts and access.
        </section>
      ) : error ? (
        <section className="state-panel state-panel--error">
          <p>{error}</p>
          <button
            className="button button--secondary"
            onClick={() => setVersion((value) => value + 1)}
          >
            Try again
          </button>
        </section>
      ) : !data ? (
        <div className="table-skeleton" aria-label="Loading staff">
          <div />
          <div />
          <div />
        </div>
      ) : data.ready === false ? (
        <section className="state-panel" role="status">
          {data.message}
        </section>
      ) : (
        <>
          <div className="table-scroll">
            <table className="operational-table">
              <thead>
                <tr>
                  <th>Staff account</th>
                  <th>Status</th>
                  <th>Permissions</th>
                  <th>University scope</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {data.staff.map((staff) => (
                  <tr key={staff.user_id}>
                    <td>{staff.email}</td>
                    <td>{staff.status}</td>
                    <td>{staff.permissions.length} actions</td>
                    <td>
                      {staff.all_universities
                        ? "All universities"
                        : `${staff.university_ids.length} universities`}
                    </td>
                    <td>
                      <button
                        className="text-button"
                        disabled={!canProvision || staff.user_id === user?.id}
                        onClick={() => edit(staff)}
                      >
                        Manage access
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.staff.length && (
              <p className="table-empty">
                No custom staff grants. Existing provisioned operator roles
                remain active.
              </p>
            )}
          </div>
          {canProvision ? (
            <form className="panel form-stack" onSubmit={save}>
              <h2>
                {review
                  ? "Review staff access"
                  : mode === "create"
                    ? "Create a staff account"
                    : "Update an existing account"}
              </h2>
              {!review && (
                <div className="button-row">
                  <button
                    type="button"
                    className={`button ${mode === "create" ? "button--primary" : "button--secondary"}`}
                    onClick={() => {
                      setMode("create");
                      setCreated(null);
                    }}
                  >
                    New email & password
                  </button>
                  <button
                    type="button"
                    className={`button ${mode === "existing" ? "button--primary" : "button--secondary"}`}
                    onClick={() => {
                      setMode("existing");
                      setPassword("");
                      setCreated(null);
                    }}
                  >
                    Existing account access
                  </button>
                </div>
              )}
              {mode === "create" ? (
                <>
                  <label>
                    Staff member’s name
                    <input
                      value={displayName}
                      required
                      minLength={2}
                      maxLength={120}
                      readOnly={review || busy}
                      autoComplete="off"
                      onChange={(e) => setDisplayName(e.target.value)}
                    />
                  </label>
                  <label>
                    Email for this account
                    <input
                      type="email"
                      value={email}
                      required
                      maxLength={254}
                      readOnly={review || busy}
                      autoComplete="off"
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </label>
                  <label>
                    Create password
                    <input
                      type="password"
                      value={password}
                      required
                      minLength={12}
                      maxLength={128}
                      readOnly={review || busy}
                      autoComplete="new-password"
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </label>
                  <p className="field-help">
                    Use an email assigned to the intended staff member. An
                    existing account is kept intact. No email or password is
                    sent automatically.
                  </p>
                </>
              ) : (
                <>
                  <label>
                    Verified KampusOne account ID
                    <input
                      required
                      pattern="[0-9a-fA-F-]{36}"
                      value={userId}
                      readOnly={review || busy}
                      onChange={(event) => setUserId(event.target.value)}
                      placeholder="Account UUID from the user directory"
                    />
                  </label>
                  <label>
                    Account access
                    <select
                      value={status}
                      disabled={review || busy}
                      onChange={(event) => setStatus(event.target.value)}
                    >
                      <option value="ACTIVE">Active</option>
                      <option value="SUSPENDED">Suspended</option>
                    </select>
                  </label>
                </>
              )}
              <div className="permission-matrix">
                {Object.entries(grouped).map(([module, values]) => (
                  <fieldset key={module} disabled={review}>
                    <legend>{module}</legend>
                    {values.map((permission) => (
                      <label className="checkbox" key={permission}>
                        <input
                          type="checkbox"
                          checked={permissions.includes(permission)}
                          onChange={(event) =>
                            setPermissions(
                              event.target.checked
                                ? [...permissions, permission]
                                : permissions.filter(
                                    (item) => item !== permission,
                                  ),
                            )
                          }
                        />
                        {permission.split(".").slice(1).join(" ")}
                      </label>
                    ))}
                  </fieldset>
                ))}
              </div>
              <fieldset disabled={review}>
                <legend>University scope</legend>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={allUniversities}
                    onChange={(event) =>
                      setAllUniversities(event.target.checked)
                    }
                  />
                  All universities
                </label>
                {!allUniversities && (
                  <div className="scope-checkboxes">
                    {access?.universities?.map((university) => (
                      <label className="checkbox" key={university.id}>
                        <input
                          type="checkbox"
                          checked={universityIds.includes(university.id)}
                          onChange={(event) =>
                            setUniversityIds(
                              event.target.checked
                                ? [...universityIds, university.id]
                                : universityIds.filter(
                                    (id) => id !== university.id,
                                  ),
                            )
                          }
                        />
                        {university.name}
                      </label>
                    ))}
                  </div>
                )}
              </fieldset>
              <label>
                Reason for this change
                <textarea
                  required
                  minLength={10}
                  maxLength={1000}
                  value={reason}
                  readOnly={review}
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
              {review && (
                <p className="workspace-notice">
                  You are granting {permissions.length} actions to{" "}
                  {mode === "create" ? email : userId},{" "}
                  {allUniversities
                    ? "across all universities"
                    : `within ${universityIds.length} selected universities`}
                  .{" "}
                  {mode === "create"
                    ? "The new account can sign in with its assigned password."
                    : `Access will be ${status.toLowerCase()}.`}
                </p>
              )}
              <div className="form-actions">
                {review && (
                  <button
                    type="button"
                    className="button button--secondary"
                    disabled={busy}
                    onClick={() => {
                      setReview(false);
                      setRequestId("");
                    }}
                  >
                    Edit selection
                  </button>
                )}
                <button
                  className="button button--primary"
                  disabled={
                    busy ||
                    (mode === "existing" && userId === user?.id) ||
                    (!allUniversities && !universityIds.length) ||
                    (mode === "create" && !permissions.length)
                  }
                >
                  {busy
                    ? "Saving staff access…"
                    : review
                      ? mode === "create"
                        ? "Create staff account"
                        : "Confirm access change"
                      : "Review change"}
                </button>
              </div>
            </form>
          ) : (
            <p className="workspace-notice">
              Only a provisioned platform administrator can change staff access.
            </p>
          )}
        </>
      )}
    </PortalShell>
  );
}
