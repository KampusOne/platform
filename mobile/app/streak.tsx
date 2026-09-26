import { useCallback, useEffect, useState } from "react";
import { Share, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ToolPage, ToolButton, ToolRow } from "@/src/components/toolkit";
import { ScreenSkeleton } from "@/src/components/skeleton";
import { useToast } from "@/src/components/toast";
import { useAppearance } from "@/src/lib/appearance";
import { api } from "@/src/lib/api";
type Streak = {
  current_days: number;
  longest_days: number;
  goal_days: number;
  last_day: string | null;
};
type StreakData = {
  streak: Streak;
  activityDays: string[];
  timezone: string;
  today: string;
};
const milestones = [
  { days: 1, label: "First spark", shade: "#D9855F" },
  { days: 7, label: "Steady flame", shade: "#C35D38" },
  { days: 14, label: "Finding a rhythm", shade: "#A8462E" },
  { days: 30, label: "A month of progress", shade: "#C33F32" },
  { days: 100, label: "Campus flame", shade: "#8157B4" },
];
function calendarDays(today: string) {
  const end = new Date(today + "T12:00:00Z");
  return Array.from({ length: 28 }, (_, index) => {
    const day = new Date(end);
    day.setUTCDate(end.getUTCDate() - 27 + index);
    return day.toISOString().slice(0, 10);
  });
}

function currentStreakDays(streak: Streak) {
  if (!streak.last_day || streak.current_days <= 0) return new Set<string>();
  const end = new Date(streak.last_day + "T12:00:00Z");
  return new Set(
    Array.from({ length: streak.current_days }, (_, index) => {
      const day = new Date(end);
      day.setUTCDate(end.getUTCDate() - index);
      return day.toISOString().slice(0, 10);
    }),
  );
}
export default function StreakScreen() {
  const { theme } = useAppearance();
  const toast = useToast();
  const [data, setData] = useState<StreakData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      setData(await api<StreakData>("/v1/account/streak"));
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Your streak could not load. Try again.",
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const streak = data?.streak;
  const current = streak?.current_days ?? 0;
  const tier = [...milestones].reverse().find((m) => current >= m.days);
  const next = milestones.find((m) => current < m.days);
  const activeDays = streak ? currentStreakDays(streak) : new Set<string>();
  const checkedIn = Boolean(
    data &&
      streak?.last_day === data.today &&
      (data.activityDays.includes(data.today) || activeDays.has(data.today)),
  );
  return (
    <ToolPage title="Your streak">
      {loading ? (
        <ScreenSkeleton variant="dashboard" compact />
      ) : error ? (
        <>
          <Text
            accessibilityRole="alert"
            style={{ color: theme.error, lineHeight: 22 }}
          >
            {error}
          </Text>
          <ToolButton
            secondary
            label="Retry streak"
            onPress={() => {
              setLoading(true);
              void load();
            }}
          />
        </>
      ) : data && streak ? (
        <>
          <View style={{ alignItems: "center", paddingVertical: 22, gap: 8 }}>
            <Ionicons
              name={current ? "flame" : "flame-outline"}
              color={tier?.shade ?? theme.textMuted}
              size={76}
            />
            <Text
              style={{
                fontFamily: theme.font.displayStrong,
                fontSize: 62,
                color: theme.text,
              }}
            >
              {current}
            </Text>
            <Text
              style={{ color: theme.textMuted, fontFamily: theme.font.medium }}
            >
              {current === 1 ? "day" : "days"} in a row
            </Text>
            <Text
              style={{
                color: theme.text,
                fontFamily: theme.font.semibold,
                marginTop: 4,
              }}
            >
              {tier?.label ?? "Start with today"}
            </Text>
          </View>
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              paddingVertical: 18,
              borderTopWidth: 1,
              borderBottomWidth: 1,
              borderColor: theme.border,
            }}
          >
            <View>
              <Text style={{ color: theme.textMuted, fontSize: 12 }}>
                Personal best
              </Text>
              <Text
                style={{
                  color: theme.text,
                  fontFamily: theme.font.display,
                  fontSize: 24,
                  marginTop: 4,
                }}
              >
                {streak.longest_days} days
              </Text>
            </View>
            <View>
              <Text style={{ color: theme.textMuted, fontSize: 12 }}>
                Next milestone
              </Text>
              <Text
                style={{
                  color: theme.text,
                  fontFamily: theme.font.display,
                  fontSize: 24,
                  marginTop: 4,
                }}
              >
                {next ? `${next.days} days` : "100 days reached"}
              </Text>
            </View>
          </View>
          <Text
            style={{
              color: theme.text,
              fontFamily: theme.font.display,
              fontSize: 21,
              marginTop: 26,
            }}
          >
            The last 28 days
          </Text>
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              gap: 6,
              marginVertical: 16,
            }}
          >
            {calendarDays(data.today).map((day) => {
              const active = activeDays.has(day);
              const done = active || data.activityDays.includes(day);
              const today = day === data.today;
              return (
                <View
                  key={day}
                  accessibilityLabel={`${new Date(day + "T12:00:00Z").toLocaleDateString("en-NG", { day: "numeric", month: "short", timeZone: "UTC" })}: ${done ? "checked in" : "no recorded check-in"}${today ? ", today" : ""}`}
                  style={{
                    width: "12%",
                    minHeight: 49,
                    borderRadius: 10,
                    backgroundColor:
                      today && done
                        ? theme.deepBrand
                        : done
                          ? theme.brand
                          : theme.surfaceMuted,
                    borderWidth: today && done ? 2 : 0,
                    borderColor: theme.deepBrand,
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 3,
                  }}
                >
                  <Text
                    style={{
                      color: done ? "#FFFFFF" : theme.textMuted,
                      fontFamily: theme.font.medium,
                      fontSize: 12,
                    }}
                  >
                    {Number(day.slice(-2))}
                  </Text>
                  {done ? (
                    <Ionicons name="checkmark" size={12} color="#FFFFFF" />
                  ) : (
                    <View style={{ height: 12 }} />
                  )}
                </View>
              );
            })}
          </View>
          <Text
            style={{
              color: theme.textMuted,
              fontFamily: theme.font.body,
              fontSize: 12,
              lineHeight: 19,
            }}
          >
            Your streak checks itself the first time you open KampusOne each day. A missed day starts a new streak. Days follow{" "}
            {data.timezone === "Africa/Lagos"
              ? "West Africa Time"
              : data.timezone}
            . {checkedIn ? "Today is already counted." : "Open the home screen to count today."}
          </Text>
          <Text
            style={{
              color: theme.text,
              fontFamily: theme.font.display,
              fontSize: 21,
              marginTop: 26,
            }}
          >
            Your journey
          </Text>
          <View style={{ marginVertical: 16 }}>
            {milestones.map((m, i) => {
              const achieved = streak.longest_days >= m.days;
              return (
                <View
                  key={m.days}
                  style={{ flexDirection: "row", gap: 16, minHeight: 90 }}
                >
                  <View style={{ alignItems: "center", width: 48 }}>
                    <View
                      style={{
                        height: 48,
                        width: 48,
                        borderRadius: 24,
                        backgroundColor: achieved ? m.shade : theme.surfaceMuted,
                        justifyContent: "center",
                        alignItems: "center",
                        opacity: achieved ? 1 : 0.72,
                      }}
                    >
                      <Ionicons
                        name="flame"
                        size={28}
                        color={achieved ? "#FFFFFF" : theme.textMuted}
                      />
                    </View>
                    {i < milestones.length - 1 ? (
                      <View
                        style={{
                          width: 3,
                          flex: 1,
                          backgroundColor:
                            streak.longest_days > m.days
                              ? m.shade
                              : theme.border,
                        }}
                      />
                    ) : null}
                  </View>
                  <View style={{ flex: 1, paddingTop: 4, paddingBottom: 22 }}>
                    <Text
                      style={{
                        fontFamily: theme.font.semibold,
                        color: achieved ? theme.text : theme.textMuted,
                        fontSize: 16,
                      }}
                    >
                      {m.label}
                    </Text>
                    <Text
                      style={{
                        fontFamily: theme.font.body,
                        color: theme.textMuted,
                        fontSize: 12,
                        marginTop: 5,
                      }}
                    >
                      {m.days} days ·{" "}
                      {achieved
                        ? "Unlocked"
                        : `${Math.max(0, m.days - current)} days to unlock`}
                    </Text>
                    {!achieved && next?.days === m.days ? (
                      <View
                        accessibilityRole="progressbar"
                        accessibilityValue={{
                          min: 0,
                          max: m.days,
                          now: current,
                        }}
                        style={{
                          height: 5,
                          backgroundColor: theme.border,
                          borderRadius: 3,
                          marginTop: 12,
                        }}
                      >
                        <View
                          style={{
                            height: 5,
                            width: `${Math.min(100, (current / m.days) * 100)}%`,
                            backgroundColor: m.shade,
                            borderRadius: 3,
                          }}
                        />
                      </View>
                    ) : null}
                  </View>
                </View>
              );
            })}
          </View>
          <ToolButton
            secondary
            label="Share my streak"
            disabled={!current}
            onPress={() =>
              void Share.share({
                message: `I'm on a ${current}-day streak on KampusOne 🔥\n\nKampusOne helps students keep up with classes, campus updates, study tools and more.\nhttps://kampusone.app`,
              }).catch(() => toast("Could not open sharing", "error"))
            }
          />
        </>
      ) : null}
    </ToolPage>
  );
}
