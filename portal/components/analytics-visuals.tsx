type Slice = { label: string; value: number };

const compact = (value: number) =>
  new Intl.NumberFormat("en-NG", {
    notation: value >= 1000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);

export function HorizontalBars({
  title,
  rows,
  valueLabel = compact,
  limit = 10,
}: {
  title: string;
  rows: Slice[];
  valueLabel?: (value: number) => string;
  limit?: number;
}) {
  const visible = rows
    .filter((row) => Number.isFinite(row.value) && row.value >= 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
  const maximum = Math.max(1, ...visible.map((row) => row.value));
  if (!visible.length) return null;
  return (
    <section className="analytics-visual-card">
      <div className="analytics-visual-heading">
        <h3>{title}</h3>
        <span>{visible.length} shown</span>
      </div>
      <div className="analytics-bars">
        {visible.map((row) => (
          <div className="analytics-bar-row" key={row.label}>
            <div className="analytics-bar-label">
              <span title={row.label}>{row.label}</span>
              <strong>{valueLabel(row.value)}</strong>
            </div>
            <div className="analytics-bar-track">
              <div
                className="analytics-bar-fill"
                style={{ width: `${Math.max(2, (row.value / maximum) * 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function DonutBreakdown({
  title,
  rows,
}: {
  title: string;
  rows: Slice[];
}) {
  const values = rows.filter((row) => Number.isFinite(row.value) && row.value > 0);
  const total = values.reduce((sum, row) => sum + row.value, 0);
  if (!total) return null;
  const segments = values.map((row, index) => {
    const percent = (row.value / total) * 100;
    const priorPercent = values
      .slice(0, index)
      .reduce((sum, previous) => sum + (previous.value / total) * 100, 0);
    return { ...row, percent, offset: 25 - priorPercent, index };
  });
  return (
    <section className="analytics-visual-card">
      <div className="analytics-visual-heading">
        <h3>{title}</h3>
        <span>{compact(total)} total</span>
      </div>
      <div className="analytics-donut-layout">
        <svg viewBox="0 0 42 42" className="analytics-donut" role="img" aria-label={title}>
          <circle className="analytics-donut-base" cx="21" cy="21" r="15.9155" fill="none" />
          {segments.map((segment) => (
            <circle
              key={segment.label}
              className={`analytics-donut-segment analytics-donut-segment--${segment.index % 6}`}
              cx="21"
              cy="21"
              r="15.9155"
              fill="none"
              strokeDasharray={`${segment.percent} ${100 - segment.percent}`}
              strokeDashoffset={segment.offset}
            >
              <title>{`${segment.label}: ${segment.value} (${Math.round(segment.percent)}%)`}</title>
            </circle>
          ))}
          <text x="21" y="20" textAnchor="middle" className="analytics-donut-total">
            {compact(total)}
          </text>
          <text x="21" y="24" textAnchor="middle" className="analytics-donut-caption">
            total
          </text>
        </svg>
        <div className="analytics-legend">
          {segments.map((segment) => (
            <div key={segment.label} className="analytics-legend-row">
              <i className={`analytics-legend-dot analytics-legend-dot--${segment.index % 6}`} />
              <span>{segment.label}</span>
              <strong>{Math.round(segment.percent)}%</strong>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
