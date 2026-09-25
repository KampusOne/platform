import { Ionicons } from "@expo/vector-icons";
import { type Href, router } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { ProductScreen, SearchField } from "@/src/components/product-ui";
import { SectionHeading } from "@/src/components/section-heading";
import { AgentShortcuts } from "@/src/components/agent-shortcuts";
import { ToolRow } from "@/src/components/toolkit";
import { recordRecentTool, useRecentToolIds } from "@/src/lib/recent-tools";
import { useAppearance } from "@/src/lib/appearance";
import { selectionAsync } from "@/src/lib/haptics";
type Tool = {
  id: string;
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  href: Href;
  keywords?: string;
};
const tools: Tool[] = [
  {
    id: "calendar",
    title: "Academic calendar",
    icon: "calendar-number-outline",
    href: "/academic-calendar",
    keywords: "semesters registration exams holidays dates",
  },
  {
    id: "timetable",
    title: "Timetable",
    icon: "calendar-outline",
    href: "/timetable",
    keywords: "classes schedule",
  },
  {
    id: "gpa",
    title: "CGPA calculator",
    icon: "calculator-outline",
    href: "/course-planner",
    keywords: "grades courses units",
  },
  {
    id: "upload",
    title: "Import timetable",
    icon: "cloud-upload-outline",
    href: "/timetable-import",
  },
  {
    id: "alarm",
    title: "Alarms & reminders",
    icon: "alarm-outline",
    href: "/alarms",
  },
  {
    id: "study",
    title: "Study assistant",
    icon: "sparkles-outline",
    href: "/ai",
    keywords: "AI questions notes",
  },
  {
    id: "summarize",
    title: "Summaries",
    icon: "reader-outline",
    href: { pathname: "/ai", params: { mode: "summary" } },
  },
  {
    id: "quiz",
    title: "Practice questions",
    icon: "help-circle-outline",
    href: { pathname: "/ai", params: { mode: "quiz" } },
  },
  {
    id: "history",
    title: "Study history",
    icon: "time-outline",
    href: "/study-history",
    keywords: "saved notes summaries quizzes",
  },
  {
    id: "tutors",
    title: "Tutors & materials",
    icon: "people-outline",
    href: "/tutorials",
    keywords: "notes PDFs past questions",
  },
  {
    id: "community",
    title: "Class community",
    icon: "people-circle-outline",
    href: "/communities",
  },
  {
    id: "market",
    title: "Marketplace",
    icon: "bag-handle-outline",
    href: "/store",
  },
  {
    id: "guide",
    title: "Campus guidelines",
    icon: "book-outline",
    href: "/guidelines",
    keywords: "student rules",
  },
  { id: "campus", title: "Campus map", icon: "map-outline", href: "/map" },
  { id: "routine", title: "My streak", icon: "flame-outline", href: "/streak" },
];
export default function ExploreScreen() {
  const { theme } = useAppearance();
  const [query, setQuery] = useState("");
  const recentIds = useRecentToolIds();
  const recent = recentIds
    .map((id) => tools.find((tool) => tool.id === id))
    .filter((t): t is Tool => Boolean(t))
    .slice(0, 5);
  function open(tool: Tool) {
    void selectionAsync().catch(() => undefined);
    recordRecentTool(tool.id);
    router.push(tool.href);
  }
  const matches = query.trim()
    ? tools.filter((tool) =>
        `${tool.title} ${tool.keywords ?? ""}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
      )
    : null;
  const row = (tool: Tool) => (
    <ToolRow
      key={tool.id}
      title={tool.title}
      icon={tool.icon}
      onPress={() => open(tool)}
    />
  );
  return (
    <ProductScreen style={{ paddingTop: 12 }}>
      <Text
        style={{
          fontFamily: theme.font.displayStrong,
          color: theme.text,
          fontSize: 30,
          marginBottom: 20,
        }}
      >
        Explore
      </Text>
      <SearchField
        value={query}
        onChangeText={setQuery}
        placeholder="Find a tool"
      />
      {matches ? (
        <View style={{ marginTop: 24 }}>
          <SectionHeading
            title="Search results"
            meta={String(matches.length)}
          />
          {matches.length ? (
            matches.map(row)
          ) : (
            <Text
              style={{
                fontFamily: theme.font.body,
                color: theme.textMuted,
                paddingVertical: 32,
              }}
            >
              No matching tools. Try a different word.
            </Text>
          )}
        </View>
      ) : (
        <>
          <AgentShortcuts />
          {recent.length ? (
            <View style={{ marginTop: 24 }}>
              <SectionHeading title="Recently used" />
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 10 }}
              >
                {recent.map((tool) => (
                  <Pressable
                    key={tool.id}
                    accessibilityRole="button"
                    onPress={() => open(tool)}
                    style={({ pressed }) => ({
                      borderBottomWidth: 2,
                      borderColor: theme.brand,
                      paddingHorizontal: 4,
                      paddingVertical: 12,
                      marginRight: 14,
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <Text
                      style={{
                        fontFamily: theme.font.medium,
                        color: theme.text,
                      }}
                    >
                      {tool.title}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          ) : null}
          <View style={{ marginTop: 28 }}>
            <SectionHeading title="Your academics" />
            <View style={{ flexDirection: "row", gap: 12 }}>
              {tools.slice(0, 2).map((tool, index) => (
                <Pressable
                  key={tool.id}
                  accessibilityRole="button"
                  onPress={() => open(tool)}
                  style={({ pressed }) => ({
                    flex: 1,
                    minHeight: 136,
                    backgroundColor: index ? theme.sand : theme.surfaceMuted,
                    padding: 18,
                    borderRadius: 18,
                    justifyContent: "space-between",
                    opacity: pressed ? 0.75 : 1,
                  })}
                >
                  <Ionicons
                    name={tool.icon}
                    color={theme.deepBrand}
                    size={29}
                  />
                  <Text
                    style={{
                      fontFamily: theme.font.display,
                      color: theme.text,
                      fontSize: 20,
                    }}
                  >
                    {tool.title}
                  </Text>
                </Pressable>
              ))}
            </View>
            {tools.slice(2, 4).map(row)}
          </View>
          <View style={{ marginTop: 28 }}>
            <SectionHeading title="Make room for study" />
            <Pressable
              accessibilityRole="button"
              onPress={() => open(tools[4]!)}
              style={({ pressed }) => ({
                backgroundColor: theme.deepBrand,
                borderRadius: 18,
                padding: 22,
                minHeight: 115,
                justifyContent: "space-between",
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Ionicons name="sparkles-outline" color="#FFFFFF" size={25} />
              <Text
                style={{
                  color: "#FFFFFF",
                  fontFamily: theme.font.display,
                  fontSize: 23,
                  marginTop: 18,
                }}
              >
                Open study assistant
              </Text>
            </Pressable>
            <View
              style={{ flexDirection: "row", flexWrap: "wrap", paddingTop: 8 }}
            >
              {tools.slice(5, 8).map((tool) => (
                <Pressable
                  accessibilityRole="button"
                  key={tool.id}
                  onPress={() => open(tool)}
                  style={{ paddingVertical: 16, paddingRight: 20 }}
                >
                  <Text
                    style={{
                      color: theme.deepBrand,
                      fontFamily: theme.font.semibold,
                      fontSize: 13,
                    }}
                  >
                    {tool.title}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
          <View style={{ marginTop: 24 }}>
            <SectionHeading title="Around campus" />
            {tools.slice(8).map(row)}
          </View>
        </>
      )}
    </ProductScreen>
  );
}
