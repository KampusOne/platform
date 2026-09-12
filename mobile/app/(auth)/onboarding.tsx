import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  FlatList,
  findNodeHandle,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "@/src/auth/auth-context";
import { AuthField, AuthShell, FormError, PrimaryButton, TextLink } from "@/src/components/auth-ui";
import { ApiError, api } from "@/src/lib/api";
import { theme } from "@/src/theme";

const DEEP_TERRACOTTA = "#A8462E";
const levels = ["100", "200", "300", "400", "500", "600"] as const;

type Item = {
  id: string;
  name: string;
  university_id?: string;
  faculty_id?: string;
  department_id?: string;
  code?: string;
};
type Catalog = { universities: Item[]; faculties: Item[]; departments: Item[]; courses: Item[] };

function useReducedMotionPreference() {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (live) setReducedMotion(value);
    });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReducedMotion);
    return () => {
      live = false;
      subscription.remove();
    };
  }, []);

  return reducedMotion;
}

const stepCopy = [
  {
    title: "Choose your school",
    subtitle: "We’ll use this to show the right classes, updates and campus places.",
  },
  {
    title: "Your student details",
    subtitle: "Add the details that connect your account to your academic profile.",
  },
  {
    title: "Where are you now?",
    subtitle: "Set your current level and expected graduation year. You can update these later.",
  },
] as const;

function Selector({
  label,
  items,
  selected,
  onSelect,
  disabled = false,
  optional = false,
}: {
  label: string;
  items: Item[];
  selected: string;
  onSelect: (id: string) => void;
  disabled?: boolean;
  optional?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const modalHeadingRef = useRef<View>(null);
  const reducedMotion = useReducedMotionPreference();
  const activeItem = items.find((item) => item.id === selected);
  const filteredItems = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) => `${item.code ?? ""} ${item.name}`.toLowerCase().includes(needle));
  }, [items, query]);
  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const node = findNodeHandle(modalHeadingRef.current);
      if (node !== null) AccessibilityInfo.setAccessibilityFocus(node);
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  return (
    <>
      <View style={styles.selectorGroup}>
        <Text style={styles.fieldLabel}>
          {label}
          {optional ? <Text style={styles.optional}> · Optional</Text> : null}
        </Text>
        <Pressable
          accessibilityLabel={`${label}: ${activeItem?.name ?? "not selected"}`}
          accessibilityRole="button"
          accessibilityState={{ disabled: disabled || !items.length, expanded: open }}
          disabled={disabled || !items.length}
          onPress={() => setOpen(true)}
          style={({ pressed }) => [
            styles.selector,
            (disabled || !items.length) && styles.selectorDisabled,
            pressed && styles.selectorPressed,
          ]}
        >
          <View style={styles.selectorCopy}>
            <Text numberOfLines={1} style={[styles.selectorValue, !activeItem && styles.selectorPlaceholder]}>
              {activeItem ? `${activeItem.code ? `${activeItem.code} · ` : ""}${activeItem.name}` : `Select ${label.toLowerCase()}`}
            </Text>
          </View>
          <Ionicons color={theme.textMuted} name="chevron-down" size={19} />
        </Pressable>
      </View>

      <Modal
        animationType={reducedMotion ? "none" : "slide"}
        onRequestClose={close}
        statusBarTranslucent
        transparent
        visible={open}
      >
        <View style={styles.modalBackdrop}>
          <SafeAreaView
            accessibilityViewIsModal
            edges={["bottom"]}
            onAccessibilityEscape={close}
            style={styles.sheet}
          >
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <View
                accessible
                accessibilityLabel={`Select ${label.toLowerCase()}`}
                accessibilityRole="header"
                ref={modalHeadingRef}
              >
                <Text style={styles.sheetEyebrow}>ACADEMIC PROFILE</Text>
                <Text style={styles.sheetTitle}>Select {label.toLowerCase()}</Text>
              </View>
              <Pressable
                accessibilityLabel={`Close ${label.toLowerCase()} choices`}
                accessibilityRole="button"
                onPress={close}
                style={({ pressed }) => [styles.close, pressed && styles.closePressed]}
              >
                <Ionicons color={theme.text} name="close" size={23} />
              </Pressable>
            </View>
            <AuthField
              autoCapitalize="none"
              autoCorrect={false}
              hideLabel
              icon="search-outline"
              label={`Search ${label.toLowerCase()}`}
              onChangeText={setQuery}
              placeholder={`Search ${label.toLowerCase()}`}
              value={query}
            />
            <FlatList
              contentContainerStyle={styles.optionList}
              data={filteredItems}
              keyboardShouldPersistTaps="handled"
              keyExtractor={(item) => item.id}
              ListEmptyComponent={<Text style={styles.noOptions}>No matching option. Try another search.</Text>}
              renderItem={({ item }) => {
                const checked = item.id === selected;
                return (
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{ checked }}
                    onPress={() => {
                      onSelect(item.id);
                      close();
                    }}
                    style={({ pressed }) => [styles.option, checked && styles.optionSelected, pressed && styles.optionPressed]}
                  >
                    <Text style={[styles.optionText, checked && styles.optionTextSelected]}>
                      {item.code ? `${item.code} · ` : ""}
                      {item.name}
                    </Text>
                    {checked ? <Ionicons color={DEEP_TERRACOTTA} name="checkmark-circle" size={21} /> : null}
                  </Pressable>
                );
              }}
              showsVerticalScrollIndicator={false}
            />
          </SafeAreaView>
        </View>
      </Modal>
    </>
  );
}

export default function OnboardingScreen() {
  const { profile, reloadProfile, signOut } = useAuth();
  const [step, setStep] = useState(0);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
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
  const [signingOut, setSigningOut] = useState(false);

  const loadCatalog = useCallback(async () => {
    setCatalogLoading(true);
    setError("");
    try {
      const data = await api<Catalog>("/v1/student/catalog");
      setCatalog(data);
      setUniversityId((current) => data.universities.some((item) => item.id === current) ? current : "");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "School details could not be loaded.");
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const faculties = useMemo(
    () => catalog?.faculties.filter((item) => item.university_id === universityId) ?? [],
    [catalog, universityId],
  );
  const departments = useMemo(
    () => catalog?.departments.filter((item) => item.faculty_id === facultyId) ?? [],
    [catalog, facultyId],
  );
  const courses = useMemo(
    () => catalog?.courses.filter((item) => item.department_id === departmentId) ?? [],
    [catalog, departmentId],
  );

  useEffect(() => {
    if (facultyId && !faculties.some((item) => item.id === facultyId)) setFacultyId("");
  }, [faculties, facultyId]);
  useEffect(() => {
    if (departmentId && !departments.some((item) => item.id === departmentId)) setDepartmentId("");
  }, [departments, departmentId]);
  useEffect(() => {
    if (!courses.some((item) => item.id === courseId)) setCourseId("");
  }, [courseId, courses]);
  const courseOptions = useMemo<Item[]>(
    () => [{ id: "", name: "Not listed — skip for now" }, ...courses],
    [courses],
  );

  const university = catalog?.universities.find((item) => item.id === universityId);
  const department = departments.find((item) => item.id === departmentId);
  const course = courses.find((item) => item.id === courseId);
  const yearOptions = useMemo<Item[]>(() => {
    const thisYear = new Date().getFullYear();
    return Array.from({ length: 9 }, (_, index) => {
      const year = String(thisYear + index);
      return { id: year, name: year };
    });
  }, []);

  const schoolStepComplete = Boolean(
    universityId
      && facultyId
      && departmentId
      && (!courseId || courses.some((item) => item.id === courseId)),
  );
  const identityStepComplete = username.trim().length >= 3 && matriculationNumber.trim().length >= 3;
  const timelineStepComplete = levels.includes(currentLevel as (typeof levels)[number]) && Boolean(graduationYear);
  const canContinue = step === 0 ? schoolStepComplete : step === 1 ? identityStepComplete : timelineStepComplete;

  function nextStep() {
    if (!canContinue) return;
    setError("");
    setStep((current) => Math.min(current + 1, stepCopy.length - 1));
  }

  async function submit() {
    if (!canContinue) return;
    if (!profile?.first_name || !profile.last_name) {
      setError("Your verified account details did not load. Go back, check your connection and try again.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await api("/v1/student/me/onboarding", {
        method: "PATCH",
        body: JSON.stringify({
          firstName: profile.first_name,
          lastName: profile.last_name,
          username: username.trim(),
          universityId,
          facultyId,
          departmentId,
          courseId: courseId || null,
          currentLevel,
          matriculationNumber: matriculationNumber.trim(),
          graduationYear: Number(graduationYear),
        }),
      });
      await reloadProfile();
      router.replace("/(tabs)");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Your profile could not be completed.");
    } finally {
      setLoading(false);
    }
  }

  async function switchAccount() {
    setSigningOut(true);
    setError("");
    try {
      const signedOut = await signOut();
      if (signedOut) {
        router.replace("/(auth)/sign-in");
      } else {
        setError("You are still signed in. Check your connection and try switching accounts again.");
      }
    } catch {
      setError("You are still signed in. Check your connection and try switching accounts again.");
    } finally {
      setSigningOut(false);
    }
  }

  const copy = stepCopy[step] ?? stepCopy[0];

  return (
    <AuthShell
      back={step > 0}
      eyebrow={`Step ${step + 1} of ${stepCopy.length}`}
      onBack={() => {
        setError("");
        setStep((current) => Math.max(current - 1, 0));
      }}
      subtitle={copy.subtitle}
      title={copy.title}
    >
      <View accessibilityLabel={`Academic setup step ${step + 1} of ${stepCopy.length}`} style={styles.progress}>
        {stepCopy.map((item, index) => (
          <View key={item.title} style={[styles.progressBar, index <= step && styles.progressBarActive]} />
        ))}
      </View>

      {step === 0 ? (
        <>
          <Image
            accessible={false}
            accessibilityElementsHidden
            accessibilityIgnoresInvertColors
            importantForAccessibility="no-hide-descendants"
            resizeMode="contain"
            source={require("@/assets/illustrations/onboarding-walk-v2.png")}
            style={styles.illustration}
          />
          {catalogLoading ? (
            <View accessibilityLiveRegion="polite" style={styles.loadingState}>
              <ActivityIndicator color={DEEP_TERRACOTTA} />
              <Text style={styles.loadingText}>Loading your school choices…</Text>
            </View>
          ) : null}
          {!catalogLoading && catalog ? (
            <View>
              <Selector
                items={catalog.universities}
                label="University"
                onSelect={(id) => {
                  setUniversityId(id);
                  setFacultyId("");
                  setDepartmentId("");
                  setCourseId("");
                }}
                selected={universityId}
              />
              <Selector
                disabled={!universityId}
                items={faculties}
                label="Faculty"
                onSelect={(id) => {
                  setFacultyId(id);
                  setDepartmentId("");
                  setCourseId("");
                }}
                selected={facultyId}
              />
              <Selector
                disabled={!facultyId}
                items={departments}
                label="Department"
                onSelect={(id) => {
                  setDepartmentId(id);
                  setCourseId("");
                }}
                selected={departmentId}
              />
              <Selector
                disabled={!departmentId}
                items={courseOptions}
                label="Programme"
                onSelect={setCourseId}
                optional
                selected={courseId}
              />
            </View>
          ) : null}
          {!catalogLoading && !catalog ? (
            <View style={styles.retry}>
              <TextLink onPress={() => void loadCatalog()}>Try loading school choices again</TextLink>
            </View>
          ) : null}
        </>
      ) : null}

      {step === 1 ? (
        <View>
          <AuthField
            autoCapitalize="none"
            autoComplete="username-new"
            autoCorrect={false}
            icon="at-outline"
            label="Username"
            maxLength={30}
            onChangeText={(value) => setUsername(value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
            placeholder="e.g. warriorpikin"
            textContentType="username"
            value={username}
          />
          <Text style={styles.help}>Use letters, numbers and underscores. This can be different from your full name.</Text>
          <AuthField
            autoCapitalize="characters"
            autoCorrect={false}
            icon="id-card-outline"
            label="Matriculation number"
            onChangeText={setMatriculationNumber}
            placeholder="Enter your matric number"
            value={matriculationNumber}
          />
          <Text style={styles.privacy}>Your matriculation number is private and only used for account and school verification.</Text>
        </View>
      ) : null}

      {step === 2 ? (
        <View>
          <Text style={styles.fieldLabel}>Current level</Text>
          <View accessibilityRole="radiogroup" style={styles.levels}>
            {levels.map((level) => {
              const selected = currentLevel === level;
              return (
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  key={level}
                  onPress={() => setCurrentLevel(level)}
                  style={({ pressed }) => [styles.level, selected && styles.levelSelected, pressed && styles.levelPressed]}
                >
                  <Text style={[styles.levelText, selected && styles.levelTextSelected]}>{level}</Text>
                </Pressable>
              );
            })}
          </View>
          <Selector
            items={yearOptions}
            label="Expected graduation year"
            onSelect={setGraduationYear}
            selected={graduationYear}
          />

          <View style={styles.summary}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>School</Text>
              <Text numberOfLines={2} style={styles.summaryValue}>{university?.name ?? "Not selected"}</Text>
            </View>
            <View style={styles.summaryRule} />
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Programme</Text>
              <Text numberOfLines={2} style={styles.summaryValue}>{course?.name ?? department?.name ?? "Not selected"}</Text>
            </View>
          </View>
        </View>
      ) : null}

      <FormError message={error} />
      <PrimaryButton
        disabled={!canContinue || catalogLoading || signingOut}
        loading={loading}
        onPress={() => void (step === stepCopy.length - 1 ? submit() : nextStep())}
      >
        {step === stepCopy.length - 1 ? "Finish setup" : "Continue"}
      </PrimaryButton>
      <Pressable
        accessibilityLabel="Switch account or sign out"
        accessibilityRole="button"
        accessibilityState={{ busy: signingOut, disabled: loading || signingOut }}
        disabled={loading || signingOut}
        onPress={() => void switchAccount()}
        style={({ pressed }) => [styles.switchAccount, pressed && styles.closePressed]}
      >
        {signingOut ? <ActivityIndicator color={DEEP_TERRACOTTA} size="small" /> : null}
        <Text style={styles.switchAccountText}>{signingOut ? "Signing out…" : "Switch account / Sign out"}</Text>
      </Pressable>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  progress: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 24,
  },
  progressBar: {
    backgroundColor: theme.border,
    borderRadius: 2,
    flex: 1,
    height: 4,
  },
  progressBarActive: {
    backgroundColor: DEEP_TERRACOTTA,
  },
  illustration: {
    alignSelf: "center",
    height: 176,
    marginBottom: 18,
    marginTop: -14,
    width: "100%",
  },
  loadingState: {
    alignItems: "center",
    gap: 10,
    paddingVertical: 42,
  },
  loadingText: {
    color: theme.textMuted,
    fontFamily: theme.font.body,
    fontSize: 13,
  },
  selectorGroup: {
    marginBottom: 15,
  },
  fieldLabel: {
    color: theme.text,
    fontFamily: theme.font.semibold,
    fontSize: 13,
    marginBottom: 7,
  },
  optional: {
    color: theme.textSubtle,
    fontFamily: theme.font.body,
    fontSize: 11.5,
  },
  selector: {
    alignItems: "center",
    backgroundColor: "rgba(255,253,252,0.72)",
    borderColor: theme.clay,
    borderRadius: 14,
    borderWidth: 1.25,
    flexDirection: "row",
    minHeight: 56,
    paddingHorizontal: 15,
  },
  selectorDisabled: {
    backgroundColor: "#EFEAE5",
    borderColor: theme.border,
    opacity: 0.64,
  },
  selectorPressed: {
    backgroundColor: theme.surfaceSoft,
  },
  selectorCopy: {
    flex: 1,
    paddingRight: 10,
  },
  selectorValue: {
    color: theme.text,
    fontFamily: theme.font.medium,
    fontSize: 14,
  },
  selectorPlaceholder: {
    color: theme.textSubtle,
    fontFamily: theme.font.body,
  },
  retry: {
    alignItems: "center",
    marginBottom: 24,
  },
  help: {
    color: theme.textSubtle,
    fontFamily: theme.font.body,
    fontSize: 11.5,
    lineHeight: 17,
    marginBottom: 20,
    marginTop: -7,
  },
  privacy: {
    color: theme.textMuted,
    fontFamily: theme.font.body,
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 26,
    marginTop: -6,
  },
  levels: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 24,
  },
  level: {
    alignItems: "center",
    backgroundColor: "rgba(255,253,252,0.72)",
    borderColor: theme.border,
    borderRadius: 12,
    borderWidth: 1,
    height: 48,
    justifyContent: "center",
    minWidth: "30%",
    paddingHorizontal: 14,
  },
  levelSelected: {
    backgroundColor: DEEP_TERRACOTTA,
    borderColor: DEEP_TERRACOTTA,
  },
  levelPressed: {
    opacity: 0.75,
  },
  levelText: {
    color: theme.text,
    fontFamily: theme.font.semibold,
    fontSize: 13,
  },
  levelTextSelected: {
    color: "#FFFFFF",
  },
  summary: {
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
    borderTopColor: theme.border,
    borderTopWidth: 1,
    marginBottom: 24,
    marginTop: 12,
    paddingVertical: 4,
  },
  summaryRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 16,
    justifyContent: "space-between",
    paddingVertical: 13,
  },
  summaryLabel: {
    color: theme.textMuted,
    fontFamily: theme.font.body,
    fontSize: 12.5,
  },
  summaryValue: {
    color: theme.text,
    flex: 1,
    fontFamily: theme.font.semibold,
    fontSize: 12.5,
    lineHeight: 18,
    textAlign: "right",
  },
  summaryRule: {
    backgroundColor: theme.border,
    height: StyleSheet.hairlineWidth,
  },
  modalBackdrop: {
    backgroundColor: "rgba(41,35,31,0.42)",
    flex: 1,
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: theme.canvas,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    maxHeight: "82%",
    paddingHorizontal: 22,
    paddingTop: 10,
  },
  sheetHandle: {
    alignSelf: "center",
    backgroundColor: "#CFC3BB",
    borderRadius: 2,
    height: 4,
    marginBottom: 14,
    width: 40,
  },
  sheetHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 18,
  },
  sheetEyebrow: {
    color: DEEP_TERRACOTTA,
    fontFamily: theme.font.bold,
    fontSize: 9,
    letterSpacing: 1.1,
  },
  sheetTitle: {
    color: theme.text,
    fontFamily: theme.font.display,
    fontSize: 22,
    marginTop: 3,
  },
  close: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  closePressed: {
    opacity: 0.55,
  },
  optionList: {
    flexGrow: 1,
    paddingBottom: 24,
  },
  option: {
    alignItems: "center",
    borderBottomColor: theme.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    minHeight: 58,
    paddingHorizontal: 4,
    paddingVertical: 10,
  },
  optionSelected: {
    borderBottomColor: theme.clay,
  },
  optionPressed: {
    backgroundColor: theme.surfaceSoft,
  },
  optionText: {
    color: theme.text,
    flex: 1,
    fontFamily: theme.font.body,
    fontSize: 14,
    lineHeight: 20,
    paddingRight: 12,
  },
  optionTextSelected: {
    color: DEEP_TERRACOTTA,
    fontFamily: theme.font.semibold,
  },
  noOptions: {
    color: theme.textMuted,
    fontFamily: theme.font.body,
    fontSize: 13,
    lineHeight: 20,
    paddingVertical: 32,
    textAlign: "center",
  },
  switchAccount: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 16,
  },
  switchAccountText: {
    color: DEEP_TERRACOTTA,
    fontFamily: theme.font.semibold,
    fontSize: 13,
  },
});
