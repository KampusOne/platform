"use client";

import { useMemo, useState } from "react";

import { deploymentMap, requirementRegister, roadmap, type DeliveryStatus } from "@/lib/roadmap";

const statusCopy: Record<DeliveryStatus, string> = {
  complete: "Complete",
  building: "Building",
  blocked: "Needs input",
  planned: "Planned",
};

const filters: Array<{ key: "all" | DeliveryStatus; label: string }> = [
  { key: "all", label: "All phases" },
  { key: "building", label: "Building now" },
  { key: "blocked", label: "Needs input" },
  { key: "complete", label: "Complete" },
  { key: "planned", label: "Planned" },
];

export function DeliveryTracker() {
  const [filter, setFilter] = useState<(typeof filters)[number]["key"]>("all");
  const visible = useMemo(() => filter === "all" ? roadmap : roadmap.filter((phase) => phase.status === filter || phase.tasks.some((task) => task.status === filter)), [filter]);
  const completedTasks = roadmap.flatMap((phase) => phase.tasks).filter((task) => task.status === "complete").length;
  const totalTasks = roadmap.flatMap((phase) => phase.tasks).length;

  return (
    <>
      <section className="tracker-summary" id="roadmap" aria-label="Delivery summary">
        <div className="tracker-summary__lead">
          <span>Current build focus</span>
          <strong>Phase 01 · Student entry and identity</strong>
          <p>Last updated 10 September 2026 · evidence is committed with each phase.</p>
        </div>
        <div><span>Phase 00</span><strong>Complete</strong><small>Foundation verified</small></div>
        <div><span>Task evidence</span><strong>{completedTasks}/{totalTasks}</strong><small>completed across roadmap</small></div>
        <div><span>Next input</span><strong>Catalogue + SMTP</strong><small>required before Phase 01 closes</small></div>
      </section>

      <section className="work-section tracker-section">
        <div className="section-heading section-heading--tracker">
          <div>
            <p className="section-kicker">Build roadmap</p>
            <h2>Done, building, blocked and next</h2>
          </div>
          <div className="tracker-filters" aria-label="Filter roadmap">
            {filters.map((item) => (
              <button className="tracker-filter" aria-pressed={filter === item.key} key={item.key} onClick={() => setFilter(item.key)} type="button">{item.label}</button>
            ))}
          </div>
        </div>

        <div className="phase-list">
          {visible.map((phase) => (
            <details className="phase" key={phase.id} open={phase.status === "building" || phase.status === "blocked"}>
              <summary>
                <span className="phase__number">{phase.number}</span>
                <span className="phase__title"><strong>{phase.title}</strong><small>{phase.objective}</small></span>
                <span className={`delivery-status delivery-status--${phase.status}`}>{statusCopy[phase.status]}</span>
                <span className="phase__progress" aria-label={`${phase.progress} percent complete`}><i style={{ width: `${phase.progress}%` }} /></span>
                <span className="phase__percent">{phase.progress}%</span>
                <span className="phase__chevron" aria-hidden="true">⌄</span>
              </summary>
              <div className="phase__body">
                <div className="task-list">
                  {phase.tasks.map((task) => (
                    <div className="tracker-task" key={task.title}>
                      <span className={`task-mark task-mark--${task.status}`} aria-hidden="true">{task.status === "complete" ? "✓" : task.status === "building" ? "→" : task.status === "blocked" ? "!" : "·"}</span>
                      <div><strong>{task.title}</strong><p>{task.detail}</p>{task.evidence ? <small>Evidence · {task.evidence}</small> : null}</div>
                      <span className={`delivery-status delivery-status--${task.status}`}>{statusCopy[task.status]}</span>
                    </div>
                  ))}
                </div>
                <aside className="phase-note">
                  <p className="section-kicker">Build note</p>
                  <p>{phase.note}</p>
                  <p className="section-kicker phase-note__requirement-title">Requirements</p>
                  {phase.requirements.length ? <ul>{phase.requirements.map((requirement) => <li key={requirement}>{requirement}</li>)}</ul> : <p className="phase-note__clear">No user input needed for this phase.</p>}
                </aside>
              </div>
            </details>
          ))}
        </div>
      </section>

      <section className="work-section" id="requirements">
        <div className="section-heading">
          <div><p className="section-kicker">Requirement register</p><h2>What I need from you—and when</h2></div>
          <span className="data-label">Never paste secrets into source code</span>
        </div>
        <div className="requirement-grid">
          {requirementRegister.map((register) => (
            <article className="requirement-card" key={register.group}>
              <span className={`delivery-status delivery-status--${register.status}`}>{statusCopy[register.status]}</span>
              <h3>{register.group}</h3>
              <ul>{register.items.map((item) => <li key={item}>{item}</li>)}</ul>
            </article>
          ))}
        </div>
      </section>

      <section className="work-section" id="architecture">
        <div className="section-heading">
          <div><p className="section-kicker">Deployment architecture</p><h2>Separate URLs, explicit trust boundaries</h2></div>
          <span className="data-label">Cloudflare-first backend</span>
        </div>
        <div className="deployment-table" role="table" aria-label="KampusOne deployment map">
          <div className="deployment-row deployment-row--head" role="row"><span>Surface</span><span>Production target</span><span>Runtime</span><span>Security boundary</span></div>
          {deploymentMap.map((item) => <div className="deployment-row" role="row" key={item.surface}><strong>{item.surface}</strong><code>{item.target}</code><span>{item.runtime}</span><span>{item.boundary}</span></div>)}
        </div>
      </section>

      <section className="tracker-opinion" id="notes">
        <div><p className="section-kicker section-kicker--light">Builder opinion</p><h2>Premium starts with trust and daily usefulness.</h2></div>
        <p>The right order is identity → academic utility → controlled operations → community and commerce. Building payments, NIN automation or a rider network before tenant security, human review and a reliable daily student experience would create operational risk, not a finished product.</p>
      </section>
    </>
  );
}
