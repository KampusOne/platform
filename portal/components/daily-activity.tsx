type Row = Record<string, string | number | null>;
export function DailyActivity({
  rows,
  title = "Active accounts by day",
  description = "Recorded days in West Africa Time. Exact values are in the activity table.",
}: {
  rows: Row[];
  title?: string;
  description?: string;
}) {
  const dated = rows
    .map((row) => ({
      day: row.day,
      active_users: row.active_users,
      stamp: Date.parse(String(row.day) + "T00:00:00Z"),
    }))
    .filter((row) => Number.isFinite(row.stamp))
    .sort((a, b) => a.stamp - b.stamp);
  if (!dated.length) return null;
  const first = dated[0]!,
    last = dated.at(-1)!,
    maximum = Math.max(0, ...dated.map((row) => Number(row.active_users) || 0));
  const width = 640,
    height = 180,
    days = (last.stamp - first.stamp) / 86400000 + 1,
    gap = width / days;
  return (
    <section className="panel">
      <h2>{title}</h2>
      <p className="field-help">{description}</p>
      <svg
        viewBox={`0 0 ${width} ${height + 28}`}
        role="img"
        aria-label={`${title} from ${first.day} to ${last.day}; highest daily count ${maximum}.`}
        style={{ width: "100%", maxHeight: 240, color: "var(--k1-brand-600)" }}
      >
        {dated.map((row) => {
          const barHeight = maximum
            ? ((Number(row.active_users) || 0) / maximum) * (height - 12)
            : 0;
          return (
            <rect
              key={String(row.day)}
              x={((row.stamp - first.stamp) / 86400000) * gap + gap * 0.15}
              y={height - barHeight}
              width={gap * 0.7}
              height={barHeight}
              rx={Math.min(3, gap * 0.12)}
              fill="currentColor"
            >
              <title>{`${row.day}: ${row.active_users}`}</title>
            </rect>
          );
        })}
        <text x={0} y={height + 24} fontSize={13} fill="currentColor">
          {String(first.day)}
        </text>
        <text
          x={width}
          y={height + 24}
          textAnchor="end"
          fontSize={13}
          fill="currentColor"
        >
          {String(last.day)}
        </text>
      </svg>
    </section>
  );
}
