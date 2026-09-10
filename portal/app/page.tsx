import Image from "next/image";
import Link from "next/link";

const surfaces = [
  {
    href: "/admin",
    label: "Admin",
    description: "Institution setup, governance, verification, and audit readiness.",
    marker: "01",
  },
  {
    href: "/agents",
    label: "Agents",
    description: "Assigned campus operations with narrow, accountable permissions.",
    marker: "02",
  },
  {
    href: "/engineering",
    label: "Engineering",
    description: "Deployment health, release gates, cost controls, and system evidence.",
    marker: "03",
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
        <span className="environment-chip">Foundation preview</span>
      </header>

      <section className="gateway__intro" aria-labelledby="gateway-title">
        <p className="eyebrow">Internal platform · Phase 0</p>
        <h1 id="gateway-title">The operating surfaces behind a calmer campus day.</h1>
        <p className="gateway__lede">
          These previews establish boundaries and interaction standards. They do not contain live
          student records or enabled operational actions yet.
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
              <span>{surface.description}</span>
            </span>
            <span className="surface-link__arrow" aria-hidden="true">
              →
            </span>
          </Link>
        ))}
      </nav>

      <footer className="gateway__footer">
        <p>Private preview · No production data</p>
        <p className="handwritten">Ready before you need to be.</p>
      </footer>
    </main>
  );
}
