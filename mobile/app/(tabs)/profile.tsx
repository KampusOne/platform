import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Image, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { useAuth } from "@/src/auth/auth-context";
import { EmptyResult, InlineFeedback, ProductScreen, useReducedMotionPreference } from "@/src/components/product-ui";
import { SectionHeading } from "@/src/components/section-heading";
import { CampusScape } from "@/src/components/visual-system";
import { ApiError, api } from "@/src/lib/api";
import { theme } from "@/src/theme";

type StudentProfile = {
  id: string;
  email: string;
  email_verified_at: string | null;
  username: string | null;
  display_name: string;
  first_name: string | null;
  last_name: string | null;
  biography: string | null;
  profile_image_url: string | null;
  cover_image_url: string | null;
  university_name: string | null;
  faculty_name: string | null;
  department_name: string | null;
  course_name: string | null;
  current_level: string | null;
  graduation_year: number | null;
  verification_status: string | null;
};

type AcademicTerm = { id?: string; label?: string; term?: string; semester?: string; gpa?: string | number | null };
type Academic = { summary: { cgpa: string | number | null; total_units: string | number | null } | null; terms: AcademicTerm[] };
type Booking = { id: string; title: string; course_code: string; tutor_name: string; status: string; created_at: string };
type Order = { id: string; vendor_name: string; status: string; total_kobo: number; created_at: string };
type Purchases = { tutorialBookings: Booking[]; orders: Order[] };
type FeedPost = { id: string; title: string; source_name: string; bookmarked: boolean; published_at: string };
type Feed = { posts: FeedPost[] };
type ProfilePayload = { profile: StudentProfile };
type Tab = "Overview" | "Activity" | "Classes" | "Transactions";
type ResourceState = "idle" | "ready" | "stale" | "error";

export default function ProfileScreen() {
  const { profile: sessionProfile, signOut } = useAuth();
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [academics, setAcademics] = useState<Academic | null>(null);
  const [purchases, setPurchases] = useState<Purchases | null>(null);
  const [bookmarks, setBookmarks] = useState<FeedPost[]>([]);
  const [academicState, setAcademicState] = useState<ResourceState>("idle");
  const [purchasesState, setPurchasesState] = useState<ResourceState>("idle");
  const [feedState, setFeedState] = useState<ResourceState>("idle");
  const [activeTab, setActiveTab] = useState<Tab>("Overview");
  const [menuOpen, setMenuOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [dataNotice, setDataNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const reducedMotion = useReducedMotionPreference();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setError("");
      setDataNotice("");
      const me = await api<ProfilePayload>("/v1/student/me");
      setProfile(me.profile);

      const [gpa, bought, feed] = await Promise.allSettled([
        api<Academic>("/v1/student/gpa"),
        api<Purchases>("/v1/student/purchases"),
        api<Feed>("/v1/student/feed"),
      ]);
      if (gpa.status === "fulfilled") {
        setAcademics(gpa.value);
        setAcademicState("ready");
      } else {
        setAcademicState((current) => current === "ready" || current === "stale" ? "stale" : "error");
      }
      if (bought.status === "fulfilled") {
        setPurchases(bought.value);
        setPurchasesState("ready");
      } else {
        setPurchasesState((current) => current === "ready" || current === "stale" ? "stale" : "error");
      }
      if (feed.status === "fulfilled") {
        setBookmarks(feed.value.posts.filter((post) => post.bookmarked));
        setFeedState("ready");
      } else {
        setFeedState((current) => current === "ready" || current === "stale" ? "stale" : "error");
      }
      const unavailable = [
        gpa.status === "rejected" ? "academics" : "",
        bought.status === "rejected" ? "purchases" : "",
        feed.status === "rejected" ? "saved posts" : "",
      ].filter(Boolean);
      if (unavailable.length) {
        setDataNotice(`${unavailable.join(", ")} could not be refreshed. Previously loaded information remains visible where available.`);
      }
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Your profile could not be refreshed.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const name = profile?.display_name ?? sessionProfile?.display_name ?? "Student";
  const initials = name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  const academicsKnown = academicState === "ready" || academicState === "stale";
  const purchasesKnown = purchasesState === "ready" || purchasesState === "stale";
  const feedKnown = feedState === "ready" || feedState === "stale";
  const activityComplete = purchasesKnown;
  const activities = useMemo(() => {
    const rows = [
      ...(purchases?.tutorialBookings ?? []).map((booking) => ({
        id: `booking-${booking.id}`,
        icon: "school-outline" as const,
        title: `${booking.course_code} tutorial with ${booking.tutor_name}`,
        detail: booking.status.replaceAll("_", " "),
        date: booking.created_at,
      })),
      ...(purchases?.orders ?? []).map((order) => ({
        id: `order-${order.id}`,
        icon: "bag-handle-outline" as const,
        title: `Order from ${order.vendor_name}`,
        detail: order.status.replaceAll("_", " "),
        date: order.created_at,
      })),
    ];
    return rows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [purchases]);

  function explain(message: string) {
    void Haptics.selectionAsync();
    setNotice(message);
  }

  return (
    <ProductScreen style={styles.screen}>
      <View style={styles.profileTop}>
        <View style={styles.cover}>
          {profile?.cover_image_url ? <Image accessible={false} source={{ uri: profile.cover_image_url }} style={styles.coverImage} /> : <CampusScape />}
          <View pointerEvents="none" style={styles.coverShade} />
          <Pressable accessibilityLabel="Open account menu" accessibilityRole="button" onPress={() => setMenuOpen(true)} style={({ pressed }) => [styles.moreButton, pressed && styles.pressed]}>
            <Ionicons color={theme.text} name="ellipsis-vertical" size={22} />
          </Pressable>
        </View>

        <View style={styles.identity}>
          <Pressable accessibilityLabel="Edit profile photo" accessibilityRole="button" onPress={() => explain("Profile photo editing is scheduled for Phase 2.")} style={styles.avatarWrap}>
            <View style={styles.avatarFallback}><Text style={styles.avatarText}>{initials}</Text></View>
            {profile?.profile_image_url ? <Image accessible={false} source={{ uri: profile.profile_image_url }} style={styles.avatarImage} /> : null}
            <View style={styles.camera}><Ionicons color="#FFFFFF" name="camera" size={17} /></View>
          </Pressable>
          <View style={styles.nameRow}>
            <Text style={styles.name}>{name}</Text>
            <Pressable accessibilityLabel="Edit name" accessibilityRole="button" onPress={() => explain("Name editing is scheduled for Phase 2.")} style={styles.editNameButton}>
              <Ionicons color={theme.deepBrand} name="pencil-outline" size={18} />
            </Pressable>
          </View>
          <View style={styles.usernameRow}>
            <Text style={styles.username}>@{profile?.username ?? "student"}</Text>
            {profile?.verification_status && ["VERIFIED", "APPROVED"].includes(profile.verification_status.toUpperCase()) ? <VerifiedMark status={profile.verification_status} /> : null}
          </View>
          <Text style={styles.bio}>{profile?.biography ?? "Your campus identity, resources and history in one place."}</Text>
          <ScrollView contentContainerStyle={styles.metaRow} horizontal showsHorizontalScrollIndicator={false}>
            <Meta icon="person-outline" text={profile?.current_level ? `${profile.current_level} Level` : "Level not set"} />
            <Meta icon="book-outline" text={profile?.course_name ?? profile?.department_name ?? "Programme not set"} />
            {profile?.faculty_name ? <Meta icon="school-outline" text={profile.faculty_name} /> : null}
            <Meta icon="business-outline" text={profile?.university_name ?? "University not set"} />
            {profile?.graduation_year ? <Meta icon="calendar-outline" text={`Graduating ${profile.graduation_year}`} /> : null}
          </ScrollView>
        </View>
      </View>

      {notice ? <View style={styles.notice}><InlineFeedback message={notice} /></View> : null}
      {dataNotice ? <View style={styles.notice}><InlineFeedback message={dataNotice} /></View> : null}
      {loading ? <View style={styles.loading}><ActivityIndicator color={theme.brand} /><Text style={styles.loadingText}>Loading your profile…</Text></View> : null}
      {error ? (
        <Pressable accessibilityRole="button" onPress={() => { setLoading(true); void load(); }} style={({ pressed }) => [styles.error, pressed && styles.pressed]}>
          <Ionicons color={theme.deepBrand} name="cloud-offline-outline" size={20} />
          <Text style={styles.errorText}>{error} Tap to retry.</Text>
        </Pressable>
      ) : null}

      {(!loading || Boolean(profile)) && (profile || sessionProfile) ? (
        <>
          <View style={styles.metrics}>
            <Metric icon="stats-chart-outline" label="CGPA" value={academicsKnown && academics?.summary?.cgpa ? String(academics.summary.cgpa) : "—"} />
            <Metric icon="layers-outline" label="Semesters" value={academicsKnown ? String(academics?.terms.length ?? 0) : "—"} />
            <Metric icon="bag-check-outline" label="Orders" value={purchasesKnown ? String(purchases?.orders.length ?? 0) : "—"} />
            <Metric icon="bookmark-outline" label="Recent saves" value={feedKnown ? String(bookmarks.length) : "—"} />
          </View>

          <ScrollView contentContainerStyle={styles.tabs} horizontal showsHorizontalScrollIndicator={false}>
            {(["Overview", "Activity", "Classes", "Transactions"] as const).map((tab) => (
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected: activeTab === tab }}
                key={tab}
                onPress={() => { void Haptics.selectionAsync(); setActiveTab(tab); }}
                style={[styles.tab, activeTab === tab && styles.tabActive]}
              >
                <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>{tab}</Text>
              </Pressable>
            ))}
          </ScrollView>

          {activeTab === "Overview" ? (
            <>
              <View style={styles.section}>
                <SectionHeading meta="Open Feed" onPress={() => router.push("/feed")} title="Recently saved" />
                {!feedKnown ? (
                  <Text style={styles.quietState}>Saved posts are unavailable right now. Other profile details remain available.</Text>
                ) : bookmarks.length ? (
                  <ScrollView contentContainerStyle={styles.savedRail} horizontal showsHorizontalScrollIndicator={false}>
                    {bookmarks.slice(0, 4).map((post) => (
                      <Pressable accessibilityRole="button" key={post.id} onPress={() => router.push("/feed")} style={({ pressed }) => [styles.savedCard, pressed && styles.pressed]}>
                        <View style={styles.savedTop}><View style={styles.sourceDot} /><Ionicons color={theme.deepBrand} name="bookmark" size={18} /></View>
                        <Text numberOfLines={3} style={styles.savedTitle}>{post.title}</Text>
                        <Text numberOfLines={1} style={styles.savedSource}>{post.source_name}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                ) : (
                  <Text style={styles.quietState}>Recent posts you bookmark in Feed will appear here.</Text>
                )}
              </View>
              <View style={styles.actionGrid}>
                <ProfileAction icon="document-text-outline" title="Faculty Guidelines" body="Academic handbooks and verified resources." onPress={() => explain("Faculty Guidelines will open when your school publishes them.")} />
                <ProfileAction icon="briefcase-outline" title="Departmental Guidelines" body="Course structure, electives and requirements." onPress={() => explain("Departmental Guidelines will open when your department publishes them.")} />
                <ProfileAction icon="wallet-outline" title="Transactions" body="Bookings, orders and payment history." onPress={() => router.push("/purchases")} />
                <ProfileAction icon="time-outline" title="Past Classes" body="Previous semesters and class records." onPress={() => setActiveTab("Classes")} />
              </View>
              <View style={styles.section}>
                <SectionHeading meta="See all" onPress={() => setActiveTab("Activity")} title="Recent Activity" />
                <ActivityList activities={activities.slice(0, 4)} emptyMessage={activityComplete ? undefined : "Purchase activity is unavailable right now. Available records will appear here."} />
              </View>
            </>
          ) : null}

          {activeTab === "Activity" ? <View style={styles.section}><ActivityList activities={activities} emptyMessage={activityComplete ? undefined : "Purchase activity is unavailable right now. Available records will appear here."} /></View> : null}
          {activeTab === "Classes" ? (
            <View style={styles.tabPanel}>
              <EmptyResult actionLabel="Open timetable" body="Your current classes, venues and reminders live in Timetable Manager." icon="calendar-outline" onAction={() => router.push("/timetable")} title="Your class history" />
            </View>
          ) : null}
          {activeTab === "Transactions" ? (
            <View style={styles.tabPanel}>
              <EmptyResult
                actionLabel="View bookings and orders"
                body={purchasesKnown ? "Track tutorial bookings, store orders, delivery codes and payment status." : "Transaction totals are unavailable right now. Open Purchases to retry."}
                icon="receipt-outline"
                onAction={() => router.push("/purchases")}
                title={purchasesKnown ? `${(purchases?.orders.length ?? 0) + (purchases?.tutorialBookings.length ?? 0)} transactions` : "Transactions unavailable"}
              />
            </View>
          ) : null}

          <Pressable accessibilityRole="link" onPress={() => void Linking.openURL("https://agents.kampusone.app")} style={({ pressed }) => [styles.agentLink, pressed && styles.pressed]}>
            <View style={styles.agentIcon}><Ionicons color={theme.deepBrand} name="people-outline" size={21} /></View>
            <View style={styles.agentCopy}><Text style={styles.agentTitle}>Become a KampusOne agent</Text><Text style={styles.agentBody}>Apply as a tutor, vendor or campus rider.</Text></View>
            <Ionicons color={theme.deepBrand} name="open-outline" size={18} />
          </Pressable>
        </>
      ) : null}

      <AccountMenu
        onClose={() => setMenuOpen(false)}
        onSelect={(item) => {
          setMenuOpen(false);
          if (item === "Log out") {
            void signOut().catch((caught) => {
              setNotice(caught instanceof Error ? caught.message : "Sign out could not be completed. Please try again.");
            });
            return;
          }
          if (item === "Privacy policy") {
            void Linking.openURL("https://kampusone.app/privacy").catch(() => {
              setNotice("The Privacy Policy could not be opened. Check your connection and try again.");
            });
            return;
          }
          explain(`${item} is scheduled for Phase 2.`);
        }}
        reducedMotion={reducedMotion}
        visible={menuOpen}
      />
    </ProductScreen>
  );
}

function VerifiedMark({ status }: { status: string }) {
  const label = status.toUpperCase() === "APPROVED" ? "Profile approved" : "Profile verified";
  return <View accessibilityLabel={label} accessibilityRole="image" style={styles.verified}><Ionicons color="#FFFFFF" name="checkmark" size={10} /></View>;
}

function Meta({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return <View style={styles.meta}><Ionicons color={theme.deepBrand} name={icon} size={16} /><Text numberOfLines={1} style={styles.metaText}>{text}</Text></View>;
}

function Metric({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }) {
  return <View style={styles.metric}><Ionicons color={theme.deepBrand} name={icon} size={21} /><Text style={styles.metricValue}>{value}</Text><Text numberOfLines={1} style={styles.metricLabel}>{label}</Text></View>;
}

function ProfileAction({ icon, title, body, onPress }: { icon: keyof typeof Ionicons.glyphMap; title: string; body: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.action, pressed && styles.pressed]}><View style={styles.actionIcon}><Ionicons color={theme.deepBrand} name={icon} size={21} /></View><View style={styles.actionCopy}><Text style={styles.actionTitle}>{title}</Text><Text style={styles.actionBody}>{body}</Text></View><Ionicons color={theme.deepBrand} name="chevron-forward" size={17} /></Pressable>;
}

function ActivityList({ activities, emptyMessage }: { activities: Array<{ id: string; icon: keyof typeof Ionicons.glyphMap; title: string; detail: string; date: string }>; emptyMessage?: string | undefined }) {
  if (!activities.length) return <Text style={styles.quietState}>{emptyMessage ?? "Your tutorial bookings and store orders will build your activity here."}</Text>;
  return <View style={styles.activityList}>{activities.map((activity) => <View key={activity.id} style={styles.activity}><View style={styles.activityIcon}><Ionicons color={theme.deepBrand} name={activity.icon} size={19} /></View><View style={styles.activityCopy}><Text numberOfLines={2} style={styles.activityTitle}>{activity.title}</Text><Text style={styles.activityDetail}>{activity.detail} · {new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "short" }).format(new Date(activity.date))}</Text></View><Ionicons color={theme.textMuted} name="ellipsis-vertical" size={17} /></View>)}</View>;
}

function AccountMenu({ visible, onClose, onSelect, reducedMotion }: { visible: boolean; onClose: () => void; onSelect: (item: string) => void; reducedMotion: boolean }) {
  const items = [
    ["Account manager", "person-outline"],
    ["Settings", "settings-outline"],
    ["Privacy policy", "shield-checkmark-outline"],
    ["Help & support", "help-circle-outline"],
    ["Log out", "log-out-outline"],
  ] as const;
  return (
    <Modal animationType={reducedMotion ? "none" : "fade"} onRequestClose={onClose} statusBarTranslucent transparent visible={visible}>
      <View style={styles.menuBackdrop}>
        <Pressable accessibilityLabel="Close account menu" accessibilityRole="button" onPress={onClose} style={StyleSheet.absoluteFill} />
        <View accessibilityViewIsModal onAccessibilityEscape={onClose} style={styles.menuPanel}>
          {items.map(([label, icon], index) => (
            <Pressable accessibilityRole="button" key={label} onPress={() => onSelect(label)} style={[styles.menuItem, index === items.length - 1 && styles.menuLogout]}>
              <Ionicons color={index === items.length - 1 ? theme.deepBrand : theme.text} name={icon} size={20} />
              <Text style={[styles.menuText, index === items.length - 1 && styles.menuLogoutText]}>{label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { paddingHorizontal: 0, paddingTop: 0 },
  profileTop: { position: "relative" },
  cover: { backgroundColor: theme.sand, height: 176, overflow: "hidden", position: "relative" },
  coverImage: { height: "100%", width: "100%" },
  coverShade: { backgroundColor: "rgba(41,35,31,0.08)", bottom: 0, left: 0, position: "absolute", right: 0, top: 0 },
  moreButton: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.90)", borderRadius: 17, height: 46, justifyContent: "center", position: "absolute", right: 18, top: 16, width: 46 },
  identity: { backgroundColor: theme.canvas, borderTopLeftRadius: 28, borderTopRightRadius: 28, marginTop: -20, paddingHorizontal: 20, paddingTop: 54 },
  avatarWrap: { borderColor: "#FFFFFF", borderRadius: 52, borderWidth: 5, height: 104, left: 20, position: "absolute", top: -52, width: 104 },
  avatarFallback: { alignItems: "center", backgroundColor: theme.deepBrand, borderRadius: 48, bottom: 0, justifyContent: "center", left: 0, position: "absolute", right: 0, top: 0 },
  avatarText: { color: "#FFFFFF", fontFamily: theme.font.displayStrong, fontSize: 27 },
  avatarImage: { borderRadius: 48, height: "100%", width: "100%" },
  camera: { alignItems: "center", backgroundColor: theme.midnight, borderColor: "#FFFFFF", borderRadius: 18, borderWidth: 3, bottom: -2, height: 36, justifyContent: "center", position: "absolute", right: -4, width: 36 },
  nameRow: { alignItems: "center", flexDirection: "row", gap: 4, maxWidth: "100%" },
  name: { color: theme.text, flexShrink: 1, fontFamily: theme.font.displayStrong, fontSize: 25, letterSpacing: -0.4 },
  editNameButton: { alignItems: "center", height: 44, justifyContent: "center", width: 44 },
  usernameRow: { alignItems: "center", flexDirection: "row", gap: 6, marginTop: 3 },
  username: { color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 13.5 },
  verified: { alignItems: "center", backgroundColor: theme.verification, borderRadius: 7, height: 14, justifyContent: "center", width: 14 },
  bio: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 13, lineHeight: 19, marginTop: 10 },
  metaRow: { gap: 7, paddingRight: 20, paddingTop: 14 },
  meta: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.88)", borderColor: theme.border, borderRadius: 13, borderWidth: 1, flexDirection: "row", gap: 7, minHeight: 40, paddingHorizontal: 11 },
  metaText: { color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 11.5, maxWidth: 190 },
  notice: { marginHorizontal: 20, marginTop: 14 },
  loading: { alignItems: "center", gap: 9, paddingVertical: 38 },
  loadingText: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 12.5 },
  error: { alignItems: "center", backgroundColor: "#FFF2EC", borderRadius: 16, flexDirection: "row", gap: 8, marginHorizontal: 20, marginTop: 16, padding: 13 },
  errorText: { color: theme.deepBrand, flex: 1, fontFamily: theme.font.medium, fontSize: 12 },
  metrics: { backgroundColor: "rgba(255,255,255,0.90)", borderColor: theme.border, borderRadius: 20, borderWidth: 1, flexDirection: "row", marginHorizontal: 20, marginTop: 18, paddingVertical: 15, ...theme.shadow },
  metric: { alignItems: "center", borderRightColor: theme.border, borderRightWidth: 1, flex: 1, minWidth: 0 },
  metricValue: { color: theme.text, fontFamily: theme.font.displayStrong, fontSize: 16, marginTop: 5 },
  metricLabel: { color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 10, marginTop: 2, paddingHorizontal: 2 },
  tabs: { gap: 8, paddingHorizontal: 20, paddingVertical: 20 },
  tab: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.82)", borderColor: theme.border, borderRadius: 14, borderWidth: 1, height: 46, justifyContent: "center", minWidth: 100, paddingHorizontal: 15 },
  tabActive: { backgroundColor: theme.deepBrand, borderColor: theme.deepBrand },
  tabText: { color: theme.deepBrand, fontFamily: theme.font.medium, fontSize: 12.5 },
  tabTextActive: { color: "#FFFFFF", fontFamily: theme.font.semibold },
  section: { marginHorizontal: 20, marginTop: 8 },
  savedRail: { gap: 10, paddingRight: 20 },
  savedCard: { backgroundColor: "rgba(255,255,255,0.88)", borderColor: theme.border, borderRadius: 17, borderWidth: 1, minHeight: 130, padding: 13, width: 174 },
  savedTop: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  sourceDot: { backgroundColor: theme.brand, borderRadius: 14, height: 28, width: 28 },
  savedTitle: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 13, lineHeight: 18, marginTop: 12 },
  savedSource: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 10.5, marginTop: 7 },
  quietState: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 13, lineHeight: 20, paddingVertical: 18 },
  actionGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", marginHorizontal: 20, marginTop: 22, rowGap: 10 },
  action: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.88)", borderColor: theme.border, borderRadius: 18, borderWidth: 1, flexDirection: "row", minHeight: 100, padding: 12, width: "48%" },
  actionIcon: { alignItems: "center", backgroundColor: "rgba(233,177,142,0.18)", borderRadius: 13, height: 42, justifyContent: "center", width: 42 },
  actionCopy: { flex: 1, marginLeft: 9 },
  actionTitle: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 12, lineHeight: 15 },
  actionBody: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 9.5, lineHeight: 13, marginTop: 4 },
  activityList: { backgroundColor: "rgba(255,255,255,0.72)", borderColor: theme.border, borderRadius: 18, borderWidth: 1, overflow: "hidden" },
  activity: { alignItems: "center", borderBottomColor: theme.border, borderBottomWidth: 1, flexDirection: "row", minHeight: 70, paddingHorizontal: 12, paddingVertical: 9 },
  activityIcon: { alignItems: "center", backgroundColor: "rgba(233,177,142,0.16)", borderRadius: 12, height: 40, justifyContent: "center", width: 40 },
  activityCopy: { flex: 1, marginLeft: 10 },
  activityTitle: { color: theme.text, fontFamily: theme.font.medium, fontSize: 12, lineHeight: 16 },
  activityDetail: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 9.5, marginTop: 3, textTransform: "capitalize" },
  tabPanel: { marginHorizontal: 20 },
  agentLink: { alignItems: "center", borderColor: theme.border, borderRadius: 17, borderWidth: 1, flexDirection: "row", marginHorizontal: 20, marginTop: 24, minHeight: 72, padding: 12 },
  agentIcon: { alignItems: "center", backgroundColor: "rgba(233,177,142,0.18)", borderRadius: 13, height: 44, justifyContent: "center", width: 44 },
  agentCopy: { flex: 1, marginLeft: 10 },
  agentTitle: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 13 },
  agentBody: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 10.5, marginTop: 3 },
  menuBackdrop: { backgroundColor: "rgba(41,35,31,0.16)", flex: 1 },
  menuPanel: { backgroundColor: "rgba(255,255,255,0.98)", borderColor: theme.border, borderRadius: 20, borderWidth: 1, overflow: "hidden", position: "absolute", right: 20, top: 84, width: 240, ...theme.floatingShadow },
  menuItem: { alignItems: "center", borderBottomColor: theme.border, borderBottomWidth: 1, flexDirection: "row", gap: 12, minHeight: 54, paddingHorizontal: 16 },
  menuText: { color: theme.text, fontFamily: theme.font.medium, fontSize: 13 },
  menuLogout: { borderBottomWidth: 0 },
  menuLogoutText: { color: theme.deepBrand, fontFamily: theme.font.semibold },
  pressed: { opacity: 0.75, transform: [{ scale: 0.98 }] },
});
