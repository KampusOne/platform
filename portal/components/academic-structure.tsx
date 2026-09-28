"use client";

import { useEffect, useState, type FormEvent } from "react";
import { portalApi } from "@/lib/api";
import { useAdminContext } from "./admin-context";
import { PortalShell } from "./portal-shell";

type Row = {
  id: string;
  name: string;
  faculty_id?: string;
  department_id?: string;
  code?: string;
  award?: string;
  normal_duration_years?: number;
  primary_source_url?: string;
  source_verified_at?: string;
};
type Data = { faculties: Row[]; departments: Row[]; programmes: Row[] };
type MissingRow = {
  id: string;
  kind: "FACULTY" | "DEPARTMENT" | "PROGRAMME";
  status: string;
  university_name: string;
  student_name: string;
  student_username?: string;
  student_email: string;
  faculty_name?: string | null;
  department_name?: string | null;
  programme_name?: string | null;
  source_note?: string | null;
  selected_faculty_name?: string | null;
  selected_department_name?: string | null;
  created_at: string;
  review_note?: string | null;
};
type MissingData = { rows: MissingRow[] };
type CoverageRow = {
  id: string;
  name: string;
  slug: string;
  catalogue_status: string;
  faculty_count: number;
  faculties_without_departments: number;
  department_count: number;
  departments_without_programmes: number;
  programme_count: number;
};
type CoverageData = { rows: CoverageRow[] };

export function AcademicStructure() {
  const { scope, scopedPath, can } = useAdminContext();
  const [view, setView] = useState<"catalogue" | "reports" | "coverage">("catalogue");
  return (
    <PortalShell
      active="admin"
      eyebrow="Reviewed academic data"
      title="Faculties, departments & programmes"
      description="Maintain each university’s academic structure and review student reports when something is missing."
    >
      <div className="workspace-toolbar">
        <button
          className={`button button--${view === "catalogue" ? "primary" : "secondary"}`}
          onClick={() => setView("catalogue")}
        >
          Catalogue
        </button>
        <button
          className={`button button--${view === "reports" ? "primary" : "secondary"}`}
          onClick={() => setView("reports")}
        >
          Missing items
        </button>
        <button
          className={`button button--${view === "coverage" ? "primary" : "secondary"}`}
          onClick={() => setView("coverage")}
        >
          Coverage
        </button>
      </div>
      {view === "catalogue" ? (
        <CatalogueEditor
          key={scope}
          scope={scope}
          path={scopedPath("/v1/admin/academic/catalogue")}
          editable={can("academic.manage")}
        />
      ) : view === "reports" ? (
        <MissingAcademicQueue
          key={scope}
          path={scopedPath("/v1/admin/academic/missing")}
          editable={can("academic.manage")}
        />
      ) : (
        <AcademicCoverage key={scope} path={scopedPath("/v1/admin/academic/coverage")} />
      )}
    </PortalShell>
  );
}

function CatalogueEditor({
  scope,
  path,
  editable,
}: {
  scope: string;
  path: string;
  editable: boolean;
}) {
  const [data, setData] = useState<Data>();
  const [kind, setKind] = useState<"faculty" | "department" | "programme">("faculty");
  const [editing, setEditing] = useState<Row | null>(null);
  const [key, setKey] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    void portalApi<Data>(path)
      .then((result) => {
        if (active) {
          setData(result);
          setError("");
        }
      })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : "Could not load academic records.");
      });
    return () => {
      active = false;
    };
  }, [path, version]);

  const rows =
    data?.[kind === "faculty" ? "faculties" : kind === "department" ? "departments" : "programmes"] ?? [];

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!scope || busy) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const text = (name: string) => String(values.get(name) ?? "").trim();
    const requestId = editing?.id || key || crypto.randomUUID();
    setKey(requestId);
    setBusy(true);
    setError("");
    try {
      await portalApi("/v1/admin/academic/catalogue", {
        method: "POST",
        body: JSON.stringify({
          id: requestId,
          universityId: scope,
          kind,
          parentId: text("parent") || undefined,
          name: text("name"),
          code: text("code"),
          award: text("award"),
          durationYears: text("duration") ? Number(text("duration")) : null,
          sourceUrl: text("source"),
          sourceVerified: values.has("verified"),
          reason: text("reason"),
        }),
      });
      setEditing(null);
      setKey("");
      form.reset();
      setVersion((value) => value + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save this academic record.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {error && <p role="alert">{error}</p>}
      <div className="workspace-toolbar">
        {(["faculty", "department", "programme"] as const).map((item) => (
          <button
            key={item}
            className={`button button--${kind === item ? "primary" : "secondary"}`}
            onClick={() => {
              setKind(item);
              setEditing(null);
              setKey("");
            }}
          >
            {item === "faculty" ? "Faculties" : item === "department" ? "Departments" : "Programmes"}
          </button>
        ))}
        <input
          aria-label="Search academic records"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search names"
        />
      </div>
      <div className="table-scroll">
        <table className="operational-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Award / duration</th>
              <th>Source</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows
              .filter((row) => row.name.toLowerCase().includes(search.toLowerCase()))
              .map((row) => (
                <tr key={row.id}>
                  <td>{row.name}</td>
                  <td>
                    {row.award || "—"}
                    {row.normal_duration_years ? ` · ${row.normal_duration_years} years` : ""}
                  </td>
                  <td>
                    {row.primary_source_url ? (
                      <a href={row.primary_source_url} target="_blank" rel="noopener noreferrer">
                        Verified source
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>{editable && scope && <button onClick={() => setEditing(row)}>Edit</button>}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {editable && scope ? (
        <form className="form-stack panel" onSubmit={save} key={kind + (editing?.id ?? "new")}>
          <h2>
            {editing ? "Edit" : "Add"} {kind}
          </h2>
          <label>
            Name
            <input required name="name" defaultValue={editing?.name} minLength={2} maxLength={160} />
          </label>
          {kind !== "faculty" && (
            <label>
              {kind === "department" ? "Faculty" : "Department"}
              <select required name="parent" defaultValue={editing?.faculty_id ?? editing?.department_id ?? ""}>
                <option value="">Choose</option>
                {data?.[kind === "department" ? "faculties" : "departments"].map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {kind === "programme" && (
            <>
              <label>
                Programme code
                <input name="code" defaultValue={editing?.code} maxLength={24} />
              </label>
              <label>
                Degree award
                <input name="award" placeholder="B.Eng" defaultValue={editing?.award} maxLength={30} />
              </label>
              <label>
                Normal duration (years)
                <input
                  type="number"
                  name="duration"
                  min={1}
                  max={10}
                  step={0.5}
                  defaultValue={editing?.normal_duration_years}
                />
              </label>
            </>
          )}
          <label>
            Primary source
            <input
              required
              name="source"
              type="url"
              defaultValue={editing?.primary_source_url}
              placeholder="https://…"
            />
          </label>
          <label>
            Reason
            <textarea required name="reason" minLength={10} maxLength={1000} />
          </label>
          <label>
            <input required type="checkbox" name="verified" />I checked this against the university’s source.
          </label>
          <button className="button button--primary" disabled={busy}>
            {busy ? "Saving…" : "Save reviewed record"}
          </button>
          {editing && (
            <button type="button" onClick={() => setEditing(null)}>
              Cancel
            </button>
          )}
        </form>
      ) : (
        <p>Choose a university above to edit its academic structure.</p>
      )}
    </>
  );
}

function MissingAcademicQueue({ path, editable }: { path: string; editable: boolean }) {
  const [status, setStatus] = useState("PENDING");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [data, setData] = useState<MissingData>();
  const [selected, setSelected] = useState<MissingRow | null>(null);
  const [decision, setDecision] = useState<"APPROVED" | "NEEDS_CORRECTION" | "REJECTED">("APPROVED");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);

  const requestPath = `${path}${path.includes("?") ? "&" : "?"}status=${status}&q=${encodeURIComponent(search)}`;

  useEffect(() => {
    let active = true;
    void portalApi<MissingData>(requestPath)
      .then((result) => {
        if (active) {
          setData(result);
          setError("");
        }
      })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : "Could not load student reports.");
      });
    return () => {
      active = false;
    };
  }, [requestPath, version]);

  async function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || busy) return;
    const values = new FormData(event.currentTarget);
    const text = (name: string) => String(values.get(name) ?? "").trim();
    setBusy(true);
    setNotice("");
    setError("");
    try {
      await portalApi(`/v1/admin/academic/missing/${selected.id}/review`, {
        method: "POST",
        body: JSON.stringify({
          decision,
          reason: text("reason"),
          ...(decision === "APPROVED"
            ? {
                primarySourceUrl: text("source"),
                sourceVerified: values.has("verified"),
                facultyName: text("facultyName") || undefined,
                departmentName: text("departmentName") || undefined,
                programmeName: text("programmeName") || undefined,
                code: text("code"),
                award: text("award"),
                durationYears: text("duration") ? Number(text("duration")) : null,
              }
            : {}),
        }),
      });
      setNotice(
        decision === "APPROVED"
          ? "Approved and added to the academic catalogue. The student’s provisional profile was relinked."
          : decision === "NEEDS_CORRECTION"
            ? "Sent back for correction."
            : "Submission rejected.",
      );
      setSelected(null);
      setVersion((value) => value + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not review this submission.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className="field-help">
        Students can report a missing faculty, department or programme without being blocked during onboarding.
        Approve only after checking a current university or regulator source.
      </p>
      {notice && <p className="workspace-notice" role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
      <form
        className="workspace-toolbar"
        onSubmit={(event) => {
          event.preventDefault();
          setSearch(query);
          setSelected(null);
        }}
      >
        <label>
          Status
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setSelected(null);
            }}
          >
            <option value="PENDING">Pending</option>
            <option value="NEEDS_CORRECTION">Needs correction</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
            <option value="ALL">All</option>
          </select>
        </label>
        <label>
          Search
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="University, student or item" />
        </label>
        <button className="button button--secondary">Search</button>
      </form>
      <div className="table-scroll">
        <table className="operational-table">
          <thead>
            <tr>
              <th>Student</th>
              <th>University</th>
              <th>Missing</th>
              <th>Submitted item</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data?.rows.map((row) => (
              <tr key={row.id}>
                <td>
                  {row.student_name}
                  {row.student_username ? <><br /><small>@{row.student_username}</small></> : null}
                </td>
                <td>{row.university_name}</td>
                <td>{row.kind.toLowerCase()}</td>
                <td>
                  {row.kind === "FACULTY"
                    ? row.faculty_name
                    : row.kind === "DEPARTMENT"
                      ? `${row.selected_faculty_name ?? "Faculty"} → ${row.department_name ?? "—"}`
                      : `${row.selected_department_name ?? "Department"} → ${row.programme_name ?? "—"}`}
                </td>
                <td>{row.status}</td>
                <td>
                  {editable && ["PENDING", "NEEDS_CORRECTION"].includes(row.status) ? (
                    <button
                      className="text-button"
                      onClick={() => {
                        setSelected(row);
                        setDecision("APPROVED");
                        setNotice("");
                      }}
                    >
                      Review
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data?.rows.length && <p className="table-empty">No student-reported academic gaps match this filter.</p>}
      </div>
      {selected && (
        <form className="form-stack panel" onSubmit={review} key={selected.id}>
          <div className="workspace-toolbar">
            <h2>Review missing {selected.kind.toLowerCase()}</h2>
            <button type="button" className="text-button" onClick={() => setSelected(null)}>
              Close
            </button>
          </div>
          <p>
            {selected.university_name} · {selected.student_name}
          </p>
          {selected.selected_faculty_name && <p>Selected faculty: {selected.selected_faculty_name}</p>}
          {selected.selected_department_name && <p>Selected department: {selected.selected_department_name}</p>}
          {selected.source_note && <p className="field-help">Student note: {selected.source_note}</p>}
          <label>
            Decision
            <select
              value={decision}
              onChange={(event) =>
                setDecision(event.target.value as "APPROVED" | "NEEDS_CORRECTION" | "REJECTED")
              }
            >
              <option value="APPROVED">Approve and add to catalogue</option>
              <option value="NEEDS_CORRECTION">Needs correction</option>
              <option value="REJECTED">Reject</option>
            </select>
          </label>
          {decision === "APPROVED" && (
            <>
              {selected.kind === "FACULTY" && (
                <label>
                  Verified faculty / college
                  <input required name="facultyName" defaultValue={selected.faculty_name ?? ""} maxLength={180} />
                </label>
              )}
              {selected.kind !== "PROGRAMME" && (
                <label>
                  Verified department
                  <input required name="departmentName" defaultValue={selected.department_name ?? ""} maxLength={180} />
                </label>
              )}
              <label>
                {selected.kind === "PROGRAMME" ? "Verified programme" : "Programme (optional)"}
                <input
                  required={selected.kind === "PROGRAMME"}
                  name="programmeName"
                  defaultValue={selected.programme_name ?? ""}
                  maxLength={180}
                />
              </label>
              <label>
                Programme code
                <input name="code" maxLength={24} />
              </label>
              <label>
                Degree award
                <input name="award" placeholder="B.Sc, B.Eng, LL.B…" maxLength={30} />
              </label>
              <label>
                Normal duration
                <input name="duration" type="number" min={1} max={10} step={0.5} />
              </label>
              <label>
                Primary source
                <input required name="source" type="url" placeholder="https://university.edu.ng/…" />
              </label>
              <label>
                <input required type="checkbox" name="verified" />I verified this against the current university or regulator source.
              </label>
            </>
          )}
          <label>
            Review note
            <textarea required name="reason" minLength={10} maxLength={2000} />
          </label>
          <button className="button button--primary" disabled={busy}>
            {busy ? "Saving…" : decision === "APPROVED" ? "Approve & add" : "Save review"}
          </button>
        </form>
      )}
    </>
  );
}


function AcademicCoverage({ path }: { path: string }) {
  const [data, setData] = useState<CoverageData>();
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void portalApi<CoverageData>(path)
      .then((result) => {
        if (active) {
          setData(result);
          setError("");
        }
      })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : "Could not load academic coverage.");
      });
    return () => {
      active = false;
    };
  }, [path]);

  const rows = (data?.rows ?? []).filter((row) =>
    row.name.toLowerCase().includes(query.toLowerCase()),
  );
  const complete = rows.filter(
    (row) =>
      row.faculty_count > 0 &&
      row.faculties_without_departments === 0 &&
      row.department_count > 0 &&
      row.departments_without_programmes === 0 &&
      row.programme_count > 0,
  ).length;

  return (
    <>
      <p className="field-help">
        A university is not treated as structurally complete until it has faculties/schools,
        departments and programmes. This view exposes the remaining research queue.
      </p>
      {error && <p role="alert">{error}</p>}
      <div className="workspace-toolbar">
        <strong>
          {complete} / {rows.length} shown universities have all three catalogue levels
        </strong>
        <input
          aria-label="Search university coverage"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search university"
        />
      </div>
      <div className="table-scroll">
        <table className="operational-table">
          <thead>
            <tr>
              <th>University</th>
              <th>Faculties</th>
              <th>Departments</th>
              <th>Programmes</th>
              <th>Hierarchy gaps</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const missing = [
                row.faculty_count === 0 ? "no faculties" : null,
                row.faculties_without_departments > 0
                  ? `${row.faculties_without_departments} faculties without departments`
                  : null,
                row.department_count === 0 ? "no departments" : null,
                row.departments_without_programmes > 0
                  ? `${row.departments_without_programmes} departments without programmes`
                  : null,
                row.programme_count === 0 ? "no programmes" : null,
              ].filter(Boolean);
              return (
                <tr key={row.id}>
                  <td>{row.name}</td>
                  <td>{row.faculty_count}</td>
                  <td>{row.department_count}</td>
                  <td>{row.programme_count}</td>
                  <td>{missing.length ? missing.join(" · ") : "Complete hierarchy"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
