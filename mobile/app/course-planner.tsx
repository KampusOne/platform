import { useCallback, useState } from "react";
import { router, useFocusEffect } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { ToolPage, ToolButton, ToolField } from "@/src/components/toolkit";
import { EmptyResult } from "@/src/components/product-ui";
import { useToast } from "@/src/components/toast";
import { useAppearance } from "@/src/lib/appearance";
import { api } from "@/src/lib/api";
type Course = {
  course_code: string;
  title: string;
  units: string | number | null;
  grade: string | null;
};
export default function CoursePlanner() {
  const { theme } = useAppearance();
  const toast = useToast();
  const [courses, setCourses] = useState<Course[]>([]);
  const [scale, setScale] = useState<Record<string, number>>({
    A: 5,
    B: 4,
    C: 3,
    D: 2,
    E: 1,
    F: 0,
  });
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  useFocusEffect(
    useCallback(() => {
      void api<{ courses: Course[]; gradingScale: Record<string, number> }>(
        "/v1/learning/courses",
      )
        .then((r) => {
          setCourses(r.courses);
          setScale(r.gradingScale);
          setReady(true);
        })
        .catch((e) => toast(e.message, "error"));
    }, [toast]),
  );
  const included = courses.filter(
    (c) => Number(c.units) > 0 && c.grade && scale[c.grade] !== undefined,
  );
  const total = included.reduce((s, c) => s + Number(c.units), 0);
  const gpa = total
    ? included.reduce((s, c) => s + Number(c.units) * scale[c.grade!]!, 0) /
      total
    : null;
  function change(index: number, patch: Partial<Course>) {
    setCourses((s) => s.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }
  async function save() {
    setBusy(true);
    try {
      await api("/v1/learning/courses", {
        method: "PUT",
        body: JSON.stringify({
          courses: courses.map((c) => ({
            courseCode: c.course_code,
            title: c.title,
            units: c.units === null || c.units === "" ? null : Number(c.units),
            grade: c.grade,
          })),
        }),
      });
      toast("Course plan saved", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save courses", "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <ToolPage title="Grade planner">
      {ready && !courses.length ? (
        <>
          <EmptyResult title="No courses added yet" />
          <ToolButton
            label="Add timetable"
            onPress={() => router.push("/timetable")}
          />
        </>
      ) : null}
      {courses.length ? (
        <>
          <Text
            style={{
              fontFamily: theme.font.displayStrong,
              color: theme.text,
              fontSize: 42,
              marginBottom: 4,
            }}
          >
            {gpa === null ? "—" : gpa.toFixed(2)}
          </Text>
          <Text
            style={{
              fontFamily: theme.font.body,
              color: theme.textMuted,
              marginBottom: 22,
            }}
          >
            Projected GPA · {included.length} graded courses
          </Text>
          {courses.map((c, i) => (
            <View
              key={c.course_code}
              style={{
                paddingVertical: 18,
                borderBottomWidth: 1,
                borderColor: theme.border,
              }}
            >
              <Text
                style={{
                  fontFamily: theme.font.semibold,
                  color: theme.text,
                  fontSize: 16,
                  marginBottom: 4,
                }}
              >
                {c.course_code}
              </Text>
              <Text
                style={{
                  fontFamily: theme.font.body,
                  color: theme.textMuted,
                  marginBottom: 16,
                }}
              >
                {c.title}
              </Text>
              <ToolField
                label="Units"
                value={c.units === null ? "" : String(c.units)}
                keyboardType="decimal-pad"
                onChangeText={(units) => change(i, { units })}
              />
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {["", ...Object.keys(scale)].map((grade) => (
                  <Pressable
                    key={grade}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: (c.grade ?? "") === grade }}
                    onPress={() => change(i, { grade: grade || null })}
                    style={{
                      minWidth: 40,
                      minHeight: 44,
                      borderRadius: 10,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor:
                        (c.grade ?? "") === grade
                          ? theme.deepBrand
                          : theme.surfaceMuted,
                    }}
                  >
                    <Text
                      style={{
                        color: (c.grade ?? "") === grade ? "#fff" : theme.text,
                      }}
                    >
                      {grade || "—"}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ))}
          <ToolButton
            label="Save course plan"
            disabled={busy}
            onPress={() => void save()}
          />
        </>
      ) : null}
      <ToolButton
        secondary
        label="Completed GPA & CGPA"
        onPress={() => router.push("/gpa")}
      />
    </ToolPage>
  );
}
