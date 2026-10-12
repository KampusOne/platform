import { KeyboardScrollView as ScrollView } from '@/src/components/keyboard-viewport';
import { randomUUID } from "expo-crypto";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "@/src/auth/auth-context";
import { useThemeStyles, type Theme } from "@/src/lib/appearance";
import { api } from "@/src/lib/api";
import { writeCache } from "@/src/lib/device-cache";
import { cacheScopeForUser } from "@/src/lib/request-policy";
import { useOwnedDraftRestore } from '@/src/lib/use-owned-draft-restore';
import { useOwnedDraftSave } from '@/src/lib/use-owned-draft-save';
import { restorePublisherDraft } from '@/src/lib/form-drafts';
import { DraftRecovery } from '@/src/components/draft-recovery';
import { ToolButton } from '@/src/components/toolkit';
import { pickAndUpload } from "@/src/lib/uploads";

type Format = "POLL" | "QA" | "ANONYMOUS_QA";
type Draft = {
  format: Format;
  anonymousPoll: boolean;
  body: string;
  options: string[];
  hours: string;
  requestId: string;
  closesAt?: string;
  mediaId?: string;
  mediaUrl?: string;
};

const durations = [
  { value: "24", label: "24 hours" },
  { value: "72", label: "3 days" },
  { value: "168", label: "7 days" },
  { value: "720", label: "30 days" },
];

export default function PublishingCreate() {
  const { user } = useAuth();
  return <AccountPublisher key={(user?cacheScopeForUser(user):'signed-out')} />;
}

function AccountPublisher() {
  const { user } = useAuth();
  const { theme, styles } = useThemeStyles(createStyles);
  const [formats, setFormats] = useState<string[]>([]);
  const [format, setFormat] = useState<Format>("POLL");
  const [anonymousPoll, setAnonymousPoll] = useState(false);
  const [body, setBody] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [hours, setHours] = useState("24");
  const [media, setMedia] = useState<{ id: string; url: string } | null>(null);
  const [accessReady, setAccessReady] = useState(false);
  const [accessBusy, setAccessBusy] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);
  const [busy, setBusy] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(randomUUID());
  const closing = useRef<string | undefined>(undefined);
  const locked = useRef(false);
  const alive = useRef(true);
  const draftKey = `publisher-draft.v2.${user?.id}`;

  useEffect(() => { alive.current=true; return () => { alive.current=false; }; }, []);
  const loadAccess=useCallback(async () => {
    setAccessBusy(true); setError("");
    try {
      const access=await api<{formats:string[]}>("/v1/student/publishing/capabilities");
      if (alive.current) { setFormats(access.formats); setAccessReady(true); }
    } catch (caught) {
      if (alive.current) setError(caught instanceof Error ? caught.message : "Publishing access could not load.");
    } finally { if (alive.current) setAccessBusy(false); }
  }, []);
  useEffect(() => { void loadAccess(); }, [loadAccess]);
  const restored=useOwnedDraftRestore<unknown>(draftKey,value=>{
    if (value===null) { setHasDraft(false); return; }
    const draft=restorePublisherDraft(value);
    setFormat(draft.format); setAnonymousPoll(draft.anonymousPoll); setBody(draft.body);
    setOptions(draft.options); setHours(draft.hours); request.current=draft.requestId??randomUUID(); closing.current=draft.closesAt;
    setMedia(draft.mediaId&&draft.mediaUrl?{id:draft.mediaId,url:draft.mediaUrl}:null); setHasDraft(true);
  },Boolean(user?.id));
  const ready=restored.ready&&accessReady;
  useEffect(() => {
    if (ready&&!hasDraft) setFormat(formats.includes("POLL")?"POLL":formats.includes("QA")?"QA":formats.includes("ANONYMOUS_QA")?"ANONYMOUS_QA":"POLL");
  },[ready,hasDraft,formats]);
  const currentDraft=():Draft=>({format,anonymousPoll,body,options,hours,requestId:request.current,...(closing.current?{closesAt:closing.current}:{}),...(media?{mediaId:media.id,mediaUrl:media.url}:{})});
  const draftSave=useOwnedDraftSave(draftKey,currentDraft(),restored.ready&&Boolean(user?.id)&&!busy);

  function changed() {
    request.current = randomUUID();
    closing.current = undefined;
    setError("");
  }

  const poll = format === "POLL";
  const allowed = formats.includes(format);
  const canPublish =
    allowed &&
    body.trim().length > 0 &&
    (!poll ||
      (options.length >= 2 &&
        options.every((value) => value.trim()) &&
        new Set(options.map((value) => value.trim().toLowerCase())).size ===
          options.length));

  const availableFormats = useMemo(
    () =>
      [
        formats.includes("POLL") && {
          value: "POLL" as Format,
          label: "Poll",
          icon: "stats-chart-outline" as const,
        },
        formats.includes("QA") && {
          value: "QA" as Format,
          label: "Q&A",
          icon: "chatbubbles-outline" as const,
        },
        formats.includes("ANONYMOUS_QA") && {
          value: "ANONYMOUS_QA" as Format,
          label: "Anonymous Q&A",
          icon: "eye-off-outline" as const,
        },
      ].filter(Boolean) as Array<{
        value: Format;
        label: string;
        icon: keyof typeof Ionicons.glyphMap;
      }>,
    [formats],
  );

  async function chooseImage(source: "library" | "camera") {
    if (imageBusy || busy || !ready || !alive.current) return;
    setImageBusy(true);
    setError("");
    try {
      const uploaded = await pickAndUpload("post", source);
      if (!uploaded || !alive.current) return;
      changed();
      setMedia({ id: uploaded.id, url: uploaded.url });
    } catch (caught) {
      if (alive.current)
        setError(
          caught instanceof Error
            ? caught.message
            : "That image could not be added.",
        );
    } finally {
      if (alive.current) setImageBusy(false);
    }
  }

  async function publish() {
    if (locked.current || imageBusy || !canPublish || !ready || !alive.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      closing.current ??= new Date(
        Date.now() + Number(hours) * 3600000,
      ).toISOString();
      await draftSave.persist(currentDraft());
      if (!alive.current) return;
      const result = await api<{ id: string }>(
        "/v1/student/publishing/posts",
        {
          method: "POST",
          body: JSON.stringify({
            requestId: request.current,
            format,
            anonymousPoll: poll && anonymousPoll,
            body: body.trim(),
            ...(poll
              ? { options: options.map((value) => value.trim()) }
              : {}),
            closesAt: closing.current,
            ...(media ? { mediaId: media.id } : {}),
          }),
        },
      );
      if (!alive.current) return;
      draftSave.discard();
      await writeCache(draftKey, null);
      if (alive.current)
        router.replace({
          pathname: "/post",
          params: { id: result.id },
        });
    } catch (caught) {
      if (alive.current)
        setError(
          caught instanceof Error
            ? caught.message
              : "Your post could not be published. Your work is still here.",
        );
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.screen}
      >
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            disabled={busy}
            onPress={() =>
              router.canGoBack() ? router.back() : router.replace("/(tabs)/feed")
            }
            style={styles.headerButton}
          >
            <Ionicons name="arrow-back" size={24} color={theme.text} />
          </Pressable>
          <Text accessibilityRole="header" style={styles.headerTitle}>
            Create
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Publish"
            disabled={busy || !ready || !canPublish || imageBusy}
            onPress={() => void publish()}
            style={[
              styles.publishButton,
              (busy || !ready || !canPublish || imageBusy) && styles.disabled,
            ]}
          >
            <Text style={styles.publishText}>
              {busy ? "Posting…" : "Post"}
            </Text>
          </Pressable>
        </View>

        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <DraftRecovery loading={restored.loading} error={restored.error} onRetry={restored.retry} />
          {draftSave.warning?<Text accessibilityRole="alert" style={styles.stateText}>{draftSave.warning}</Text>:null}
          {!accessReady ? (
            <View style={styles.stateCard}>
              <Text style={styles.stateText}>{accessBusy?"Loading publishing access…":"Publishing access could not load."}</Text>
              {!accessBusy?<ToolButton label="Retry publishing access" onPress={()=>void loadAccess()} />:null}
            </View>
          ) : !restored.ready ? null : !formats.length ? (
            <View style={styles.stateCard}>
              <Ionicons
                name="lock-closed-outline"
                size={24}
                color={theme.deepBrand}
              />
              <Text style={styles.stateTitle}>Publishing access required</Text>
              <Text style={styles.stateText}>
                Polls and Q&A are enabled for selected campus publishers.
              </Text>
            </View>
          ) : (
            <>
              <View style={styles.intro}>
                <Text style={styles.eyebrow}>CAMPUS PUBLISHING</Text>
                <Text style={styles.title}>
                  {poll ? "Ask the campus." : "Start a conversation."}
                </Text>
                <Text style={styles.subtitle}>
                  {poll
                    ? "Create a clean poll that appears directly in the feed."
                    : "Publish a question students can respond to."}
                </Text>
              </View>

              {availableFormats.length > 1 ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.formatRow}
                >
                  {availableFormats.map((item) => {
                    const selected = item.value === format;
                    return (
                      <Pressable
                        key={item.value}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        disabled={busy}
                        onPress={() => {
                          changed();
                          setFormat(item.value);
                          if (item.value !== "POLL") setAnonymousPoll(false);
                        }}
                        style={[
                          styles.formatChip,
                          selected && styles.formatChipSelected,
                        ]}
                      >
                        <Ionicons
                          name={item.icon}
                          size={17}
                          color={selected ? "#FFFFFF" : theme.deepBrand}
                        />
                        <Text
                          style={[
                            styles.formatText,
                            selected && styles.formatTextSelected,
                          ]}
                        >
                          {item.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              ) : null}

              <View style={styles.section}>
                <View style={styles.sectionHeading}>
                  <View>
                    <Text style={styles.sectionKicker}>
                      {poll ? "Poll title" : "Question"}
                    </Text>
                    <Text style={styles.sectionHint}>
                      Keep it clear enough to understand at a glance.
                    </Text>
                  </View>
                  <Text style={styles.counter}>{body.length}/5000</Text>
                </View>
                <TextInput
                  accessibilityLabel={poll ? "Poll title" : "Question"}
                  autoFocus
                  editable={!busy}
                  multiline
                  maxLength={5000}
                  placeholder={
                    poll
                      ? "What do you want students to vote on?"
                      : "What do you want to ask?"
                  }
                  placeholderTextColor={theme.textSubtle}
                  selectionColor={theme.deepBrand}
                  value={body}
                  onChangeText={(value) => {
                    changed();
                    setBody(value);
                  }}
                  style={styles.questionInput}
                />

                {media ? (
                  <View style={styles.mediaPreview}>
                    <Image
                      source={{ uri: media.url }}
                      resizeMode="cover"
                      style={styles.mediaImage}
                    />
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Remove poll image"
                      disabled={busy}
                      onPress={() => {
                        changed();
                        setMedia(null);
                      }}
                      style={styles.removeMedia}
                    >
                      <Ionicons name="close" size={18} color="#FFFFFF" />
                    </Pressable>
                  </View>
                ) : (
                  <View style={styles.mediaActions}>
                    <Pressable
                      accessibilityRole="button"
                      disabled={busy || imageBusy}
                      onPress={() => void chooseImage("library")}
                      style={styles.mediaAction}
                    >
                      <Ionicons
                        name="image-outline"
                        size={21}
                        color={theme.deepBrand}
                      />
                      <Text style={styles.mediaActionText}>
                        {imageBusy ? "Adding image…" : "Add image"}
                      </Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      disabled={busy || imageBusy}
                      onPress={() => void chooseImage("camera")}
                      style={styles.mediaAction}
                    >
                      <Ionicons
                        name="camera-outline"
                        size={21}
                        color={theme.deepBrand}
                      />
                      <Text style={styles.mediaActionText}>Camera</Text>
                    </Pressable>
                  </View>
                )}
              </View>

              {poll ? (
                <View style={styles.section}>
                  <View style={styles.sectionHeading}>
                    <View>
                      <Text style={styles.sectionKicker}>Options</Text>
                      <Text style={styles.sectionHint}>
                        Add between 2 and 6 choices.
                      </Text>
                    </View>
                    <Text style={styles.counter}>{options.length}/6</Text>
                  </View>

                  <View style={styles.options}>
                    {options.map((value, index) => (
                      <View key={index} style={styles.optionRow}>
                        <View style={styles.optionNumber}>
                          <Text style={styles.optionNumberText}>{index + 1}</Text>
                        </View>
                        <TextInput
                          accessibilityLabel={`Poll option ${index + 1}`}
                          editable={!busy}
                          maxLength={100}
                          placeholder={`Option ${index + 1}`}
                          placeholderTextColor={theme.textSubtle}
                          selectionColor={theme.deepBrand}
                          value={value}
                          onChangeText={(next) => {
                            changed();
                            setOptions((current) =>
                              current.map((old, i) =>
                                i === index ? next : old,
                              ),
                            );
                          }}
                          style={styles.optionInput}
                        />
                        {options.length > 2 ? (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Remove option ${index + 1}`}
                            disabled={busy}
                            onPress={() => {
                              changed();
                              setOptions((current) =>
                                current.filter((_, i) => i !== index),
                              );
                            }}
                            style={styles.optionRemove}
                          >
                            <Ionicons
                              name="close"
                              size={18}
                              color={theme.textMuted}
                            />
                          </Pressable>
                        ) : null}
                      </View>
                    ))}
                  </View>

                  {options.length < 6 ? (
                    <Pressable
                      accessibilityRole="button"
                      disabled={busy}
                      onPress={() => {
                        changed();
                        setOptions((current) => [...current, ""]);
                      }}
                      style={styles.addOption}
                    >
                      <Ionicons
                        name="add"
                        size={19}
                        color={theme.deepBrand}
                      />
                      <Text style={styles.addOptionText}>Add another option</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}

              <View style={styles.section}>
                {poll ? (
                  <Pressable
                    accessibilityRole="switch"
                    accessibilityState={{ checked: anonymousPoll }}
                    disabled={busy}
                    onPress={() => {
                      changed();
                      setAnonymousPoll((value) => !value);
                    }}
                    style={styles.settingRow}
                  >
                    <View style={styles.settingCopy}>
                      <Text style={styles.settingTitle}>Anonymous voting</Text>
                      <Text style={styles.settingText}>
                        Hide voter identities and show only totals.
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.switchTrack,
                        anonymousPoll && styles.switchTrackOn,
                      ]}
                    >
                      <View
                        style={[
                          styles.switchThumb,
                          anonymousPoll && styles.switchThumbOn,
                        ]}
                      />
                    </View>
                  </Pressable>
                ) : null}

                <Text style={styles.sectionKicker}>Response window</Text>
                <View style={styles.durationRow}>
                  {durations.map((item) => {
                    const selected = item.value === hours;
                    return (
                      <Pressable
                        key={item.value}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        disabled={busy}
                        onPress={() => {
                          changed();
                          setHours(item.value);
                        }}
                        style={[
                          styles.durationChip,
                          selected && styles.durationChipSelected,
                        ]}
                      >
                        <Text
                          style={[
                            styles.durationText,
                            selected && styles.durationTextSelected,
                          ]}
                        >
                          {item.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            </>
          )}

          {error ? (
            <View accessibilityRole="alert" style={styles.errorCard}>
              <Ionicons name="alert-circle-outline" size={18} color={theme.error} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.canvas },
    header: {
      minHeight: 62,
      paddingHorizontal: 10,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border,
    },
    headerButton: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
    },
    headerTitle: {
      color: theme.text,
      fontFamily: theme.font.semibold,
      fontSize: 17,
    },
    publishButton: {
      minWidth: 76,
      minHeight: 40,
      paddingHorizontal: 17,
      borderRadius: 21,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.deepBrand,
    },
    publishText: {
      color: "#FFFFFF",
      fontFamily: theme.font.semibold,
      fontSize: 13,
    },
    disabled: { opacity: 0.42 },
    content: {
      width: "100%",
      maxWidth: 620,
      alignSelf: "center",
      padding: 18,
      paddingBottom: 80,
      gap: 16,
    },
    intro: { paddingVertical: 8, gap: 6 },
    eyebrow: {
      color: theme.deepBrand,
      fontFamily: theme.font.bold,
      fontSize: 10,
      letterSpacing: 1.1,
    },
    title: {
      color: theme.text,
      fontFamily: theme.font.display,
      fontSize: 32,
      lineHeight: 38,
    },
    subtitle: {
      color: theme.textMuted,
      fontFamily: theme.font.body,
      fontSize: 13.5,
      lineHeight: 20,
      maxWidth: 480,
    },
    formatRow: { gap: 8, paddingRight: 18 },
    formatChip: {
      minHeight: 42,
      paddingHorizontal: 14,
      borderRadius: 21,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      flexDirection: "row",
      alignItems: "center",
      gap: 7,
    },
    formatChipSelected: {
      backgroundColor: theme.deepBrand,
      borderColor: theme.deepBrand,
    },
    formatText: {
      color: theme.text,
      fontFamily: theme.font.medium,
      fontSize: 12,
    },
    formatTextSelected: { color: "#FFFFFF", fontFamily: theme.font.semibold },
    section: {
      backgroundColor: theme.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
      borderRadius: 20,
      padding: 16,
      gap: 13,
    },
    sectionHeading: {
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: 12,
    },
    sectionKicker: {
      color: theme.text,
      fontFamily: theme.font.semibold,
      fontSize: 13.5,
    },
    sectionHint: {
      color: theme.textMuted,
      fontFamily: theme.font.body,
      fontSize: 11.5,
      lineHeight: 17,
      marginTop: 2,
    },
    counter: {
      color: theme.textSubtle,
      fontFamily: theme.font.medium,
      fontSize: 10.5,
    },
    questionInput: {
      color: theme.text,
      fontFamily: theme.font.body,
      fontSize: 19,
      lineHeight: 27,
      minHeight: 118,
      padding: 0,
      textAlignVertical: "top",
    },
    mediaActions: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
    mediaAction: {
      minHeight: 42,
      paddingHorizontal: 13,
      borderRadius: 13,
      backgroundColor: theme.surfaceMuted,
      flexDirection: "row",
      alignItems: "center",
      gap: 7,
    },
    mediaActionText: {
      color: theme.deepBrand,
      fontFamily: theme.font.semibold,
      fontSize: 12,
    },
    mediaPreview: {
      position: "relative",
      width: "100%",
      aspectRatio: 1.6,
      borderRadius: 16,
      overflow: "hidden",
      backgroundColor: theme.surfaceMuted,
    },
    mediaImage: { width: "100%", height: "100%" },
    removeMedia: {
      position: "absolute",
      top: 9,
      right: 9,
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "rgba(34,29,26,.76)",
    },
    options: { gap: 9 },
    optionRow: {
      minHeight: 54,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 14,
      backgroundColor: theme.canvas,
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 10,
      gap: 9,
    },
    optionNumber: {
      width: 27,
      height: 27,
      borderRadius: 14,
      backgroundColor: theme.surfaceMuted,
      alignItems: "center",
      justifyContent: "center",
    },
    optionNumberText: {
      color: theme.deepBrand,
      fontFamily: theme.font.bold,
      fontSize: 11,
    },
    optionInput: {
      flex: 1,
      minHeight: 50,
      color: theme.text,
      fontFamily: theme.font.medium,
      fontSize: 14,
      paddingVertical: 0,
    },
    optionRemove: {
      width: 36,
      height: 36,
      alignItems: "center",
      justifyContent: "center",
    },
    addOption: {
      alignSelf: "flex-start",
      minHeight: 40,
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    addOptionText: {
      color: theme.deepBrand,
      fontFamily: theme.font.semibold,
      fontSize: 12,
    },
    settingRow: {
      minHeight: 66,
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      paddingBottom: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border,
    },
    settingCopy: { flex: 1, minWidth: 0 },
    settingTitle: {
      color: theme.text,
      fontFamily: theme.font.semibold,
      fontSize: 14,
    },
    settingText: {
      color: theme.textMuted,
      fontFamily: theme.font.body,
      fontSize: 11.5,
      lineHeight: 17,
      marginTop: 2,
    },
    switchTrack: {
      width: 48,
      height: 28,
      borderRadius: 14,
      backgroundColor: theme.border,
      padding: 3,
    },
    switchTrackOn: { backgroundColor: theme.deepBrand },
    switchThumb: {
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: "#FFFFFF",
    },
    switchThumbOn: { transform: [{ translateX: 20 }] },
    durationRow: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
    durationChip: {
      minHeight: 38,
      paddingHorizontal: 12,
      borderRadius: 19,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.canvas,
      alignItems: "center",
      justifyContent: "center",
    },
    durationChipSelected: {
      backgroundColor: theme.surfaceSoft,
      borderColor: theme.deepBrand,
    },
    durationText: {
      color: theme.textMuted,
      fontFamily: theme.font.medium,
      fontSize: 11,
    },
    durationTextSelected: {
      color: theme.deepBrand,
      fontFamily: theme.font.semibold,
    },
    stateCard: {
      minHeight: 180,
      borderRadius: 20,
      backgroundColor: theme.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
      gap: 8,
    },
    stateTitle: {
      color: theme.text,
      fontFamily: theme.font.semibold,
      fontSize: 16,
      textAlign: "center",
    },
    stateText: {
      color: theme.textMuted,
      fontFamily: theme.font.body,
      fontSize: 13,
      lineHeight: 20,
      textAlign: "center",
    },
    errorCard: {
      borderRadius: 14,
      backgroundColor: theme.surfaceMuted,
      padding: 13,
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 9,
    },
    errorText: {
      flex: 1,
      color: theme.error,
      fontFamily: theme.font.medium,
      fontSize: 12,
      lineHeight: 18,
    },
  });
