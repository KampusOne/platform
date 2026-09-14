import { useThemeStyles, type Theme } from "@/src/lib/appearance";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "@/src/lib/haptics";
import { type Href, router } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import {
  InlineFeedback,
  ProductScreen,
  SearchField,
} from "@/src/components/product-ui";
import { SectionHeading } from "@/src/components/section-heading";
import { AgentShortcuts } from "@/src/components/agent-shortcuts";
import { recordRecentTool, useRecentToolIds } from "@/src/lib/recent-tools";
import { theme } from "@/src/theme";

type IconName = keyof typeof Ionicons.glyphMap;
type Tool = {
  id: string;
  title: string;
  description: string;
  icon: IconName;
  href?: Href;
  unavailableMessage?: string;
  tone?: "peach" | "sand" | "sage";
};

const tools = {
  gpa: {
    id: "gpa",
    title: "CGPA Calculator",
    description: "Your courses, units and grades.",
    icon: "document-text-outline",
    href: "/course-planner",
    tone: "peach",
  },
  upload: {
    id: "upload",
    title: "Timetable Upload",
    description: "Import and review your class schedule.",
    icon: "cloud-upload-outline",
    href: "/timetable-import",
    tone: "sage",
  },
  timetable: {
    id: "timetable",
    title: "Timetable Manager",
    description: "View, add and manage your timetable.",
    icon: "calendar-outline",
    href: "/timetable",
    tone: "sand",
  },
  alarm: {
    id: "alarm",
    title: "Alarms",
    description: "Classes, study time and everyday reminders.",
    icon: "alarm-outline",
    href: "/alarms",
    tone: "peach",
  },
  market: {
    id: "market",
    title: "Marketplace",
    description: "Buy, sell or discover useful items.",
    icon: "bag-handle-outline",
    href: "/store",
    tone: "sage",
  },
  study: {
    id: "study",
    title: "AI Study Assistant",
    description: "Work through a difficult topic.",
    icon: "sparkles-outline",
    href: "/ai",
    tone: "peach",
  },
  summarize: {
    id: "summarize",
    title: "Summaries & Quizzes",
    description: "Bring your notes. Find the key ideas.",
    icon: "reader-outline",
    href: "/ai",
    tone: "sand",
  },
} satisfies Record<string, Tool>;

const essentialIds = [
  "gpa",
  "upload",
  "timetable",
  "alarm",
  "market",
  "study",
] as const;

const moreTools: Tool[] = [
  {
    id: "tutors",
    title: "Tutors",
    description: "",
    icon: "people-outline",
    href: "/tutorials",
  },
  {
    id: "notes",
    title: "Notes & PDFs",
    description: "",
    icon: "document-text-outline",
    href: "/tutorials",
  },
  {
    id: "community",
    title: "Class community",
    description: "",
    icon: "people-circle-outline",
    href: "/communities",
  },
  {
    id: "questions",
    title: "Past Questions",
    description: "",
    icon: "documents-outline",
    href: "/tutorials",
  },
  {
    id: "guide",
    title: "Student Guide",
    description: "",
    icon: "book-outline",
    href: "/guidelines",
  },
  {
    id: "campus",
    title: "Campus Guide",
    description: "",
    icon: "map-outline",
    href: "/map",
  },
  {
    id: "routine",
    title: "My streak",
    description: "",
    icon: "flame-outline",
    href: "/streak",
  },
  {
    id: "editor",
    title: "Timetable Editor",
    description: "",
    icon: "calendar-number-outline",
    href: "/timetable",
  },
];

export default function ExploreScreen() {
  const { theme, styles } = useThemeStyles(createStyles);

  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const recentToolIds = useRecentToolIds();
  const needle = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!needle) return null;
    return [...Object.values(tools), ...moreTools].filter((tool) =>
      `${tool.title} ${tool.description}`.toLowerCase().includes(needle),
    );
  }, [needle]);
  const recentTools = recentToolIds
    .map((id) =>
      [...Object.values(tools), ...moreTools].find((tool) => tool.id === id),
    )
    .filter((tool): tool is Tool => Boolean(tool));

  function openTool(tool: Tool) {
    void Haptics.selectionAsync();
    if (tool.href) {
      recordRecentTool(tool.id);
      router.push(tool.href);
      return;
    }
    setNotice(tool.unavailableMessage ?? `${tool.title} is not available yet.`);
  }

  return (
    <ProductScreen style={styles.screen}>
      <SearchField
        onChangeText={setQuery}
        onFilterPress={() =>
          setNotice("Tools are already grouped by what students need most.")
        }
        placeholder="Search tools, resources or services"
        value={query}
      />
      {notice ? (
        <View style={styles.notice}>
          <InlineFeedback message={notice} />
        </View>
      ) : null}

      {matches ? (
        <View style={styles.results}>
          <SectionHeading
            meta={`${matches.length} found`}
            title="Search results"
          />
          {matches.length ? (
            matches.map((tool) => (
              <SearchResult
                key={tool.id}
                onPress={() => openTool(tool)}
                tool={tool}
              />
            ))
          ) : (
            <View style={styles.zero}>
              <Ionicons
                color={theme.deepBrand}
                name="search-outline"
                size={30}
              />
              <Text style={styles.zeroTitle}>No matching tool</Text>
            </View>
          )}
        </View>
      ) : (
        <>
          <AgentShortcuts />
          <View style={styles.section}>
            <SectionHeading
              {...(recentTools.length
                ? { meta: `${recentTools.length} this session` }
                : {})}
              title="Recently used"
            />
            {recentTools.length ? (
              <ScrollView
                contentContainerStyle={styles.recentRail}
                horizontal
                showsHorizontalScrollIndicator={false}
              >
                {recentTools.map((tool) => (
                  <RecentCard
                    key={tool.id}
                    onPress={() => openTool(tool)}
                    tool={tool}
                  />
                ))}
              </ScrollView>
            ) : (
              <Pressable
                accessibilityRole="button"
                onPress={() => openTool(tools.gpa)}
                style={({ pressed }) => [
                  styles.recentEmpty,
                  pressed && styles.pressed,
                ]}
              >
                <View style={styles.recentEmptyIcon}>
                  <Ionicons
                    color={theme.deepBrand}
                    name="time-outline"
                    size={22}
                  />
                </View>
                <View style={styles.recentEmptyCopy}>
                  <Text style={styles.recentEmptyTitle}>
                    Your recent tools will appear here
                  </Text>
                </View>
                <Ionicons
                  color={theme.deepBrand}
                  name="arrow-forward"
                  size={18}
                />
              </Pressable>
            )}
          </View>

          <View style={styles.section}>
            <SectionHeading title="Student Essentials" />
            <View style={styles.essentialGrid}>
              {essentialIds.map((id) => (
                <FeatureCard
                  key={id}
                  onPress={() => openTool(tools[id])}
                  tool={tools[id]}
                />
              ))}
            </View>
          </View>

          <View style={styles.section}>
            <SectionHeading title="AI Tools" />
            <View style={styles.aiRow}>
              {([tools.study, tools.summarize] as const).map((tool) => (
                <AiCard
                  key={tool.id}
                  onPress={() => openTool(tool)}
                  tool={tool}
                />
              ))}
            </View>
          </View>

          <View style={styles.section}>
            <SectionHeading title="More to explore" />
            <View style={styles.moreGrid}>
              {moreTools.map((tool) => (
                <CompactTool
                  key={tool.id}
                  onPress={() => openTool(tool)}
                  tool={tool}
                />
              ))}
            </View>
          </View>
        </>
      )}
    </ProductScreen>
  );
}

function ToolIcon({
  icon,
  tone = "peach",
  size = 23,
}: {
  icon: IconName;
  tone?: Tool["tone"];
  size?: number;
}) {
  const { theme, styles } = useThemeStyles(createStyles);

  return (
    <View
      style={[
        styles.toolIcon,
        tone === "sage" && styles.toolIconSage,
        tone === "sand" && styles.toolIconSand,
      ]}
    >
      <Ionicons color={theme.deepBrand} name={icon} size={size} />
    </View>
  );
}

function RecentCard({ tool, onPress }: { tool: Tool; onPress: () => void }) {
  const { theme, styles } = useThemeStyles(createStyles);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.recentCard, pressed && styles.pressed]}
    >
      <ToolIcon icon={tool.icon} tone={tool.tone} />
      <Ionicons
        color={theme.deepBrand}
        name="chevron-forward"
        size={17}
        style={styles.recentChevron}
      />
      <Text style={styles.recentTitle}>{tool.title}</Text>
    </Pressable>
  );
}

function FeatureCard({ tool, onPress }: { tool: Tool; onPress: () => void }) {
  const { theme, styles } = useThemeStyles(createStyles);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.featureCard, pressed && styles.pressed]}
    >
      <View pointerEvents="none" style={styles.featureBlob} />
      <ToolIcon icon={tool.icon} tone={tool.tone} size={25} />
      <View style={styles.featureCopy}>
        <Text style={styles.featureTitle}>{tool.title}</Text>
        <Text numberOfLines={3} style={styles.featureBody}>
          {tool.description}
        </Text>
      </View>
      <View style={styles.chevronCircle}>
        <Ionicons color={theme.deepBrand} name="chevron-forward" size={17} />
      </View>
    </Pressable>
  );
}

function AiCard({ tool, onPress }: { tool: Tool; onPress: () => void }) {
  const { theme, styles } = useThemeStyles(createStyles);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.aiCard, pressed && styles.pressed]}
    >
      <ToolIcon icon={tool.icon} tone={tool.tone} size={25} />
      <View style={styles.aiCopy}>
        <Text style={styles.featureTitle}>{tool.title}</Text>
        <Text numberOfLines={3} style={styles.featureBody}>
          {tool.description}
        </Text>
      </View>
      <Ionicons color={theme.deepBrand} name="chevron-forward" size={18} />
    </Pressable>
  );
}

function CompactTool({ tool, onPress }: { tool: Tool; onPress: () => void }) {
  const { theme, styles } = useThemeStyles(createStyles);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.compact, pressed && styles.pressed]}
    >
      <View style={styles.compactIcon}>
        <Ionicons color={theme.deepBrand} name={tool.icon} size={20} />
      </View>
      <Text numberOfLines={2} style={styles.compactTitle}>
        {tool.title}
      </Text>
      <Ionicons color={theme.deepBrand} name="chevron-forward" size={15} />
    </Pressable>
  );
}

function SearchResult({ tool, onPress }: { tool: Tool; onPress: () => void }) {
  const { theme, styles } = useThemeStyles(createStyles);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.resultRow, pressed && styles.pressed]}
    >
      <ToolIcon icon={tool.icon} tone={tool.tone} />
      <View style={styles.resultCopy}>
        <Text style={styles.resultTitle}>{tool.title}</Text>
        {tool.description ? (
          <Text style={styles.resultBody}>{tool.description}</Text>
        ) : null}
      </View>
      <Ionicons color={theme.deepBrand} name="chevron-forward" size={18} />
    </Pressable>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    screen: { paddingTop: 8 },
    notice: { marginTop: 12 },
    section: { marginTop: 28 },
    recentRail: { gap: 10, paddingRight: 20 },
    recentEmpty: {
      alignItems: "center",
      backgroundColor: theme.surfaceGlassStrong,
      borderColor: theme.border,
      borderRadius: 18,
      borderStyle: "dashed",
      borderWidth: 1,
      flexDirection: "row",
      minHeight: 76,
      paddingHorizontal: 14,
    },
    recentEmptyIcon: {
      alignItems: "center",
      backgroundColor: "rgba(233,177,142,0.18)",
      borderRadius: 13,
      height: 44,
      justifyContent: "center",
      width: 44,
    },
    recentEmptyCopy: { flex: 1, marginHorizontal: 11 },
    recentEmptyTitle: {
      color: theme.text,
      fontFamily: theme.font.semibold,
      fontSize: 13,
    },
    recentEmptyBody: {
      color: theme.textMuted,
      fontFamily: theme.font.body,
      fontSize: 11,
      marginTop: 3,
    },
    recentCard: {
      backgroundColor: theme.surfaceGlassStrong,
      borderColor: theme.border,
      borderRadius: 18,
      borderWidth: 1,
      minHeight: 142,
      padding: 13,
      position: "relative",
      width: 145,
      ...theme.shadow,
    },
    toolIcon: {
      alignItems: "center",
      backgroundColor: "#FBEDE6",
      borderRadius: 14,
      height: 48,
      justifyContent: "center",
      width: 48,
    },
    toolIconSage: { backgroundColor: "#EAF2EA" },
    toolIconSand: { backgroundColor: "#F6EEDF" },
    recentChevron: { position: "absolute", right: 11, top: 29 },
    recentTitle: {
      color: theme.text,
      fontFamily: theme.font.semibold,
      fontSize: 14.5,
      lineHeight: 18,
      marginTop: 12,
      maxWidth: 110,
    },
    essentialGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "space-between",
      rowGap: 10,
    },
    featureCard: {
      alignItems: "flex-start",
      backgroundColor: theme.surfaceGlassStrong,
      borderColor: "rgba(41,35,31,0.09)",
      borderRadius: 20,
      borderWidth: 1,
      flexDirection: "row",
      minHeight: 142,
      overflow: "hidden",
      padding: 13,
      position: "relative",
      width: "48%",
    },
    featureBlob: {
      backgroundColor: "rgba(233,177,142,0.20)",
      borderRadius: 60,
      bottom: -44,
      height: 92,
      position: "absolute",
      right: -22,
      width: 105,
    },
    featureCopy: { flex: 1, marginLeft: 10, paddingRight: 2 },
    featureTitle: {
      color: theme.text,
      fontFamily: theme.font.semibold,
      fontSize: 14,
      lineHeight: 18,
    },
    featureBody: {
      color: theme.textMuted,
      fontFamily: theme.font.body,
      fontSize: 11,
      lineHeight: 16,
      marginTop: 5,
    },
    chevronCircle: {
      alignItems: "center",
      backgroundColor: theme.surfaceGlassStrong,
      borderRadius: 18,
      bottom: 10,
      height: 36,
      justifyContent: "center",
      position: "absolute",
      right: 10,
      width: 36,
    },
    aiRow: { flexDirection: "row", gap: 10 },
    aiCard: {
      alignItems: "center",
      backgroundColor: theme.surfaceGlassStrong,
      borderColor: theme.border,
      borderRadius: 19,
      borderWidth: 1,
      flex: 1,
      minHeight: 128,
      padding: 13,
    },
    aiCopy: { flex: 1, marginLeft: 10 },
    moreGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "space-between",
      rowGap: 8,
    },
    compact: {
      alignItems: "center",
      backgroundColor: theme.surfaceGlassStrong,
      borderColor: theme.border,
      borderRadius: 14,
      borderWidth: 1,
      flexDirection: "row",
      minHeight: 56,
      paddingHorizontal: 8,
      width: "48%",
    },
    compactIcon: {
      alignItems: "center",
      backgroundColor: "rgba(233,177,142,0.16)",
      borderRadius: 11,
      height: 36,
      justifyContent: "center",
      width: 36,
    },
    compactTitle: {
      color: theme.text,
      flex: 1,
      fontFamily: theme.font.medium,
      fontSize: 11,
      lineHeight: 14,
      marginLeft: 7,
    },
    results: { marginTop: 26 },
    resultRow: {
      alignItems: "center",
      borderBottomColor: theme.border,
      borderBottomWidth: 1,
      flexDirection: "row",
      gap: 12,
      minHeight: 78,
      paddingVertical: 10,
    },
    resultCopy: { flex: 1 },
    resultTitle: {
      color: theme.text,
      fontFamily: theme.font.semibold,
      fontSize: 14,
    },
    resultBody: {
      color: theme.textMuted,
      fontFamily: theme.font.body,
      fontSize: 11.5,
      lineHeight: 16,
      marginTop: 3,
    },
    zero: { alignItems: "center", minHeight: 340, paddingTop: 90 },
    zeroTitle: {
      color: theme.text,
      fontFamily: theme.font.display,
      fontSize: 20,
      marginTop: 16,
    },
    zeroBody: {
      color: theme.textMuted,
      fontFamily: theme.font.body,
      fontSize: 13,
      lineHeight: 19,
      marginTop: 7,
      maxWidth: 300,
      textAlign: "center",
    },
    pressed: { opacity: 0.76, transform: [{ scale: 0.98 }] },
  });
const styles = createStyles(theme);
