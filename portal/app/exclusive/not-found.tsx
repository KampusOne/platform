import Link from "next/link";
import Image from "next/image";
import styles from "@/components/agent-intake.module.css";

export default function ExclusiveNotFound() {
  return (
    <main className={styles.root}>
      <header className={styles.entryHeader}>
        <Image
          className={styles.logo}
          src="/brand/kampusone-horizontal-ink.svg"
          width={180}
          height={44}
          alt="KampusOne"
        />
      </header>
      <section className={`${styles.main} ${styles.pageHeading}`}>
        <p className={styles.kicker}>404</p>
        <h1>Page not found</h1>
        <p>This invitation page is no longer available.</p>
        <Link className="button button--primary" href="/agents">
          Open agent applications
        </Link>
      </section>
    </main>
  );
}
