import { useThemeStyles, type Theme } from "@/src/lib/appearance";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "@/src/lib/haptics";
import { type Href, router } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { ProductScreen, SearchField } from "@/src/components/product-ui";
import { SectionHeading } from "@/src/components/section-heading";
import { AgentShortcuts } from "@/src/components/agent-shortcuts";
import { recordRecentTool, useRecentToolIds } from "@/src/lib/recent-tools";

type IconName = keyof typeof Ionicons.glyphMap;
type Tool = {
  id: string;
  title: string;
  description: string;
  icon: IconName;
  href: Href;
  tone?: "peach" | "sand" | "sage";
};

const tools = {
  calendar: {
    id: "calendar",
    title: "Academic calendar",
    description: "Important semester, registration and exam dates.",
    icon: "calendar-number-outline",
    href: "/academic-calendar",
    tone: "peach",
  },
  timetable: {
    id: "timetable",
    title: "Timetable",
    description: "View and manage your class schedule.",
    icon: "calendar-outline",
    href: "/timetable",
    tone: "sand",
  },
  gpa: {
    id: "gpa",
    title: "CGPA calculator",
    description: "Your courses, units and grades.",
    icon: "calculator-outline",
    href: "/course-planner",
    tone: "peach",
  },
  upload: {
    id: "upload",
    title: "Import timetable",
    description: "Import and review your class schedule.",
    icon: "cloud-upload-outline",
    href: "/timetable-import",
    tone: "sage",
  },
  alarm: {
    id: "alarm",
    title: "Alarms & reminders",
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
    title: "Study assistant",
    description: "Ask questions and work through difficult topics.",
    icon: "sparkles-outline",
    href: "/ai",
    tone: "peach",
  },
  summarize: {
    id: "summarize",
    title: "Summaries",
    description: "Turn your notes into a clear study summary.",
    icon: "reader-outline",
    href: { pathname: "/ai", params: { mode: "summary" } },
    tone: "sand",
  },
  quiz: {
    id: "quiz",
    title: "Practice questions",
    description: "Generate questions from what you are studying.",
    icon: "help-circle-outline",
    href: { pathname: "/ai", params: { mode: "quiz" } },
    tone: "sage",
  },
} satisfies Record<string, Tool>;

const essentialIds = [
  "calendar",
  "timetable",
  "gpa",
  "upload",
  "alarm",
  "market",
] as const;

const moreTools: Tool[] = [
  {
    id: "history",
    title: "Study history",
    description: "Saved study sessions and generated work.",
    icon: "time-outline",
    href: "/study-history",
  },
  {
    id: "tutors",
    title: "Tutors & materials",
    description: "Tutors, notes, PDFs and past questions.",
    icon: "people-outline",
    href: "/tutorials",
  },
  {
    id: "community",
    title: "Class community",
    description: "Your class and course communities.",
    icon: "people-circle-outline",
    href: "/communities",
  },
  {
    id: "guide",
    title: "Campus guidelines",
    description: "Official student rules and guidance.",
    icon: "book-outline",
    href: "/guidelines",
  },
  {
    id: "campus",
    title: "Campus map",
    description: "Find places around campus.",
    icon: "map-outline",
    href: "/map",
  },
  {
    id: "routine",
    title: "My streak",
    description: "Keep track of your study routine.",
    icon: "flame-outline",
    href: "/streak",
  },
];

export default function ExploreScreen() {
  const { theme, styles } = useThemeStyles(createStyles);

  const [query, setQuery] = useState("");
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
    recordRecentTool(tool.id);
    router.push(tool.href);
  }

  return (
    <ProductScreen style={styles.screen}>
      <SearchField
        onChangeText={setQuery}
        placeholder="Search tools, resources or services"
        value={query}
      />

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
            <SectionHeading title="Student tools" />
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
            <SectionHeading title="Study tools" />
            <ScrollView
              contentContainerStyle={styles.aiRow}
              horizontal
              showsHorizontalScrollIndicator={false}
            >
              {([tools.study, tools.summarize, tools.quiz] as const).map((tool) => (
                <AiCard
                  key={tool.id}
                  onPress={() => openTool(tool)}
                  tool={tool}
                />
              ))}
            </ScrollView>
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
      </View>
      <Ionicons color={theme.deepBrand} name="chevron-forward" size={18} />
    </Pressable>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    screen: { paddingTop: 8 },
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
      minHeight: 126,
      padding: 13,
      position: "relative",
      width: 138,
      ...theme.shadow,
    },
    toolIcon: {
      alignItems: "center",
      backgroundColor: "#FBEDE6",
      borderRadius: 14,
      height: 44,
      justifyContent: "center",
      width: 44,
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
      borderRadius: 18,
      borderWidth: 1,
      flexDirection: "row",
      minHeight: 124,
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
    aiRow: { gap: 10, paddingRight: 20 },
    aiCard: {
      alignItems: "center",
      backgroundColor: theme.surfaceGlassStrong,
      borderColor: theme.border,
      borderRadius: 18,
      borderWidth: 1,
      flexDirection: "row",
      minHeight: 104,
      padding: 13,
      width: 176,
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
