"use client";
import { useId, useSyncExternalStore } from "react";
import styles from "./admin-reporting.module.css";
type Row = Record<string, string | number | null>;
const narrowQuery = "(max-width:650px)";
function subscribeViewport(notify: () => void) {
  const query = window.matchMedia(narrowQuery);
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
}
const narrowSnapshot = () => window.matchMedia(narrowQuery).matches;
const serverSnapshot = () => false;

function compact(value: number) {
  return new Intl.NumberFormat("en-NG", {
    notation: value >= 1000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

export function DailyActivity({
  rows,
  title = "Active accounts by day",
  description = "Recorded days in West Africa Time. Exact values are in the activity table.",
  metricKey = "active_users",
  metricLabel = "active accounts",
}: {
  rows: Row[];
  title?: string;
  description?: string;
  metricKey?: string;
  metricLabel?: string;
}) {
  const gradientId = useId();
  const narrow = useSyncExternalStore(subscribeViewport, narrowSnapshot, serverSnapshot);
  const dated = rows
    .map((row) => ({
      day: String(row.day ?? ""),
      activeUsers: Math.max(0, Number(row[metricKey]) || 0),
      events: Math.max(0, Number(row.events) || 0),
      stamp: Date.parse(String(row.day) + "T00:00:00Z"),
    }))
    .filter((row) => Number.isFinite(row.stamp))
    .sort((a, b) => a.stamp - b.stamp);

  if (!dated.length) return null;

  const first = dated[0]!;
  const last = dated.at(-1)!;
  const observedMaximum = Math.max(0, ...dated.map((row) => row.activeUsers));
  const maximum = Math.max(1, observedMaximum);
  const totalEvents = dated.reduce((sum, row) => sum + row.events, 0);
  const width = narrow ? 360 : 720;
  const height = 230;
  const plot = { left: 48, right: 14, top: 16, bottom: 36 };
  const plotWidth = width - plot.left - plot.right;
  const plotHeight = height - plot.top - plot.bottom;
  const span = Math.max(1, last.stamp - first.stamp);

  const points = dated.map((row, index) => {
    const x =
      dated.length === 1
        ? plot.left + plotWidth / 2
        : plot.left + ((row.stamp - first.stamp) / span) * plotWidth;
    const y =
      plot.top + plotHeight - (row.activeUsers / maximum) * plotHeight;
    return { ...row, x, y, index };
  });

  const polyline = points.map((point) => `${point.x},${point.y}`).join(" ");
  const area =
    points.length > 1
      ? `${plot.left},${plot.top + plotHeight} ${polyline} ${plot.left + plotWidth},${plot.top + plotHeight}`
      : "";

  const labels =
    points.length <= 7
      ? points
      : points.filter(
          (_, index) =>
            index === 0 ||
            index === points.length - 1 ||
            index % Math.ceil(points.length / (narrow ? 3 : 6)) === 0,
        );
  const ticks = [...new Set([0, 0.25, 0.5, 0.75, 1].map(fraction => Math.round(maximum * fraction)))];

  return (
    <section className={`panel analytics-chart-panel ${styles.chartPanel}`}>
      <div className={`panel-heading ${styles.chartHeader}`}>
        <div>
          <h2>{title}</h2>
          <p className="field-help">{description}</p>
        </div>
        <div className="data-label">
          Peak {observedMaximum.toLocaleString()} · {totalEvents.toLocaleString()} recorded
        </div>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${title} from ${first.day} to ${last.day}; highest daily count ${observedMaximum}.`}
        className={`analytics-line-chart ${styles.lineChart}`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity=".18" />
            <stop offset="100%" stopColor="currentColor" stopOpacity=".015" />
          </linearGradient>
        </defs>

        {ticks.map((tick) => {
          const y = plot.top + plotHeight * (1 - tick / maximum);
          return (
            <g key={tick}>
              <line
                x1={plot.left}
                x2={plot.left + plotWidth}
                y1={y}
                y2={y}
                className="analytics-grid-line"
              />
              <text
                x={plot.left - 10}
                y={y + 4}
                textAnchor="end"
                className="analytics-axis-label"
              >
                {compact(tick)}
              </text>
            </g>
          );
        })}

        {area ? (
          <polygon points={area} fill={`url(#${gradientId})`} />
        ) : null}

        {points.length > 1 ? (
          <polyline
            points={polyline}
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}

        {points.map((point) => (
          <circle
            key={point.day}
            cx={point.x}
            cy={point.y}
            r={points.length === 1 ? 7 : narrow ? 3 : 4.5}
            fill="var(--k1-cream)"
            stroke="currentColor"
            strokeWidth={narrow ? 2 : 3}
            vectorEffect="non-scaling-stroke"
          >
            <title>{`${point.day}: ${point.activeUsers} ${metricLabel}`}</title>
          </circle>
        ))}

        {labels.map((point) => (
          <text
            key={`label-${point.day}`}
            x={point.x}
            y={height - 9}
            textAnchor={
              point.index === 0
                ? "start"
                : point.index === points.length - 1
                  ? "end"
                  : "middle"
            }
            className="analytics-axis-label analytics-axis-label--date"
          >
            {new Date(point.day + "T00:00:00Z").toLocaleDateString("en-NG", {
              day: "numeric",
              month: "short",
            })}
          </text>
        ))}
      </svg>
    </section>
  );
}
