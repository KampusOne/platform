import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from "react-native";
import { BlurView } from "expo-blur";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { useThemeStyles, type Theme } from "@/src/lib/appearance";

export const MESSAGE_REACTIONS = ["😂", "❤️", "👍", "😮", "😭", "🔥"] as const;
export type MessageReaction = (typeof MESSAGE_REACTIONS)[number];

type SwipeReplyMessageProps = {
  mine: boolean;
  disabled?: boolean;
  children: ReactNode;
  onReply: () => void;
  onLongPress: (event: GestureResponderEvent) => void;
};

export function SwipeReplyMessage({
  mine,
  disabled = false,
  children,
  onReply,
  onLongPress,
}: SwipeReplyMessageProps) {
  const { theme, styles } = useThemeStyles(createStyles);
  const offset = useRef(new Animated.Value(0)).current;
  const crossed = useRef(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const direction = mine ? -1 : 1;

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (mounted) setReduceMotion(value);
    });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  const reset = () => {
    if (reduceMotion) {
      offset.setValue(0);
      return;
    }
    Animated.spring(offset, {
      toValue: 0,
      speed: 28,
      bounciness: 5,
      useNativeDriver: true,
    }).start();
  };

  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) => {
          if (disabled) return false;
          const horizontal = Math.abs(gesture.dx) > 8 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.35;
          const correctDirection = direction < 0 ? gesture.dx < 0 : gesture.dx > 0;
          return horizontal && correctDirection;
        },
        onPanResponderMove: (_, gesture) => {
          const directed = direction < 0 ? Math.min(0, gesture.dx) : Math.max(0, gesture.dx);
          const clamped = Math.max(-74, Math.min(74, directed));
          offset.setValue(clamped);
          const reached = Math.abs(clamped) >= 46;
          if (reached && !crossed.current) {
            crossed.current = true;
            if (Platform.OS !== "web") void Haptics.selectionAsync();
          } else if (!reached) {
            crossed.current = false;
          }
        },
        onPanResponderRelease: (_, gesture) => {
          const reached = Math.abs(gesture.dx) >= 52;
          const correctDirection = direction < 0 ? gesture.dx < 0 : gesture.dx > 0;
          if (reached && correctDirection && !disabled) {
            if (Platform.OS !== "web") {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }
            onReply();
          }
          crossed.current = false;
          reset();
        },
        onPanResponderTerminate: () => {
          crossed.current = false;
          reset();
        },
      }),
    [direction, disabled, onReply, reduceMotion],
  );

  return (
    <View style={styles.swipeShell}>
      <View
        pointerEvents="none"
        style={[
          styles.replyCue,
          mine ? styles.replyCueMine : styles.replyCueOther,
        ]}
      >
        <Ionicons name="arrow-undo" size={18} color={theme.deepBrand} />
      </View>
      <Animated.View
        {...responder.panHandlers}
        style={{ transform: [{ translateX: offset }] }}
      >
        <Pressable
          delayLongPress={260}
          onLongPress={(event) => {
            if (disabled) return;
            if (Platform.OS !== "web") {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            }
            onLongPress(event);
          }}
        >
          {children}
        </Pressable>
      </Animated.View>
    </View>
  );
}

export type MessageActionTarget = {
  id: string;
  mine: boolean;
  body: string;
  mediaType?: string | null;
  mediaName?: string | null;
  myReaction?: MessageReaction | null;
  pinned?: boolean;
  forwarded?: boolean;
  pageY: number;
};

type MessageActionOverlayProps = {
  target: MessageActionTarget | null;
  peerName: string;
  busy?: boolean;
  onClose: () => void;
  onReply: (target: MessageActionTarget) => void;
  onReaction: (target: MessageActionTarget, reaction: MessageReaction | null) => void;
  onForward: (target: MessageActionTarget) => void;
  onShare: (target: MessageActionTarget) => void;
  onPin: (target: MessageActionTarget) => void;
  onUnsend: (target: MessageActionTarget) => void;
  onReport: (target: MessageActionTarget) => void;
};

function messagePreview(target: MessageActionTarget) {
  const cleaned = target.body.trim();
  if (target.mediaType?.startsWith("image/")) return cleaned && cleaned !== "Picture" ? cleaned : "Picture";
  if (target.mediaType?.startsWith("video/")) return cleaned && cleaned !== "Video" ? cleaned : "Video";
  if (target.mediaType?.startsWith("audio/")) return cleaned && cleaned !== "Voice note" ? cleaned : "Voice note";
  if (target.mediaType) return cleaned && cleaned !== "Document" ? cleaned : target.mediaName || "Document";
  return cleaned || "Message";
}

export function MessageActionOverlay({
  target,
  peerName,
  busy = false,
  onClose,
  onReply,
  onReaction,
  onForward,
  onShare,
  onPin,
  onUnsend,
  onReport,
}: MessageActionOverlayProps) {
  const { theme, styles } = useThemeStyles(createStyles);
  if (!target) return null;

  const run = (action: () => void) => {
    if (busy) return;
    action();
  };

  const menu = [
    { key: "reply", label: "Reply", icon: "arrow-undo-outline" as const, action: () => onReply(target) },
    { key: "forward", label: "Forward", icon: "arrow-redo-outline" as const, action: () => onForward(target) },
    { key: "share", label: "Share", icon: "share-social-outline" as const, action: () => onShare(target) },
    {
      key: "pin",
      label: target.pinned ? "Unpin" : "Pin",
      icon: target.pinned ? "pin-outline" as const : "pin" as const,
      action: () => onPin(target),
    },
    ...(target.mine
      ? [{ key: "unsend", label: "Unsend", icon: "arrow-undo-circle-outline" as const, danger: true, action: () => onUnsend(target) }]
      : [{ key: "report", label: "Report", icon: "flag-outline" as const, danger: true, action: () => onReport(target) }]),
  ];

  return (
    <Modal
      visible
      transparent
      statusBarTranslucent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.actionBackdrop}>
        <BlurView intensity={38} tint="default" style={StyleSheet.absoluteFill} />
        <View style={styles.actionShade} />
        <Pressable accessibilityRole="button" accessibilityLabel="Close message actions" onPress={onClose} style={StyleSheet.absoluteFill} />

        <View
          pointerEvents="box-none"
          style={[
            styles.actionCluster,
            target.mine ? styles.actionClusterMine : styles.actionClusterOther,
            { top: Math.max(78, Math.min(target.pageY - 135, 330)) },
          ]}
        >
          <View style={styles.reactionBar}>
            {MESSAGE_REACTIONS.map((reaction) => {
              const selected = target.myReaction === reaction;
              return (
                <Pressable
                  key={reaction}
                  accessibilityRole="button"
                  accessibilityLabel={selected ? `Remove ${reaction} reaction` : `React ${reaction}`}
                  disabled={busy}
                  onPress={() => {
                    if (Platform.OS !== "web") void Haptics.selectionAsync();
                    run(() => onReaction(target, selected ? null : reaction));
                  }}
                  style={({ pressed }) => [
                    styles.reactionButton,
                    selected && styles.reactionButtonSelected,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.reactionEmoji}>{reaction}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={[styles.focusBubble, target.mine ? styles.focusBubbleMine : styles.focusBubbleOther]}>
            {target.forwarded ? (
              <View style={styles.forwardedLabel}>
                <Ionicons name="arrow-redo-outline" size={13} color={target.mine ? "#FFFFFF" : theme.textMuted} />
                <Text style={[styles.forwardedText, target.mine && styles.forwardedTextMine]}>Forwarded</Text>
              </View>
            ) : null}
            <Text numberOfLines={4} style={[styles.focusText, target.mine && styles.focusTextMine]}>
              {messagePreview(target)}
            </Text>
            <Text style={[styles.focusOwner, target.mine && styles.focusTextMine]}>
              {target.mine ? "You" : peerName}
            </Text>
          </View>

          <View style={styles.actionMenu}>
            {menu.map((item) => (
              <Pressable
                key={item.key}
                accessibilityRole="button"
                disabled={busy}
                onPress={() => run(item.action)}
                style={({ pressed }) => [styles.actionItem, pressed && styles.actionItemPressed]}
              >
                <Ionicons
                  name={item.icon}
                  size={21}
                  color={item.danger ? theme.error : theme.text}
                />
                <Text style={[styles.actionItemText, item.danger && { color: theme.error }]}>
                  {item.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (theme: Theme) => StyleSheet.create({
  swipeShell: { position: "relative" },
  replyCue: {
    position: "absolute",
    top: "50%",
    marginTop: -17,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.surfaceMuted,
  },
  replyCueMine: { right: 2 },
  replyCueOther: { left: 2 },
  actionBackdrop: { flex: 1 },
  actionShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.24)",
  },
  actionCluster: {
    position: "absolute",
    width: 310,
    maxWidth: "88%",
    gap: 9,
  },
  actionClusterMine: { right: 16, alignItems: "flex-end" },
  actionClusterOther: { left: 16, alignItems: "flex-start" },
  reactionBar: {
    minHeight: 56,
    maxWidth: 310,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 9,
    paddingVertical: 7,
    borderRadius: 28,
    backgroundColor: theme.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    shadowColor: "#000000",
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 7 },
    elevation: 8,
  },
  reactionButton: {
    width: 46,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
  },
  reactionButtonSelected: { backgroundColor: theme.surfaceMuted },
  reactionEmoji: { fontSize: 27 },
  focusBubble: {
    maxWidth: 275,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 11,
    gap: 5,
    shadowColor: "#000000",
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 7 },
    elevation: 7,
  },
  focusBubbleMine: {
    backgroundColor: theme.deepBrand,
    borderBottomRightRadius: 6,
  },
  focusBubbleOther: {
    backgroundColor: theme.surface,
    borderBottomLeftRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  focusText: { color: theme.text, fontFamily: theme.font.body, fontSize: 14, lineHeight: 20 },
  focusTextMine: { color: "#FFFFFF" },
  focusOwner: { color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 10 },
  forwardedLabel: { flexDirection: "row", alignItems: "center", gap: 4 },
  forwardedText: { color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 10 },
  forwardedTextMine: { color: "rgba(255,255,255,0.76)" },
  actionMenu: {
    width: 246,
    overflow: "hidden",
    borderRadius: 17,
    backgroundColor: theme.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    shadowColor: "#000000",
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  actionItem: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    paddingHorizontal: 15,
  },
  actionItemPressed: { backgroundColor: theme.surfaceMuted },
  actionItemText: { color: theme.text, fontFamily: theme.font.medium, fontSize: 15 },
  pressed: { opacity: 0.7 },
});
