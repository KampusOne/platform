import { Ionicons } from "@expo/vector-icons";
import { useCallback, useMemo, useState } from "react";
import { router, useFocusEffect } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ToolPage, ToolButton, ToolField } from "@/src/components/toolkit";
import { ScreenSkeleton } from "@/src/components/skeleton";
import { useToast } from "@/src/components/toast";
import { useAppearance, type Theme } from "@/src/lib/appearance";
import { api } from "@/src/lib/api";

type Course = {
  course_code: string;
  title: string;
  units: string | number | null;
  grade: string | null;
};

type GpaResult = {
  courseCode: string;
  courseTitle: string;
  units: string | number;
  grade: string;
  gradePoint: string | number;
};

type GpaTerm = {
  id: string;
  session_label: string;
  semester: number;
  level_code: string;
  results: GpaResult[];
};

type GpaData = {
  terms: GpaTerm[];
};

function emptyCourse(): Course {
  return { course_code: "", title: "", units: null, grade: null };
}

function saveErrorMessage(error: unknown) {
  if (!(error instanceof Error)) {
    return "We couldn't save this plan yet. Your changes are still here.";
  }
  const message = error.message.trim();
  if (
    !message ||
    /could not complete|request failed|provider unavailable|network|timeout/i.test(
      message,
    )
  ) {
    return "We couldn't save this plan yet. Your changes are still here. Check your connection and try again.";
  }
  return message;
}

export default function CoursePlanner() {
  const { theme } = useAppearance();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const toast = useToast();
  const [courses, setCourses] = useState<Course[]>([]);
  const [scale, setScale] = useState<Record<string, number> | null>(null);
  const [ready, setReady] = useState(false);
  const [loadedFromServer, setLoadedFromServer] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [importingGpa, setImportingGpa] = useState(false);
  const [importMessage, setImportMessage] = useState("");
  const [gpaTerms, setGpaTerms] = useState<GpaTerm[]>([]);
  const [showImportTerms, setShowImportTerms] = useState(false);

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
      setLoadFailed(false);
      setDirty(false);
      setScale(r.gradingScale ?? null);
    } catch {
      setLoadedFromServer(false);
      setLoadFailed(true);
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
    setDirty(true);
    setError("");
    setCourses((items) =>
      items.map((course, i) =>
        i === index ? { ...course, ...patch } : course,
      ),
    );
  }

  function addCourse() {
    if (busy || courses.length >= 100) return;
    setDirty(true);
    setError("");
    setCourses((items) => [...items, emptyCourse()]);
  }

  function removeCourse(index: number) {
    if (busy) return;
    setDirty(true);
    setError("");
    setCourses((items) => items.filter((_, i) => i !== index));
  }

  function importGpaTerm(term: GpaTerm) {
    const imported = (term.results ?? [])
      .filter((result) => {
        const numericUnits = Number(result.units);
        return (
          result.courseCode.trim().length >= 2 &&
          result.courseTitle.trim().length > 0 &&
          Boolean(result.grade?.trim()) &&
          Number.isFinite(numericUnits) &&
          numericUnits > 0
        );
      })
      .map<Course>((result) => ({
        course_code: result.courseCode.trim().toUpperCase(),
        title: result.courseTitle.trim(),
        units: Number(result.units),
        grade: result.grade.trim().toUpperCase(),
      }));

    if (!imported.length) {
      setImportMessage("Nothing to import.");
      setShowImportTerms(false);
      return;
    }

    const current = courses.filter(
      (course) => course.course_code.trim() || course.title.trim(),
    );
    const existingCodes = new Set(
      current.map((course) => course.course_code.trim().toUpperCase()),
    );
    const additions = imported
      .filter((course) => !existingCodes.has(course.course_code))
      .slice(0, Math.max(0, 100 - current.length));

    if (!additions.length) {
      setImportMessage("Nothing new to import.");
      setShowImportTerms(false);
      return;
    }

    setCourses([...current, ...additions]);
    setDirty(true);
    setError("");
    setShowImportTerms(false);
    setImportMessage(
      `${additions.length} ${additions.length === 1 ? "course" : "courses"} imported · ${term.session_label} · Semester ${term.semester}`,
    );
  }

  async function importFromGpa() {
    if (busy || importingGpa) return;
    setImportingGpa(true);
    setImportMessage("");
    setError("");
    setShowImportTerms(false);

    try {
      const response = await api<GpaData>("/v1/student/gpa");
      const terms = (response.terms ?? []).filter(
        (term) => (term.results ?? []).length > 0,
      );

      if (!terms.length) {
        setImportMessage("Nothing to import.");
        return;
      }

      const onlyTerm = terms[0];
      if (terms.length === 1 && onlyTerm) {
        importGpaTerm(onlyTerm);
        return;
      }

      setGpaTerms(terms);
      setShowImportTerms(true);
    } catch (e) {
      setImportMessage(
        e instanceof Error && e.message.trim()
          ? e.message
          : "GPA & CGPA could not be loaded.",
      );
    } finally {
      setImportingGpa(false);
    }
  }

  async function save() {
    if (busy || !dirty) return;

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
        "Check course " +
          (invalid + 1) +
          ": add a code, a title and valid units.",
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
      setLoadedFromServer(true);
      setLoadFailed(false);
      setDirty(false);
      toast("Course plan saved", "success");
    } catch (e) {
      setError(saveErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const syncLabel = loadFailed
    ? "Not synced"
    : loadedFromServer
      ? "Synced"
      : "Local plan";

  return (
    <ToolPage title="Grade planner">
      {!ready ? (
        <ScreenSkeleton variant="learning" compact />
      ) : (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: importingGpa, busy: importingGpa }}
            disabled={importingGpa}
            onPress={() => void importFromGpa()}
            style={({ pressed }) => [
              styles.importAction,
              importingGpa && styles.importActionDisabled,
              pressed && !importingGpa && { opacity: 0.82 },
            ]}
          >
            <Ionicons name="download-outline" size={19} color={theme.accentText} />
            <Text style={styles.importActionText}>
              {importingGpa ? "Importing…" : "Import from GPA & CGPA"}
            </Text>
          </Pressable>

          {importMessage ? (
            <Text accessibilityLiveRegion="polite" style={styles.importMessage}>
              {importMessage}
            </Text>
          ) : null}

          {showImportTerms ? (
            <View style={styles.importPicker}>
              <Text style={styles.importPickerTitle}>Choose semester</Text>
              {gpaTerms.map((term) => (
                <Pressable
                  accessibilityRole="button"
                  key={term.id}
                  onPress={() => importGpaTerm(term)}
                  style={({ pressed }) => [
                    styles.importTerm,
                    pressed && { opacity: 0.72 },
                  ]}
                >
                  <View style={styles.importTermCopy}>
                    <Text style={styles.importTermTitle}>
                      {term.session_label} · Semester {term.semester}
                    </Text>
                    <Text style={styles.importTermMeta}>
                      {term.results.length} {term.results.length === 1 ? "course" : "courses"}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
                </Pressable>
              ))}
            </View>
          ) : null}

          {loadFailed ? (
            <View style={styles.syncCard}>
              <View style={styles.syncIcon}>
                <Ionicons
                  name="cloud-offline-outline"
                  size={22}
                  color={theme.accentText}
                />
              </View>
              <View style={styles.syncCopy}>
                <Text style={styles.syncTitle}>Saved plan unavailable</Text>
                <Text style={styles.syncBody}>
                  You can still add and edit courses. Retry to restore anything
                  you already saved.
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setReady(false);
                    void load();
                  }}
                  style={styles.retryAction}
                >
                  <Ionicons
                    name="refresh"
                    size={16}
                    color={theme.accentText}
                  />
                  <Text style={styles.retryText}>Retry sync</Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          {courses.length ? (
            <View style={styles.summaryCard}>
              <View style={styles.summaryTop}>
                <View style={styles.summaryCopy}>
                  <Text style={styles.eyebrow}>
                    {scale ? "PROJECTED GPA" : "SEMESTER PLAN"}
                  </Text>
                  <Text style={styles.summaryValue}>
                    {scale ? (gpa === null ? "—" : gpa.toFixed(2)) : courses.length}
                  </Text>
                  <Text style={styles.summaryCaption}>
                    {scale
                      ? gpa === null
                        ? "Add grades to preview your GPA"
                        : included.length +
                          " graded course" +
                          (included.length === 1 ? "" : "s")
                      : courses.length +
                        " course" +
                        (courses.length === 1 ? "" : "s") +
                        " in this plan"}
                  </Text>
                </View>
                <View style={styles.summaryIcon}>
                  <Ionicons
                    name={scale ? "stats-chart-outline" : "book-outline"}
                    size={24}
                    color={theme.accentText}
                  />
                </View>
              </View>

              <View style={styles.syncStatus}>
                <View
                  style={[
                    styles.syncDot,
                    loadFailed && { backgroundColor: theme.statusAttention },
                  ]}
                />
                <Text style={styles.syncStatusText}>{syncLabel}</Text>
              </View>

            </View>
          ) : (
            <View style={styles.emptyState}>
              <View style={styles.emptyIcon}>
                <Ionicons
                  name="school-outline"
                  size={24}
                  color={theme.accentText}
                />
              </View>
              <Text style={styles.emptyTitle}>No courses yet</Text>
              <Pressable
                accessibilityRole="button"
                onPress={addCourse}
                style={({ pressed }) => [
                  styles.primaryAdd,
                  pressed && { opacity: 0.82 },
                ]}
              >
                <Ionicons name="add" size={20} color="#FFFFFF" />
                <Text style={styles.primaryAddText}>Add first course</Text>
              </Pressable>
            </View>
          )}

          {courses.map((course, index) => (
            <View key={index} style={styles.courseCard}>
              <View style={styles.courseHeader}>
                <View style={styles.courseNumber}>
                  <Text style={styles.courseNumberText}>{index + 1}</Text>
                </View>
                <View style={styles.courseHeadingCopy}>
                  <Text
                    android_hyphenationFrequency="none"
                    style={styles.courseHeading}
                    textBreakStrategy="simple"
                  >
                    {course.course_code.trim() || "New course"}
                  </Text>
                  <Text
                    android_hyphenationFrequency="none"
                    numberOfLines={2}
                    style={styles.courseSubheading}
                    textBreakStrategy="simple"
                  >
                    {course.title.trim() || "Add the course details below"}
                  </Text>
                </View>
                <Pressable
                  accessibilityLabel={"Remove course " + (index + 1)}
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={() => removeCourse(index)}
                  hitSlop={8}
                  style={({ pressed }) => [
                    styles.removeButton,
                    (pressed || busy) && { opacity: 0.55 },
                  ]}
                >
                  <Ionicons name="trash-outline" size={20} color={theme.error} />
                </Pressable>
              </View>

              <ToolField
                label="Course code"
                autoCapitalize="characters"
                maxLength={24}
                value={course.course_code}
                editable={!busy}
                placeholder="e.g. CSC 201"
                onChangeText={(course_code) => change(index, { course_code })}
              />
              <ToolField
                label="Course title"
                maxLength={160}
                value={course.title}
                editable={!busy}
                placeholder="e.g. Data Structures"
                onChangeText={(title) => change(index, { title })}
              />
              <ToolField
                label="Units"
                value={course.units === null ? "" : String(course.units)}
                keyboardType="decimal-pad"
                editable={!busy}
                placeholder="e.g. 3"
                onChangeText={(units) => change(index, { units })}
              />

              {scale ? (
                <View style={styles.gradeSection}>
                  <Text style={styles.gradeLabel}>Grade</Text>
                  <View style={styles.gradeOptions}>
                    {["", ...Object.keys(scale)].map((grade) => {
                      const selected = (course.grade ?? "") === grade;
                      return (
                        <Pressable
                          key={grade}
                          accessibilityRole="radio"
                          accessibilityState={{
                            checked: selected,
                            disabled: busy,
                          }}
                          disabled={busy}
                          onPress={() =>
                            change(index, { grade: grade || null })
                          }
                          style={({ pressed }) => [
                            styles.gradeOption,
                            selected && styles.gradeOptionSelected,
                            pressed && { opacity: 0.75 },
                          ]}
                        >
                          <Text
                            style={[
                              styles.gradeOptionText,
                              selected && styles.gradeOptionTextSelected,
                            ]}
                          >
                            {grade || "—"}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ) : (
                <ToolField
                  label="Grade (optional)"
                  value={course.grade ?? ""}
                  autoCapitalize="characters"
                  maxLength={3}
                  editable={!busy}
                  placeholder="e.g. A"
                  onChangeText={(grade) =>
                    change(index, {
                      grade: grade.trim().toUpperCase() || null,
                    })
                  }
                />
              )}
            </View>
          ))}

          {courses.length && courses.length < 100 ? (
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={addCourse}
              style={({ pressed }) => [
                styles.addAnother,
                (pressed || busy) && { opacity: 0.62 },
              ]}
            >
              <Ionicons
                name="add-circle-outline"
                size={20}
                color={theme.accentText}
              />
              <Text style={styles.addAnotherText}>Add another course</Text>
            </Pressable>
          ) : null}

          {error ? (
            <View accessibilityRole="alert" style={styles.errorCard}>
              <Ionicons
                name="alert-circle-outline"
                size={20}
                color={theme.error}
              />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {dirty ? (
            <ToolButton
              label={busy ? "Saving course plan…" : "Save course plan"}
              disabled={busy}
              onPress={() => void save()}
            />
          ) : null}
        </>
      )}

      <Pressable
        accessibilityRole="button"
        onPress={() => router.push("/gpa")}
        style={({ pressed }) => [
          styles.completedRow,
          pressed && { opacity: 0.72 },
        ]}
      >
        <View style={styles.completedIcon}>
          <Ionicons
            name="calculator-outline"
            size={21}
            color={theme.accentText}
          />
        </View>
        <View style={styles.completedCopy}>
          <Text style={styles.completedTitle}>Completed GPA & CGPA</Text>
        </View>
        <Ionicons name="chevron-forward" size={19} color={theme.textMuted} />
      </Pressable>
    </ToolPage>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    importAction: {
      alignItems: "center",
      backgroundColor: theme.surface,
      borderColor: theme.border,
      borderRadius: 14,
      borderWidth: 1,
      flexDirection: "row",
      gap: 8,
      justifyContent: "center",
      minHeight: 50,
      paddingHorizontal: 16,
      marginBottom: 10,
    },
    importActionText: {
      color: theme.accentText,
      fontFamily: theme.font.semibold,
      fontSize: 14,
    },
    importActionDisabled: { opacity: 0.55 },
    importMessage: {
      color: theme.textMuted,
      fontFamily: theme.font.medium,
      fontSize: 12.5,
      lineHeight: 18,
      marginBottom: 12,
    },
    importPicker: {
      backgroundColor: theme.surface,
      borderColor: theme.border,
      borderRadius: 16,
      borderWidth: 1,
      marginBottom: 16,
      overflow: "hidden",
    },
    importPickerTitle: {
      color: theme.text,
      fontFamily: theme.font.semibold,
      fontSize: 13,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    importTerm: {
      alignItems: "center",
      borderTopColor: theme.border,
      borderTopWidth: 1,
      flexDirection: "row",
      minHeight: 58,
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    importTermCopy: { flex: 1, minWidth: 0 },
    importTermTitle: {
      color: theme.text,
      fontFamily: theme.font.semibold,
      fontSize: 13.5,
    },
    importTermMeta: {
      color: theme.textMuted,
      fontFamily: theme.font.body,
      fontSize: 12,
      marginTop: 2,
    },
    syncCard: {
      flexDirection: "row",
      gap: 12,
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 16,
      padding: 15,
      marginBottom: 18,
    },
    syncIcon: {
      width: 40,
      height: 40,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.surfaceMuted,
      flexShrink: 0,
    },
    syncCopy: { flex: 1, minWidth: 0 },
    syncTitle: {
      fontFamily: theme.font.semibold,
      fontSize: 14,
      color: theme.text,
    },
    syncBody: {
      fontFamily: theme.font.body,
      fontSize: 13,
      lineHeight: 20,
      color: theme.textMuted,
      marginTop: 4,
    },
    retryAction: {
      alignSelf: "flex-start",
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      minHeight: 38,
      marginTop: 8,
      paddingRight: 10,
    },
    retryText: {
      fontFamily: theme.font.semibold,
      fontSize: 13,
      color: theme.accentText,
    },
    summaryCard: {
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 18,
      padding: 18,
      marginBottom: 18,
      ...theme.shadow,
    },
    summaryTop: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 12,
    },
    summaryCopy: { flex: 1, minWidth: 0 },
    eyebrow: {
      fontFamily: theme.font.semibold,
      fontSize: 11,
      letterSpacing: 1.1,
      color: theme.textMuted,
    },
    summaryValue: {
      fontFamily: theme.font.displayStrong,
      fontSize: 40,
      lineHeight: 48,
      color: theme.text,
      marginTop: 3,
    },
    summaryCaption: {
      fontFamily: theme.font.body,
      fontSize: 13,
      lineHeight: 20,
      color: theme.textMuted,
    },
    summaryIcon: {
      width: 46,
      height: 46,
      borderRadius: 14,
      backgroundColor: theme.surfaceMuted,
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
    },
    syncStatus: {
      flexDirection: "row",
      alignItems: "center",
      gap: 7,
      marginTop: 14,
    },
    syncDot: {
      width: 7,
      height: 7,
      borderRadius: 4,
      backgroundColor: theme.statusPositive,
    },
    syncStatusText: {
      fontFamily: theme.font.medium,
      fontSize: 12,
      color: theme.textMuted,
    },
    scaleNote: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 8,
      marginTop: 14,
      paddingTop: 14,
      borderTopWidth: 1,
      borderColor: theme.border,
    },
    scaleNoteText: {
      flex: 1,
      minWidth: 0,
      fontFamily: theme.font.body,
      fontSize: 12,
      lineHeight: 19,
      color: theme.textMuted,
    },
    emptyState: {
      alignItems: "center",
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 18,
      padding: 20,
      marginBottom: 18,
      ...theme.shadow,
    },
    emptyIcon: {
      width: 46,
      height: 46,
      borderRadius: 14,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.surfaceMuted,
      marginBottom: 10,
    },
    emptyTitle: {
      fontFamily: theme.font.display,
      fontSize: 20,
      color: theme.text,
    },
    emptyBody: {
      fontFamily: theme.font.body,
      fontSize: 14,
      lineHeight: 22,
      color: theme.textMuted,
      marginTop: 8,
    },
    primaryAdd: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      alignSelf: "stretch",
      gap: 8,
      minHeight: 50,
      borderRadius: 14,
      paddingHorizontal: 18,
      marginTop: 14,
      backgroundColor: theme.deepBrand,
    },
    primaryAddText: {
      fontFamily: theme.font.semibold,
      fontSize: 14,
      color: "#FFFFFF",
    },
    courseCard: {
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 16,
      padding: 16,
      marginBottom: 14,
    },
    courseHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: 11,
      marginBottom: 18,
    },
    courseNumber: {
      width: 34,
      height: 34,
      borderRadius: 11,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.surfaceMuted,
      flexShrink: 0,
    },
    courseNumberText: {
      fontFamily: theme.font.semibold,
      fontSize: 13,
      color: theme.accentText,
    },
    courseHeadingCopy: { flex: 1, minWidth: 0 },
    courseHeading: {
      fontFamily: theme.font.semibold,
      fontSize: 15,
      color: theme.text,
    },
    courseSubheading: {
      fontFamily: theme.font.body,
      fontSize: 12,
      lineHeight: 18,
      color: theme.textMuted,
      marginTop: 2,
    },
    removeButton: {
      width: 42,
      height: 42,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.surfaceMuted,
      flexShrink: 0,
    },
    gradeSection: { marginBottom: 4 },
    gradeLabel: {
      fontFamily: theme.font.medium,
      fontSize: 13,
      color: theme.text,
      marginBottom: 9,
    },
    gradeOptions: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
    },
    gradeOption: {
      minWidth: 46,
      minHeight: 44,
      paddingHorizontal: 12,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.surfaceMuted,
      borderWidth: 1,
      borderColor: "transparent",
    },
    gradeOptionSelected: {
      backgroundColor: theme.deepBrand,
      borderColor: theme.deepBrand,
    },
    gradeOptionText: {
      fontFamily: theme.font.semibold,
      fontSize: 13,
      color: theme.text,
    },
    gradeOptionTextSelected: { color: "#FFFFFF" },
    addAnother: {
      minHeight: 52,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      paddingHorizontal: 16,
      marginBottom: 8,
    },
    addAnotherText: {
      fontFamily: theme.font.semibold,
      fontSize: 14,
      color: theme.accentText,
    },
    errorCard: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 9,
      borderWidth: 1,
      borderColor: theme.error,
      borderRadius: 14,
      padding: 13,
      marginVertical: 8,
    },
    errorText: {
      flex: 1,
      minWidth: 0,
      fontFamily: theme.font.body,
      fontSize: 13,
      lineHeight: 20,
      color: theme.error,
    },
    completedRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      minHeight: 68,
      marginTop: 20,
      paddingVertical: 12,
      borderTopWidth: 1,
      borderColor: theme.border,
    },
    completedIcon: {
      width: 42,
      height: 42,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.surfaceMuted,
      flexShrink: 0,
    },
    completedCopy: { flex: 1, minWidth: 0 },
    completedTitle: {
      fontFamily: theme.font.semibold,
      fontSize: 14,
      color: theme.text,
    },
    completedDetail: {
      fontFamily: theme.font.body,
      fontSize: 12,
      lineHeight: 18,
      color: theme.textMuted,
      marginTop: 2,
    },
  });
