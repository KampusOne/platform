import { useCallback, useState } from "react";
import { Linking, Pressable, Share, Text, View } from "react-native";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import * as Crypto from "expo-crypto";
import { useAuth } from "@/src/auth/auth-context";
import {
  ToolButton,
  ToolField,
  ToolPage,
  ToolRow,
} from "@/src/components/toolkit";
import { EmptyResult } from "@/src/components/product-ui";
import { ScreenSkeleton } from "@/src/components/skeleton";
import { useToast } from "@/src/components/toast";
import { useAppearance } from "@/src/lib/appearance";
import { api } from "@/src/lib/api";
type Detail = {
  community: {
    id: string;
    name: string;
    rep_name: string | null;
    joined_at: string | null;
    verified_at: string | null;
    archived_at: string | null;
  };
  election: {
    id: string;
    is_open: boolean;
    status: string;
    starts_at: string;
    ends_at: string;
    my_vote: string | null;
  } | null;
  candidates: {
    user_id: string;
    display_name: string;
    username: string;
    votes: number;
  }[];
  announcements: {
    id: string;
    title: string;
    body: string;
    created_at: string;
  }[];
  transfers: {
    id: string;
    to_user_id: string;
    status: string;
    username: string;
  }[];
  isRep: boolean;
};
export default function Community() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth(),
    { theme } = useAppearance(),
    toast = useToast();
  const [data, setData] = useState<Detail | null>(null),
    [busy, setBusy] = useState(false),
    [title, setTitle] = useState(""),
    [body, setBody] = useState(""),
    [username, setUsername] = useState(""),
    [requestKey, setRequestKey] = useState(Crypto.randomUUID());
  const load = useCallback(async () => {
    try {
      setData(await api<Detail>("/v1/communities/" + id));
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not open community");
    }
  }, [id, toast]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  async function act(path: string, payload: unknown) {
    setBusy(true);
    try {
      const r = await api<{ status: string }>("/v1/communities/" + id + path, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      toast(
        r.status === "already_voted"
          ? "Your vote is already recorded"
          : path.includes("announcements")
            ? "Announcement published"
            : "Saved",
      );
      if (path === "/announcements") {
        setTitle("");
        setBody("");
        setRequestKey(Crypto.randomUUID());
      }
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }
  const text = {
    fontFamily: theme.font.body,
    color: theme.text,
    fontSize: 14,
    lineHeight: 23,
  };
  const heading = {
    fontFamily: theme.font.displayStrong,
    color: theme.text,
    fontSize: 21,
  };
  const e = data?.election;
  return (
    <ToolPage
      title={data?.community.name ?? "Class community"}
      action={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Share community"
          onPress={() =>
            void Share.share({
              message: `${data?.community.name ?? "Class community"}\nhttps://kampusone-mobile-preview.vercel.app/community?id=${encodeURIComponent(id ?? "")}`,
            }).catch(() => toast("Could not share"))
          }
        >
          <Text style={{ ...text, color: theme.brand }}>Share</Text>
        </Pressable>
      }
    >
      {!data ? (
        <ScreenSkeleton />
      ) : (
        <>
          <Text style={{ ...text, color: theme.textMuted }}>
            {data.community.rep_name
              ? "Course rep · " + data.community.rep_name
              : "No course rep yet"}
          </Text>
          {!data.community.joined_at && !data.community.archived_at ? (
            <ToolButton
              disabled={busy}
              label="Join this class"
              onPress={() => void act("/join", {})}
            />
          ) : null}
          {data.community.joined_at && !data.community.verified_at ? (
            <ToolRow
              title="Membership awaiting verification"
              icon="shield-checkmark-outline"
            />
          ) : null}
          {e ? (
            <View style={{ marginVertical: 22, gap: 12 }}>
              <Text style={heading}>Course rep election</Text>
              <Text style={{ ...text, color: theme.textMuted }}>
                {e.is_open
                  ? "Closes "
                  : e.status === "SCHEDULED"
                    ? "Opens "
                    : e.status === "TIED"
                      ? "Tied · new voting dates will be announced."
                      : "Election closed"}
                {e.is_open
                  ? new Date(e.ends_at).toLocaleString()
                  : e.status === "SCHEDULED"
                    ? new Date(e.starts_at).toLocaleString()
                    : ""}
              </Text>
              {data.candidates.map((candidate) => (
                <ToolRow
                  key={candidate.user_id}
                  title={candidate.display_name}
                  detail={
                    "@" +
                    candidate.username +
                    " · " +
                    candidate.votes +
                    " votes"
                  }
                  trailing={
                    <ToolButton
                      label={e.my_vote === candidate.user_id ? "Voted" : "Vote"}
                      disabled={
                        busy ||
                        !e.is_open ||
                        !!e.my_vote ||
                        !data.community.verified_at
                      }
                      onPress={() =>
                        void act("/elections/" + e.id, {
                          candidateId: candidate.user_id,
                        })
                      }
                    />
                  }
                />
              ))}
              {e.is_open &&
              !data.candidates.some(
                (candidate) => candidate.user_id === user?.id,
              ) ? (
                <ToolButton
                  secondary
                  disabled={busy || !data.community.verified_at}
                  label="Apply as course rep"
                  onPress={() => void act("/elections/" + e.id, {})}
                />
              ) : null}
            </View>
          ) : null}
          {data.transfers.map((t) => (
            <ToolRow
              key={t.id}
              title={"Transfer to @" + t.username}
              detail={
                t.status === "ACCEPTED"
                  ? "Awaiting admin review"
                  : "Awaiting acceptance"
              }
              trailing={
                t.to_user_id === user?.id && t.status === "PENDING" ? (
                  <ToolButton
                    label="Accept"
                    disabled={busy}
                    onPress={() =>
                      void act("/transfers/" + t.id + "/accept", {})
                    }
                  />
                ) : undefined
              }
            />
          ))}
          {data.isRep && !data.community.archived_at ? (
            <View style={{ marginTop: 24 }}>
              <Text style={heading}>Class announcement</Text>
              <ToolField
                label="Title"
                value={title}
                onChangeText={setTitle}
                maxLength={140}
              />
              <ToolField
                label="Message"
                value={body}
                onChangeText={setBody}
                multiline
                maxLength={4000}
              />
              <ToolButton
                label="Publish"
                disabled={
                  busy || title.trim().length < 3 || body.trim().length < 3
                }
                onPress={() =>
                  void act("/announcements", {
                    title,
                    body,
                    idempotencyKey: requestKey,
                  })
                }
              />
              <ToolField
                label="Transfer course rep role"
                placeholder="Recipient’s username"
                autoCapitalize="none"
                value={username}
                onChangeText={setUsername}
              />
              <ToolButton
                secondary
                label="Request transfer"
                disabled={busy || username.trim().length < 3}
                onPress={() => void act("/transfers", { username })}
              />
            </View>
          ) : null}
          <View style={{ marginTop: 28, gap: 18 }}>
            <Text style={heading}>Important information</Text>
            {data.announcements.length ? (
              data.announcements.map((a) => (
                <View
                  key={a.id}
                  style={{
                    paddingVertical: 16,
                    borderBottomWidth: 1,
                    borderColor: theme.border,
                    gap: 8,
                  }}
                >
                  <Text style={{ ...heading, fontSize: 18 }}>{a.title}</Text>
                  <Text
                    style={{ ...text, color: theme.textMuted, fontSize: 12 }}
                  >
                    {new Date(a.created_at).toLocaleString()}
                  </Text>
                  <LinkedMessage body={a.body} />
                </View>
              ))
            ) : (
              <EmptyResult title="No announcements yet" />
            )}
          </View>
        </>
      )}
    </ToolPage>
  );
}
function LinkedMessage({ body }: { body: string }) {
  const { theme } = useAppearance();
  const toast = useToast();
  return (
    <Text
      selectable
      style={{
        fontFamily: theme.font.body,
        color: theme.text,
        fontSize: 14,
        lineHeight: 24,
      }}
    >
      {body.split(/(https?:\/\/[^\s<>]+)/g).map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <Text
            key={i}
            accessibilityRole="link"
            style={{ color: theme.brand, textDecorationLine: "underline" }}
            onPress={() =>
              void Linking.openURL(part).catch(() =>
                toast("Could not open link"),
              )
            }
          >
            {part}
          </Text>
        ) : (
          part
        ),
      )}
    </Text>
  );
}
