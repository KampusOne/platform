import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { randomUUID } from "expo-crypto";
import { Ionicons } from "@expo/vector-icons";
import { ToolPage, ToolButton, ToolField } from "@/src/components/toolkit";
import { ScreenSkeleton } from "@/src/components/skeleton";
import { EmptyResult } from "@/src/components/product-ui";
import { useAppearance } from "@/src/lib/appearance";
import { useAuth } from "@/src/auth/auth-context";
import { api } from "@/src/lib/api";
import { readCache, writeCache } from "@/src/lib/device-cache";
type Answer = {
  id: string;
  body: string;
  reply: string | null;
  author_name: string | null;
  status: string;
  created_at: string;
  published_at: string | null;
};
type Details = {
  post: {
    id: string;
    format: "POLL" | "QA" | "ANONYMOUS_QA";
    body: string;
    closes_at: string | null;
    is_owner: boolean;
  };
  options: { id: number; label: string; votes: number }[];
  myVote?: number | null;
  answers: Answer[];
  disclosure?: string;
};
export default function PublishingPost() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { theme } = useAppearance();
  const [data, setData] = useState<Details | null>(null);
  const [inbox, setInbox] = useState<Answer[]>([]);
  const [showInbox, setShowInbox] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [body, setBody] = useState("");
  const [consent, setConsent] = useState(false);
  const [replyTo, setReplyTo] = useState<Answer | null>(null);
  const [reply, setReply] = useState("");
  const [ready, setReady] = useState(false);
  const requestId = useRef(randomUUID());
  const working = useRef(false);
  const path = "/v1/student/publishing/posts/" + encodeURIComponent(id ?? "");
  const draftKey = `answer-draft.${user?.id}.${id}`;
  const load = useCallback(async () => {
    setError("");
    try {
      const response = await api<Details>(path);
      setData(response);
      if (response.post.is_owner && response.post.format !== "POLL")
        setInbox((await api<{ answers: Answer[] }>(path + "/inbox")).answers);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The post could not load. Try again.",
      );
    } finally {
      setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    if (id) void load();
    else {
      setError("This post link is incomplete.");
      setLoading(false);
    }
  }, [id, load]);
  useEffect(() => {
    let live = true;
    if (user && id)
      void readCache<{ body: string; requestId: string }>(draftKey).then(
        (draft) => {
          if (live) {
            if (draft) {
              setBody(draft.body);
              requestId.current = draft.requestId;
            }
            setReady(true);
          }
        },
      );
    return () => {
      live = false;
    };
  }, [draftKey, user?.id, id]);
  useEffect(() => {
    if (ready)
      void writeCache(draftKey, { body, requestId: requestId.current });
  }, [body, ready, draftKey]);
  async function action(operation: () => Promise<unknown>, success: string) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    setFeedback("");
    try {
      const outcome = await operation();
      setFeedback(typeof outcome === "string" ? outcome : success);
      await load();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "This action could not finish. Your work is still here.",
      );
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  const anonymous = data?.post.format === "ANONYMOUS_QA";
  const poll = data?.post.format === "POLL";
  const totalVotes =
    data?.options.reduce((sum, option) => sum + Number(option.votes), 0) ?? 0;
  const pollClosed = Boolean(
    data?.post.closes_at && Date.parse(data.post.closes_at) <= Date.now(),
  );
  return (
    <ToolPage
      title={poll ? "Campus poll" : anonymous ? "Anonymous Q&A" : "Campus Q&A"}
    >
      {loading ? (
        <ScreenSkeleton variant="feed" compact />
      ) : !data ? (
        <>
          <Text accessibilityRole="alert" style={{ color: theme.error }}>
            {error}
          </Text>
          <ToolButton
            secondary
            label="Retry post"
            onPress={() => {
              setLoading(true);
              void load();
            }}
          />
        </>
      ) : (
        <>
          <Text
            style={{
              fontFamily: theme.font.display,
              color: theme.text,
              fontSize: 25,
              lineHeight: 32,
              marginBottom: 22,
            }}
          >
            {data.post.body}
          </Text>
          {poll ? (
            <>
              {data.options.map((option) => {
                const selected = data.myVote === option.id;
                const percent = totalVotes
                  ? Math.round((Number(option.votes) / totalVotes) * 100)
                  : 0;
                return (
                  <Pressable
                    key={option.id}
                    accessibilityRole="button"
                    accessibilityState={{
                      selected,
                      disabled: busy || pollClosed || Boolean(data.myVote),
                    }}
                    disabled={busy || pollClosed || Boolean(data.myVote)}
                    onPress={() =>
                      void action(
                        () =>
                          api(path + "/vote", {
                            method: "POST",
                            body: JSON.stringify({ optionId: option.id }),
                          }),
                        "Your vote was saved",
                      )
                    }
                    style={{
                      borderWidth: selected ? 2 : 1,
                      borderColor: selected ? theme.deepBrand : theme.border,
                      borderRadius: 12,
                      padding: 15,
                      marginBottom: 12,
                      overflow: "hidden",
                    }}
                  >
                    <View
                      style={{
                        position: "absolute",
                        left: 0,
                        top: 0,
                        bottom: 0,
                        width: `${percent}%`,
                        backgroundColor: theme.surfaceMuted,
                      }}
                    />
                    <View
                      style={{
                        flexDirection: "row",
                        justifyContent: "space-between",
                        gap: 10,
                      }}
                    >
                      <Text
                        style={{
                          flex: 1,
                          fontFamily: theme.font.medium,
                          color: theme.text,
                        }}
                      >
                        {option.label}
                      </Text>
                      {selected ? (
                        <Ionicons
                          name="checkmark"
                          color={theme.deepBrand}
                          size={20}
                        />
                      ) : null}
                      <Text style={{ color: theme.text }}>{percent}%</Text>
                    </View>
                  </Pressable>
                );
              })}
              <Text
                style={{
                  color: theme.textMuted,
                  fontFamily: theme.font.body,
                  lineHeight: 21,
                }}
              >
                {totalVotes} {totalVotes === 1 ? "vote" : "votes"} · One vote
                per account
                {data.post.closes_at
                  ? ` · ${pollClosed ? "Closed" : "Closes"} ${new Date(data.post.closes_at).toLocaleString()}`
                  : ""}
              </Text>
            </>
          ) : (
            <>
              {data.post.is_owner ? (
                <View
                  style={{ flexDirection: "row", gap: 12, marginBottom: 18 }}
                >
                  <ToolButton
                    secondary={showInbox}
                    label="Published answers"
                    onPress={() => setShowInbox(false)}
                  />
                  <ToolButton
                    secondary={!showInbox}
                    label={`Private inbox (${inbox.filter((answer) => answer.status === "PRIVATE").length})`}
                    onPress={() => setShowInbox(true)}
                  />
                </View>
              ) : null}
              {(showInbox ? inbox : data.answers).length ? (
                (showInbox ? inbox : data.answers).map((answer) => (
                  <View
                    key={answer.id}
                    style={{
                      paddingVertical: 18,
                      borderBottomWidth: 1,
                      borderColor: theme.border,
                    }}
                  >
                    <Text
                      style={{
                        color: theme.textMuted,
                        fontFamily: theme.font.medium,
                        fontSize: 12,
                        marginBottom: 8,
                      }}
                    >
                      {anonymous
                        ? "Anonymous answer"
                        : answer.author_name || "Student answer"}{" "}
                      · {answer.status === "PRIVATE" ? "Private" : "Published"}
                    </Text>
                    <Text
                      selectable
                      style={{
                        color: theme.text,
                        fontFamily: theme.font.body,
                        lineHeight: 24,
                      }}
                    >
                      {answer.body}
                    </Text>
                    {answer.reply ? (
                      <View
                        style={{
                          borderLeftWidth: 3,
                          borderColor: theme.brand,
                          marginTop: 16,
                          paddingLeft: 14,
                        }}
                      >
                        <Text
                          style={{
                            color: theme.textMuted,
                            fontSize: 12,
                            marginBottom: 6,
                          }}
                        >
                          Publisher's reply
                        </Text>
                        <Text
                          selectable
                          style={{
                            color: theme.text,
                            fontFamily: theme.font.body,
                            lineHeight: 24,
                          }}
                        >
                          {answer.reply}
                        </Text>
                      </View>
                    ) : null}
                    {showInbox && answer.status === "PRIVATE" ? (
                      <ToolButton
                        secondary
                        label="Write a reply to publish"
                        disabled={busy}
                        onPress={() => {
                          setReplyTo(answer);
                          setReply("");
                        }}
                      />
                    ) : null}
                  </View>
                ))
              ) : (
                <EmptyResult
                  title={
                    showInbox
                      ? "No private answers yet"
                      : "No published answers yet"
                  }
                />
              )}
              {replyTo ? (
                <View style={{ marginTop: 20 }}>
                  <Text
                    style={{
                      color: theme.text,
                      fontFamily: theme.font.medium,
                      marginBottom: 12,
                    }}
                  >
                    Publish this answer with your reply
                  </Text>
                  <Text
                    style={{
                      color: theme.textMuted,
                      lineHeight: 22,
                      marginBottom: 14,
                    }}
                  >
                    {replyTo.body}
                  </Text>
                  <ToolField
                    label="Your public reply"
                    value={reply}
                    onChangeText={setReply}
                    editable={!busy}
                    multiline
                    maxLength={3000}
                  />
                  <ToolButton
                    label={busy ? "Publishing…" : "Publish answer & reply"}
                    disabled={busy || !reply.trim()}
                    onPress={() =>
                      void action(async () => {
                        await api(`${path}/answers/${replyTo.id}/publish`, {
                          method: "POST",
                          body: JSON.stringify({ reply }),
                        });
                        setReplyTo(null);
                        setReply("");
                      }, "Answer and reply published")
                    }
                  />
                  <ToolButton
                    secondary
                    label="Cancel reply"
                    disabled={busy}
                    onPress={() => setReplyTo(null)}
                  />
                </View>
              ) : null}
              {!data.post.is_owner ? (
                <View style={{ marginTop: 26 }}>
                  <Text
                    style={{
                      color: theme.textMuted,
                      lineHeight: 21,
                      fontFamily: theme.font.body,
                      fontSize: 12,
                      marginBottom: 16,
                    }}
                  >
                    {data.disclosure ||
                      `Your answer starts private. The publisher may share it with a public reply.${anonymous ? " Your name is hidden from the publisher and other students. Restricted account linkage is kept for moderation." : " Your name may appear with a published answer."}`}
                  </Text>
                  <ToolField
                    label={anonymous ? "Your anonymous answer" : "Your answer"}
                    value={body}
                    editable={!busy && ready}
                    multiline
                    maxLength={3000}
                    onChangeText={(value) => {
                      setBody(value);
                      requestId.current = randomUUID();
                    }}
                  />
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: consent, disabled: busy }}
                    disabled={busy}
                    onPress={() => setConsent(!consent)}
                    style={{
                      flexDirection: "row",
                      gap: 12,
                      alignItems: "center",
                      minHeight: 48,
                      marginBottom: 12,
                    }}
                  >
                    <Ionicons
                      name={consent ? "checkbox" : "square-outline"}
                      size={23}
                      color={theme.deepBrand}
                    />
                    <Text
                      style={{
                        flex: 1,
                        color: theme.text,
                        fontFamily: theme.font.body,
                        lineHeight: 20,
                        fontSize: 12,
                      }}
                    >
                      I understand the publisher may publish my answer with a
                      reply.
                    </Text>
                  </Pressable>
                  <ToolButton
                    label={busy ? "Sending privately…" : "Send private answer"}
                    disabled={busy || !ready || !consent || !body.trim()}
                    onPress={() =>
                      void action(async () => {
                        const result = await api<{ status: string }>(
                          path + "/answers",
                          {
                            method: "POST",
                            body: JSON.stringify({
                              body,
                              requestId: requestId.current,
                              acceptPublication: true,
                            }),
                          },
                        );
                        setBody("");
                        setConsent(false);
                        requestId.current = randomUUID();
                        await writeCache(draftKey, null);
                        return result.status === "PUBLISHED"
                          ? "This answer has already been published by the publisher"
                          : result.status === "DELETED"
                            ? "This answer was previously removed"
                            : "Your answer was sent privately to the publisher";
                      }, "Your answer was sent privately to the publisher")
                    }
                  />
                </View>
              ) : null}
            </>
          )}
          {error ? (
            <Text
              accessibilityRole="alert"
              style={{
                color: theme.error,
                fontFamily: theme.font.body,
                lineHeight: 22,
                marginTop: 18,
              }}
            >
              {error}
            </Text>
          ) : null}
          {feedback ? (
            <Text
              accessibilityLiveRegion="polite"
              style={{
                color: theme.text,
                fontFamily: theme.font.medium,
                marginTop: 18,
              }}
            >
              {feedback}
            </Text>
          ) : null}
          {busy ? (
            <Text
              accessibilityLiveRegion="polite"
              style={{ color: theme.textMuted, marginTop: 12 }}
            >
              Saving…
            </Text>
          ) : null}
        </>
      )}
    </ToolPage>
  );
}
