import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { AppHeader } from "@/src/components/app-header";
import { InlineFeedback, ProductScreen } from "@/src/components/product-ui";
import { theme } from "@/src/theme";

const STORAGE_KEY = "kampusone:gpa-history:v1";
const gradePoints = { A: 5, B: 4, C: 3, D: 2, E: 1, F: 0 } as const;
type Grade = keyof typeof gradePoints;
type Course = { id: string; code: string; units: string; grade: Grade };
type SavedResult = { id: string; label: string; gpa: number; units: number; savedAt: string };

const starterCourses: Course[] = [
  { id: "csc211", code: "CSC 211", units: "3", grade: "A" },
  { id: "edu201", code: "EDU 201", units: "2", grade: "B" },
  { id: "mth213", code: "MTH 213", units: "3", grade: "B" },
];

export default function GpaScreen() {
  const [courses, setCourses] = useState<Course[]>(starterCourses);
  const [semester, setSemester] = useState("2026 · First semester");
  const [history, setHistory] = useState<SavedResult[]>([]);
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    void AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (!stored) return;
      try {
        setHistory(JSON.parse(stored) as SavedResult[]);
      } catch {
        setMessage("Your saved GPA history could not be read on this device.");
      }
    });
  }, []);

  const calculation = useMemo(() => {
    const valid = courses
      .map((course) => ({ ...course, numericUnits: Number(course.units) }))
      .filter((course) => Number.isFinite(course.numericUnits) && course.numericUnits > 0);
    const units = valid.reduce((total, course) => total + course.numericUnits, 0);
    const qualityPoints = valid.reduce(
      (total, course) => total + course.numericUnits * gradePoints[course.grade],
      0,
    );
    return { gpa: units ? qualityPoints / units : 0, units };
  }, [courses]);

  function updateCourse(id: string, update: Partial<Course>) {
    setCourses((current) => current.map((course) => course.id === id ? { ...course, ...update } : course));
  }

  function addCourse() {
    void Haptics.selectionAsync();
    setCourses((current) => [
      ...current,
      { id: `${Date.now()}`, code: "", units: "3", grade: "A" },
    ]);
  }

  async function saveResult() {
    if (calculation.units === 0) {
      setMessage("Add at least one course with valid credit units first.");
      return;
    }
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const next: SavedResult[] = [
      {
        id: `${Date.now()}`,
        label: semester.trim() || "Unnamed semester",
        gpa: calculation.gpa,
        units: calculation.units,
        savedAt: new Date().toISOString(),
      },
      ...history,
    ].slice(0, 12);
    setHistory(next);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setMessage("Saved on this device. Cloud sync will switch on with the academic catalogue.");
  }

  return (
    <ProductScreen>
      <AppHeader
        badge={{ icon: "calculator", text: "Academic tool" }}
        showBell={false}
        subtitle="Calculate and keep each semester in one place."
        title="GPA calculator"
        unread={false}
      />

      <View style={styles.resultCard}>
        <View>
          <Text style={styles.resultLabel}>CURRENT GPA</Text>
          <Text accessibilityLabel={`Current GPA ${calculation.gpa.toFixed(2)} out of 5`} style={styles.resultValue}>
            {calculation.gpa.toFixed(2)}<Text style={styles.resultScale}> / 5.00</Text>
          </Text>
          <Text style={styles.resultMeta}>{calculation.units} credit units included</Text>
        </View>
        <View style={styles.resultIcon}><Ionicons name="school" size={28} color="#FFFFFF" /></View>
      </View>

      {message ? <InlineFeedback message={message} tone={message.startsWith("Saved") ? "success" : "brand"} /> : null}

      <Text style={styles.label}>Semester name</Text>
      <TextInput
        accessibilityLabel="Semester name"
        onChangeText={setSemester}
        placeholder="2026 · First semester"
        placeholderTextColor={theme.textSubtle}
        style={styles.semesterInput}
        value={semester}
      />

      <View style={styles.sectionHead}>
        <View><Text style={styles.sectionTitle}>Courses</Text><Text style={styles.sectionBody}>Use your school&apos;s credit units and grades.</Text></View>
        <Pressable accessibilityRole="button" onPress={addCourse} style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}>
          <Ionicons name="add" size={18} color={theme.brandPressed} /><Text style={styles.addText}>Course</Text>
        </Pressable>
      </View>

      <View style={styles.courseList}>
        {courses.map((course, index) => (
          <View key={course.id} style={styles.courseCard}>
            <TextInput
              accessibilityLabel={`Course ${index + 1} code`}
              autoCapitalize="characters"
              onChangeText={(code) => updateCourse(course.id, { code })}
              placeholder="Course code"
              placeholderTextColor={theme.textSubtle}
              style={styles.courseCode}
              value={course.code}
            />
            <TextInput
              accessibilityLabel={`${course.code || `Course ${index + 1}`} credit units`}
              keyboardType="number-pad"
              maxLength={1}
              onChangeText={(units) => updateCourse(course.id, { units: units.replace(/[^0-9]/g, "") })}
              style={styles.unitsInput}
              value={course.units}
            />
            <View style={styles.gradeRow}>
              {(Object.keys(gradePoints) as Grade[]).map((grade) => (
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ selected: course.grade === grade }}
                  key={grade}
                  onPress={() => {
                    void Haptics.selectionAsync();
                    updateCourse(course.id, { grade });
                  }}
                  style={({ pressed }) => [styles.grade, course.grade === grade && styles.gradeActive, pressed && styles.pressed]}
                >
                  <Text style={[styles.gradeText, course.grade === grade && styles.gradeTextActive]}>{grade}</Text>
                </Pressable>
              ))}
            </View>
            {courses.length > 1 ? (
              <Pressable
                accessibilityLabel={`Remove ${course.code || `course ${index + 1}`}`}
                hitSlop={9}
                onPress={() => setCourses((current) => current.filter((item) => item.id !== course.id))}
                style={styles.remove}
              >
                <Ionicons name="trash-outline" size={18} color={theme.textSubtle} />
              </Pressable>
            ) : null}
          </View>
        ))}
      </View>

      <Pressable accessibilityRole="button" onPress={() => void saveResult()} style={({ pressed }) => [styles.saveButton, pressed && styles.pressed]}>
        <Ionicons name="bookmark" size={19} color="#FFFFFF" /><Text style={styles.saveText}>Save this calculation</Text>
      </Pressable>

      <Text style={styles.sectionTitle}>Saved semesters</Text>
      {history.length ? (
        <View style={styles.historyCard}>
          {history.map((item, index) => (
            <View key={item.id} style={[styles.historyRow, index < history.length - 1 && styles.historyBorder]}>
              <View style={styles.historyIcon}><Ionicons name="stats-chart" size={17} color={theme.brandPressed} /></View>
              <View style={styles.historyCopy}><Text style={styles.historyTitle}>{item.label}</Text><Text style={styles.historyMeta}>{item.units} credit units · {new Date(item.savedAt).toLocaleDateString()}</Text></View>
              <Text style={styles.historyGpa}>{item.gpa.toFixed(2)}</Text>
            </View>
          ))}
        </View>
      ) : (
        <View style={styles.empty}><Ionicons name="bookmark-outline" size={24} color={theme.brand} /><Text style={styles.emptyText}>Your saved semester calculations will appear here.</Text></View>
      )}
    </ProductScreen>
  );
}

const styles = StyleSheet.create({
  resultCard: { alignItems: "center", backgroundColor: theme.deepBrand, borderRadius: 24, flexDirection: "row", justifyContent: "space-between", marginBottom: 14, overflow: "hidden", padding: 20, ...theme.floatingShadow },
  resultLabel: { color: "rgba(255,255,255,0.68)", fontFamily: theme.font.bold, fontSize: 10.5, letterSpacing: 1.3 },
  resultValue: { color: "#FFFFFF", fontFamily: theme.font.displayStrong, fontSize: 43, letterSpacing: -1.5, marginTop: 3 },
  resultScale: { color: "rgba(255,255,255,0.68)", fontFamily: theme.font.display, fontSize: 18 },
  resultMeta: { color: "rgba(255,255,255,0.72)", fontFamily: theme.font.body, fontSize: 11.5, marginTop: 3 },
  resultIcon: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.13)", borderRadius: 22, height: 62, justifyContent: "center", width: 62 },
  label: { color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 12.5, marginBottom: 7, marginTop: 4 },
  semesterInput: { backgroundColor: theme.warmWhite, borderColor: "rgba(41,35,31,0.13)", borderRadius: 15, borderWidth: 1.5, color: theme.text, fontFamily: theme.font.body, fontSize: 14, minHeight: 53, paddingHorizontal: 15, ...theme.shadow },
  sectionHead: { alignItems: "flex-end", flexDirection: "row", justifyContent: "space-between", marginBottom: 11, marginTop: 26 },
  sectionTitle: { color: theme.text, fontFamily: theme.font.displayStrong, fontSize: 22, letterSpacing: -0.4, marginTop: 26 },
  sectionBody: { color: theme.textSubtle, fontFamily: theme.font.body, fontSize: 11.5, marginTop: 3 },
  addButton: { alignItems: "center", backgroundColor: "rgba(233,177,142,0.28)", borderRadius: 13, flexDirection: "row", gap: 4, minHeight: 39, paddingHorizontal: 12 },
  addText: { color: theme.brandPressed, fontFamily: theme.font.semibold, fontSize: 12 },
  courseList: { gap: 9 },
  courseCard: { alignItems: "center", backgroundColor: "rgba(255,253,252,0.90)", borderColor: "rgba(255,255,255,0.97)", borderRadius: 18, borderWidth: 1, flexDirection: "row", gap: 8, minHeight: 72, padding: 10, ...theme.shadow },
  courseCode: { color: theme.text, flex: 1, fontFamily: theme.font.semibold, fontSize: 12.5, minHeight: 42, minWidth: 76 },
  unitsInput: { backgroundColor: theme.surfaceMuted, borderRadius: 11, color: theme.brandPressed, fontFamily: theme.font.bold, fontSize: 13, height: 42, textAlign: "center", width: 40 },
  gradeRow: { flexDirection: "row", gap: 3 },
  grade: { alignItems: "center", borderRadius: 9, height: 31, justifyContent: "center", width: 27 },
  gradeActive: { backgroundColor: theme.brand },
  gradeText: { color: theme.textSubtle, fontFamily: theme.font.semibold, fontSize: 10.5 },
  gradeTextActive: { color: "#FFFFFF" },
  remove: { alignItems: "center", justifyContent: "center", width: 25 },
  saveButton: { alignItems: "center", backgroundColor: theme.brand, borderRadius: 16, flexDirection: "row", gap: 8, justifyContent: "center", marginTop: 15, minHeight: 54, ...theme.shadow },
  saveText: { color: "#FFFFFF", fontFamily: theme.font.semibold, fontSize: 14 },
  historyCard: { backgroundColor: "rgba(255,253,252,0.92)", borderColor: "rgba(255,255,255,0.98)", borderRadius: 19, borderWidth: 1, marginTop: 10, overflow: "hidden", paddingHorizontal: 12, ...theme.shadow },
  historyRow: { alignItems: "center", flexDirection: "row", minHeight: 68, paddingVertical: 10 },
  historyBorder: { borderBottomColor: theme.border, borderBottomWidth: StyleSheet.hairlineWidth },
  historyIcon: { alignItems: "center", backgroundColor: "rgba(233,177,142,0.25)", borderRadius: 12, height: 40, justifyContent: "center", width: 40 },
  historyCopy: { flex: 1, marginLeft: 10 },
  historyTitle: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 12.5 },
  historyMeta: { color: theme.textSubtle, fontFamily: theme.font.body, fontSize: 10.5, marginTop: 3 },
  historyGpa: { color: theme.brandPressed, fontFamily: theme.font.displayStrong, fontSize: 21 },
  empty: { alignItems: "center", backgroundColor: "rgba(255,253,252,0.65)", borderColor: theme.border, borderRadius: 18, borderStyle: "dashed", borderWidth: 1, flexDirection: "row", gap: 10, marginTop: 10, padding: 17 },
  emptyText: { color: theme.textMuted, flex: 1, fontFamily: theme.font.body, fontSize: 12.5, lineHeight: 18 },
  pressed: { opacity: 0.7, transform: [{ scale: 0.98 }] },
});
