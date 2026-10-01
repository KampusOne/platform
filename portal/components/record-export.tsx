"use client";
import { useState, type FormEvent } from "react";
import { portalApi } from "@/lib/api";
import { downloadCsv } from "@/lib/csv";
export function RecordExport({
  path,
  label = "Export CSV",
  description,
}: {
  path: string;
  label?: string;
  description: string;
}) {
  const [open, setOpen] = useState(false),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setNotice("");
    try {
      const r = await portalApi<{
        filename: string;
        columns: string[];
        rows: Record<string, unknown>[];
      }>(path, { method: "POST", body: JSON.stringify({ reason }) });
      downloadCsv(r.filename, r.columns, r.rows);
      setOpen(false);
      setReason("");
      setNotice(
        `${r.rows.length.toLocaleString()} records exported. Purpose recorded in the audit trail.`,
      );
    } catch (e) {
      setNotice(
        e instanceof Error ? e.message : "Export could not be prepared.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="record-export">
      <button
        className="button button--secondary"
        disabled={busy}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
      </button>
      {open && (
        <form className="form-stack panel" onSubmit={submit}>
          <p>{description}</p>
          <label>
            Purpose of this export
            <textarea
              required
              minLength={10}
              maxLength={1000}
              value={reason}
              disabled={busy}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <div className="form-actions">
            <button
              type="button"
              className="button button--secondary"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
            <button className="button button--primary" disabled={busy}>
              {busy ? "Preparing export…" : "Download reviewed scope"}
            </button>
          </div>
        </form>
      )}
      {notice && (
        <p role="status" className="field-help">
          {notice}
        </p>
      )}
    </div>
  );
}
