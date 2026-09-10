import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { InlineNotice } from "@/src/components/auth-ui";
import { readableAuthError, supabase } from "@/src/lib/supabase";
import { theme } from "@/src/theme";

const UNIBEN_ID = "10000000-0000-4000-8000-000000000001";

const steps = [
  { key: "university", eyebrow: "Campus", title: "Where do you study?", description: "We use this to show the right timetable, places and campus notices.", options: ["University of Benin"] },
  { key: "faculty", eyebrow: "Academic profile", title: "Choose your faculty", description: "You can correct this later from your academic profile.", options: ["Engineering", "Life Sciences", "Physical Sciences", "Arts", "Social Sciences"] },
  { key: "department", eyebrow: "Academic profile", title: "Which department?", description: "This helps us organise relevant courses and useful classmates.", options: ["Computer Engineering", "Electrical Engineering", "Computer Science", "Microbiology", "Economics"] },
  { key: "programme", eyebrow: "Academic profile", title: "Select your programme", description: "Choose the programme printed on your school record.", options: ["B.Eng Computer Engineering", "B.Sc Computer Science", "B.Sc Microbiology", "B.Sc Economics"] },
  { key: "level", eyebrow: "Academic profile", title: "What level are you in?", description: "We use this to shape course and deadline suggestions.", options: ["100", "200", "300", "400", "500", "600"] },
  { key: "admissionYear", eyebrow: "Academic profile", title: "Admission year", description: "Enter the year you started this programme.", placeholder: "e.g. 2024", keyboard: "number-pad" as const },
  { key: "graduationYear", eyebrow: "Academic profile", title: "Expected graduation", description: "A best estimate is fine—you can update it later.", placeholder: "e.g. 2028", keyboard: "number-pad" as const },
  { key: "session", eyebrow: "Academic calendar", title: "Current academic session", description: "This keeps semester tools and GPA records properly grouped.", options: ["2025/2026", "2026/2027", "Not sure yet"] },
  { key: "interests", eyebrow: "Personalise", title: "What should feel closer?", description: "Pick as many as you like. This never changes your access.", options: ["Study groups", "Technology", "Sports", "Music", "Volunteering", "Entrepreneurship"], multiple: true },
  { key: "studentId", eyebrow: "Student identity", title: "Add your school ID", description: "This is optional now. Verification remains pending until trusted evidence is reviewed.", placeholder: "Matriculation number (optional)" },
  { key: "notifications", eyebrow: "Stay ready", title: "Let us remind you before class", description: "KampusOne can send timetable changes, deadline nudges and your class alarm. The phone permission appears only after you choose Allow.", permission: "notifications" as const },
  { key: "location", eyebrow: "Find your way", title: "Use location only when it helps", description: "Location powers nearby campus places, directions and later delivery matching. Precise location is never required for browsing.", permission: "location" as const },
  { key: "privacy", eyebrow: "Your choices", title: "Choose your data settings", description: "Essential security events always run. Product analytics and personalisation stay optional.", toggles: ["privacyAccepted", "analyticsAllowed", "personalisationAllowed"] },
  { key: "summary", eyebrow: "Ready", title: "Your campus setup at a glance", description: "Review the essentials. You can change them later from your academic profile.", summary: true },
] as const;

type Answers = Record<string, string | string[] | boolean>;

const toggleLabels: Record<string, { title: string; copy: string; required?: boolean }> = {
  privacyAccepted: { title: "Privacy notice and terms", copy: "Required to create and protect your account.", required: true },
  analyticsAllowed: { title: "Help improve KampusOne", copy: "Share pseudonymous usage events such as page time and feature use." },
  personalisationAllowed: { title: "Personalised suggestions", copy: "Use your activity to rank relevant tools, events and notices." },
};

export default function OnboardingScreen() {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Answers>({
    university: "University of Benin",
    notifications: "ask_after_setup",
    location: "ask_when_needed",
    privacyAccepted: false,
    analyticsAllowed: false,
    personalisationAllowed: true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const step = steps[index] ?? steps[0];
  const progress = ((index + 1) / steps.length) * 100;
  const selected = answers[step.key];
  const canContinue = (() => {
    if (step.key === "studentId") return true;
    if ("summary" in step) return answers.privacyAccepted === true;
    if ("permission" in step) return typeof selected === "string";
    if (step.key === "privacy") return answers.privacyAccepted === true;
    if ("multiple" in step) return Array.isArray(selected) && selected.length > 0;
    return typeof selected === "string" && selected.trim().length > 0;
  })();

  function update(key: string, value: Answers[string]) {
    setAnswers((current) => ({ ...current, [key]: value }));
    setError(null);
  }

  function toggleMultiple(value: string) {
    const current = Array.isArray(selected) ? selected : [];
    update(step.key, current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  }

  async function persist(nextIndex: number, completed = false) {
    if (!supabase) return;
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;
    const { error: saveError } = await supabase.from("onboarding_progress").upsert({
      user_id: userData.user.id,
      institution_id: UNIBEN_ID,
      current_step: Math.min(nextIndex + 1, steps.length),
      status: completed ? "completed" : "in_progress",
      answers,
      permission_preferences: {
        notifications: answers.notifications,
        location: answers.location,
      },
      privacy_notice_version: answers.privacyAccepted ? "2026-09-10" : null,
      analytics_consent: answers.analyticsAllowed === true,
      personalisation_consent: answers.personalisationAllowed === true,
      completed_at: completed ? new Date().toISOString() : null,
    });
    if (saveError) throw saveError;
  }

  async function next() {
    if (!canContinue) {
      setError(step.key === "privacy" ? "Accept the privacy notice to continue. The other choices stay optional." : "Choose or enter an answer to continue.");
      return;
    }
    setSaving(true);
    try {
      if (index === steps.length - 1) {
        await persist(index, true);
        router.replace("/(tabs)");
      } else {
        await persist(index + 1);
        setIndex((value) => value + 1);
      }
    } catch (saveError) {
      setError(readableAuthError(saveError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.flex}>
        <View style={styles.header}>
          <Pressable
            accessibilityLabel="Previous setup step"
            disabled={index === 0}
            hitSlop={8}
            onPress={() => setIndex((value) => Math.max(0, value - 1))}
            style={[styles.back, index === 0 && styles.backDisabled]}
          >
            <Ionicons color={theme.text} name="arrow-back" size={20} />
          </Pressable>
          <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${progress}%` }]} /></View>
          <Text style={styles.progressText}>{index + 1}/{steps.length}</Text>
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Text style={styles.eyebrow}>{step.eyebrow}</Text>
          <Text style={styles.title}>{step.title}</Text>
          <Text style={styles.description}>{step.description}</Text>
          {error ? <View style={styles.noticeWrap}><InlineNotice tone="error">{error}</InlineNotice></View> : null}

          <View style={styles.answerArea}>
            {"options" in step ? (
              <View style={styles.options}>
                {step.options.map((option) => {
                  const active = Array.isArray(selected) ? selected.includes(option) : selected === option;
                  return (
                    <Pressable
                      accessibilityRole={"multiple" in step ? "checkbox" : "radio"}
                      accessibilityState={{ checked: active }}
                      key={option}
                      onPress={() => "multiple" in step ? toggleMultiple(option) : update(step.key, option)}
                      style={({ pressed }) => [styles.option, active && styles.optionActive, pressed && styles.optionPressed]}
                    >
                      <View style={[styles.optionIndicator, active && styles.optionIndicatorActive]}>
                        {active ? <Ionicons color={theme.white} name="checkmark" size={14} /> : null}
                      </View>
                      <Text style={[styles.optionText, active && styles.optionTextActive]}>{option}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}

            {"placeholder" in step ? (
              <TextInput
                autoCapitalize={step.key === "studentId" ? "characters" : "none"}
                keyboardType={"keyboard" in step ? step.keyboard : "default"}
                onChangeText={(value) => update(step.key, value)}
                placeholder={step.placeholder}
                placeholderTextColor={theme.textSubtle}
                style={styles.textInput}
                value={typeof selected === "string" ? selected : ""}
              />
            ) : null}

            {"permission" in step ? <PermissionChoice permission={step.permission} selected={typeof selected === "string" ? selected : ""} update={(value) => update(step.key, value)} /> : null}

            {"toggles" in step ? (
              <View style={styles.toggleList}>
                {step.toggles.map((key) => {
                  const item = toggleLabels[key];
                  const active = answers[key] === true;
                  return (
                    <Pressable key={key} onPress={() => update(key, !active)} style={styles.toggleRow}>
                      <View style={styles.toggleCopy}>
                        <Text style={styles.toggleTitle}>{item?.title}{item?.required ? " · Required" : ""}</Text>
                        <Text style={styles.toggleDescription}>{item?.copy}</Text>
                      </View>
                      <View style={[styles.toggle, active && styles.toggleActive]}><View style={[styles.toggleThumb, active && styles.toggleThumbActive]} /></View>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}

            {"summary" in step ? <Summary answers={answers} /> : null}
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            accessibilityRole="button"
            disabled={saving}
            onPress={() => void next()}
            style={({ pressed }) => [styles.continue, (!canContinue || saving) && styles.continueDisabled, pressed && canContinue && styles.continuePressed]}
          >
            {saving ? <ActivityIndicator color={theme.white} /> : <><Text style={styles.continueText}>{index === steps.length - 1 ? "Open my campus" : "Continue"}</Text><Ionicons color={theme.white} name="arrow-forward" size={19} /></>}
          </Pressable>
          <Text style={styles.saveNote}>{supabase ? "Your progress saves securely" : "Preview progress stays on this device session"}</Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function PermissionChoice({ permission, selected, update }: { permission: "notifications" | "location"; selected: string; update: (value: string) => void }) {
  const notification = permission === "notifications";
  const choices: ReadonlyArray<readonly [string, string, string]> = notification
    ? [["ask_after_setup", "Allow after setup", "Recommended for class alarms and urgent changes."], ["not_now", "Not now", "You can enable it later from your profile."]]
    : [["ask_when_needed", "Ask when I use a map", "Recommended—permission appears only when useful."], ["approximate_only", "Approximate area only", "Enough for campus discovery, not precise routing."], ["not_now", "Not now", "Nearby tools will stay limited."]];
  return (
    <View style={styles.permissionPanel}>
      <View style={styles.permissionGraphic}>
        <View style={styles.permissionPhone}>
          <Ionicons color={theme.brand} name={notification ? "notifications-outline" : "location-outline"} size={38} />
          <View style={styles.permissionLine} /><View style={[styles.permissionLine, styles.permissionLineShort]} />
        </View>
        <View style={styles.permissionBadge}><Ionicons color={theme.white} name={notification ? "alarm-outline" : "navigate-outline"} size={20} /></View>
      </View>
      <View style={styles.options}>
        {choices.map(([value, title, copy]) => {
          const active = selected === value;
          return (
            <Pressable key={value} onPress={() => update(value)} style={[styles.permissionOption, active && styles.optionActive]}>
              <View style={styles.permissionCopy}><Text style={styles.optionText}>{title}</Text><Text style={styles.permissionDescription}>{copy}</Text></View>
              <Ionicons color={active ? theme.brand : theme.textSubtle} name={active ? "radio-button-on" : "radio-button-off"} size={22} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function Summary({ answers }: { answers: Answers }) {
  const rows = [
    ["University", answers.university], ["Faculty", answers.faculty], ["Department", answers.department],
    ["Programme", answers.programme], ["Level", answers.level ? `${answers.level} level` : undefined], ["Session", answers.session],
  ];
  return (
    <View style={styles.summaryCard}>
      <View style={styles.summaryTop}><View style={styles.summaryIcon}><Text style={styles.summaryIconText}>K1</Text></View><View><Text style={styles.summaryName}>Campus profile</Text><Text style={styles.summaryStatus}>Student verification pending</Text></View></View>
      {rows.map(([label, value]) => <View key={String(label)} style={styles.summaryRow}><Text style={styles.summaryLabel}>{label}</Text><Text numberOfLines={2} style={styles.summaryValue}>{typeof value === "string" ? value : "Not added"}</Text></View>)}
      <View style={styles.summaryPrivacy}><Ionicons color={theme.brandPressed} name="shield-checkmark-outline" size={20} /><Text style={styles.summaryPrivacyText}>Optional analytics: {answers.analyticsAllowed ? "allowed" : "off"}. You can change this anytime.</Text></View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { backgroundColor: theme.canvas, flex: 1 }, flex: { flex: 1 },
  header: { alignItems: "center", flexDirection: "row", gap: 13, marginHorizontal: "auto", maxWidth: 560, paddingHorizontal: theme.spacing[5], paddingTop: 8, width: "100%" },
  back: { alignItems: "center", backgroundColor: theme.surfaceRaised, borderColor: "#E2D4CA", borderRadius: 21, borderWidth: 1, height: 42, justifyContent: "center", width: 42 },
  backDisabled: { opacity: 0.3 }, progressTrack: { backgroundColor: "#E4D8CF", borderRadius: 4, flex: 1, height: 7, overflow: "hidden" },
  progressFill: { backgroundColor: theme.brand, borderRadius: 4, height: "100%" }, progressText: { color: theme.textSubtle, fontFamily: theme.font.semibold, fontSize: 12 },
  content: { flexGrow: 1, marginHorizontal: "auto", maxWidth: 560, paddingBottom: 24, paddingHorizontal: theme.spacing[5], paddingTop: 46, width: "100%" },
  eyebrow: { color: theme.brandPressed, fontFamily: theme.font.bold, fontSize: 12, letterSpacing: 1.4, marginBottom: 11, textTransform: "uppercase" },
  title: { color: theme.text, fontFamily: theme.font.displayStrong, fontSize: 35, letterSpacing: -1, lineHeight: 40 },
  description: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 15.5, lineHeight: 23, marginTop: 11 }, noticeWrap: { marginTop: 18 },
  answerArea: { marginTop: 30 }, options: { gap: 11 },
  option: { alignItems: "center", backgroundColor: theme.surfaceRaised, borderColor: "#DFD2C8", borderRadius: 16, borderWidth: 1, flexDirection: "row", gap: 13, minHeight: 57, paddingHorizontal: 16 },
  optionActive: { backgroundColor: "#FFF3EB", borderColor: theme.brand }, optionPressed: { transform: [{ scale: 0.985 }] },
  optionIndicator: { alignItems: "center", borderColor: "#C9B8AC", borderRadius: 10, borderWidth: 1.5, height: 20, justifyContent: "center", width: 20 },
  optionIndicatorActive: { backgroundColor: theme.brand, borderColor: theme.brand }, optionText: { color: theme.text, flex: 1, fontFamily: theme.font.semibold, fontSize: 14.5 }, optionTextActive: { color: theme.brandPressed },
  textInput: { backgroundColor: theme.surfaceRaised, borderColor: "#DCCEC4", borderRadius: 16, borderWidth: 1, color: theme.text, fontFamily: theme.font.body, fontSize: 17, minHeight: 60, paddingHorizontal: 18 },
  permissionPanel: { gap: 25 }, permissionGraphic: { alignItems: "center", height: 175, justifyContent: "center", position: "relative" },
  permissionPhone: { alignItems: "center", backgroundColor: "#FFF8F3", borderColor: theme.brand, borderRadius: 22, borderWidth: 2, height: 150, justifyContent: "center", width: 112, ...theme.shadow },
  permissionLine: { backgroundColor: "#E5D2C5", borderRadius: 3, height: 5, marginTop: 14, width: 58 }, permissionLineShort: { marginTop: 7, width: 38 },
  permissionBadge: { alignItems: "center", backgroundColor: theme.brand, borderColor: theme.canvas, borderRadius: 24, borderWidth: 4, height: 48, justifyContent: "center", position: "absolute", right: "28%", top: 10, width: 48 },
  permissionOption: { alignItems: "center", backgroundColor: theme.surfaceRaised, borderColor: "#DFD2C8", borderRadius: 16, borderWidth: 1, flexDirection: "row", gap: 12, minHeight: 70, padding: 14 }, permissionCopy: { flex: 1 }, permissionDescription: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 12.5, lineHeight: 18, marginTop: 3 },
  toggleList: { gap: 12 }, toggleRow: { alignItems: "center", backgroundColor: theme.surfaceRaised, borderColor: "#E2D5CB", borderRadius: 16, borderWidth: 1, flexDirection: "row", gap: 14, minHeight: 78, padding: 15 }, toggleCopy: { flex: 1 },
  toggleTitle: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 14 }, toggleDescription: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 12.5, lineHeight: 18, marginTop: 3 },
  toggle: { backgroundColor: "#D6CBC3", borderRadius: 15, height: 30, padding: 3, width: 52 }, toggleActive: { backgroundColor: theme.brand }, toggleThumb: { backgroundColor: theme.white, borderRadius: 12, height: 24, width: 24, ...theme.shadow }, toggleThumbActive: { transform: [{ translateX: 22 }] },
  summaryCard: { backgroundColor: theme.surfaceRaised, borderColor: "#E1D2C8", borderRadius: 20, borderWidth: 1, overflow: "hidden", padding: 18, ...theme.shadow }, summaryTop: { alignItems: "center", flexDirection: "row", gap: 12, marginBottom: 12 },
  summaryIcon: { alignItems: "center", backgroundColor: theme.brand, borderRadius: 13, height: 45, justifyContent: "center", width: 45 }, summaryIconText: { color: theme.white, fontFamily: theme.font.displayStrong, fontSize: 14 }, summaryName: { color: theme.text, fontFamily: theme.font.display, fontSize: 18 }, summaryStatus: { color: theme.statusAttention, fontFamily: theme.font.medium, fontSize: 11.5, marginTop: 2 },
  summaryRow: { borderTopColor: "#EEE4DC", borderTopWidth: 1, flexDirection: "row", gap: 14, justifyContent: "space-between", minHeight: 48, paddingVertical: 12 }, summaryLabel: { color: theme.textSubtle, fontFamily: theme.font.medium, fontSize: 12.5 }, summaryValue: { color: theme.text, flex: 1, fontFamily: theme.font.semibold, fontSize: 12.5, textAlign: "right" },
  summaryPrivacy: { alignItems: "flex-start", backgroundColor: "#F8EEE7", borderRadius: 12, flexDirection: "row", gap: 9, marginTop: 12, padding: 12 }, summaryPrivacyText: { color: theme.textMuted, flex: 1, fontFamily: theme.font.body, fontSize: 12, lineHeight: 18 },
  footer: { backgroundColor: theme.canvas, marginHorizontal: "auto", maxWidth: 560, paddingBottom: 10, paddingHorizontal: theme.spacing[5], paddingTop: 10, width: "100%" },
  continue: { alignItems: "center", backgroundColor: theme.brand, borderRadius: 17, flexDirection: "row", gap: 10, justifyContent: "center", minHeight: 57, ...theme.shadow }, continueDisabled: { opacity: 0.55 }, continuePressed: { backgroundColor: theme.brandPressed, transform: [{ scale: 0.98 }] }, continueText: { color: theme.white, fontFamily: theme.font.bold, fontSize: 15 }, saveNote: { color: theme.textSubtle, fontFamily: theme.font.body, fontSize: 11.5, marginTop: 8, textAlign: "center" },
});
