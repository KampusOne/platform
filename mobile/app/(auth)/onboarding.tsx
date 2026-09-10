import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { useAuth } from "@/src/auth/auth-context";
import { AuthField, AuthShell, FormError, PrimaryButton } from "@/src/components/auth-ui";
import { ApiError, api } from "@/src/lib/api";
import { theme } from "@/src/theme";

type Item = { id: string; name: string; university_id?: string; faculty_id?: string; department_id?: string; code?: string };
type Catalog = { universities: Item[]; faculties: Item[]; departments: Item[]; courses: Item[] };

function ChoiceRow({ items, selected, onSelect }: { items: Item[]; selected: string; onSelect: (id: string) => void }) {
  return (
    <ScrollView contentContainerStyle={styles.choices} horizontal showsHorizontalScrollIndicator={false}>
      {items.map((item) => (
        <Pressable key={item.id} onPress={() => onSelect(item.id)} style={[styles.choice, selected === item.id && styles.choiceActive]}>
          <Text style={[styles.choiceText, selected === item.id && styles.choiceTextActive]}>{item.code ? `${item.code} · ` : ""}{item.name}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

export default function OnboardingScreen() {
  const { profile, reloadProfile } = useAuth();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [universityId, setUniversityId] = useState("");
  const [facultyId, setFacultyId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [courseId, setCourseId] = useState("");
  const [username, setUsername] = useState("");
  const [matriculationNumber, setMatriculationNumber] = useState("");
  const [currentLevel, setCurrentLevel] = useState("100");
  const [graduationYear, setGraduationYear] = useState(String(new Date().getFullYear() + 4));
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void api<Catalog>("/v1/student/catalog").then((data) => {
      setCatalog(data);
      setUniversityId(data.universities[0]?.id ?? "");
    }).catch((caught) => setError(caught instanceof ApiError ? caught.message : "School details could not be loaded."));
  }, []);
  const faculties = useMemo(() => catalog?.faculties.filter((item) => item.university_id === universityId) ?? [], [catalog, universityId]);
  const departments = useMemo(() => catalog?.departments.filter((item) => item.faculty_id === facultyId) ?? [], [catalog, facultyId]);
  const courses = useMemo(() => catalog?.courses.filter((item) => item.department_id === departmentId) ?? [], [catalog, departmentId]);

  useEffect(() => { setFacultyId(faculties[0]?.id ?? ""); }, [faculties]);
  useEffect(() => { setDepartmentId(departments[0]?.id ?? ""); }, [departments]);
  useEffect(() => { setCourseId(courses[0]?.id ?? ""); }, [courses]);

  async function submit() {
    setLoading(true); setError("");
    try {
      await api("/v1/student/me/onboarding", { method: "PATCH", body: JSON.stringify({
        firstName: profile?.first_name ?? "Student",
        lastName: profile?.last_name ?? "Member",
        username, universityId, facultyId, departmentId, courseId: courseId || null,
        currentLevel, matriculationNumber, graduationYear: Number(graduationYear),
      }) });
      await reloadProfile();
      router.replace("/(tabs)");
    } catch (caught) { setError(caught instanceof ApiError ? caught.message : "Your profile could not be completed."); }
    finally { setLoading(false); }
  }

  return (
    <AuthShell back={false} subtitle="This keeps your timetable, updates, tutorials and services relevant to your school." title="Set up your campus">
      <Image resizeMode="cover" source={require("@/assets/brand-scenes/campus-life.png")} style={styles.photo} />
      <Text style={styles.label}>University</Text><ChoiceRow items={catalog?.universities ?? []} onSelect={setUniversityId} selected={universityId} />
      <Text style={styles.label}>Faculty</Text><ChoiceRow items={faculties} onSelect={setFacultyId} selected={facultyId} />
      <Text style={styles.label}>Department</Text><ChoiceRow items={departments} onSelect={setDepartmentId} selected={departmentId} />
      {courses.length ? <><Text style={styles.label}>Course</Text><ChoiceRow items={courses} onSelect={setCourseId} selected={courseId} /></> : null}
      <View style={styles.formGap} />
      <AuthField autoCapitalize="none" icon="at-outline" label="Username" onChangeText={(value) => setUsername(value.toLowerCase().replace(/[^a-z0-9_]/g, ""))} value={username} />
      <AuthField autoCapitalize="characters" icon="id-card-outline" label="Matriculation number" onChangeText={setMatriculationNumber} value={matriculationNumber} />
      <View style={styles.double}>
        <View style={styles.half}><AuthField icon="layers-outline" keyboardType="number-pad" label="Current level" maxLength={3} onChangeText={setCurrentLevel} value={currentLevel} /></View>
        <View style={styles.half}><AuthField icon="calendar-outline" keyboardType="number-pad" label="Graduation year" maxLength={4} onChangeText={setGraduationYear} value={graduationYear} /></View>
      </View>
      <FormError message={error} />
      <PrimaryButton disabled={!universityId || !facultyId || !departmentId || username.length < 3 || matriculationNumber.length < 3} loading={loading} onPress={() => void submit()}>Finish setup</PrimaryButton>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  photo: { borderRadius: 22, height: 180, marginBottom: 22, width: "100%" },
  label: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 12, marginBottom: 8, marginTop: 8 },
  choices: { gap: 8, paddingBottom: 7 },
  choice: { backgroundColor: theme.surfaceRaised, borderColor: theme.border, borderRadius: 14, borderWidth: 1, justifyContent: "center", minHeight: 44, paddingHorizontal: 14 },
  choiceActive: { backgroundColor: theme.brand, borderColor: theme.brand },
  choiceText: { color: theme.text, fontFamily: theme.font.medium, fontSize: 12.5 },
  choiceTextActive: { color: "#FFFFFF", fontFamily: theme.font.semibold },
  formGap: { height: 18 },
  double: { flexDirection: "row", gap: 10 },
  half: { flex: 1 },
});
