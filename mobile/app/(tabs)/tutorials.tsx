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
  Modal,
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
  tutor_profile_id: string | null;
  tutor_name: string;
  tutor_biography: string | null;
  tutor_verified: boolean;
  rating: number;
  review_count: number;
  completed_sessions: number;
  is_demo: boolean;
  location_text: string | null;
  availability: Availability[];
};
type TutorSummary = {
  id: string;
  biography: string | null;
  courses: string[];
  name: string;
  verified: boolean;
  isDemo: boolean;
};

type Resource = {
  id: string;
  listing_id: string | null;
  course_code: string;
  title: string;
  description: string;
  resource_type: "PAST_QUESTION" | "NOTE" | "PDF" | "AUDIOBOOK";
  access_model: "FREE" | "BOOKING_INCLUDED" | "PAID";
  price_kobo: number;
  level_code: string | null;
  batch_label: string | null;
  publisher_name: string;
  publisher_verified: boolean;
  preview_text: string | null;
  file_url: string | null;
  page_count: number | null;
  duration_seconds: number | null;
  download_count: number;
  is_demo: boolean;
};

const learningCategories = ["All", "Tutors", "Past Questions", "Notes", "PDFs", "Audiobooks"];

const resourceCategory: Record<Resource["resource_type"], string> = {
  PAST_QUESTION: "Past Questions",
  NOTE: "Notes",
  PDF: "PDFs",
  AUDIOBOOK: "Audiobooks",
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
      accessibilityLabel={`${tutor.name}, ${tutor.isDemo ? "demo tutor" : tutor.verified ? "verified tutor" : "tutor"}. ${tutor.biography ?? "KampusOne tutor"}. Teaches ${tutor.courses.join(", ")}.`}
      style={styles.tutorCard}
    >
      <View style={styles.tutorCardTop}>
        <View style={styles.tutorAvatar}>
          <Text style={styles.tutorAvatarText}>{initials(tutor.name)}</Text>
        </View>
        {tutor.verified ? <VerificationBadge /> : tutor.isDemo ? <Text style={styles.demoLabel}>Demo</Text> : null}
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

function resourceMeta(resource: Resource) {
  if (resource.resource_type === "AUDIOBOOK" && resource.duration_seconds) {
    return `${Math.max(1, Math.round(resource.duration_seconds / 60))} min audio`;
  }
  if (resource.page_count) return `${resource.page_count} ${resource.page_count === 1 ? "page" : "pages"}`;
  return resource.access_model === "FREE" ? "Free preview" : "Access with tutorial";
}

function ResourceRow({ onOpen, resource }: { onOpen: () => void; resource: Resource }) {
  const icons = {
    PAST_QUESTION: "help-circle-outline",
    NOTE: "document-text-outline",
    PDF: "reader-outline",
    AUDIOBOOK: "headset-outline",
  } as const;
  return (
    <Pressable
      accessibilityLabel={`Open ${resource.title}, ${resourceCategory[resource.resource_type]}, by ${resource.publisher_name}`}
      accessibilityRole="button"
      onPress={onOpen}
      style={({ pressed }) => [styles.resourceRow, pressed && styles.resourceRowPressed]}
    >
      <View style={styles.resourceIcon}>
        <Ionicons color={theme.deepBrand} name={icons[resource.resource_type]} size={22} />
      </View>
      <View style={styles.resourceCopy}>
        <View style={styles.resourceEyebrowRow}>
          <Text style={styles.resourceCourse}>{resource.course_code}</Text>
          {resource.is_demo ? <Text style={styles.demoLabel}>Demo</Text> : null}
        </View>
        <Text numberOfLines={2} style={styles.resourceTitle}>{resource.title}</Text>
        <View style={styles.publisherRow}>
          <Text numberOfLines={1} style={styles.resourceMeta}>By {resource.publisher_name}</Text>
          {resource.publisher_verified ? <VerificationBadge /> : null}
        </View>
        <Text style={styles.resourceDetail}>{resource.level_code ?? resource.batch_label ?? "Campus resource"} · {resourceMeta(resource)}</Text>
      </View>
      <Ionicons color={theme.textSubtle} name="chevron-forward" size={18} />
    </Pressable>
  );
}

function ResourcePreview({ onClose, resource }: { onClose: () => void; resource: Resource | null }) {
  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={Boolean(resource)}>
      <View style={styles.previewBackdrop}>
        <Pressable accessibilityLabel="Close resource preview" accessibilityRole="button" onPress={onClose} style={styles.previewDismiss} />
        <View accessibilityViewIsModal style={styles.previewSheet}>
          <View style={styles.previewHandle} />
          <View style={styles.previewHeader}>
            <View style={styles.previewHeaderCopy}>
              <Text style={styles.previewCourse}>{resource?.course_code}</Text>
              <Text style={styles.previewTitle}>{resource?.title}</Text>
            </View>
            <Pressable accessibilityLabel="Close preview" accessibilityRole="button" onPress={onClose} style={styles.previewClose}>
              <Ionicons color={theme.text} name="close" size={23} />
            </Pressable>
          </View>
          <Text style={styles.previewPublisher}>By {resource?.publisher_name} · {resource ? resourceMeta(resource) : ""}</Text>
          <ScrollView contentContainerStyle={styles.previewContent} showsVerticalScrollIndicator={false}>
            <Text style={styles.previewDescription}>{resource?.description}</Text>
            <View style={styles.previewDivider} />
            <Text style={styles.previewLabel}>Preview</Text>
            <Text style={styles.previewText}>{resource?.preview_text ?? "A preview has not been added yet."}</Text>
          </ScrollView>
          {resource?.file_url ? (
            <Pressable
              accessibilityLabel={`Open full ${resource.title}`}
              accessibilityRole="link"
              onPress={() => void Linking.openURL(resource.file_url!)}
              style={({ pressed }) => [styles.openResourceButton, pressed && styles.bookButtonPressed]}
            >
              <Text style={styles.openResourceButtonText}>Open full resource</Text>
              <Ionicons color="#FFFFFF" name="open-outline" size={17} />
            </Pressable>
          ) : (
            <View style={styles.previewNotice}>
              <Ionicons color={theme.brandPressed} name="information-circle-outline" size={18} />
              <Text style={styles.previewNoticeText}>{resource?.is_demo ? "This is preview-only demo material. Replace it with an approved file when storage is ready." : "The publisher has provided a preview only."}</Text>
            </View>
          )}
        </View>
      </View>
    </Modal>
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
              accessibilityLabel={`By ${listing.tutor_name}${listing.tutor_verified ? ", verified tutor" : listing.is_demo ? ", demo tutor" : ""}`}
              numberOfLines={1}
              style={styles.listingTutor}
            >
              By {listing.tutor_name}
            </Text>
            {listing.tutor_verified ? <VerificationBadge /> : listing.is_demo ? <Text style={styles.demoLabel}>Demo</Text> : null}
          </View>
        </View>
      </View>

      <Text numberOfLines={3} style={styles.listingDescription}>{listing.description}</Text>

      <View style={styles.listingTrustRow}>
        <Ionicons color={theme.statusAttention} name="star" size={14} />
        <Text style={styles.listingTrustText}>{Number(listing.review_count) > 0 ? `${Number(listing.rating).toFixed(1)} · ${listing.review_count} reviews` : "New tutorial"}</Text>
        <View style={styles.trustDot} />
        <Text style={styles.listingTrustText}>{listing.location_text ?? displayFormat(listing.format)}</Text>
      </View>

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
  const [resources, setResources] = useState<Resource[]>([]);
  const [query, setQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [selectedFormat, setSelectedFormat] = useState("All");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [previewResource, setPreviewResource] = useState<Resource | null>(null);
  const [selectedWindows, setSelectedWindows] = useState<Record<string, string>>({});
  const bookingLock = useRef(false);

  const load = useCallback(async () => {
    try {
      setLoadError("");
      const catalogue = await api<{ listings: Listing[]; resources?: Resource[] }>("/v1/student/tutorials");
      setListings(catalogue.listings.map((listing) => ({
        ...listing,
        completed_sessions: Number(listing.completed_sessions ?? 0),
        is_demo: Boolean(listing.is_demo),
        location_text: listing.location_text ?? null,
        rating: Number(listing.rating ?? 0),
        review_count: Number(listing.review_count ?? 0),
        tutor_verified: Boolean(listing.tutor_verified),
      })));
      setResources(catalogue.resources ?? []);
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

  const filteredResources = useMemo(() => resources.filter((item) => {
    const needle = query.trim().toLowerCase();
    const matchesQuery = !needle || `${item.course_code} ${item.title} ${item.description} ${item.publisher_name}`.toLowerCase().includes(needle);
    const matchesCategory = selectedCategory === "All" || resourceCategory[item.resource_type] === selectedCategory;
    return matchesQuery && matchesCategory;
  }), [query, resources, selectedCategory]);

  const showListings = selectedCategory === "All" || selectedCategory === "Tutors";

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
        isDemo: listing.is_demo,
        name: listing.tutor_name,
        verified: listing.tutor_verified,
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
      const booking = await api<{ id: string; status: string; amountKobo: number }>("/v1/student/tutorial-bookings", {
        body: JSON.stringify({ availabilityWindowId, listingId: listing.id }),
        method: "POST",
      });
      savedBookingId = booking.id;
      if (booking.status === "CONFIRMED" || booking.amountKobo === 0) {
        const message = "Your free tutorial is booked. Open Purchases to see the session details.";
        setNotice(message);
        AccessibilityInfo.announceForAccessibility(message);
        await load();
        return;
      }
      const payment = await api<{ authorizationUrl: string }>("/v1/payments/initialize", {
        body: JSON.stringify({
          idempotencyKey: `tutorial-${booking.id}-${Date.now()}`,
          resourceId: booking.id,
          resourceType: "TUTORIAL_BOOKING",
        }),
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
  }, [load, selectedWindows]);

  const selectWindow = useCallback((listingId: string, windowId: string) => {
    void Haptics.selectionAsync();
    setSelectedWindows((current) => ({ ...current, [listingId]: windowId }));
  }, []);

  const hasActiveFilter = Boolean(query.trim()) || activeFormat !== "All" || selectedCategory !== "All";
  const canShowEmpty = Boolean(listings.length || resources.length) || (!loading && !loadError);

  return (
    <SafeAreaView edges={["top"]} style={styles.screen}>
      <FlatList
        contentContainerStyle={styles.listContent}
        data={showListings ? filtered : []}
        initialNumToRender={4}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        keyExtractor={(listing) => listing.id}
        ListEmptyComponent={canShowEmpty && !filteredResources.length ? <TutorialsEmptyState filtered={hasActiveFilter} /> : null}
        ListHeaderComponent={(
          <>
            <SearchField onChangeText={setQuery} placeholder="Search a course, topic or tutor" value={query} />
            <View style={styles.categories}>
              <FilterRow items={learningCategories} onSelect={setSelectedCategory} selected={selectedCategory} />
            </View>
            {showListings && formats.length > 1 ? (
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

            {showListings && filtered.length ? (
              <>
                <View style={styles.sectionHeader}>
                  <View>
                    <Text style={styles.sectionTitle}>Tutors</Text>
                    <Text style={styles.sectionSubtitle}>People teaching the sessions below</Text>
                  </View>
                  <View style={styles.approvedKey}>
                    <Ionicons name="people-outline" size={15} color={theme.brandPressed} />
                    <Text accessibilityLabel={`${tutors.length} tutors`} style={styles.approvedKeyText}>{tutors.length} available</Text>
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

                {filteredResources.length ? (
                  <View style={styles.resourceSection}>
                    <View style={styles.availableHeader}>
                      <View>
                        <Text style={styles.sectionTitle}>Study materials</Text>
                        <Text style={styles.sectionSubtitle}>Notes, questions, PDFs and audio</Text>
                      </View>
                      <Text style={styles.availableCount}>{filteredResources.length} resources</Text>
                    </View>
                    <View style={styles.resourceList}>
                      {filteredResources.map((resource) => (
                        <ResourceRow key={resource.id} onOpen={() => setPreviewResource(resource)} resource={resource} />
                      ))}
                    </View>
                  </View>
                ) : null}

                <View style={styles.availableHeader}>
                  <Text style={styles.sectionTitle}>Available tutorials</Text>
                  <Text style={styles.availableCount}>{filtered.length} {filtered.length === 1 ? "session" : "sessions"}</Text>
                </View>
              </>
            ) : filteredResources.length ? (
              <View style={styles.resourceSectionStandalone}>
                <View style={styles.availableHeader}>
                  <View>
                    <Text style={styles.sectionTitle}>{selectedCategory === "All" ? "Study materials" : selectedCategory}</Text>
                    <Text style={styles.sectionSubtitle}>Published for your university</Text>
                  </View>
                  <Text style={styles.availableCount}>{filteredResources.length} resources</Text>
                </View>
                <View style={styles.resourceList}>
                  {filteredResources.map((resource) => (
                    <ResourceRow key={resource.id} onOpen={() => setPreviewResource(resource)} resource={resource} />
                  ))}
                </View>
              </View>
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
      <ResourcePreview onClose={() => setPreviewResource(null)} resource={previewResource} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: theme.canvas, flex: 1 },
  catalogue: { alignSelf: "center" },
  listContent: { paddingBottom: 118, paddingHorizontal: 20, paddingTop: 10 },
  categories: { marginTop: 13 },
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
  demoLabel: { color: theme.brandPressed, fontFamily: theme.font.bold, fontSize: 8.5, letterSpacing: .35, textTransform: "uppercase" },
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
  listingTrustRow: { alignItems: "center", flexDirection: "row", gap: 5, marginTop: 9 },
  listingTrustText: { color: theme.textMuted, flexShrink: 1, fontFamily: theme.font.medium, fontSize: 9.5 },
  trustDot: { backgroundColor: "rgba(41,35,31,.24)", borderRadius: 2, height: 3, marginHorizontal: 2, width: 3 },
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
  resourceSection: { marginTop: 25 },
  resourceSectionStandalone: { marginTop: 23 },
  resourceList: { borderBottomColor: theme.border, borderBottomWidth: 1, marginTop: 10 },
  resourceRow: { alignItems: "center", borderTopColor: theme.border, borderTopWidth: 1, flexDirection: "row", gap: 12, minHeight: 104, paddingVertical: 14 },
  resourceRowPressed: { backgroundColor: "rgba(241,223,200,.28)", opacity: .82 },
  resourceIcon: { alignItems: "center", backgroundColor: theme.surfaceMuted, borderRadius: 15, height: 50, justifyContent: "center", width: 50 },
  resourceCopy: { flex: 1, minWidth: 0 },
  resourceEyebrowRow: { alignItems: "center", flexDirection: "row", gap: 7 },
  resourceCourse: { color: theme.brandPressed, fontFamily: theme.font.bold, fontSize: 9, letterSpacing: .65 },
  resourceTitle: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 14.5, lineHeight: 19, marginTop: 3 },
  publisherRow: { alignItems: "center", flexDirection: "row", gap: 5, marginTop: 4 },
  resourceMeta: { color: theme.textMuted, flexShrink: 1, fontFamily: theme.font.body, fontSize: 10.5 },
  resourceDetail: { color: theme.textSubtle, fontFamily: theme.font.body, fontSize: 9.5, marginTop: 3 },
  previewBackdrop: { backgroundColor: "rgba(41,35,31,.42)", flex: 1, justifyContent: "flex-end" },
  previewDismiss: { flex: 1 },
  previewSheet: { backgroundColor: theme.canvas, borderTopLeftRadius: 26, borderTopRightRadius: 26, maxHeight: "84%", minHeight: "62%", paddingBottom: 24, paddingHorizontal: 20 },
  previewHandle: { alignSelf: "center", backgroundColor: "rgba(41,35,31,.24)", borderRadius: 2, height: 4, marginBottom: 18, marginTop: 9, width: 42 },
  previewHeader: { alignItems: "flex-start", flexDirection: "row" },
  previewHeaderCopy: { flex: 1, paddingRight: 12 },
  previewCourse: { color: theme.brandPressed, fontFamily: theme.font.bold, fontSize: 10, letterSpacing: .7 },
  previewTitle: { color: theme.text, fontFamily: theme.font.display, fontSize: 24, lineHeight: 29, marginTop: 4 },
  previewClose: { alignItems: "center", height: 44, justifyContent: "center", marginRight: -8, marginTop: -8, width: 44 },
  previewPublisher: { color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 11.5, marginTop: 8 },
  previewContent: { paddingBottom: 24, paddingTop: 20 },
  previewDescription: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 13, lineHeight: 20 },
  previewDivider: { backgroundColor: theme.border, height: 1, marginVertical: 20 },
  previewLabel: { color: theme.brandPressed, fontFamily: theme.font.bold, fontSize: 10, letterSpacing: .75, textTransform: "uppercase" },
  previewText: { color: theme.text, fontFamily: theme.font.body, fontSize: 14, lineHeight: 23, marginTop: 10 },
  openResourceButton: { alignItems: "center", backgroundColor: theme.deepBrand, borderRadius: 14, flexDirection: "row", gap: 8, height: 48, justifyContent: "center" },
  openResourceButtonText: { color: "#FFFFFF", fontFamily: theme.font.bold, fontSize: 12 },
  previewNotice: { alignItems: "flex-start", backgroundColor: theme.surfaceMuted, borderRadius: 14, flexDirection: "row", gap: 8, padding: 12 },
  previewNoticeText: { color: theme.textMuted, flex: 1, fontFamily: theme.font.body, fontSize: 11.5, lineHeight: 17 },
  emptyState: { alignItems: "center", minHeight: 530, paddingHorizontal: 20, paddingTop: 74 },
  emptyIllustration: { height: 245, width: "100%" },
  emptyTitle: { color: theme.text, fontFamily: theme.font.display, fontSize: 24, marginTop: 18, textAlign: "center" },
  emptyBody: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 14, lineHeight: 21, marginTop: 8, maxWidth: 330, textAlign: "center" },
  pressed: { opacity: .72, transform: [{ scale: .97 }] },
});
