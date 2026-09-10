import Image from "next/image";
import Link from "next/link";

const capabilities = [
  { label: "Students", value: "Today, feed, timetable, GPA, tutorials and store" },
  { label: "Agents", value: "Applications, listings, products and delivery work" },
  { label: "Administrators", value: "Users, approvals, content, revenue and audit" },
];

export default function PlatformIndex() {
  return <main className="home-page">
    <header className="home-nav"><Image src="/kampusone-horizontal-ink.png" width={188} height={46} alt="KampusOne" priority /><nav><Link href="/agents">Agent workspace</Link><Link href="/admin" className="button button--primary">Administration</Link></nav></header>
    <section className="home-hero"><div className="home-hero__copy"><p className="eyebrow">The operating system for campus life</p><h1>Everything students need, in one campus.</h1><p>KampusOne connects academic planning, trusted campus updates, tutorials, local commerce, delivery, and the people who run it.</p><div className="hero-actions"><Link href="/agents" className="button button--primary">Start as an agent</Link><Link href="/engineering" className="button button--secondary">View system status</Link></div><div className="trust-line"><span className="status-dot status-dot--online" />Real accounts · verified actions · accountable operations</div></div><div className="home-hero__visual"><div className="visual-card"><Image src="/brand-scenes/campus-life.png" alt="Nigerian students using KampusOne on campus" width={1024} height={1024} priority /></div><div className="visual-float visual-float--top"><span>Today</span><strong>Classes, updates and campus life</strong></div><div className="visual-float visual-float--bottom"><span>One account</span><strong>Student → agent → campus operator</strong></div></div></section>
    <section className="capability-band">{capabilities.map((item, index) => <article key={item.label}><span>0{index + 1}</span><div><strong>{item.label}</strong><p>{item.value}</p></div></article>)}</section>
    <section className="home-story"><Image src="/brand-scenes/onboarding.png" alt="Campus onboarding illustration" width={1024} height={1024} /><div><p className="eyebrow">Built for real campus days</p><h2>A useful platform before it becomes a crowded one.</h2><p>The student app opens to what matters now. The agent workspace reveals only approved capabilities. The administration center turns live records into decisions, without hiding gaps behind sample data.</p><Link href="/admin" className="text-link">Open the operations center →</Link></div></section>
    <footer className="home-footer"><Image src="/kampusone-horizontal-ink.png" width={142} height={35} alt="KampusOne" /><span>Ready before you need to be.</span><span>© 2026 KampusOne</span></footer>
  </main>;
}
