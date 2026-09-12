import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from "react-native";

import { ProductScreen } from "@/src/components/product-ui";
import { ApiError, api } from "@/src/lib/api";
import { theme } from "@/src/theme";

type Result = {
  courseCode: string;
  courseTitle: string;
  units: string | number;
  grade: string;
  gradePoint: string | number;
};

type Term = {
  id: string;
  session_label: string;
  semester: number;
  level_code: string;
  gpa: string | number;
  earned_units: string | number;
  results: Result[];
};

type GpaData = {
  terms: Term[];
  summary: { cgpa: string | number | null; total_units: string | number | null } | null;
};

const gradePoints: Record<string, number> = { A: 5, B: 4, C: 3, D: 2, E: 1, F: 0 };
const grades = Object.keys(gradePoints);

export default function GpaScreen() {
  const [data, setData] = useState<GpaData | null>(null);
  const [editing, setEditing] = useState(false);
  const [sessionLabel, setSessionLabel] = useState("2025/2026");
  const [semester, setSemester] = useState("1");
  const [levelCode, setLevelCode] = useState("100");
  const [courseCode, setCourseCode] = useState("");
  const [courseTitle, setCourseTitle] = useState("");
  const [units, setUnits] = useState("3");
  const [grade, setGrade] = useState("A");
  const [results, setResults] = useState<Result[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setError("");
      setData(await api<GpaData>("/v1/student/gpa"));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Your GPA records could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const normalizedGrade = grade.trim().toUpperCase();
  const numericUnits = Number(units);
  const canAddCourse = courseCode.trim().length > 0
    && courseTitle.trim().length > 0
    && gradePoints[normalizedGrade] !== undefined
    && Number.isFinite(numericUnits)
    && numericUnits > 0;

  const plannedGpa = useMemo(() => {
    let weightedPoints = 0;
    let totalUnits = 0;
    for (const result of results) {
      const resultUnits = Number(result.units);
      const resultPoint = Number(result.gradePoint);
      if (!Number.isFinite(resultUnits) || !Number.isFinite(resultPoint)) continue;
      weightedPoints += resultUnits * resultPoint;
      totalUnits += resultUnits;
    }
    return totalUnits > 0 ? (weightedPoints / totalUnits).toFixed(2) : "—";
  }, [results]);

  function addCourse() {
    const gradePoint = gradePoints[normalizedGrade];
    if (!canAddCourse || gradePoint === undefined) return;
    const normalizedCode = courseCode.trim().toUpperCase();
    setResults((items) => [
      ...items.filter((item) => item.courseCode !== normalizedCode),
      {
        courseCode: normalizedCode,
        courseTitle: courseTitle.trim(),
        units: numericUnits,
        grade: normalizedGrade,
        gradePoint,
      },
    ]);
    setCourseCode("");
    setCourseTitle("");
  }

  async function save() {
    if (results.length === 0 || saving) return;
    setSaving(true);
    setError("");
    try {
      await api("/v1/student/gpa", {
        method: "POST",
        body: JSON.stringify({ sessionLabel, semester: Number(semester), levelCode, results }),
      });
      setEditing(false);
      setResults([]);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The semester could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  function toggleEditor() {
    setError("");
    setEditing((value) => !value);
  }

  function retry() {
    setLoading(true);
    void load();
  }

  return (
    <ProductScreen>
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="Go back"
          accessibilityRole="button"
          hitSlop={4}
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
        >
          <Ionicons name="arrow-back" size={22} color={theme.text} />
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>ACADEMIC RECORD</Text>
          <Text style={styles.pageTitle}>GPA & CGPA</Text>
          <Text style={styles.subtitle}>Save completed results and follow your cumulative progress.</Text>
        </View>
      </View>

      {loading ? <SummarySkeleton /> : <AcademicSummary data={data} />}

      <Pressable
        accessibilityLabel={editing ? "Close semester result form" : "Add semester results"}
        accessibilityRole="button"
        onPress={toggleEditor}
        style={({ pressed }) => [styles.addAction, editing && styles.closeAction, pressed && styles.pressed]}
      >
        <Ionicons name={editing ? "close" : "add"} size={20} color={editing ? theme.deepBrand : "#FFFFFF"} />
        <Text style={[styles.addActionText, editing && styles.closeActionText]}>{editing ? "Close result form" : "Add semester results"}</Text>
      </Pressable>

      {editing ? (
        <View style={styles.form}>
          <View style={styles.formHeading}>
            <Text style={styles.formTitle}>Semester details</Text>
            <Text style={styles.formIntro}>Add only completed courses with confirmed grades.</Text>
          </View>
          <View style={styles.double}>
            <View style={styles.half}>
              <Field label="Session" onChangeText={setSessionLabel} value={sessionLabel} />
            </View>
            <View style={styles.half}>
              <Field keyboardType="number-pad" label="Level" onChangeText={setLevelCode} value={levelCode} />
            </View>
          </View>
          <Text style={styles.label}>Semester</Text>
          <View accessibilityLabel="Choose semester" accessibilityRole="radiogroup" style={styles.segmented}>
            {["1", "2", "3"].map((item) => {
              const selected = semester === item;
              return (
                <Pressable
                  accessibilityLabel={`Semester ${item}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  key={item}
                  onPress={() => setSemester(item)}
                  style={({ pressed }) => [styles.segment, selected && styles.segmentActive, pressed && styles.pressed]}
                >
                  <Text style={[styles.segmentText, selected && styles.segmentTextActive]}>Semester {item}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.formDivider} />
          <Text style={styles.formTitle}>Course result</Text>
          <View style={styles.double}>
            <View style={styles.half}>
              <Field autoCapitalize="characters" label="Course code" onChangeText={setCourseCode} placeholder="CPE 211" value={courseCode} />
            </View>
            <View style={styles.unitsField}>
              <Field keyboardType="number-pad" label="Units" onChangeText={setUnits} value={units} />
            </View>
          </View>
          <Field autoCapitalize="words" label="Course title" onChangeText={setCourseTitle} placeholder="Circuit Theory" value={courseTitle} />
          <Text style={styles.label}>Grade</Text>
          <View accessibilityLabel="Choose grade" accessibilityRole="radiogroup" style={styles.gradeRow}>
            {grades.map((item) => {
              const selected = normalizedGrade === item;
              return (
                <Pressable
                  accessibilityLabel={`Grade ${item}, ${gradePoints[item]} points`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  key={item}
                  onPress={() => setGrade(item)}
                  style={({ pressed }) => [styles.grade, selected && styles.gradeActive, pressed && styles.pressed]}
                >
                  <Text style={[styles.gradeText, selected && styles.gradeTextActive]}>{item}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.courseHint}>Course code, title and units are required before adding a row.</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !canAddCourse }}
            disabled={!canAddCourse}
            onPress={addCourse}
            style={({ pressed }) => [styles.addCourse, !canAddCourse && styles.secondaryDisabled, pressed && canAddCourse && styles.pressed]}
          >
            <Ionicons name="add-circle-outline" size={19} color={canAddCourse ? theme.deepBrand : theme.textMuted} />
            <Text style={[styles.addCourseText, !canAddCourse && styles.secondaryDisabledText]}>Add course to semester</Text>
          </Pressable>

          {results.length > 0 ? (
            <View style={styles.staged}>
              <View style={styles.stagedHeading}>
                <View>
                  <Text style={styles.stagedTitle}>Ready to save</Text>
                  <Text style={styles.stagedMeta}>{results.length} {results.length === 1 ? "course" : "courses"}</Text>
                </View>
                <View style={styles.planValue}>
                  <Text style={styles.planNumber}>{plannedGpa}</Text>
                  <Text style={styles.planLabel}>GPA</Text>
                </View>
              </View>
              <View style={styles.tableHeading}>
                <Text style={[styles.tableHeadingText, styles.codeColumn]}>COURSE</Text>
                <Text style={[styles.tableHeadingText, styles.courseColumn]}>TITLE</Text>
                <Text style={styles.tableHeadingText}>GRADE</Text>
              </View>
              {results.map((item) => (
                <View key={item.courseCode} style={styles.pendingRow}>
                  <Text style={[styles.pendingCode, styles.codeColumn]}>{item.courseCode}</Text>
                  <Text numberOfLines={1} style={[styles.pendingTitle, styles.courseColumn]}>{item.courseTitle}</Text>
                  <Text style={styles.pendingGrade}>{item.grade} · {item.units}u</Text>
                </View>
              ))}
            </View>
          ) : null}

          {error ? <Text accessibilityRole="alert" style={styles.formError}>{error}</Text> : null}
          <Pressable
            accessibilityLabel={saving ? "Calculating and saving semester" : "Calculate and save semester"}
            accessibilityRole="button"
            accessibilityState={{ disabled: results.length === 0 || saving, busy: saving }}
            disabled={results.length === 0 || saving}
            onPress={() => void save()}
            style={({ pressed }) => [styles.save, (results.length === 0 || saving) && styles.primaryDisabled, pressed && results.length > 0 && !saving && styles.pressed]}
          >
            {saving
              ? <ActivityIndicator color="#FFFFFF" />
              : <Text style={[styles.saveText, results.length === 0 && styles.primaryDisabledText]}>Calculate and save semester</Text>}
          </Pressable>
        </View>
      ) : null}

      {!editing && error ? <ErrorNotice message={error} onRetry={retry} /> : null}
      {!loading && !error && !data?.terms.length ? <GpaEmpty /> : null}
      {!loading && data?.terms.length ? (
        <View style={styles.history}>
          <View style={styles.historyHeading}>
            <Text style={styles.historyTitle}>Academic history</Text>
            <Text style={styles.historyMeta}>{data.terms.length} {data.terms.length === 1 ? "semester" : "semesters"}</Text>
          </View>
          {data.terms.map((term) => <TermResult key={term.id} term={term} />)}
        </View>
      ) : null}
    </ProductScreen>
  );
}

function AcademicSummary({ data }: { data: GpaData | null }) {
  const cgpa = data?.summary?.cgpa ?? "—";
  const totalUnits = data?.summary?.total_units ?? 0;
  return (
    <View accessible accessibilityLabel={`Cumulative GPA ${cgpa} out of 5.00. ${totalUnits} earned units.`} style={styles.summary}>
      <View style={styles.summaryTop}>
        <View>
          <Text style={styles.summaryLabel}>Cumulative GPA</Text>
          <View style={styles.cgpaRow}>
            <Text style={styles.cgpa}>{cgpa}</Text>
            <Text style={styles.scale}>/ 5.00</Text>
          </View>
        </View>
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.summaryIcon}>
          <Ionicons name="school-outline" size={25} color={theme.deepBrand} />
        </View>
      </View>
      <View style={styles.summaryRule} />
      <View style={styles.summaryFoot}>
        <Text style={styles.summaryFootLabel}>Earned units</Text>
        <Text style={styles.summaryFootValue}>{totalUnits}</Text>
      </View>
    </View>
  );
}

function SummarySkeleton() {
  return (
    <View accessibilityLabel="Loading GPA records" accessibilityRole="progressbar" style={styles.summary}>
      <View style={styles.skeletonLabel} />
      <View style={styles.skeletonValue} />
      <View style={styles.summaryRule} />
      <View style={styles.skeletonFoot} />
    </View>
  );
}

function Field({ label, ...props }: TextInputProps & { label: string }) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        onBlur={() => setFocused(false)}
        onFocus={() => setFocused(true)}
        placeholderTextColor={theme.textMuted}
        style={[styles.field, focused && styles.fieldFocused]}
        {...props}
      />
    </View>
  );
}

function TermResult({ term }: { term: Term }) {
  return (
    <View style={styles.term}>
      <View style={styles.termTop}>
        <View style={styles.termCopy}>
          <Text style={styles.termSession}>{term.session_label}</Text>
          <Text style={styles.termLevel}>{term.level_code} level · Semester {term.semester} · {term.earned_units} units</Text>
        </View>
        <View accessible accessibilityLabel={`GPA ${term.gpa}`} style={styles.termGpa}>
          <Text style={styles.termGpaValue}>{term.gpa}</Text>
          <Text style={styles.termGpaLabel}>GPA</Text>
        </View>
      </View>
      <View style={styles.tableHeading}>
        <Text style={[styles.tableHeadingText, styles.codeColumn]}>COURSE</Text>
        <Text style={[styles.tableHeadingText, styles.courseColumn]}>TITLE</Text>
        <Text style={styles.tableHeadingText}>GRADE</Text>
      </View>
      {term.results.map((result) => (
        <View key={result.courseCode} style={styles.resultRow}>
          <Text style={[styles.resultCode, styles.codeColumn]}>{result.courseCode}</Text>
          <Text numberOfLines={1} style={[styles.resultTitle, styles.courseColumn]}>{result.courseTitle}</Text>
          <Text style={styles.resultGrade}>{result.grade} · {result.units}u</Text>
        </View>
      ))}
    </View>
  );
}

function ErrorNotice({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View accessibilityRole="alert" style={styles.errorNotice}>
      <Ionicons name="alert-circle-outline" size={22} color={theme.deepBrand} />
      <View style={styles.errorCopy}>
        <Text style={styles.errorTitle}>Academic record unavailable</Text>
        <Text style={styles.errorText}>{message}</Text>
      </View>
      <Pressable accessibilityLabel="Retry GPA records" accessibilityRole="button" onPress={onRetry} style={({ pressed }) => [styles.retry, pressed && styles.pressed]}>
        <Text style={styles.retryText}>Retry</Text>
      </Pressable>
    </View>
  );
}

function GpaEmpty() {
  return (
    <View style={styles.empty}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.emptyArt}>
        <View style={styles.emptySheet}>
          <View style={styles.emptyTopline} />
          <View style={styles.emptyGradeRow}><View style={styles.emptyCourseLine} /><Text style={styles.emptyGrade}>A</Text></View>
          <View style={styles.emptyGradeRow}><View style={styles.emptyCourseLineShort} /><Text style={styles.emptyGrade}>B</Text></View>
          <View style={styles.emptyBadge}><Ionicons name="trending-up" size={24} color={theme.deepBrand} /></View>
        </View>
      </View>
      <Text style={styles.emptyTitle}>No results saved yet</Text>
      <Text style={styles.emptyBody}>Add the courses from a completed semester to calculate its GPA and begin your cumulative record.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: "flex-start", flexDirection: "row", gap: 12, paddingBottom: 20, paddingTop: 6 },
  backButton: { alignItems: "center", height: 44, justifyContent: "center", marginLeft: -10, width: 44 },
  headerCopy: { flex: 1 },
  eyebrow: { color: theme.deepBrand, fontFamily: theme.font.bold, fontSize: 11, letterSpacing: 1.15 },
  pageTitle: { color: theme.text, fontFamily: theme.font.display, fontSize: 27, letterSpacing: -0.45, lineHeight: 33, marginTop: 2 },
  subtitle: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 14, lineHeight: 21, marginTop: 2 },
  summary: { backgroundColor: theme.sand, borderColor: "rgba(168,70,46,0.16)", borderRadius: 22, borderWidth: 1, minHeight: 170, padding: 20 },
  summaryTop: { alignItems: "flex-start", flexDirection: "row", justifyContent: "space-between" },
  summaryLabel: { color: theme.deepBrand, fontFamily: theme.font.semibold, fontSize: 13 },
  cgpaRow: { alignItems: "baseline", flexDirection: "row", gap: 7, marginTop: 5 },
  cgpa: { color: theme.text, fontFamily: theme.font.displayStrong, fontSize: 46, fontVariant: ["tabular-nums"], letterSpacing: -1.2, lineHeight: 53 },
  scale: { color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 14 },
  summaryIcon: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.55)", borderRadius: 16, height: 52, justifyContent: "center", width: 52 },
  summaryRule: { backgroundColor: "rgba(41,35,31,0.12)", height: 1, marginVertical: 15 },
  summaryFoot: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  summaryFootLabel: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 13.5 },
  summaryFootValue: { color: theme.text, fontFamily: theme.font.bold, fontSize: 15, fontVariant: ["tabular-nums"] },
  skeletonLabel: { backgroundColor: "rgba(41,35,31,0.09)", borderRadius: 5, height: 12, width: 104 },
  skeletonValue: { backgroundColor: "rgba(41,35,31,0.09)", borderRadius: 9, height: 44, marginTop: 12, width: 126 },
  skeletonFoot: { backgroundColor: "rgba(41,35,31,0.09)", borderRadius: 5, height: 13, width: 148 },
  addAction: { alignItems: "center", alignSelf: "flex-start", backgroundColor: theme.deepBrand, borderRadius: 14, flexDirection: "row", gap: 8, height: 48, justifyContent: "center", marginBottom: 22, marginTop: 16, paddingHorizontal: 16 },
  addActionText: { color: "#FFFFFF", fontFamily: theme.font.semibold, fontSize: 14 },
  closeAction: { backgroundColor: "transparent", borderColor: "rgba(168,70,46,0.35)", borderWidth: 1.5 },
  closeActionText: { color: theme.deepBrand },
  form: { backgroundColor: theme.surfaceRaised, borderColor: theme.border, borderRadius: 20, borderWidth: 1, marginBottom: 24, padding: 18 },
  formHeading: { marginBottom: 17 },
  formTitle: { color: theme.text, fontFamily: theme.font.display, fontSize: 19, lineHeight: 24 },
  formIntro: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 13, lineHeight: 19, marginTop: 3 },
  double: { flexDirection: "row", gap: 10 },
  half: { flex: 1 },
  unitsField: { width: 96 },
  fieldWrap: { marginBottom: 14 },
  label: { color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 13, marginBottom: 7 },
  field: { backgroundColor: theme.canvas, borderColor: "rgba(41,35,31,0.18)", borderRadius: 15, borderWidth: 1.5, color: theme.text, fontFamily: theme.font.body, fontSize: 15, minHeight: 52, paddingHorizontal: 15 },
  fieldFocused: { borderColor: theme.brand, shadowColor: theme.brand, shadowOffset: { height: 0, width: 0 }, shadowOpacity: 0.14, shadowRadius: 4 },
  segmented: { backgroundColor: theme.surfaceMuted, borderRadius: 14, flexDirection: "row", gap: 4, marginBottom: 4, padding: 4 },
  segment: { alignItems: "center", borderRadius: 11, flex: 1, height: 44, justifyContent: "center" },
  segmentActive: { backgroundColor: theme.surfaceRaised, borderColor: theme.border, borderWidth: 1 },
  segmentText: { color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 13.5 },
  segmentTextActive: { color: theme.deepBrand, fontFamily: theme.font.semibold },
  formDivider: { backgroundColor: theme.border, height: 1, marginBottom: 18, marginTop: 20 },
  gradeRow: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  grade: { alignItems: "center", borderColor: "rgba(41,35,31,0.16)", borderRadius: 12, borderWidth: 1, height: 46, justifyContent: "center", width: "30%" },
  gradeActive: { backgroundColor: theme.sand, borderColor: "rgba(168,70,46,0.34)" },
  gradeText: { color: theme.textMuted, fontFamily: theme.font.semibold, fontSize: 14 },
  gradeTextActive: { color: theme.deepBrand, fontFamily: theme.font.bold },
  courseHint: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 12.5, lineHeight: 18, marginTop: 9 },
  addCourse: { alignItems: "center", borderColor: theme.deepBrand, borderRadius: 14, borderWidth: 1.5, flexDirection: "row", gap: 8, height: 48, justifyContent: "center", marginTop: 12 },
  addCourseText: { color: theme.deepBrand, fontFamily: theme.font.semibold, fontSize: 14 },
  secondaryDisabled: { borderColor: theme.border, backgroundColor: "rgba(41,35,31,0.04)" },
  secondaryDisabledText: { color: theme.textMuted },
  staged: { borderColor: theme.border, borderRadius: 17, borderWidth: 1, marginTop: 18, overflow: "hidden" },
  stagedHeading: { alignItems: "center", backgroundColor: theme.surfaceMuted, flexDirection: "row", justifyContent: "space-between", padding: 14 },
  stagedTitle: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 14.5 },
  stagedMeta: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 12.5, marginTop: 2 },
  planValue: { alignItems: "flex-end" },
  planNumber: { color: theme.deepBrand, fontFamily: theme.font.displayStrong, fontSize: 21, fontVariant: ["tabular-nums"] },
  planLabel: { color: theme.textMuted, fontFamily: theme.font.bold, fontSize: 10, letterSpacing: 0.6 },
  tableHeading: { alignItems: "center", backgroundColor: theme.canvas, borderTopColor: theme.border, borderTopWidth: 1, flexDirection: "row", minHeight: 34, paddingHorizontal: 13 },
  tableHeadingText: { color: theme.textMuted, fontFamily: theme.font.bold, fontSize: 10, letterSpacing: 0.65 },
  codeColumn: { width: 72 },
  courseColumn: { flex: 1 },
  pendingRow: { alignItems: "center", borderTopColor: theme.border, borderTopWidth: 1, flexDirection: "row", minHeight: 48, paddingHorizontal: 13 },
  pendingCode: { color: theme.deepBrand, fontFamily: theme.font.bold, fontSize: 11 },
  pendingTitle: { color: theme.text, fontFamily: theme.font.body, fontSize: 12.5, paddingRight: 8 },
  pendingGrade: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 12 },
  formError: { color: theme.deepBrand, fontFamily: theme.font.medium, fontSize: 13, lineHeight: 19, marginTop: 14 },
  save: { alignItems: "center", backgroundColor: theme.deepBrand, borderRadius: 16, height: 52, justifyContent: "center", marginTop: 16 },
  saveText: { color: "#FFFFFF", fontFamily: theme.font.semibold, fontSize: 15.5 },
  primaryDisabled: { backgroundColor: "rgba(41,35,31,0.08)" },
  primaryDisabledText: { color: theme.textMuted },
  errorNotice: { alignItems: "center", backgroundColor: "rgba(168,70,46,0.07)", borderColor: "rgba(168,70,46,0.24)", borderRadius: 16, borderWidth: 1, flexDirection: "row", gap: 10, marginBottom: 22, padding: 14 },
  errorCopy: { flex: 1 },
  errorTitle: { color: theme.deepBrand, fontFamily: theme.font.semibold, fontSize: 14 },
  errorText: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 12.5, lineHeight: 18, marginTop: 2 },
  retry: { alignItems: "center", borderColor: "rgba(168,70,46,0.32)", borderRadius: 11, borderWidth: 1, height: 44, justifyContent: "center", paddingHorizontal: 12 },
  retryText: { color: theme.deepBrand, fontFamily: theme.font.semibold, fontSize: 13 },
  history: { gap: 13 },
  historyHeading: { alignItems: "baseline", flexDirection: "row", justifyContent: "space-between" },
  historyTitle: { color: theme.text, fontFamily: theme.font.display, fontSize: 20 },
  historyMeta: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 13 },
  term: { backgroundColor: theme.surfaceRaised, borderColor: theme.border, borderRadius: 19, borderWidth: 1, overflow: "hidden" },
  termTop: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", padding: 15 },
  termCopy: { flex: 1, paddingRight: 12 },
  termSession: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 15 },
  termLevel: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 12.5, lineHeight: 18, marginTop: 3 },
  termGpa: { alignItems: "flex-end" },
  termGpaValue: { color: theme.deepBrand, fontFamily: theme.font.displayStrong, fontSize: 22, fontVariant: ["tabular-nums"] },
  termGpaLabel: { color: theme.textMuted, fontFamily: theme.font.bold, fontSize: 10, letterSpacing: 0.65 },
  resultRow: { alignItems: "center", borderTopColor: theme.border, borderTopWidth: 1, flexDirection: "row", minHeight: 48, paddingHorizontal: 13 },
  resultCode: { color: theme.deepBrand, fontFamily: theme.font.bold, fontSize: 11 },
  resultTitle: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 12.5, paddingRight: 8 },
  resultGrade: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 12 },
  empty: { alignItems: "center", paddingHorizontal: 18, paddingVertical: 34 },
  emptyArt: { alignItems: "center", height: 145, justifyContent: "center", width: 180 },
  emptySheet: { backgroundColor: theme.surfaceRaised, borderColor: "rgba(168,70,46,0.20)", borderRadius: 18, borderWidth: 1.5, height: 118, padding: 18, transform: [{ rotate: "2deg" }], width: 144 },
  emptyTopline: { backgroundColor: theme.brand, borderRadius: 3, height: 7, marginBottom: 17, width: 58 },
  emptyGradeRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginTop: 9 },
  emptyCourseLine: { backgroundColor: theme.sand, borderRadius: 4, height: 8, width: 68 },
  emptyCourseLineShort: { backgroundColor: theme.surfaceTint, borderRadius: 4, height: 8, width: 48 },
  emptyGrade: { color: theme.deepBrand, fontFamily: theme.font.bold, fontSize: 15 },
  emptyBadge: { alignItems: "center", backgroundColor: theme.sand, borderColor: theme.canvas, borderRadius: 26, borderWidth: 5, bottom: -23, height: 52, justifyContent: "center", position: "absolute", right: -23, width: 52 },
  emptyTitle: { color: theme.text, fontFamily: theme.font.display, fontSize: 20, lineHeight: 25, textAlign: "center" },
  emptyBody: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 14, lineHeight: 21, marginTop: 7, maxWidth: 315, textAlign: "center" },
  pressed: { opacity: 0.82, transform: [{ scale: 0.97 }] },
});
