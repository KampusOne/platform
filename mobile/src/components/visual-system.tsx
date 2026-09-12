import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import * as Haptics from "expo-haptics";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { theme } from "@/src/theme";

type IconName = keyof typeof Ionicons.glyphMap;
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const streakTiers = [
  { days: 1, name: "First spark", outer: "#E9D0C3", middle: "#DFAF99" },
  { days: 7, name: "Warm ember", outer: "#DFB19B", middle: "#CE8768" },
  { days: 14, name: "Clay flame", outer: "#CF8769", middle: "#B96345" },
  { days: 30, name: "Terracotta", outer: "#B65D42", middle: "#91402F" },
  { days: 60, name: "Deep ember", outer: "#8F3C29", middle: "#6F3025" },
] as const;

const streakQuotes = [
  "Show up for the day in front of you.",
  "Small effort, repeated, becomes momentum.",
  "Your future is built in ordinary days.",
  "Keep the promise you made to yourself.",
  "Progress does not need to be loud.",
  "One focused day can change the next.",
  "You do not need a perfect day. Just return tomorrow.",
] as const;

type StreakTier = (typeof streakTiers)[number];

function FlameMark({ size, tier, pulse }: { size: number; tier: StreakTier; pulse?: Animated.Value }) {
  const motion = pulse
    ? {
        transform: [
          { rotate: pulse.interpolate({ inputRange: [0, 1], outputRange: ["-2deg", "2deg"] }) },
          { scaleY: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1.05] }) },
          { scaleX: pulse.interpolate({ inputRange: [0, 1], outputRange: [1.02, 0.97] }) },
        ],
      }
    : undefined;

  return (
    <Animated.View style={[{ height: size, position: "relative", width: size }, motion]}>
      <Ionicons color={tier.outer} name="flame" size={size} style={{ bottom: 0, left: 0, position: "absolute" }} />
      <Ionicons
        color={tier.middle}
        name="flame"
        size={size * 0.66}
        style={{ bottom: size * 0.035, left: size * 0.17, position: "absolute" }}
      />
      <Ionicons
        color="#FFF5EE"
        name="flame"
        size={size * 0.32}
        style={{ bottom: size * 0.07, left: size * 0.34, position: "absolute" }}
      />
    </Animated.View>
  );
}

export function useReducedMotionPreference() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (live) setReduced(value);
    });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    return () => {
      live = false;
      subscription.remove();
    };
  }, []);

  return reduced;
}

export function GlassCard({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.glass, style]}>
      <BlurView
        experimentalBlurMethod={Platform.OS === "android" ? "dimezisBlurView" : "none"}
        intensity={34}
        style={StyleSheet.absoluteFill}
        tint="light"
      />
      <View pointerEvents="none" style={styles.glassTint} />
      <View pointerEvents="none" style={styles.glassGlow} />
      <View pointerEvents="none" style={styles.glassEdge} />
      {children}
    </View>
  );
}

export function PressScale({
  children,
  onPress,
  style,
  accessibilityLabel,
  disabled = false,
}: {
  children: ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  disabled?: boolean;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const reducedMotion = useReducedMotionPreference();

  function animate(value: number) {
    if (reducedMotion) {
      scale.setValue(1);
      return;
    }
    Animated.timing(scale, {
      duration: theme.motion.micro,
      easing: Easing.out(Easing.cubic),
      toValue: value,
      useNativeDriver: true,
    }).start();
  }

  return (
    <AnimatedPressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      onPressIn={() => animate(0.97)}
      onPressOut={() => animate(1)}
      style={[style, { opacity: disabled ? 0.48 : 1, transform: [{ scale }] }]}
    >
      {children}
    </AnimatedPressable>
  );
}

export function StreakCard({ days = 0 }: { days?: number }) {
  const pulse = useRef(new Animated.Value(0)).current;
  const sheetEntry = useRef(new Animated.Value(0)).current;
  const [open, setOpen] = useState(false);
  const reducedMotion = useReducedMotionPreference();
  const tierIndex = streakTiers.reduce((match, tier, index) => (days >= tier.days ? index : match), 0);
  const currentTier = streakTiers[tierIndex] ?? streakTiers[0]!;
  const nextTier = streakTiers[tierIndex + 1];
  const dailyQuote = streakQuotes[(Math.max(days, 1) - 1) % streakQuotes.length] ?? streakQuotes[0]!;

  useEffect(() => {
    if (reducedMotion) {
      pulse.setValue(0.5);
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { duration: 900, easing: Easing.inOut(Easing.sin), toValue: 1, useNativeDriver: true }),
        Animated.timing(pulse, { duration: 900, easing: Easing.inOut(Easing.sin), toValue: 0, useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [pulse, reducedMotion]);

  useEffect(() => {
    if (!open) return;
    sheetEntry.stopAnimation();
    sheetEntry.setValue(reducedMotion ? 1 : 0);
    if (!reducedMotion) {
      const animation = Animated.spring(sheetEntry, {
        damping: 17,
        mass: 0.7,
        stiffness: 180,
        toValue: 1,
        useNativeDriver: true,
      });
      animation.start();
      return () => animation.stop();
    }
  }, [open, reducedMotion, sheetEntry]);

  function openTimeline() {
    void Haptics.selectionAsync();
    setOpen(true);
  }

  function closeTimeline() {
    if (reducedMotion) {
      setOpen(false);
      return;
    }
    Animated.timing(sheetEntry, {
      duration: theme.motion.standard,
      easing: Easing.in(Easing.cubic),
      toValue: 0,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setOpen(false);
    });
  }

  const progress = nextTier ? Math.min(days / nextTier.days, 1) : 1;

  return (
    <>
      <Pressable
        accessibilityHint="Opens your streak timeline"
        accessibilityLabel={`${days} day streak`}
        accessibilityRole="button"
        onPress={openTimeline}
        style={({ pressed }) => [styles.streakPill, pressed && styles.streakPillPressed]}
      >
        <FlameMark pulse={pulse} size={32} tier={currentTier} />
        <Text style={styles.streakPillText}>{days} day streak</Text>
      </Pressable>

      <Modal
        animationType={reducedMotion ? "none" : "fade"}
        onRequestClose={closeTimeline}
        statusBarTranslucent
        transparent
        visible={open}
      >
        <View style={styles.streakModalRoot}>
          <Animated.View
            pointerEvents="none"
            style={[styles.streakBackdrop, { opacity: sheetEntry.interpolate({ inputRange: [0, 1], outputRange: [0, 0.42] }) }]}
          />
          <Pressable
            accessibilityLabel="Close streak timeline"
            accessibilityRole="button"
            onPress={closeTimeline}
            style={StyleSheet.absoluteFill}
          />
          <Animated.View
            accessibilityLabel="Streak timeline"
            accessibilityViewIsModal
            onAccessibilityEscape={closeTimeline}
            style={[
              styles.streakSheet,
              {
                opacity: sheetEntry,
                transform: [{ translateY: sheetEntry.interpolate({ inputRange: [0, 1], outputRange: [64, 0] }) }],
              },
            ]}
          >
            <View style={styles.streakHandle} />
            <ScrollView contentContainerStyle={styles.streakSheetContent} showsVerticalScrollIndicator={false}>
              <View style={styles.streakSheetTop}>
                <View>
                  <Text style={styles.streakSheetEyebrow}>YOUR STREAK</Text>
                  <Text style={styles.streakSheetTitle}>{days} days strong</Text>
                </View>
                <Pressable
                  accessibilityLabel="Close streak timeline"
                  accessibilityRole="button"
                  hitSlop={8}
                  onPress={closeTimeline}
                  style={styles.streakClose}
                >
                  <Ionicons color={theme.text} name="close" size={20} />
                </Pressable>
              </View>

              <View style={styles.streakHero}>
                <View style={styles.streakHeroGlow} />
                <FlameMark pulse={pulse} size={82} tier={currentTier} />
                <View style={styles.streakHeroCopy}>
                  <Text style={styles.streakCurrentLabel}>CURRENT FLAME</Text>
                  <Text style={styles.streakCurrentName}>{currentTier.name}</Text>
                  <Text style={styles.streakCurrentBody}>
                    {nextTier ? `${nextTier.days - days} days until your flame deepens.` : "You have unlocked every flame shade."}
                  </Text>
                </View>
              </View>

              {nextTier ? (
                <View style={styles.streakProgressCard}>
                  <View style={styles.streakProgressTop}>
                    <Text style={styles.streakProgressLabel}>NEXT SHADE · {nextTier.name.toUpperCase()}</Text>
                    <Text style={styles.streakProgressCount}>{days}/{nextTier.days}</Text>
                  </View>
                  <View style={styles.streakProgressTrack}><View style={[styles.streakProgressFill, { width: `${progress * 100}%` }]} /></View>
                </View>
              ) : null}

              <Text style={styles.streakTimelineTitle}>Flame timeline</Text>
              <View style={styles.streakTimeline}>
                <View pointerEvents="none" style={styles.streakTimelineRail} />
                {streakTiers.map((tier, index) => {
                  const earned = days >= tier.days;
                  const active = index === tierIndex;
                  const remaining = tier.days - days;
                  return (
                    <View key={tier.days} style={[styles.streakTierRow, !earned && styles.streakTierLocked]}>
                      <View style={[styles.streakTierIcon, active && styles.streakTierIconActive]}>
                        <FlameMark size={28} tier={tier} />
                      </View>
                      <View style={styles.streakTierCopy}>
                        <Text style={styles.streakTierName}>{tier.name}</Text>
                        <Text style={styles.streakTierMeta}>{tier.days} day milestone</Text>
                      </View>
                      {active ? (
                        <View style={styles.streakCurrentChip}><Text style={styles.streakCurrentChipText}>Current</Text></View>
                      ) : earned ? (
                        <Ionicons color={theme.statusPositive} name="checkmark-done" size={18} />
                      ) : (
                        <View style={styles.streakLockedMeta}>
                          <Ionicons color={theme.textSubtle} name="lock-closed" size={13} />
                          <Text style={styles.streakLockedText}>{remaining}d</Text>
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>

              <View style={styles.streakQuote}>
                <Ionicons color={theme.brandPressed} name="sparkles" size={18} />
                <View style={styles.streakQuoteCopy}>
                  <Text style={styles.streakQuoteLabel}>TODAY'S REMINDER</Text>
                  <Text style={styles.streakQuoteText}>“{dailyQuote}”</Text>
                </View>
              </View>
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>
    </>
  );
}

export function CampusScape({ compact = false }: { compact?: boolean }) {
  return (
    <View pointerEvents="none" style={[styles.scape, compact && styles.scapeCompact]}>
      <View style={styles.sunLarge} />
      <View style={styles.sunSmall} />
      <View style={styles.hillBack} />
      <View style={styles.hillFront} />
      <View style={styles.treeOne}><View style={styles.treeCrown} /><View style={styles.treeTrunk} /></View>
      <View style={styles.treeTwo}><View style={styles.treeCrownSmall} /><View style={styles.treeTrunk} /></View>
      <View style={styles.buildingWing}>
        <View style={styles.windowRow}><View style={styles.window} /><View style={styles.window} /><View style={styles.window} /></View>
      </View>
      <View style={styles.buildingMain}>
        <View style={styles.roof} />
        <View style={styles.door} />
        <View style={styles.windowTall} />
      </View>
      <View style={styles.road} />
    </View>
  );
}

export function HeaderBadge({ icon, text, verified = false }: { icon?: IconName; text: string; verified?: boolean }) {
  const hasMark = verified || Boolean(icon);

  return (
    <View accessibilityLabel={text} accessible style={styles.headerBadge}>
      <View style={styles.headerBadgeContent}>
        {verified ? <VerifiedBadge label={`${text} is verified`} size={15} /> : icon ? <Ionicons name={icon} size={15} color={theme.deepBrand} /> : null}
        <Text style={styles.headerBadgeText}>{text}</Text>
      </View>
      <View pointerEvents="none" style={[styles.headerBadgeFlourish, hasMark && styles.headerBadgeFlourishIndented]}>
        <View style={styles.headerBadgeLine} />
        <View style={styles.headerBadgeFlick} />
      </View>
    </View>
  );
}

/**
 * KampusOne's verification seal: a soft twelve-point rosette based on the
 * hand-drawn brand sketch. Keep this exclusive to verified identities and
 * sources; ordinary success states use the status palette instead.
 */
export function VerifiedBadge({ size = 16, label = "Verified" }: { size?: number; label?: string }) {
  const entry = useRef(new Animated.Value(0)).current;
  const reducedMotion = useReducedMotionPreference();
  const petalSize = size * 0.73;
  const petalInset = (size - petalSize) / 2;

  useEffect(() => {
    if (reducedMotion) {
      entry.setValue(1);
      return;
    }
    Animated.spring(entry, {
      damping: 11,
      mass: 0.45,
      stiffness: 230,
      toValue: 1,
      useNativeDriver: true,
    }).start();
  }, [entry, reducedMotion]);

  return (
    <Animated.View
      accessibilityLabel={label}
      accessibilityRole="image"
      style={{
        alignItems: "center",
        height: size,
        justifyContent: "center",
        opacity: entry,
        shadowColor: theme.verification,
        shadowOffset: { height: 2, width: 0 },
        shadowOpacity: 0.16,
        shadowRadius: 3,
        transform: [{ scale: entry }],
        width: size,
      }}
    >
      {[0, 30, 60].map((rotation) => (
        <View
          key={rotation}
          pointerEvents="none"
          style={{
            backgroundColor: theme.verification,
            borderRadius: petalSize * 0.27,
            height: petalSize,
            left: petalInset,
            position: "absolute",
            top: petalInset,
            transform: [{ rotate: `${rotation}deg` }],
            width: petalSize,
          }}
        />
      ))}
      <Ionicons color={theme.verificationMark} name="checkmark" size={size * 0.67} />
    </Animated.View>
  );
}

export function FavoriteButton({ active, onPress, label = "Save item" }: { active: boolean; onPress: () => void; label?: string }) {
  const scale = useRef(new Animated.Value(1)).current;
  const reducedMotion = useReducedMotionPreference();

  useEffect(() => {
    if (!active) return;
    if (reducedMotion) {
      scale.setValue(1);
      return;
    }
    Animated.sequence([
      Animated.timing(scale, { duration: 90, toValue: 0.78, useNativeDriver: true }),
      Animated.spring(scale, { damping: 7, mass: 0.55, stiffness: 260, toValue: 1.14, useNativeDriver: true }),
      Animated.spring(scale, { damping: 9, mass: 0.55, stiffness: 240, toValue: 1, useNativeDriver: true }),
    ]).start();
  }, [active, reducedMotion, scale]);

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      hitSlop={8}
      onPress={() => {
        void Haptics.selectionAsync();
        onPress();
      }}
      style={({ pressed }) => [styles.favorite, pressed && styles.favoritePressed]}
    >
      <Animated.View style={{ transform: [{ scale }] }}>
        <Ionicons name={active ? "heart" : "heart-outline"} size={20} color={active ? theme.brand : theme.brandPressed} />
      </Animated.View>
    </Pressable>
  );
}

export function IllustrationTile({ type }: { type: "library" | "notice" | "scholarship" | "event" | "sports" }) {
  if (type === "library") {
    return (
      <View style={[styles.artTile, styles.librarySky]}>
        <View style={styles.librarySun} />
        <View style={styles.libraryTree} />
        <View style={styles.libraryBuilding}>
          <View style={styles.libraryGlass} /><View style={styles.libraryGlass} /><View style={styles.libraryGlass} />
        </View>
        <View style={styles.libraryGround} />
      </View>
    );
  }

  const details = {
    notice: { icon: "megaphone" as const, color: "#A8462E", background: "#F8DDD2" },
    scholarship: { icon: "school" as const, color: "#8F3C29", background: "#F1DFC8" },
    event: { icon: "mic" as const, color: "#346E8A", background: "#DDEAF0" },
    sports: { icon: "football" as const, color: "#2D7D59", background: "#E2EEE7" },
  }[type];

  return (
    <View style={[styles.artTile, { backgroundColor: details.background }]}>
      <View style={styles.artOrbOne} /><View style={styles.artOrbTwo} />
      <View style={styles.artIconDisc}><Ionicons name={details.icon} size={42} color={details.color} /></View>
    </View>
  );
}

export function ProductArtwork({ type }: { type: "books" | "burger" | "earbuds" | "hoodie" | "print" | "notebook" }) {
  if (type === "books") {
    return (
      <View style={[styles.productArt, styles.productSand]}>
        <View style={[styles.book, styles.bookOne]}><Text style={styles.bookText}>DATA</Text></View>
        <View style={[styles.book, styles.bookTwo]}><Text style={styles.bookText}>ALGORITHMS</Text></View>
        <View style={[styles.book, styles.bookThree]}><Text style={styles.bookText}>CLEAN CODE</Text></View>
      </View>
    );
  }
  if (type === "burger") {
    return (
      <View style={[styles.productArt, styles.productPeach]}>
        <View style={[styles.burgerLayer, styles.bunTop]} />
        <View style={[styles.burgerLayer, styles.lettuce]} />
        <View style={[styles.burgerLayer, styles.cheese]} />
        <View style={[styles.burgerLayer, styles.patty]} />
        <View style={[styles.burgerLayer, styles.bunBottom]} />
      </View>
    );
  }
  if (type === "earbuds") {
    return (
      <View style={[styles.productArt, styles.productStone]}>
        <View style={styles.earbudCase}><View style={styles.caseLine} /></View>
        <View style={[styles.earbud, styles.earbudLeft]}><View style={styles.earbudStem} /></View>
        <View style={[styles.earbud, styles.earbudRight]}><View style={styles.earbudStem} /></View>
      </View>
    );
  }
  if (type === "hoodie") {
    return (
      <View style={[styles.productArt, styles.productDark]}>
        <View style={styles.hoodieHood} />
        <View style={styles.hoodieBody} />
        <View style={[styles.hoodieArm, styles.hoodieArmLeft]} /><View style={[styles.hoodieArm, styles.hoodieArmRight]} />
      </View>
    );
  }
  if (type === "print") {
    return (
      <View style={[styles.productArt, styles.productPaper]}>
        <View style={[styles.paper, styles.paperBack]} /><View style={[styles.paper, styles.paperMid]} />
        <View style={styles.paper}><Text style={styles.paperText}>PRINT{`\n`}YOUR{`\n`}IDEAS</Text></View>
      </View>
    );
  }
  return (
    <View style={[styles.productArt, styles.productSand]}>
      <View style={styles.notebookSpine}>{[0, 1, 2, 3, 4, 5].map((i) => <View key={i} style={styles.notebookRing} />)}</View>
      <View style={styles.notebook}><Text style={styles.notebookText}>Better notes.{`\n`}Brighter futures.</Text></View>
    </View>
  );
}

export function MotivationBanner({ title, body }: { title: string; body: string }) {
  return (
    <GlassCard style={styles.motivation}>
      <View style={styles.motivationIcon}><Ionicons name="school" size={27} color={theme.brandPressed} /></View>
      <View style={styles.motivationCopy}>
        <Text style={styles.motivationTitle}>{title}</Text>
        <Text style={styles.motivationBody}>{body}</Text>
      </View>
      <Ionicons name="chevron-forward" size={19} color={theme.brandPressed} />
      <View pointerEvents="none" style={styles.motivationHillOne} />
      <View pointerEvents="none" style={styles.motivationHillTwo} />
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  glass: {
    backgroundColor: "rgba(255,253,252,0.58)",
    borderColor: "rgba(255,255,255,0.96)",
    borderRadius: 22,
    borderWidth: 1,
    overflow: "hidden",
    position: "relative",
    ...theme.glassShadow,
  },
  glassTint: { backgroundColor: "rgba(255,253,252,0.49)", bottom: 0, left: 0, position: "absolute", right: 0, top: 0 },
  glassGlow: {
    backgroundColor: "rgba(255,255,255,0.54)",
    borderRadius: 100,
    height: 56,
    left: -12,
    position: "absolute",
    top: -31,
    transform: [{ rotate: "-8deg" }],
    width: "72%",
  },
  glassEdge: { backgroundColor: "rgba(255,255,255,0.78)", height: 1, left: 16, position: "absolute", right: 16, top: 1 },
  streakPill: { alignItems: "center", alignSelf: "flex-start", flexDirection: "row", gap: 6, height: 48, paddingRight: 4 },
  streakPillPressed: { opacity: 0.68, transform: [{ scale: 0.96 }] },
  streakPillText: { color: theme.text, fontFamily: theme.font.bold, fontSize: 13.5 },
  streakModalRoot: { flex: 1, justifyContent: "flex-end" },
  streakBackdrop: { backgroundColor: "#231D1A", bottom: 0, left: 0, position: "absolute", right: 0, top: 0 },
  streakSheet: { backgroundColor: theme.canvas, borderColor: "rgba(255,255,255,0.94)", borderTopLeftRadius: 30, borderTopRightRadius: 30, borderWidth: 1, maxHeight: "88%", overflow: "hidden", ...theme.glassShadow },
  streakHandle: { alignSelf: "center", backgroundColor: "#D8CCC4", borderRadius: 2, height: 4, marginTop: 9, width: 42 },
  streakSheetContent: { paddingBottom: 34, paddingHorizontal: 21, paddingTop: 15 },
  streakSheetTop: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  streakSheetEyebrow: { color: theme.brandPressed, fontFamily: theme.font.bold, fontSize: 9, letterSpacing: 0.9 },
  streakSheetTitle: { color: theme.text, fontFamily: theme.font.displayStrong, fontSize: 27, letterSpacing: -0.55, marginTop: 3 },
  streakClose: { alignItems: "center", backgroundColor: theme.surfaceMuted, borderRadius: 17, height: 36, justifyContent: "center", width: 36 },
  streakHero: { alignItems: "center", backgroundColor: "rgba(255,253,252,0.88)", borderColor: "rgba(255,255,255,0.96)", borderRadius: 22, borderWidth: 1, flexDirection: "row", marginTop: 18, minHeight: 126, overflow: "hidden", padding: 15, position: "relative", ...theme.shadow },
  streakHeroGlow: { backgroundColor: "rgba(223,177,155,0.20)", borderRadius: 70, height: 138, left: -36, position: "absolute", top: -14, width: 138 },
  streakHeroCopy: { flex: 1, marginLeft: 14 },
  streakCurrentLabel: { color: theme.brandPressed, fontFamily: theme.font.bold, fontSize: 8.5, letterSpacing: 0.75 },
  streakCurrentName: { color: theme.text, fontFamily: theme.font.display, fontSize: 20, marginTop: 4 },
  streakCurrentBody: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 11.5, lineHeight: 17, marginTop: 5 },
  streakProgressCard: { backgroundColor: "rgba(241,223,200,0.48)", borderRadius: 15, marginTop: 12, padding: 12 },
  streakProgressTop: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  streakProgressLabel: { color: theme.brandPressed, fontFamily: theme.font.bold, fontSize: 8.5, letterSpacing: 0.45 },
  streakProgressCount: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 10.5 },
  streakProgressTrack: { backgroundColor: "rgba(111,48,37,0.10)", borderRadius: 5, height: 8, marginTop: 9, overflow: "hidden" },
  streakProgressFill: { backgroundColor: theme.clay, borderRadius: 5, height: 8 },
  streakTimelineTitle: { color: theme.text, fontFamily: theme.font.display, fontSize: 18, marginTop: 21 },
  streakTimeline: { marginTop: 7, position: "relative" },
  streakTimelineRail: { backgroundColor: "rgba(111,48,37,0.11)", bottom: 28, left: 24, position: "absolute", top: 28, width: 2 },
  streakTierRow: { alignItems: "center", flexDirection: "row", minHeight: 61, paddingHorizontal: 5 },
  streakTierLocked: { opacity: 0.52 },
  streakTierIcon: { alignItems: "center", backgroundColor: theme.surfaceRaised, borderColor: "rgba(111,48,37,0.10)", borderRadius: 19, borderWidth: 1, height: 40, justifyContent: "center", width: 40, zIndex: 2 },
  streakTierIconActive: { borderColor: "rgba(111,48,37,0.22)", borderWidth: 2, ...theme.shadow },
  streakTierCopy: { flex: 1, marginLeft: 11 },
  streakTierName: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 12.5 },
  streakTierMeta: { color: theme.textSubtle, fontFamily: theme.font.body, fontSize: 10, marginTop: 2 },
  streakCurrentChip: { backgroundColor: "rgba(223,177,155,0.32)", borderRadius: 9, paddingHorizontal: 8, paddingVertical: 5 },
  streakCurrentChipText: { color: theme.brandPressed, fontFamily: theme.font.bold, fontSize: 8.5 },
  streakLockedMeta: { alignItems: "center", flexDirection: "row", gap: 4 },
  streakLockedText: { color: theme.textSubtle, fontFamily: theme.font.semibold, fontSize: 9.5 },
  streakQuote: { alignItems: "flex-start", backgroundColor: "rgba(233,177,142,0.20)", borderColor: "rgba(111,48,37,0.10)", borderRadius: 17, borderWidth: 1, flexDirection: "row", gap: 10, marginTop: 15, padding: 13 },
  streakQuoteCopy: { flex: 1 },
  streakQuoteLabel: { color: theme.brandPressed, fontFamily: theme.font.bold, fontSize: 8, letterSpacing: 0.65 },
  streakQuoteText: { color: theme.text, fontFamily: theme.font.calligraphy, fontSize: 13, lineHeight: 18, marginTop: 4 },
  scape: { bottom: 0, height: 116, left: 0, overflow: "hidden", position: "absolute", right: 0 },
  scapeCompact: { height: 88, opacity: 0.94 },
  sunLarge: { backgroundColor: "rgba(233,177,142,0.52)", borderRadius: 42, height: 84, position: "absolute", right: 65, top: 4, width: 84 },
  sunSmall: { backgroundColor: "rgba(241,223,200,0.82)", borderRadius: 28, height: 56, position: "absolute", right: 119, top: 28, width: 56 },
  hillBack: { backgroundColor: "#EBC5AD", borderRadius: 70, bottom: -48, height: 99, position: "absolute", right: -25, transform: [{ rotate: "-8deg" }], width: 248 },
  hillFront: { backgroundColor: "#D9855F", borderRadius: 60, bottom: -51, height: 87, position: "absolute", right: 75, transform: [{ rotate: "8deg" }], width: 207 },
  treeOne: { bottom: 24, position: "absolute", right: 42 },
  treeTwo: { bottom: 23, position: "absolute", right: 177 },
  treeCrown: { backgroundColor: "#A9583D", borderRadius: 26, height: 49, width: 49 },
  treeCrownSmall: { backgroundColor: "#B96548", borderRadius: 19, height: 37, width: 37 },
  treeTrunk: { alignSelf: "center", backgroundColor: "#8F4934", height: 22, marginTop: -6, width: 6 },
  buildingWing: { backgroundColor: "#F0BFA2", bottom: 20, height: 44, position: "absolute", right: 66, width: 100 },
  buildingMain: { backgroundColor: "#E7A17C", bottom: 20, height: 69, position: "absolute", right: 122, width: 43 },
  roof: { backgroundColor: "#A8462E", height: 7, left: -5, position: "absolute", top: -6, width: 53 },
  door: { backgroundColor: "#8F3C29", bottom: 0, height: 27, left: 15, width: 14 },
  windowTall: { backgroundColor: "#F8E6D9", height: 17, left: 14, position: "absolute", top: 13, width: 16 },
  windowRow: { flexDirection: "row", gap: 9, paddingLeft: 12, paddingTop: 12 },
  window: { backgroundColor: "#F8E6D9", height: 12, width: 13 },
  road: { backgroundColor: "rgba(251,247,242,0.72)", borderRadius: 70, bottom: -62, height: 96, position: "absolute", right: 76, transform: [{ rotate: "-17deg" }], width: 31 },
  headerBadge: { alignSelf: "flex-start", marginTop: 11, paddingBottom: 3 },
  headerBadgeContent: { alignItems: "center", flexDirection: "row", gap: 7, minHeight: 21 },
  headerBadgeText: { color: theme.brandPressed, fontFamily: theme.font.calligraphy, fontSize: 14.5, letterSpacing: 0.06, lineHeight: 20 },
  headerBadgeFlourish: { alignItems: "flex-end", flexDirection: "row", height: 4, marginTop: -1, width: "82%" },
  headerBadgeFlourishIndented: { marginLeft: 22 },
  headerBadgeLine: { backgroundColor: "rgba(143,60,41,0.48)", borderRadius: 2, height: 1.5, width: "89%" },
  headerBadgeFlick: { backgroundColor: "rgba(143,60,41,0.48)", borderRadius: 2, height: 1.5, marginBottom: 0.5, marginLeft: -1, transform: [{ rotate: "-9deg" }], width: 13 },
  favorite: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.93)", borderColor: "rgba(255,255,255,0.96)", borderRadius: 16, borderWidth: 1, height: 34, justifyContent: "center", width: 34, ...theme.shadow },
  favoritePressed: { opacity: 0.72 },
  artTile: { alignItems: "center", borderRadius: 16, height: 112, justifyContent: "center", overflow: "hidden", position: "relative", width: 112 },
  artOrbOne: { backgroundColor: "rgba(255,255,255,0.32)", borderRadius: 44, height: 88, left: -29, position: "absolute", top: -37, width: 88 },
  artOrbTwo: { backgroundColor: "rgba(255,255,255,0.24)", borderRadius: 37, bottom: -25, height: 74, position: "absolute", right: -20, width: 74 },
  artIconDisc: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.48)", borderColor: "rgba(255,255,255,0.66)", borderRadius: 30, borderWidth: 1, height: 66, justifyContent: "center", width: 66 },
  librarySky: { backgroundColor: "#DCE8E9", justifyContent: "flex-end" },
  librarySun: { backgroundColor: "#F2C49E", borderRadius: 22, height: 44, position: "absolute", right: 9, top: 9, width: 44 },
  libraryTree: { backgroundColor: "#8C6A53", borderRadius: 24, bottom: 15, height: 49, left: -9, position: "absolute", width: 49 },
  libraryBuilding: { backgroundColor: "#C88965", bottom: 13, flexDirection: "row", gap: 4, height: 65, paddingHorizontal: 7, paddingTop: 8, position: "absolute", right: 6, width: 83 },
  libraryGlass: { backgroundColor: "#54727A", flex: 1, opacity: 0.86 },
  libraryGround: { backgroundColor: "#73876D", bottom: 0, height: 16, left: 0, position: "absolute", right: 0 },
  productArt: { alignItems: "center", borderRadius: 17, height: 128, justifyContent: "center", overflow: "hidden", position: "relative", width: "100%" },
  productSand: { backgroundColor: "#EEE1D2" },
  productPeach: { backgroundColor: "#F1D2C1" },
  productStone: { backgroundColor: "#E7E2DD" },
  productDark: { backgroundColor: "#D8B5AA" },
  productPaper: { backgroundColor: "#ECE7E1" },
  book: { borderRadius: 3, height: 24, justifyContent: "center", paddingLeft: 7, width: 112 },
  bookOne: { backgroundColor: "#31373A", transform: [{ rotate: "-3deg" }] },
  bookTwo: { backgroundColor: "#4E6C78", marginTop: -1, transform: [{ rotate: "1deg" }] },
  bookThree: { backgroundColor: "#A85A39", marginTop: -1, transform: [{ rotate: "-1deg" }] },
  bookText: { color: "#FFFFFF", fontFamily: theme.font.bold, fontSize: 7, letterSpacing: 0.6 },
  burgerLayer: { position: "absolute", width: 105 },
  bunTop: { backgroundColor: "#D98B3E", borderTopLeftRadius: 54, borderTopRightRadius: 54, height: 32, top: 29 },
  lettuce: { backgroundColor: "#6A8B43", borderRadius: 5, height: 11, top: 60, transform: [{ rotate: "2deg" }], width: 112 },
  cheese: { backgroundColor: "#F2B53C", height: 10, top: 70, transform: [{ rotate: "-3deg" }] },
  patty: { backgroundColor: "#674131", borderRadius: 7, height: 18, top: 78 },
  bunBottom: { backgroundColor: "#CC7835", borderBottomLeftRadius: 20, borderBottomRightRadius: 20, height: 18, top: 95 },
  earbudCase: { backgroundColor: "#F8F8F7", borderColor: "#D6D3D0", borderRadius: 28, borderWidth: 1, bottom: 20, height: 69, position: "absolute", width: 99, ...theme.shadow },
  caseLine: { backgroundColor: "#D6D3D0", height: 1, left: 3, position: "absolute", right: 3, top: 22 },
  earbud: { backgroundColor: "#FFFFFF", borderColor: "#D7D5D2", borderRadius: 12, borderWidth: 1, height: 27, position: "absolute", top: 31, width: 22 },
  earbudLeft: { left: 45, transform: [{ rotate: "-12deg" }] },
  earbudRight: { right: 45, transform: [{ rotate: "12deg" }] },
  earbudStem: { backgroundColor: "#FFFFFF", borderColor: "#D7D5D2", borderRadius: 6, borderWidth: 1, height: 33, left: 8, position: "absolute", top: 17, width: 8 },
  hoodieHood: { backgroundColor: "#713228", borderRadius: 35, height: 55, position: "absolute", top: 14, width: 69 },
  hoodieBody: { alignItems: "center", backgroundColor: "#843A2E", borderRadius: 9, bottom: -10, height: 88, justifyContent: "center", position: "absolute", width: 91 },
  hoodieArm: { backgroundColor: "#773328", borderRadius: 9, bottom: -4, height: 75, position: "absolute", width: 34 },
  hoodieArmLeft: { left: 15, transform: [{ rotate: "18deg" }] },
  hoodieArmRight: { right: 15, transform: [{ rotate: "-18deg" }] },
  hoodieText: { color: "#F4DFD3", fontFamily: theme.font.displayStrong, fontSize: 22, letterSpacing: 2 },
  paper: { backgroundColor: "#FFFFFF", borderColor: "#D9D3CD", borderRadius: 2, borderWidth: 1, height: 85, padding: 12, position: "absolute", transform: [{ rotate: "-6deg" }], width: 73 },
  paperBack: { left: 38, top: 28, transform: [{ rotate: "-12deg" }] },
  paperMid: { left: 52, top: 23, transform: [{ rotate: "-8deg" }] },
  paperText: { color: theme.text, fontFamily: theme.font.displayStrong, fontSize: 11, lineHeight: 14 },
  notebook: { backgroundColor: "#9B6549", borderRadius: 5, height: 98, justifyContent: "center", paddingLeft: 26, width: 104 },
  notebookSpine: { gap: 7, left: 31, position: "absolute", zIndex: 2 },
  notebookRing: { backgroundColor: "#4C3A31", borderRadius: 4, height: 3, width: 17 },
  notebookText: { color: "#FFF8F2", fontFamily: theme.font.semibold, fontSize: 10.5, lineHeight: 15 },
  motivation: { alignItems: "center", flexDirection: "row", marginTop: 24, minHeight: 102, paddingHorizontal: 16 },
  motivationIcon: { alignItems: "center", backgroundColor: "rgba(233,177,142,0.34)", borderRadius: 24, height: 50, justifyContent: "center", width: 50, zIndex: 2 },
  motivationCopy: { flex: 1, marginHorizontal: 12, zIndex: 2 },
  motivationTitle: { color: theme.text, fontFamily: theme.font.bold, fontSize: 13.5 },
  motivationBody: { color: theme.brandPressed, fontFamily: theme.font.calligraphy, fontSize: 13, lineHeight: 18, marginTop: 3 },
  motivationHillOne: { backgroundColor: "rgba(233,177,142,0.34)", borderRadius: 52, bottom: -42, height: 80, position: "absolute", right: 15, transform: [{ rotate: "-8deg" }], width: 139 },
  motivationHillTwo: { backgroundColor: "rgba(241,223,200,0.72)", borderRadius: 44, bottom: -46, height: 78, position: "absolute", right: 84, transform: [{ rotate: "12deg" }], width: 128 },
});
