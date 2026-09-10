"use client";

import { useState } from "react";

import { buildNotes, buildPhases, requirements, type BuildStatus } from "@/lib/build-tracker";

const statusLabel: Record<BuildStatus, string> = {
  done: "Done",
  in_progress: "In progress",
  planned: "Not started",
  blocked: "Blocked",
  needs_input: "Input needed",
};

const filterOptions: Array<{ key: "all" | BuildStatus; label: string }> = [
  { key: "all", label: "All" },
  { key: "in_progress", label: "In progress" },
  { key: "needs_input", label: "Input needed" },
  { key: "blocked", label: "Blocked" },
  { key: "done", label: "Done" },
  { key: "planned", label: "Not started" },
];

export function BuildTracker() {
  const [filter, setFilter] = useState<"all" | BuildStatus>("all");
  const [openPhase, setOpenPhase] = useState("identity");
  const phases = filter === "all"
    ? buildPhases
    : buildPhases.filter(
        (phase) => phase.status === filter || phase.items.some((item) => item.status === filter),
      );

  return (
    <>
      <section className="tracker-toolbar" aria-label="Filter build tracker">
        <div>
          <p className="section-kicker">Build ledger</p>
          <h2>Everything planned, built and waiting</h2>
        </div>
        <div className="filter-row">
          {filterOptions.map((option) => <button aria-pressed={filter === option.key} className="filter-button" key={option.key} onClick={() => setFilter(option.key)} type="button">{option.label}</button>)}
        </div>
      </section>

      <div className="phase-list" id="phases">
        {phases.map((phase) => {
          const open = openPhase === phase.id;
          const done = phase.items.filter((item) => item.status === "done").length;
          return (
            <article className="phase" key={phase.id}>
              <button className="phase__header" onClick={() => setOpenPhase(open ? "" : phase.id)} type="button" aria-expanded={open}>
                <span className="phase__number">{phase.number}</span>
                <span className="phase__heading"><strong>{phase.title}</strong><small>{phase.objective}</small></span>
                <span className="phase__count">{done}/{phase.items.length} done</span>
                <Status status={phase.status} />
                <span className="phase__toggle" aria-hidden="true">{open ? "−" : "+"}</span>
              </button>
              {open ? (
                <div className="phase__body">
                  <div className="phase__gate"><span>Review gate</span><p>{phase.reviewGate}</p></div>
                  <div className="task-list">
                    {phase.items.map((item) => (
                      <div className="task-row" key={item.name}>
                        <span className={`task-mark task-mark--${item.status}`} aria-hidden="true">{item.status === "done" ? "✓" : ""}</span>
                        <span className="task-copy"><strong>{item.name}</strong><small>{item.detail}</small>{item.evidence ? <code>{item.evidence}</code> : null}</span>
                        <Status status={item.status} />
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>

      <section className="requirements-section" id="requirements">
        <div className="section-heading"><div><p className="section-kicker">Requirements & keys</p><h2>What is needed—and when</h2></div><span className="data-label">Never paste secrets into chat</span></div>
        <p className="section-intro">These rows are the handoff checklist. Add credentials only in the named encrypted dashboard; the tracker records readiness, never secret values.</p>
        <div className="requirements-table">
          {requirements.map((item) => <div className="requirement-row" key={item.name}><span className="requirement-phase">{item.phase}</span><span className="requirement-copy"><strong>{item.name}</strong><small>{item.detail}</small><code>{item.location}</code></span><Status status={item.status} /></div>)}
        </div>
      </section>

      <section className="notes-section" id="notes">
        <div className="section-heading"><div><p className="section-kicker">Decisions & opinion</p><h2>Why the build is taking this shape</h2></div></div>
        <div className="notes-grid">{buildNotes.map((note) => <article className="build-note" key={note.title}><span>{note.date}</span><h3>{note.title}</h3><p>{note.body}</p></article>)}</div>
      </section>
    </>
  );
}

function Status({ status }: { status: BuildStatus }) {
  return <span className={`build-status build-status--${status}`}><span aria-hidden="true" />{statusLabel[status]}</span>;
}
