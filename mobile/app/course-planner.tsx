import { useCallback, useState } from "react";
import { router, useFocusEffect } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { ToolPage, ToolButton, ToolField } from "@/src/components/toolkit";
import { EmptyResult } from "@/src/components/product-ui";
import { ScreenSkeleton } from "@/src/components/skeleton";
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
  const [scale, setScale] = useState<Record<string, number> | null>(null);
  const [ready, setReady] = useState(false);
  const [loadedFromServer, setLoadedFromServer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setError("");
    try {
      const r = await api<{
        courses: Course[];
        gradingScale: Record<string, number> | null;
        gradingScaleStatus?: string;
      }>("/v1/learning/courses");
      setCourses(r.courses);
      setLoadedFromServer(true);
      setScale(r.gradingScaleStatus === "VERIFIED" ? r.gradingScale : null);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Your course plan could not load.",
      );
    } finally {
      setReady(true);
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  const included = scale
    ? courses.filter(
        (course) =>
          Number(course.units) > 0 &&
          course.grade &&
          scale[course.grade] !== undefined,
      )
    : [];
  const total = included.reduce((sum, course) => sum + Number(course.units), 0);
  const gpa =
    total && scale
      ? included.reduce(
          (sum, course) => sum + Number(course.units) * scale[course.grade!]!,
          0,
        ) / total
      : null;
  function change(index: number, patch: Partial<Course>) {
    setCourses((items) =>
      items.map((course, i) =>
        i === index ? { ...course, ...patch } : course,
      ),
    );
  }
  async function save() {
    if (busy || !loadedFromServer) return;
    const codes = courses.map((course) =>
      course.course_code.trim().toUpperCase(),
    );
    const invalid = courses.findIndex(
      (course) =>
        course.course_code.trim().length < 2 ||
        !course.title.trim() ||
        (course.units !== null &&
          course.units !== "" &&
          (!Number.isFinite(Number(course.units)) ||
            Number(course.units) <= 0 ||
            Number(course.units) > 30)),
    );
    if (invalid !== -1) {
      setError(
        `Check course ${invalid + 1}: add a code, a title and valid units.`,
      );
      return;
    }
    if (new Set(codes).size !== codes.length) {
      setError("Each course code should appear once.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api("/v1/learning/courses", {
        method: "PUT",
        body: JSON.stringify({
          courses: courses.map((course) => ({
            courseCode: course.course_code,
            title: course.title,
            units:
              course.units === null || course.units === ""
                ? null
                : Number(course.units),
            grade: course.grade,
          })),
        }),
      });
      toast("Course plan saved", "success");
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Your course plan could not save. Your changes are still here.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <ToolPage title="Grade planner">
      {!ready ? (
        <ScreenSkeleton variant="learning" compact />
      ) : (
        <>
          {error ? (
            <>
              <Text
                accessibilityRole="alert"
                style={{
                  color: theme.error,
                  lineHeight: 22,
                  marginVertical: 14,
                }}
              >
                {error}
              </Text>
              {!courses.length ? (
                <ToolButton
                  secondary
                  label="Retry course plan"
                  onPress={() => {
                    setReady(false);
                    void load();
                  }}
                />
              ) : null}
            </>
          ) : null}
          {!error && !courses.length ? (
            <EmptyResult title="No courses added yet" />
          ) : null}
          {courses.length ? (
            <View style={{ paddingVertical: 16 }}>
              {scale ? (
                <>
                  <Text
                    style={{
                      fontFamily: theme.font.displayStrong,
                      color: theme.text,
                      fontSize: 42,
                    }}
                  >
                    {gpa === null ? "—" : gpa.toFixed(2)}
                  </Text>
                  <Text
                    style={{
                      color: theme.textMuted,
                      fontFamily: theme.font.body,
                    }}
                  >
                    Projected GPA · {included.length} graded courses · reviewed
                    scale
                  </Text>
                </>
              ) : (
                <>
                  <Text
                    style={{
                      fontFamily: theme.font.display,
                      color: theme.text,
                      fontSize: 22,
                      marginBottom: 8,
                    }}
                  >
                    Your course plan
                  </Text>
                  <Text
                    style={{
                      color: theme.textMuted,
                      fontFamily: theme.font.body,
                      lineHeight: 22,
                    }}
                  >
                    Your university's reviewed grading scale is not available
                    yet. Save your courses here, or enter the correct grade
                    points in the GPA calculator.
                  </Text>
                </>
              )}
            </View>
          ) : null}
          {courses.map((course, index) => (
            <View
              key={index}
              style={{
                paddingVertical: 18,
                borderBottomWidth: 1,
                borderColor: theme.border,
              }}
            >
              <ToolField
                label="Course code"
                autoCapitalize="characters"
                maxLength={24}
                value={course.course_code}
                editable={!busy}
                onChangeText={(course_code) => change(index, { course_code })}
              />
              <ToolField
                label="Course title"
                maxLength={160}
                value={course.title}
                editable={!busy}
                onChangeText={(title) => change(index, { title })}
              />
              <ToolField
                label="Units"
                value={course.units === null ? "" : String(course.units)}
                keyboardType="decimal-pad"
                editable={!busy}
                onChangeText={(units) => change(index, { units })}
              />
              {scale ? (
                <View
                  style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}
                >
                  {["", ...Object.keys(scale)].map((grade) => (
                    <Pressable
                      key={grade}
                      accessibilityRole="radio"
                      accessibilityState={{
                        checked: (course.grade ?? "") === grade,
                        disabled: busy,
                      }}
                      disabled={busy}
                      onPress={() => change(index, { grade: grade || null })}
                      style={{
                        minWidth: 44,
                        minHeight: 44,
                        borderRadius: 10,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor:
                          (course.grade ?? "") === grade
                            ? theme.deepBrand
                            : theme.surfaceMuted,
                      }}
                    >
                      <Text
                        style={{
                          color:
                            (course.grade ?? "") === grade
                              ? "#FFFFFF"
                              : theme.text,
                        }}
                      >
                        {grade || "—"}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : (
                <ToolField
                  label="Grade (optional, as shown on your result)"
                  value={course.grade ?? ""}
                  autoCapitalize="characters"
                  maxLength={3}
                  editable={!busy}
                  onChangeText={(grade) =>
                    change(index, { grade: grade.trim().toUpperCase() || null })
                  }
                />
              )}
              <ToolButton
                secondary
                label="Remove this course"
                disabled={busy}
                onPress={() =>
                  setCourses((items) => items.filter((_, i) => i !== index))
                }
              />
            </View>
          ))}
          <ToolButton
            secondary
            label="Add a course"
            disabled={busy || !loadedFromServer || courses.length >= 100}
            onPress={() =>
              setCourses((items) => [
                ...items,
                { course_code: "", title: "", units: null, grade: null },
              ])
            }
          />
          <ToolButton
            label={busy ? "Saving course plan…" : "Save course plan"}
            disabled={busy || !loadedFromServer}
            onPress={() => void save()}
          />
        </>
      )}
      <ToolButton
        secondary
        label="Completed GPA & CGPA"
        onPress={() => router.push("/gpa")}
      />
    </ToolPage>
  );
}
