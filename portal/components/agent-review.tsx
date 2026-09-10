"use client";

import { useState } from "react";

type Decision = "pending" | "needs_information" | "verified";

const sampleApplications = [
  { id: "K1-AG-0142", name: "Efe Osagie", initials: "EO", type: "Student agent", department: "Computer Engineering", level: "400", submitted: "Today · 08:14", decision: "pending" as Decision, risk: "Manual check" },
  { id: "K1-AG-0141", name: "Amaka Nwosu", initials: "AN", type: "Event support", department: "Mass Communication", level: "300", submitted: "Yesterday · 16:38", decision: "needs_information" as Decision, risk: "More evidence" },
  { id: "K1-AG-0139", name: "David Imade", initials: "DI", type: "Campus support", department: "Economics", level: "500", submitted: "8 Sep · 11:02", decision: "verified" as Decision, risk: "Clear" },
];

export function AgentReview() {
  const [applications, setApplications] = useState(sampleApplications);
  const [selectedId, setSelectedId] = useState(sampleApplications[0]?.id ?? "");
  const [filter, setFilter] = useState<"all" | Decision>("all");
  const [audit, setAudit] = useState("No review decision made in this session.");
  const selected = applications.find((item) => item.id === selectedId) ?? applications[0];
  const visible = filter === "all"
    ? applications
    : applications.filter((item) => item.decision === filter);

  function decide(decision: Decision, label: string) {
    if (!selected) return;
    setApplications((current) => current.map((item) => item.id === selected.id ? { ...item, decision, risk: decision === "verified" ? "Clear" : decision === "needs_information" ? "More evidence" : "Manual check" } : item));
    setAudit(`${label} recorded for ${selected.id} in this sample session. The live endpoint also records actor, reason, request ID and timestamp.`);
  }

  return (
    <section className="review-workspace" id="applications">
      <div className="review-list">
        <div className="review-list__header"><div><p className="section-kicker">Agent applications</p><h2>Review queue</h2></div><span className="sample-badge">Sample records</span></div>
        <div className="review-filters">
          {(["all", "pending", "needs_information", "verified"] as const).map((item) => <button aria-pressed={filter === item} key={item} onClick={() => setFilter(item)} type="button">{item === "all" ? "All" : item.replace("_", " ")}</button>)}
        </div>
        <div className="application-list">
          {visible.map((item) => <button className={item.id === selected?.id ? "selected" : ""} key={item.id} onClick={() => setSelectedId(item.id)} type="button"><span className="applicant-avatar">{item.initials}</span><span className="applicant-copy"><strong>{item.name}</strong><small>{item.type} · {item.department}</small><em>{item.submitted}</em></span><DecisionBadge decision={item.decision} /></button>)}
        </div>
      </div>

      {selected ? (
        <div className="review-detail" id="verification">
          <div className="review-detail__header"><div><span>{selected.id}</span><h2>{selected.name}</h2><p>{selected.type} · {selected.department} · {selected.level} level</p></div><DecisionBadge decision={selected.decision} /></div>
          <div className="masked-identity"><span>Identity reference</span><strong>Provider case ·••• 83K2</strong><small>No plaintext NIN shown or stored in this interface</small></div>
          <div className="verification-grid">
            <Check label="File integrity" state="clear" value="Readable · no structural errors" />
            <Check label="Name comparison" state="clear" value="High similarity · 0.94" />
            <Check label="School evidence" state="pending" value="Issuer source not connected" />
            <Check label="Government identity" state="pending" value="Licensed provider required" />
          </div>
          <div className="document-preview">
            <div className="document-sheet"><span>K1</span><div><i /><i /><i /><i /></div><small>Private document preview</small></div>
            <div><p className="section-kicker">Student identity card</p><h3>Evidence is readable</h3><p>Extracted name is consistent with the application. The issuer cannot be independently confirmed yet, so the case remains pending—not failed.</p><button type="button">Open redacted document</button></div>
          </div>
          <div className="decision-panel">
            <div><p className="section-kicker">Manual decision</p><h3>Choose an outcome with a reason</h3><p>“Verified” activates only after the server confirms your role and writes the audit event.</p></div>
            <textarea aria-label="Review reason" defaultValue="Evidence is consistent; issuer confirmation remains a manual responsibility." />
            <div className="decision-actions"><button className="button-secondary" onClick={() => decide("pending", "Pending manual review")} type="button">Keep pending</button><button className="button-attention" onClick={() => decide("needs_information", "More information requested")} type="button">Request more</button><button onClick={() => decide("verified", "Manual verification")} type="button">Verify agent</button></div>
          </div>
          <div className="audit-note" id="audit"><strong>Latest local audit note</strong><p>{audit}</p></div>
        </div>
      ) : <div className="review-detail"><p>No application matches this filter.</p></div>}
    </section>
  );
}

function DecisionBadge({ decision }: { decision: Decision }) {
  return <span className={`decision-badge decision-badge--${decision}`}>{decision === "needs_information" ? "Needs info" : decision}</span>;
}

function Check({ label, state, value }: { label: string; state: "clear" | "pending"; value: string }) {
  return <div className={`verification-check verification-check--${state}`}><span>{state === "clear" ? "✓" : "…"}</span><div><strong>{label}</strong><small>{value}</small></div></div>;
}
