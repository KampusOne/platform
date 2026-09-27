export type StreakMilestone = {
  days: number;
  label: string;
  color: string;
};

export const streakMilestones: readonly StreakMilestone[] = [
  { days: 1, label: "First spark", color: "#EF5A47" },
  { days: 7, label: "Steady flame", color: "#22A06B" },
  { days: 14, label: "Focus flame", color: "#3478F6" },
  { days: 30, label: "Power flame", color: "#7A4CE0" },
  { days: 60, label: "Hot streak", color: "#E14B8F" },
  { days: 100, label: "Campus flame", color: "#D59A00" },
  { days: 365, label: "Legend flame", color: "#00A7B5" },
];

export function streakMilestone(days: number | null | undefined) {
  const current = Number.isFinite(days) ? Math.max(0, Number(days)) : 0;
  return [...streakMilestones].reverse().find((milestone) => current >= milestone.days);
}

export function streakColor(
  days: number | null | undefined,
  fallback: string,
) {
  return streakMilestone(days)?.color ?? fallback;
}
