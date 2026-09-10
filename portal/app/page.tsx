import Image from "next/image";
import Link from "next/link";

const surfaces = [
  {
    href: "/admin",
    label: "Operations",
    description: "Agent applications, verification decisions and audited campus controls.",
    marker: "01",
    host: "ops.kampusone.app",
  },
  {
    href: "/agents",
    label: "Agents",
    description: "Apply, upload evidence and track a campus-scoped agent application.",
    marker: "02",
    host: "agents.kampusone.app",
  },
  {
    href: "/engineering",
    label: "Build tracker",
    description: "Phases, evidence, requirements, blockers, decisions and build handoffs.",
    marker: "03",
    host: "build.kampusone.app",
  },
];

export default function PlatformIndex() {
  return (
    <main className="gateway">
      <header className="gateway__header">
        <Image
          src="/brand/kampusone-horizontal-ink.svg"
          width={178}
          height={43}
          priority
          alt="KampusOne"
        />
        <span className="environment-chip">Phase 1 review gateway</span>
      </header>

      <section className="gateway__intro" aria-labelledby="gateway-title">
        <p className="eyebrow">Private review gateway · Phase 1</p>
        <h1 id="gateway-title">Separate doors. One accountable platform.</h1>
        <p className="gateway__lede">
          This shared Vercel review build lets us inspect each surface before its dedicated domain is attached.
          Production navigation does not expose cross-surface workspace links.
        </p>
      </section>

      <nav className="surface-list" aria-label="Platform previews">
        {surfaces.map((surface) => (
          <Link href={surface.href} className="surface-link" key={surface.href}>
            <span className="surface-link__marker" aria-hidden="true">
              {surface.marker}
            </span>
            <span className="surface-link__content">
              <strong>{surface.label}</strong>
              <span>{surface.description} <small>{surface.host}</small></span>
            </span>
            <span className="surface-link__arrow" aria-hidden="true">
              →
            </span>
          </Link>
        ))}
      </nav>

      <footer className="gateway__footer">
        <p>Review build · Sample data is labelled</p>
        <p className="handwritten">Ready before you need to be.</p>
      </footer>
    </main>
  );
}
