type Tone = "ready" | "progress" | "gated" | "attention";

export function StatusLabel({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={`status-label status-label--${tone}`}>{children}</span>;
}
