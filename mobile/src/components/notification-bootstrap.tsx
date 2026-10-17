import {useToast} from './toast';
import { liveReads } from "@/src/lib/live-updates";
import {markConversationRead} from '@/src/lib/message-read';
import {getDeviceCacheRevision} from '@/src/lib/device-cache';
import {cacheScopeForUser} from '@/src/lib/request-policy';
import {updateNotificationCount} from '@/src/lib/notification-state';
import Constants from "expo-constants";
import { useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";
import { router, type Href } from "expo-router";
import * as Crypto from "expo-crypto";
import { useAuth } from "@/src/auth/auth-context";
import { api } from "@/src/lib/api";
import {
  configureNativeNotifications,
  getRegisteredPushDevice,
  PUSH_ACTION,
  pushSetupAvailability,
  registerPushDevice,
  requestNativeNotificationPermission,
} from "@/src/lib/push-registration";

type NotificationResponseLike = {
  actionIdentifier?: string;
  userText?: string;
  notification: {
    request: {
      identifier: string;
      content: { data?: Record<string, unknown> };
    };
  };
};

type PreferenceResponse = {
  channels: Record<
    string,
    { in_app_enabled: boolean; push_enabled: boolean }
  >;
};

function validAppPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//")
  );
}

function threadIdFromPath(path: unknown) {
  if (typeof path !== "string") return null;
  const match = path.match(/^\/conversation\?id=([0-9a-f-]{36})(?:&|$)/i);
  return match?.[1] ?? null;
}

async function markPushRead(data: Record<string, unknown>) {
  const revision=getDeviceCacheRevision();
  const threadId = threadIdFromPath(data.path);
  if (threadId) {
    await markConversationRead(threadId,typeof data.messageId==='string'?data.messageId:undefined);
    return;
  }
  const notificationId = data.notificationId;
  if (typeof notificationId === "string") {
    const result=await api<{unreadCount:number}>(
      `/v1/notifications/inbox/${encodeURIComponent(notificationId)}/read`,
      { method: "PATCH",timeoutMs:8000 },
    );
    if(revision!==getDeviceCacheRevision())return;
    updateNotificationCount(result.unreadCount,revision);
    liveReads.event(['/v1/notifications/inbox']);
  }
}

async function observePush(data: Record<string, unknown>) {
  const deliveryId = data.deliveryId;
  const attemptId = data.attemptId;
  const value = typeof deliveryId === 'string' ? deliveryId : attemptId;
  if (typeof value !== 'string' || !/^[0-9a-f-]{36}$/i.test(value)) return;
  const collection = typeof deliveryId === 'string' ? 'deliveries' : 'attempts';
  await api(`/v1/notifications/${collection}/${encodeURIComponent(value)}/observed`, { method: 'POST' }).catch(() => undefined);
}

async function mutePushCategory(data: Record<string, unknown>) {
  const category = data.preferenceCategory;
  if (typeof category !== "string") return;
  const current = await api<PreferenceResponse>("/v1/notifications/preferences");
  const row = current.channels?.[category];
  if (!row || !row.push_enabled) return;
  await api("/v1/notifications/preferences", {
    method: "PUT",
    body: JSON.stringify({
      channels: {
        ...current.channels,
        [category]: { ...row, push_enabled: false },
      },
    }),
  });
}

export function NotificationBootstrap() {
  const { state, user } = useAuth();
  const toast=useToast();
  const lastHandledResponse = useRef<string | null>(null);

  // The shared event coordinator reconciles both inboxes; no per-screen polling loop.
  // Seed the first snapshot quietly so opening the app never replays old alerts.
  useEffect(() => {
    if (state !== 'authenticated' || !user?.id) return;
    let active = true, noticesReady = false, messagesReady = false;
    const revision = getDeviceCacheRevision();
    const seenNotices = new Set<string>(), seenMessages = new Set<string>();
    const current = () => active && revision === getDeviceCacheRevision() && AppState.currentState === 'active';
    const remember = (set: Set<string>, key: string) => { set.add(key); while (set.size > 150) set.delete(set.values().next().value!); };
    async function notices() {
      if (!current()) return;
      const page = await api<{notifications:{id:string;title:string;body:string;path:string|null;read_at:string|null;actor_user_id:string|null;actor_name:string|null;actor_profile_image_url:string|null}[]}>('/v1/notifications/inbox');
      if (!current()) return;
      for (const row of [...page.notifications].reverse()) {
        if (noticesReady && !row.read_at && !seenNotices.has(row.id)) toast(row.body, 'info', validAppPath(row.path) ? () => router.push(row.path as Href) : undefined, {
          title: row.title, dedupeKey: 'notice:' + row.id,
          ...(row.actor_user_id ? {actor:{id:row.actor_user_id,name:row.actor_name || 'KampusOne user',imageUrl:row.actor_profile_image_url}} : {}),
        });
        remember(seenNotices, row.id);
      }
      noticesReady = true;
    }
    async function messages() {
      if (!current()) return;
      const page = await api<{threads:{id:string;user_id:string;last_message_id:string|null;last_sender_id:string|null;last_message:string|null;display_name:string;profile_image_url:string|null;unread_count:number}[]}>('/v1/messages/inbox');
      if (!current()) return;
      for (const row of [...page.threads].reverse()) {
        if (!row.last_message_id) continue;
        if (messagesReady && row.last_sender_id !== user!.id && row.unread_count > 0 && !seenMessages.has(row.last_message_id)) toast(row.last_message || 'New message', 'info', () => router.push({pathname:'/conversation',params:{id:row.id}}), {
          title: row.display_name, dedupeKey: 'message:' + row.last_message_id, actor: {id:row.user_id,name:row.display_name,imageUrl:row.profile_image_url},
        });
        remember(seenMessages, row.last_message_id);
      }
      messagesReady = true;
    }
    const offNotices = liveReads.subscribe('/v1/notifications/inbox', notices, 60_000);
    const offMessages = liveReads.subscribe('/v1/messages/inbox', messages, 60_000);
    void Promise.allSettled([notices(), messages()]);
    return () => { active = false; offNotices(); offMessages(); };
  }, [state, user ? cacheScopeForUser(user) : null, toast]);

  useEffect(() => {
    if (Platform.OS === "web" || state !== "authenticated" || !user?.id) return;
    let active = true;
    let running = false;
    let checkedAt = 0, failures = 0,registeredCheckedAt=0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let responseSubscription: { remove(): void } | undefined;
    let tokenSubscription: { remove(): void } | undefined;
    let receivedSubscription: { remove(): void } | undefined;

    const openNotification = async (response: NotificationResponseLike) => {
      if (!active) return;
      const identifier = response.notification.request.identifier;
      const actionIdentifier = response.actionIdentifier ?? "default";
      const responseKey = `${identifier}:${actionIdentifier}`;
      if (lastHandledResponse.current === responseKey) return;

      const data = response.notification.request.content.data ?? {};
      void observePush(data);
      const path = data.path;
      lastHandledResponse.current = responseKey;

      try {
        if (actionIdentifier === PUSH_ACTION.MARK_READ) {
          await markPushRead(data);
          return;
        }

        if (actionIdentifier === PUSH_ACTION.MUTE) {
          await mutePushCategory(data);
          return;
        }

        if (actionIdentifier === PUSH_ACTION.REPLY) {
          const threadId = threadIdFromPath(path);
          const body = response.userText?.trim();
          if (threadId && body) {
            await api(
              `/v1/messages/threads/${encodeURIComponent(threadId)}/messages`,
              {
                method: "POST",
                body: JSON.stringify({ id: Crypto.randomUUID(), body }),
              },
            );
            await markPushRead(data);
          }
          return;
        }

        if (!validAppPath(path)) return;
        router.push(path as Href);
      } catch (error) {
        console.warn(
          "kampusone.notifications.action",
          error instanceof Error ? error.message : "unknown",
        );
      }
    };

    void import("expo-notifications")
      .then(async (Notifications) => {
        if (!active) return;
        Notifications.setNotificationHandler({
          handleNotification: async () => ({
            shouldShowBanner: AppState.currentState !== 'active',
            shouldShowList: AppState.currentState !== 'active',
            shouldPlaySound: true,
            shouldSetBadge: true,
          }),
        });
        tokenSubscription = Notifications.addPushTokenListener(() => {
          if(active) void ensureRegistered(true);
        });
        receivedSubscription = Notifications.addNotificationReceivedListener(notification => {
          if (active) {
            const content=notification.request.content;
            if(AppState.currentState==='active' && (content.title||content.body))toast(content.body || content.title || '',"info",validAppPath(content.data?.path)?()=>router.push(content.data!.path as Href):undefined,{
              title:content.title||undefined,
              dedupeKey:typeof content.data?.notificationId==='string'?'notice:'+content.data.notificationId:typeof content.data?.messageId==='string'?'message:'+content.data.messageId:notification.request.identifier,
              ...(typeof content.data?.actorUserId==='string'?{actor:{id:content.data.actorUserId,name:typeof content.data.actorName==='string'?content.data.actorName:'KampusOne user',imageUrl:typeof content.data.actorImageUrl==='string'?content.data.actorImageUrl:null}}:{}),
            });
            const data = notification.request.content.data ?? {};
            const thread = threadIdFromPath(data.path);
            liveReads.event(["/v1/notifications/inbox", "/v1/messages/inbox", ...(thread ? ["/v1/messages/threads/" + thread] : [])]);
            void observePush(notification.request.content.data ?? {});
          }
        });
        responseSubscription =
          Notifications.addNotificationResponseReceivedListener(
            openNotification,
          );
        await configureNativeNotifications();
        const initialResponse =
          await Notifications.getLastNotificationResponseAsync();
        if (initialResponse) {
          await openNotification(initialResponse);
          await Notifications.clearLastNotificationResponseAsync();
        }
      })
      .catch((error) => {
        console.warn(
          "kampusone.notifications.listener",
          error instanceof Error ? error.message : "unknown",
        );
      });

    const ensureRegistered = async (force=false) => {
      if (!active || running || AppState.currentState !== "active" || (!force && Date.now() - checkedAt < 60_000)) return;
      if (retry) clearTimeout(retry);
      running = true;
      try {
        const granted = await requestNativeNotificationPermission();
        if (!active || !granted) { checkedAt = Date.now(); return; }

        const availability = pushSetupAvailability();
        if (!availability.available) { checkedAt = Date.now(); return; }
        if(!force&&registeredCheckedAt&&Date.now()-registeredCheckedAt<86400_000){checkedAt=Date.now();return;}

        const registered = await getRegisteredPushDevice(user.id).catch(() => null);
        if (!active) return;
        // Re-register daily so rotated provider tokens and app updates cannot leave a stale device.
        if (force || !registered || !registered.registeredAt || Date.now()-registered.registeredAt>86400_000 || registered.build_version !== String(Constants.expoConfig?.version ?? "unknown")) await registerPushDevice(user.id);
        checkedAt = Date.now();registeredCheckedAt=checkedAt; failures = 0;
      } catch (error) {
        failures++;
        if (active && failures <= 3) retry = setTimeout(() => void ensureRegistered(), Math.min(300_000, 15_000 * 2 ** failures));
        console.warn(
          "kampusone.notifications.bootstrap",
          error instanceof Error ? error.message : "unknown",
        );
      } finally {
        running = false;
      }
    };

    const initial = setTimeout(() => void ensureRegistered(), 2_500);
    const resume = AppState.addEventListener("change", state => {
      if (state === "active" && Date.now() - checkedAt >= 60_000) void ensureRegistered();
      else if (state !== "active" && retry) clearTimeout(retry);
    });

    return () => {
      active = false;
      clearTimeout(initial);
      if (retry) clearTimeout(retry);
      resume.remove();
      responseSubscription?.remove();
      tokenSubscription?.remove();
      receivedSubscription?.remove();
    };
  }, [state, user?cacheScopeForUser(user):null]);

  return null;
}
