import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  FlatList,
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { FilterRow, SearchField } from "@/src/components/product-ui";
import { ApiError, api } from "@/src/lib/api";
import { theme } from "@/src/theme";

const tutorialsEmptyIllustration = require("@/assets/illustrations/tutorials-empty-v2.png");

type Availability = {
  id: string;
  starts_at: string;
  ends_at: string;
  capacity: number;
  booked_spaces: number;
};
type Listing = {
  id: string;
  course_code: string;
  title: string;
  description: string;
  format: string;
  price_kobo: number;
  capacity: number;
  tutor_profile_id: string;
  tutor_name: string;
  tutor_biography: string | null;
  availability: Availability[];
};
type TutorSummary = {
  id: string;
  biography: string | null;
  courses: string[];
  name: string;
};

function naira(kobo: number) {
  return new Intl.NumberFormat("en-NG", {
    currency: "NGN",
    maximumFractionDigits: 0,
    style: "currency",
  }).format(kobo / 100);
}

function displayFormat(value: string) {
  const words = value.replace(/_/g, " ").trim().toLowerCase();
  return words ? `${words.charAt(0).toUpperCase()}${words.slice(1)}` : "Tutorial";
}

function formatWindow(window: Availability) {
  const date = new Date(window.starts_at);
  if (Number.isNaN(date.getTime())) return "Time to be confirmed";
  return new Intl.DateTimeFormat("en-NG", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    weekday: "short",
  }).format(date);
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "TU";
}

function VerificationBadge() {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.verifiedBadge}>
      <Ionicons color={theme.verificationMark} name="checkmark" size={9} />
    </View>
  );
}

function TutorCard({ tutor }: { tutor: TutorSummary }) {
  return (
    <View
      accessible
      accessibilityLabel={`${tutor.name}, approved tutor. ${tutor.biography ?? "KampusOne tutor"}. Teaches ${tutor.courses.join(", ")}.`}
      style={styles.tutorCard}
    >
      <View style={styles.tutorCardTop}>
        <View style={styles.tutorAvatar}>
          <Text style={styles.tutorAvatarText}>{initials(tutor.name)}</Text>
        </View>
        <VerificationBadge />
      </View>
      <Text numberOfLines={1} style={styles.tutorCardName}>{tutor.name}</Text>
      <Text numberOfLines={2} style={styles.tutorCardBio}>{tutor.biography ?? "Approved KampusOne tutor"}</Text>
      <View style={styles.courseChips}>
        {tutor.courses.slice(0, 2).map((course) => (
          <View key={course} style={styles.courseChip}><Text style={styles.courseChipText}>{course}</Text></View>
        ))}
      </View>
    </View>
  );
}

function TutorialCard({
  busy,
  disabled,
  listing,
  onBook,
  onSelect,
  selectedId,
}: {
  busy: boolean;
  disabled: boolean;
  listing: Listing;
  onBook: () => void;
  onSelect: (id: string) => void;
  selectedId: string | undefined;
}) {
  const selected = listing.availability.find((window) => window.id === selectedId) ?? listing.availability[0];
  const spaces = selected ? Math.max(0, selected.capacity - selected.booked_spaces) : 0;

  return (
    <View style={styles.listingCard}>
      <View style={styles.listingTop}>
        <View style={styles.courseTile}>
          <Ionicons color={theme.deepBrand} name="school-outline" size={21} />
          <Text numberOfLines={1} style={styles.courseCode}>{listing.course_code}</Text>
        </View>
        <View style={styles.listingCopy}>
          <View style={styles.listingMetaRow}>
            <View style={styles.formatChip}><Text style={styles.formatChipText}>{displayFormat(listing.format)}</Text></View>
            <Text style={styles.price}>{naira(Number(listing.price_kobo))}</Text>
          </View>
          <Text style={styles.listingTitle}>{listing.title}</Text>
          <View style={styles.listingTutorRow}>
            <Text
              accessibilityLabel={`By ${listing.tutor_name}, approved tutor`}
              numberOfLines={1}
              style={styles.listingTutor}
            >
              By {listing.tutor_name}
            </Text>
            <VerificationBadge />
          </View>
        </View>
      </View>

      <Text numberOfLines={3} style={styles.listingDescription}>{listing.description}</Text>

      <View style={styles.timeHeader}>
        <Text style={styles.timeLabel}>Choose a tutorial time</Text>
        <Text style={styles.spaces}>{selected ? `${spaces} ${spaces === 1 ? "space" : "spaces"} left` : "No times yet"}</Text>
      </View>

      {listing.availability.length ? (
        <ScrollView contentContainerStyle={styles.windows} horizontal showsHorizontalScrollIndicator={false}>
          {listing.availability.map((window) => {
            const active = selected?.id === window.id;
            return (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: active }}
                key={window.id}
                onPress={() => onSelect(window.id)}
                style={({ pressed }) => [styles.window, active && styles.windowSelected, pressed && styles.pressed]}
              >
                <Ionicons color={active ? "#FFFFFF" : theme.brandPressed} name="calendar-outline" size={14} />
                <Text style={[styles.windowText, active && styles.windowTextSelected]}>{formatWindow(window)}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : (
        <View style={styles.noWindows}>
          <Ionicons color={theme.textMuted} name="time-outline" size={16} />
          <Text style={styles.noWindowsText}>This tutor has not published a bookable time.</Text>
        </View>
      )}

      <Pressable
        accessibilityLabel={`Book ${listing.title} with ${listing.tutor_name}`}
        accessibilityRole="button"
        accessibilityState={{ busy, disabled: disabled || !selected }}
        disabled={disabled || !selected}
        onPress={onBook}
        style={({ pressed }) => [styles.bookButton, (disabled || !selected) && styles.bookButtonDisabled, pressed && !disabled && styles.bookButtonPressed]}
      >
        {busy ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <>
            <Text style={styles.bookButtonText}>Book tutorial</Text>
            <Ionicons color="#FFFFFF" name="arrow-forward" size={17} />
          </>
        )}
      </Pressable>
    </View>
  );
}

function TutorialsEmptyState({ filtered }: { filtered: boolean }) {
  return (
    <View style={styles.emptyState}>
      <Image
        accessible={false}
        accessibilityElementsHidden
        accessibilityIgnoresInvertColors
        importantForAccessibility="no-hide-descendants"
        resizeMode="contain"
        source={tutorialsEmptyIllustration}
        style={styles.emptyIllustration}
      />
      <Text style={styles.emptyTitle}>{filtered ? "No tutorials match" : "No tutorials published yet"}</Text>
      <Text style={styles.emptyBody}>
        {filtered
          ? "Try another course, tutor name or session format."
          : "Approved tutor listings for your university will appear here."}
      </Text>
    </View>
  );
}

export default function TutorialsScreen() {
  const { width } = useWindowDimensions();
  const [listings, setListings] = useState<Listing[]>([]);
  const [query, setQuery] = useState("");
  const [selectedFormat, setSelectedFormat] = useState("All");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedWindows, setSelectedWindows] = useState<Record<string, string>>({});
  const bookingLock = useRef(false);

  const load = useCallback(async () => {
    try {
      setLoadError("");
      setListings((await api<{ listings: Listing[] }>("/v1/student/tutorials")).listings);
    } catch (caught) {
      setLoadError(caught instanceof ApiError ? caught.message : "Tutorials could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const formats = useMemo(() => {
    const availableFormats = Array.from(new Set(listings.map((listing) => displayFormat(listing.format))));
    return ["All", ...availableFormats];
  }, [listings]);
  const activeFormat = formats.includes(selectedFormat) ? selectedFormat : "All";

  const filtered = useMemo(() => listings.filter((item) => {
    const needle = query.trim().toLowerCase();
    const matchesQuery = !needle || `${item.course_code} ${item.title} ${item.description} ${item.tutor_name}`.toLowerCase().includes(needle);
    const matchesFormat = activeFormat === "All" || displayFormat(item.format) === activeFormat;
    return matchesQuery && matchesFormat;
  }), [activeFormat, listings, query]);

  const tutors = useMemo<TutorSummary[]>(() => {
    const tutorsById = new Map<string, TutorSummary>();
    for (const listing of filtered) {
      const tutorId = listing.tutor_profile_id || listing.id;
      const existing = tutorsById.get(tutorId);
      if (existing) {
        if (!existing.courses.includes(listing.course_code)) {
          tutorsById.set(tutorId, { ...existing, courses: [...existing.courses, listing.course_code] });
        }
        continue;
      }
      tutorsById.set(tutorId, {
        biography: listing.tutor_biography,
        courses: [listing.course_code],
        id: tutorId,
        name: listing.tutor_name,
      });
    }
    return Array.from(tutorsById.values());
  }, [filtered]);

  const book = useCallback(async (listing: Listing) => {
    if (bookingLock.current) return;
    bookingLock.current = true;
    setBusy(listing.id);
    setActionError("");
    setNotice("");
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    let savedBookingId: string | null = null;

    try {
      const rememberedWindowId = selectedWindows[listing.id];
      const availabilityWindowId = listing.availability.some((window) => window.id === rememberedWindowId)
        ? rememberedWindowId
        : listing.availability[0]?.id;
      if (!availabilityWindowId) throw new ApiError(409, "CONFLICT", "Choose an available tutorial time.");
      const booking = await api<{ id: string }>("/v1/student/tutorial-bookings", {
        body: JSON.stringify({ availabilityWindowId, listingId: listing.id }),
        method: "POST",
      });
      savedBookingId = booking.id;
      const payment = await api<{ authorizationUrl: string }>("/v1/payments/initialize", {
        body: JSON.stringify({ resourceId: booking.id, resourceType: "TUTORIAL_BOOKING" }),
        method: "POST",
      });
      await Linking.openURL(payment.authorizationUrl);
    } catch (caught) {
      if (savedBookingId) {
        const providerUnavailable = caught instanceof ApiError && caught.code === "PROVIDER_UNAVAILABLE";
        const message = providerUnavailable
          ? "Your booking was saved, but secure payment is not configured yet. It remains unpaid and no money was taken. Open Purchases to review it."
          : "Your booking was saved, but payment could not be opened. Open Purchases to resume safely.";
        setNotice(message);
        AccessibilityInfo.announceForAccessibility(message);
      } else {
        const message = caught instanceof ApiError ? caught.message : "The tutorial could not be booked.";
        setActionError(message);
        AccessibilityInfo.announceForAccessibility(message);
      }
    } finally {
      bookingLock.current = false;
      setBusy("");
    }
  }, [selectedWindows]);

  const selectWindow = useCallback((listingId: string, windowId: string) => {
    void Haptics.selectionAsync();
    setSelectedWindows((current) => ({ ...current, [listingId]: windowId }));
  }, []);

  const hasActiveFilter = Boolean(query.trim()) || activeFormat !== "All";
  const canShowEmpty = Boolean(listings.length) || (!loading && !loadError);

  return (
    <SafeAreaView edges={["top"]} style={styles.screen}>
      <FlatList
        contentContainerStyle={styles.listContent}
        data={filtered}
        initialNumToRender={4}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        keyExtractor={(listing) => listing.id}
        ListEmptyComponent={canShowEmpty ? <TutorialsEmptyState filtered={hasActiveFilter} /> : null}
        ListHeaderComponent={(
          <>
            <SearchField onChangeText={setQuery} placeholder="Search a course, topic or tutor" value={query} />
            {formats.length > 1 ? (
              <View style={styles.filters}>
                <FilterRow items={formats} onSelect={setSelectedFormat} selected={activeFormat} />
              </View>
            ) : null}

            {notice ? (
              <View style={styles.notice}>
                <Ionicons accessible={false} color={theme.statusAttention} name="information-circle-outline" size={19} style={styles.alertIcon} />
                <View style={styles.noticeCopy}>
                  <Text accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.noticeText}>{notice}</Text>
                  <Pressable
                    accessibilityLabel="Open purchases to review the saved booking"
                    accessibilityRole="button"
                    onPress={() => router.push("/purchases")}
                    style={({ pressed }) => [styles.noticeAction, pressed && styles.pressed]}
                  >
                    <Text style={styles.noticeActionText}>Open purchases</Text>
                    <Ionicons color={theme.statusAttention} name="arrow-forward" size={16} />
                  </Pressable>
                </View>
                <Pressable
                  accessibilityLabel="Dismiss booking notice"
                  accessibilityRole="button"
                  onPress={() => setNotice("")}
                  style={({ pressed }) => [styles.dismissButton, pressed && styles.pressed]}
                >
                  <Ionicons color={theme.textSubtle} name="close" size={19} />
                </Pressable>
              </View>
            ) : null}

            {actionError ? (
              <View style={styles.actionError}>
                <Ionicons accessible={false} color={theme.deepBrand} name="alert-circle-outline" size={19} style={styles.alertIcon} />
                <Text accessibilityLiveRegion="assertive" accessibilityRole="alert" style={styles.actionErrorText}>{actionError}</Text>
                <Pressable
                  accessibilityLabel="Dismiss tutorial error"
                  accessibilityRole="button"
                  onPress={() => setActionError("")}
                  style={({ pressed }) => [styles.dismissButton, pressed && styles.pressed]}
                >
                  <Ionicons color={theme.textSubtle} name="close" size={19} />
                </Pressable>
              </View>
            ) : null}

            {loading ? (
              <View accessibilityLiveRegion="polite" style={styles.loading}>
                <ActivityIndicator color={theme.brand} />
                <Text style={styles.loadingText}>Finding approved tutors…</Text>
              </View>
            ) : null}

            {loadError ? (
              <Pressable
                accessibilityLabel={`Tutorials are unavailable. ${loadError}. Retry`}
                accessibilityRole="button"
                onPress={() => { setLoading(true); void load(); }}
                style={({ pressed }) => [styles.loadError, pressed && styles.pressed]}
              >
                <Ionicons color={theme.deepBrand} name="cloud-offline-outline" size={20} />
                <View style={styles.loadErrorCopy}>
                  <Text style={styles.loadErrorTitle}>Tutorials are unavailable</Text>
                  <Text style={styles.loadErrorText}>{loadError} Tap to retry.</Text>
                </View>
              </Pressable>
            ) : null}

            {filtered.length ? (
              <>
                <View style={styles.sectionHeader}>
                  <View>
                    <Text style={styles.sectionTitle}>Approved tutors</Text>
                    <Text style={styles.sectionSubtitle}>People teaching the sessions below</Text>
                  </View>
                  <View style={styles.approvedKey}>
                    <VerificationBadge />
                    <Text accessibilityLabel={`${tutors.length} approved tutors`} style={styles.approvedKeyText}>{tutors.length} approved</Text>
                  </View>
                </View>
                <FlatList
                  contentContainerStyle={styles.tutorRail}
                  data={tutors}
                  horizontal
                  initialNumToRender={4}
                  keyExtractor={(tutor) => tutor.id}
                  maxToRenderPerBatch={5}
                  renderItem={({ item: tutor }) => <TutorCard tutor={tutor} />}
                  showsHorizontalScrollIndicator={false}
                  windowSize={5}
                />

                <View style={styles.availableHeader}>
                  <Text style={styles.sectionTitle}>Available tutorials</Text>
                  <Text style={styles.availableCount}>{filtered.length} {filtered.length === 1 ? "session" : "sessions"}</Text>
                </View>
              </>
            ) : null}
          </>
        )}
        maxToRenderPerBatch={6}
        removeClippedSubviews={Platform.OS === "android"}
        renderItem={({ item: listing }) => (
          <View style={styles.listingItem}>
            <TutorialCard
              busy={busy === listing.id}
              disabled={Boolean(busy)}
              listing={listing}
              onBook={() => void book(listing)}
              onSelect={(id) => selectWindow(listing.id, id)}
              selectedId={selectedWindows[listing.id] ?? listing.availability[0]?.id}
            />
          </View>
        )}
        showsVerticalScrollIndicator={false}
        style={[styles.catalogue, { width: Math.min(width, 540) }]}
        windowSize={7}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: theme.canvas, flex: 1 },
  catalogue: { alignSelf: "center" },
  listContent: { paddingBottom: 118, paddingHorizontal: 20, paddingTop: 10 },
  filters: { marginTop: 13 },
  notice: { alignItems: "flex-start", backgroundColor: "#FFF7E9", borderRadius: 15, flexDirection: "row", gap: 8, marginTop: 13, paddingBottom: 4, paddingLeft: 13, paddingRight: 4, paddingTop: 4 },
  alertIcon: { marginTop: 10 },
  noticeCopy: { flex: 1, paddingTop: 8 },
  noticeText: { color: theme.statusAttention, flex: 1, fontFamily: theme.font.medium, fontSize: 11.5, lineHeight: 17 },
  noticeAction: { alignItems: "center", alignSelf: "flex-start", flexDirection: "row", gap: 5, minHeight: 44 },
  noticeActionText: { color: theme.statusAttention, fontFamily: theme.font.bold, fontSize: 11.5, textDecorationLine: "underline" },
  dismissButton: { alignItems: "center", height: 44, justifyContent: "center", width: 44 },
  actionError: { alignItems: "flex-start", backgroundColor: "#FFF0EB", borderRadius: 15, flexDirection: "row", gap: 8, marginTop: 13, paddingBottom: 4, paddingLeft: 13, paddingRight: 4, paddingTop: 4 },
  actionErrorText: { color: theme.deepBrand, flex: 1, fontFamily: theme.font.medium, fontSize: 11.5, lineHeight: 17 },
  loading: { alignItems: "center", gap: 9, paddingVertical: 54 },
  loadingText: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 12.5 },
  loadError: { alignItems: "center", backgroundColor: "#FFF0EB", borderRadius: 18, flexDirection: "row", gap: 11, marginTop: 18, minHeight: 72, padding: 14 },
  loadErrorCopy: { flex: 1 },
  loadErrorTitle: { color: theme.deepBrand, fontFamily: theme.font.semibold, fontSize: 13 },
  loadErrorText: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 11.5, lineHeight: 17, marginTop: 2 },
  sectionHeader: { alignItems: "flex-end", flexDirection: "row", justifyContent: "space-between", marginTop: 24 },
  sectionTitle: { color: theme.text, fontFamily: theme.font.display, fontSize: 21 },
  sectionSubtitle: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 11, marginTop: 3 },
  approvedKey: { alignItems: "center", flexDirection: "row", gap: 5, paddingBottom: 2 },
  approvedKeyText: { color: theme.brandPressed, fontFamily: theme.font.medium, fontSize: 9.5 },
  verifiedBadge: { alignItems: "center", backgroundColor: theme.brand, borderRadius: 7, height: 14, justifyContent: "center", width: 14 },
  tutorRail: { gap: 10, paddingBottom: 4, paddingRight: 3, paddingTop: 12 },
  tutorCard: { backgroundColor: theme.surfaceRaised, borderColor: theme.border, borderRadius: 19, borderWidth: 1, minHeight: 178, padding: 13, width: 164, ...theme.shadow },
  tutorCardTop: { alignItems: "flex-start", flexDirection: "row", justifyContent: "space-between" },
  tutorAvatar: { alignItems: "center", backgroundColor: theme.sand, borderRadius: 28, height: 56, justifyContent: "center", width: 56 },
  tutorAvatarText: { color: theme.deepBrand, fontFamily: theme.font.displayStrong, fontSize: 17 },
  tutorCardName: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 14, marginTop: 10 },
  tutorCardBio: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 10, lineHeight: 14, marginTop: 3, minHeight: 28 },
  courseChips: { flexDirection: "row", gap: 5, marginTop: 8 },
  courseChip: { backgroundColor: theme.surfaceMuted, borderRadius: 7, paddingHorizontal: 7, paddingVertical: 4 },
  courseChipText: { color: theme.brandPressed, fontFamily: theme.font.semibold, fontSize: 8.5 },
  availableHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginTop: 25 },
  availableCount: { color: theme.brandPressed, fontFamily: theme.font.medium, fontSize: 10.5 },
  listingItem: { marginTop: 13 },
  listingCard: { backgroundColor: theme.surfaceRaised, borderColor: theme.border, borderRadius: 22, borderWidth: 1, padding: 14, ...theme.shadow },
  listingTop: { flexDirection: "row" },
  courseTile: { alignItems: "center", backgroundColor: theme.surfaceMuted, borderRadius: 16, height: 72, justifyContent: "center", width: 72 },
  courseCode: { color: theme.deepBrand, fontFamily: theme.font.bold, fontSize: 10.5, marginTop: 5, maxWidth: 62 },
  listingCopy: { flex: 1, marginLeft: 12 },
  listingMetaRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  formatChip: { backgroundColor: "rgba(241,223,200,.62)", borderRadius: 8, paddingHorizontal: 7, paddingVertical: 4 },
  formatChipText: { color: theme.brandPressed, fontFamily: theme.font.bold, fontSize: 8.5, letterSpacing: .35 },
  price: { color: theme.text, fontFamily: theme.font.displayStrong, fontSize: 16 },
  listingTitle: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 16, lineHeight: 20, marginTop: 7 },
  listingTutorRow: { alignItems: "center", flexDirection: "row", gap: 5, marginTop: 5 },
  listingTutor: { color: theme.textMuted, flexShrink: 1, fontFamily: theme.font.medium, fontSize: 10.5 },
  listingDescription: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 11.5, lineHeight: 17, marginTop: 11 },
  timeHeader: { alignItems: "center", borderTopColor: theme.border, borderTopWidth: 1, flexDirection: "row", justifyContent: "space-between", marginTop: 12, paddingTop: 12 },
  timeLabel: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 11.5 },
  spaces: { color: theme.textSubtle, fontFamily: theme.font.body, fontSize: 9.5 },
  windows: { gap: 7, paddingRight: 3, paddingTop: 8 },
  window: { alignItems: "center", backgroundColor: theme.surfaceMuted, borderColor: theme.border, borderRadius: 11, borderWidth: 1, flexDirection: "row", gap: 5, minHeight: 44, paddingHorizontal: 10 },
  windowSelected: { backgroundColor: theme.deepBrand, borderColor: theme.deepBrand },
  windowText: { color: theme.textMuted, fontFamily: theme.font.semibold, fontSize: 9 },
  windowTextSelected: { color: "#FFFFFF" },
  noWindows: { alignItems: "center", backgroundColor: theme.surfaceMuted, borderRadius: 11, flexDirection: "row", gap: 7, marginTop: 8, minHeight: 42, paddingHorizontal: 10 },
  noWindowsText: { color: theme.textMuted, flex: 1, fontFamily: theme.font.body, fontSize: 10 },
  bookButton: { alignItems: "center", alignSelf: "flex-end", backgroundColor: theme.deepBrand, borderRadius: 14, flexDirection: "row", gap: 7, height: 46, justifyContent: "center", marginTop: 13, minWidth: 146, paddingHorizontal: 16 },
  bookButtonDisabled: { opacity: .5 },
  bookButtonPressed: { opacity: .84, transform: [{ scale: .97 }] },
  bookButtonText: { color: "#FFFFFF", fontFamily: theme.font.bold, fontSize: 11.5 },
  emptyState: { alignItems: "center", minHeight: 530, paddingHorizontal: 20, paddingTop: 74 },
  emptyIllustration: { height: 245, width: "100%" },
  emptyTitle: { color: theme.text, fontFamily: theme.font.display, fontSize: 24, marginTop: 18, textAlign: "center" },
  emptyBody: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 14, lineHeight: 21, marginTop: 8, maxWidth: 330, textAlign: "center" },
  pressed: { opacity: .72, transform: [{ scale: .97 }] },
});
