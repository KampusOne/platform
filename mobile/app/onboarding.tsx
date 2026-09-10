import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";

import { AuthScreen, ChoiceButton, FormField, FormMessage, PrimaryButton, SecondaryButton } from "@/src/components/auth-ui";
import { theme } from "@/src/theme";

const levels = ["100", "200", "300", "400", "500", "600"] as const;

export default function OnboardingScreen() {
  const [step, setStep] = useState(1);
  const [complete, setComplete] = useState(false);
  const [institution, setInstitution] = useState("uniben");
  const [faculty, setFaculty] = useState("");
  const [department, setDepartment] = useState("");
  const [programme, setProgramme] = useState("");
  const [level, setLevel] = useState("200");
  const [matric, setMatric] = useState("");
  const [entryYear, setEntryYear] = useState("");
  const [graduationYear, setGraduationYear] = useState("");
  const [notifications, setNotifications] = useState(true);
  const [location, setLocation] = useState(true);
  const [message, setMessage] = useState("");

  const title = ["Choose your university", "Tell us what you study", "Add your student details", "Stay ready, not interrupted"][step - 1] ?? "Set up KampusOne";
  const body = [
    "Your university keeps every class, notice, place and service in the right campus.",
    "This personalises your timetable, courses, news and people you may know.",
    "These details help protect your student identity. Your matric number is never public by default.",
    "We ask for each permission only when its feature needs it. You can change your choice later.",
  ][step - 1] ?? "";

  const academicReady = faculty.trim().length > 1 && department.trim().length > 1 && programme.trim().length > 1;
  const yearsReady = /^20\d{2}$/.test(entryYear) && /^20\d{2}$/.test(graduationYear) && Number(graduationYear) >= Number(entryYear);
  const canContinue = step === 1 ? Boolean(institution) : step === 2 ? academicReady : step === 3 ? yearsReady : true;

  function next() {
    setMessage("");
    if (!canContinue) {
      setMessage(step === 2 ? "Add your faculty, department and programme." : "Enter valid entry and expected graduation years.");
      return;
    }
    if (step < 4) setStep((value) => value + 1);
    else setComplete(true);
  }

  const profileLine = useMemo(() => `${programme || "Student"} · ${level} Level`, [level, programme]);

  if (complete) {
    return (
      <AuthScreen back={false} body="Your daily view is ready. We’ll keep advanced features locked until their data and safety checks pass." title={`Welcome to ${level} Level`}>
        <View style={styles.levelCard}>
          <View pointerEvents="none" style={styles.levelGlow} />
          <View style={styles.levelSeal}><Ionicons name="school" size={33} color="#FFFFFF" /></View>
          <Text style={styles.levelNumber}>{level}</Text>
          <Text style={styles.levelLabel}>LEVEL BADGE</Text>
          <Text style={styles.levelProfile}>{profileLine}</Text>
        </View>
        <FormMessage tone="success">Setup is complete on this preview. Cloud sync becomes active when the verified academic catalogue is imported.</FormMessage>
        <PrimaryButton icon="arrow-forward" onPress={() => router.replace("/today")}>Open Today</PrimaryButton>
      </AuthScreen>
    );
  }

  return (
    <AuthScreen body={body} step={step} title={title} totalSteps={4}>
      {message ? <FormMessage tone="error">{message}</FormMessage> : null}

      {step === 1 ? (
        <>
          <ChoiceButton icon="business-outline" label="University of Benin" meta="Ugbowo campus · Pilot institution" onPress={() => setInstitution("uniben")} selected={institution === "uniben"} />
          <ChoiceButton icon="add-circle-outline" label="My university is not listed" meta="Join the expansion waitlist" onPress={() => setInstitution("waitlist")} selected={institution === "waitlist"} />
          {institution === "waitlist" ? <FormMessage>We’ll save your interest without assigning you to UNIBEN content.</FormMessage> : null}
        </>
      ) : null}

      {step === 2 ? (
        <>
          <FormField autoCapitalize="words" label="Faculty" onChangeText={setFaculty} placeholder="Faculty of Education" value={faculty} />
          <FormField autoCapitalize="words" label="Department" onChangeText={setDepartment} placeholder="Computer Education" value={department} />
          <FormField autoCapitalize="words" label="Programme" onChangeText={setProgramme} placeholder="B.Sc. Computer Education" value={programme} />
          <Text style={styles.groupLabel}>Current level</Text>
          <View accessibilityRole="radiogroup" style={styles.levelGrid}>
            {levels.map((item) => (
              <Pressable accessibilityRole="radio" accessibilityState={{ selected: level === item }} key={item} onPress={() => setLevel(item)} style={({ pressed }) => [styles.levelChoice, level === item && styles.levelChoiceActive, pressed && styles.pressed]}>
                <Text style={[styles.levelChoiceText, level === item && styles.levelChoiceTextActive]}>{item}</Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}

      {step === 3 ? (
        <>
          <FormField autoCapitalize="characters" hint="Optional during preview. Visible only to you and authorised verification staff." label="Matriculation number" onChangeText={setMatric} placeholder="EDU/20/0000" value={matric} />
          <FormField keyboardType="number-pad" label="Year of entry" maxLength={4} onChangeText={(value) => setEntryYear(value.replace(/\D/g, ""))} placeholder="2025" value={entryYear} />
          <FormField keyboardType="number-pad" label="Expected graduation year" maxLength={4} onChangeText={(value) => setGraduationYear(value.replace(/\D/g, ""))} placeholder="2029" value={graduationYear} />
          <View style={styles.privateNote}><Ionicons name="lock-closed-outline" size={19} color={theme.brandPressed} /><Text style={styles.privateText}>Identity documents are never shown on your public profile. Sensitive files will use private storage and short-lived access links.</Text></View>
        </>
      ) : null}

      {step === 4 ? (
        <>
          <PermissionRow body="Class reminders, important campus notices and delivery updates." icon="notifications-outline" label="Notifications" onValueChange={setNotifications} value={notifications} />
          <PermissionRow body="Directions, campus safety prompts and nearby delivery matching while in use." icon="location-outline" label="Location while using the app" onValueChange={setLocation} value={location} />
          <FormMessage>Android or iOS will still show its own permission prompt when a feature first needs access. KampusOne records your choice, never your permission as consent for another purpose.</FormMessage>
        </>
      ) : null}

      <View style={styles.footerActions}>
        <PrimaryButton disabled={!canContinue} onPress={next}>{step === 4 ? "Finish setup" : "Continue"}</PrimaryButton>
        {step > 1 ? <SecondaryButton onPress={() => setStep((value) => Math.max(1, value - 1))}>Back to previous step</SecondaryButton> : null}
      </View>
    </AuthScreen>
  );
}

function PermissionRow({ icon, label, body, value, onValueChange }: { icon: keyof typeof Ionicons.glyphMap; label: string; body: string; value: boolean; onValueChange: (value: boolean) => void }) {
  return (
    <View style={styles.permission}>
      <View style={styles.permissionIcon}><Ionicons name={icon} size={24} color={theme.brandPressed} /></View>
      <View style={styles.permissionCopy}><Text style={styles.permissionLabel}>{label}</Text><Text style={styles.permissionBody}>{body}</Text></View>
      <Switch accessibilityLabel={label} onValueChange={onValueChange} thumbColor="#FFFFFF" trackColor={{ false: "#D8D0CA", true: theme.brand }} value={value} />
    </View>
  );
}

const styles = StyleSheet.create({
  groupLabel: { color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 13, marginBottom: 9 },
  levelGrid: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
  levelChoice: { alignItems: "center", backgroundColor: theme.warmWhite, borderColor: "rgba(41,35,31,0.12)", borderRadius: 13, borderWidth: 1, justifyContent: "center", minHeight: 48, width: "30.5%", ...theme.shadow },
  levelChoiceActive: { backgroundColor: theme.brand, borderColor: theme.brand },
  levelChoiceText: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 14 },
  levelChoiceTextActive: { color: "#FFFFFF" },
  privateNote: { alignItems: "flex-start", backgroundColor: "rgba(241,223,200,0.44)", borderRadius: 15, flexDirection: "row", gap: 9, padding: 13 },
  privateText: { color: theme.textMuted, flex: 1, fontFamily: theme.font.body, fontSize: 12, lineHeight: 18 },
  permission: { alignItems: "center", backgroundColor: "rgba(255,253,252,0.86)", borderColor: "rgba(41,35,31,0.10)", borderRadius: 18, borderWidth: 1, flexDirection: "row", gap: 12, marginBottom: 12, minHeight: 92, padding: 13, ...theme.shadow },
  permissionIcon: { alignItems: "center", backgroundColor: "rgba(233,177,142,0.28)", borderRadius: 14, height: 46, justifyContent: "center", width: 46 },
  permissionCopy: { flex: 1 },
  permissionLabel: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 14 },
  permissionBody: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 11.5, lineHeight: 17, marginTop: 4 },
  footerActions: { gap: 10, marginTop: 24 },
  pressed: { opacity: 0.7, transform: [{ scale: 0.98 }] },
  levelCard: { alignItems: "center", backgroundColor: theme.deepBrand, borderRadius: 26, marginBottom: 18, overflow: "hidden", padding: 26, position: "relative" },
  levelGlow: { backgroundColor: "rgba(241,223,200,0.16)", borderRadius: 100, height: 180, position: "absolute", right: -65, top: -70, width: 180 },
  levelSeal: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.14)", borderColor: "rgba(255,255,255,0.24)", borderRadius: 29, borderWidth: 1, height: 58, justifyContent: "center", width: 58 },
  levelNumber: { color: "#FFFFFF", fontFamily: theme.font.displayStrong, fontSize: 64, letterSpacing: -2.5, lineHeight: 70, marginTop: 10 },
  levelLabel: { color: theme.peach, fontFamily: theme.font.bold, fontSize: 10.5, letterSpacing: 1.5 },
  levelProfile: { color: "rgba(255,255,255,0.78)", fontFamily: theme.font.body, fontSize: 13, marginTop: 16, textAlign: "center" },
});
