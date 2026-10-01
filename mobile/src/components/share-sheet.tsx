import { Ionicons } from "@expo/vector-icons";
import { randomUUID } from "expo-crypto";
import { useEffect, useRef, useState } from "react";
import {
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/src/auth/auth-context";
import { api } from "@/src/lib/api";
import { useThemeStyles, type Theme } from "@/src/lib/appearance";
import {
  copySharedLink,
  registerShareSheet,
  systemShare,
  type SharedContent,
  type ShareOutcome,
} from "@/src/lib/share-content";
import { ProfileAvatar } from "./profile-avatar";
import { SkeletonBlock } from "./skeleton";
import { useReducedMotionPreference } from "./product-ui";
type Contact = {
  id: string;
  user_id: string;
  status: string;
  initiator_id: string;
  display_name: string;
  profile_image_url: string | null;
};
type Pending = { content: SharedContent; done: (result: ShareOutcome) => void };
export function ShareSheetHost() {
  const { user, state } = useAuth(),
    { theme, styles } = useThemeStyles(createStyles),
    reduced = useReducedMotionPreference();
  const [pending, setPending] = useState<Pending | null>(null),
    [contacts, setContacts] = useState<Contact[]>([]),
    [selected, setSelected] = useState<Contact | null>(null),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [inboxError, setInboxError] = useState(""),
    [reload, setReload] = useState(0),
    [sent, setSent] = useState<string[]>([]);
  const active = useRef<Pending | null>(null),
    lock = useRef(false),
    keys = useRef(new Map<string, string>()),
    generation = useRef(0);
  function close(result: ShareOutcome = "cancelled") {
    if (lock.current) return;
    active.current?.done(result);
    active.current = null;
    setPending(null);
  }
  useEffect(
    () =>
      registerShareSheet(
        (content) =>
          new Promise((done) => {
            if (lock.current) {
              done("cancelled");
              return;
            }
            active.current?.done("cancelled");
            const value = { content, done };
            active.current = value;
            keys.current.clear();
            setSent([]);
            setSelected(null);
            setError("");
            setPending(value);
          }),
      ),
    [],
  );
  useEffect(() => {
    generation.current++;
    active.current?.done("cancelled");
    active.current = null;
    lock.current = false;
    setPending(null);
    setBusy(false);
    setContacts([]);
    setSelected(null);
    return () => {
      generation.current++;
      active.current?.done("cancelled");
      active.current = null;
    };
  }, [user?.id]);
  useEffect(() => {
    if (!pending || state !== "authenticated" || !user) return;
    const controller = new AbortController(),
      current = generation.current;
    setLoading(true);
    setInboxError("");
    setContacts([]);
    void api<{ threads: Contact[] }>("/v1/messages/inbox?filter=All", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((data) => {
        if (!controller.signal.aborted && current === generation.current)
          setContacts(
            data.threads.filter(
              (c) => c.status === "ACCEPTED" || c.initiator_id === user.id,
            ),
          );
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setInboxError(
            e instanceof Error
              ? e.message
              : "Could not load your conversations.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [pending, reload, state, user?.id]);
  async function send() {
    if (!pending || !selected || lock.current || sent.includes(selected.id))
      return;
    lock.current = true;
    setBusy(true);
    setError("");
    const target = selected,
      request = pending,
      current = generation.current;
    let key = keys.current.get(target.id);
    if (!key) {
      key = randomUUID();
      keys.current.set(target.id, key);
    }
    try {
      const body = [
        request.content.message || request.content.title,
        request.content.url,
      ].join("\n");
      const result = await api<{ message: { id: string } }>(
        `/v1/messages/threads/${target.id}/messages`,
        {
          method: "POST",
          body: JSON.stringify({ id: key, body }),
          timeoutMs: 15000,
        },
      );
      if (result.message?.id !== key)
        throw new Error(
          "We could not confirm this share. Retry to check the same message.",
        );
      if (current === generation.current && active.current === request) {
        setSent((old) => [...old, target.id]);
        setSelected(null);
      }
    } catch (e) {
      if (current === generation.current)
        setError(
          e instanceof Error
            ? e.message
            : "The link could not be sent. Retry uses the same message.",
        );
    } finally {
      if (current === generation.current) {
        lock.current = false;
        setBusy(false);
      }
    }
  }
  async function external(kind: "copy" | "whatsapp" | "more") {
    if (!pending || lock.current) return;
    setError("");
    try {
      if (kind === "copy") {
        const copied = await copySharedLink(pending.content.url);
        if (!copied) {
          setError("Copy wasn’t available. Select the link below to copy it.");
          return;
        }
        close("copied");
      } else if (kind === "whatsapp") {
        await Linking.openURL(
          "https://wa.me/?text=" +
            encodeURIComponent(
              [
                pending.content.message || pending.content.title,
                pending.content.url,
              ].join("\n"),
            ),
        );
        close("shared");
      } else {
        const result = await systemShare(pending.content);
        if (result === "manual") {
          setError("Select the link below to copy it.");
          return;
        }
        if (result !== "cancelled") close(result);
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not open sharing. You can copy the link below.",
      );
    }
  }
  return (
    <Modal
      transparent
      visible={!!pending}
      animationType={reduced ? "none" : "slide"}
      onRequestClose={() => close(sent.length ? "shared" : "cancelled")}
    >
      <View style={styles.scrim}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close sharing"
          onPress={() => close(sent.length ? "shared" : "cancelled")}
          style={StyleSheet.absoluteFill}
        />
        <SafeAreaView
          accessibilityViewIsModal
          edges={["bottom"]}
          style={styles.sheet}
        >
          <View style={styles.handle} />
          <View style={styles.heading}>
            <Text style={styles.title}>Share</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close share sheet"
              disabled={busy}
              onPress={() => close(sent.length ? "shared" : "cancelled")}
              style={styles.close}
            >
              <Ionicons name="close" color={theme.text} size={22} />
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled">
            <View style={styles.preview}>
              <Ionicons name="link-outline" color={theme.brand} size={25} />
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={2}>
                  {pending?.content.title}
                </Text>
                <Text selectable style={styles.link}>
                  {pending?.content.url}
                </Text>
              </View>
            </View>
            {state === "authenticated" ? (
              <>
                <Text style={styles.label}>Send in KampusOne</Text>
                {loading ? (
                  <View style={{ padding: 22 }}><SkeletonBlock height={86} /></View>
                ) : inboxError ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setReload((n) => n + 1)}
                    style={styles.feedback}
                  >
                    <Text style={styles.body}>{inboxError} Tap to retry.</Text>
                  </Pressable>
                ) : contacts.length ? (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.contacts}
                  >
                    {contacts.map((contact) => {
                      const delivered = sent.includes(contact.id),
                        chosen = selected?.id === contact.id;
                      return (
                        <Pressable
                          key={contact.id}
                          accessibilityRole="button"
                          accessibilityLabel={
                            delivered
                              ? `Sent to ${contact.display_name}`
                              : `Share with ${contact.display_name}`
                          }
                          accessibilityState={{
                            selected: chosen,
                            disabled: busy || delivered,
                          }}
                          disabled={busy || delivered}
                          onPress={() => {
                            setSelected(chosen ? null : contact);
                            setError("");
                          }}
                          style={[
                            styles.contact,
                            chosen && styles.chosen,
                            delivered && { opacity: 0.6 },
                          ]}
                        >
                          <ProfileAvatar
                            size={54}
                            name={contact.display_name}
                            imageUrl={contact.profile_image_url}
                          />
                          <Text numberOfLines={2} style={styles.contactName}>
                            {contact.display_name}
                          </Text>
                          {delivered ? (
                            <Text style={styles.sent}>Sent ✓</Text>
                          ) : chosen ? (
                            <Ionicons
                              name="checkmark-circle"
                              color={theme.brand}
                              size={20}
                            />
                          ) : null}
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                ) : (
                  <Text
                    style={[
                      styles.body,
                      { paddingHorizontal: 22, paddingBottom: 20 },
                    ]}
                  >
                    Your recent conversations will appear here.
                  </Text>
                )}
                {selected ? (
                  <Pressable
                    accessibilityRole="button"
                    disabled={busy}
                    onPress={() => void send()}
                    style={[styles.send, busy && { opacity: 0.5 }]}
                  >
                    <Text style={styles.sendText}>
                      {busy ? "Sending…" : `Send to ${selected.display_name}`}
                    </Text>
                  </Pressable>
                ) : null}
                {sent.length ? (
                  <Text
                    accessibilityLiveRegion="polite"
                    style={styles.sentNotice}
                  >
                    Link sent to {sent.length}{" "}
                    {sent.length === 1 ? "conversation" : "conversations"}.
                  </Text>
                ) : null}
              </>
            ) : null}
            <View style={styles.external}>
              {(["whatsapp", "copy", "more"] as const).map((kind) => (
                <Pressable
                  key={kind}
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={() => void external(kind)}
                  style={styles.externalButton}
                >
                  <View
                    style={[
                      styles.externalIcon,
                      kind === "whatsapp" && { backgroundColor: "#217C4B" },
                    ]}
                  >
                    <Ionicons
                      name={
                        kind === "whatsapp"
                          ? "logo-whatsapp"
                          : kind === "copy"
                            ? "copy-outline"
                            : "ellipsis-horizontal"
                      }
                      size={25}
                      color={kind === "whatsapp" ? "white" : theme.text}
                    />
                  </View>
                  <Text style={styles.contactName}>
                    {kind === "copy"
                      ? "Copy link"
                      : kind === "more"
                        ? "More"
                        : "WhatsApp"}
                  </Text>
                </Pressable>
              ))}
            </View>
            {error ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {error}
              </Text>
            ) : null}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}
const createStyles = (theme: Theme) =>
  StyleSheet.create({
    scrim: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,.4)",
      justifyContent: "flex-end",
    },
    sheet: {
      backgroundColor: theme.canvas,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      maxHeight: "85%",
      maxWidth: 620,
      width: "100%",
      alignSelf: "center",
    },
    handle: {
      backgroundColor: theme.border,
      width: 42,
      height: 4,
      borderRadius: 2,
      alignSelf: "center",
      marginTop: 10,
    },
    heading: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 22,
      paddingVertical: 6,
    },
    title: { color: theme.text, fontFamily: theme.font.display, fontSize: 25 },
    close: {
      minHeight: 44,
      minWidth: 44,
      alignItems: "center",
      justifyContent: "center",
    },
    preview: {
      flexDirection: "row",
      gap: 12,
      padding: 16,
      marginHorizontal: 20,
      backgroundColor: theme.surfaceMuted,
      borderRadius: 13,
    },
    name: {
      color: theme.text,
      fontFamily: theme.font.semibold,
      fontSize: 14,
      lineHeight: 20,
    },
    link: {
      color: theme.brand,
      fontFamily: theme.font.body,
      fontSize: 11,
      lineHeight: 17,
      marginTop: 4,
    },
    label: {
      color: theme.textMuted,
      fontFamily: theme.font.semibold,
      fontSize: 12,
      paddingHorizontal: 22,
      paddingTop: 22,
      paddingBottom: 12,
    },
    contacts: { paddingHorizontal: 14, gap: 5, paddingBottom: 8 },
    contact: {
      width: 86,
      minHeight: 128,
      alignItems: "center",
      paddingHorizontal: 5,
      paddingTop: 9,
      borderWidth: 1.5,
      borderColor: "transparent",
      borderRadius: 12,
      gap: 8,
    },
    chosen: { borderColor: theme.brand, backgroundColor: theme.surfaceTint },
    contactName: {
      fontFamily: theme.font.medium,
      fontSize: 11,
      color: theme.text,
      textAlign: "center",
      lineHeight: 16,
    },
    body: {
      fontFamily: theme.font.body,
      color: theme.textMuted,
      fontSize: 13,
      lineHeight: 20,
    },
    feedback: {
      backgroundColor: theme.surfaceMuted,
      margin: 20,
      padding: 13,
      borderRadius: 12,
    },
    send: {
      backgroundColor: theme.deepBrand,
      borderRadius: 14,
      minHeight: 50,
      alignItems: "center",
      justifyContent: "center",
      marginHorizontal: 22,
      marginVertical: 8,
    },
    sendText: { color: "white", fontFamily: theme.font.semibold, fontSize: 14 },
    external: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.border,
      flexDirection: "row",
      justifyContent: "space-evenly",
      padding: 22,
      gap: 10,
      marginTop: 12,
    },
    externalButton: {
      alignItems: "center",
      gap: 9,
      minWidth: 72,
      minHeight: 88,
    },
    externalIcon: {
      width: 54,
      height: 54,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.surfaceMuted,
      borderRadius: 17,
    },
    error: {
      color: theme.error,
      fontFamily: theme.font.body,
      fontSize: 13,
      lineHeight: 20,
      padding: 22,
      paddingTop: 0,
    },
    sent: {
      color: theme.success,
      fontFamily: theme.font.semibold,
      fontSize: 11,
    },
    sentNotice: {
      color: theme.success,
      fontFamily: theme.font.medium,
      fontSize: 12,
      paddingHorizontal: 22,
      paddingVertical: 8,
    },
  });
