import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ApiError, api } from "@/src/lib/api";
import { theme } from "@/src/theme";

type Booking = {
  id: string;
  status: string;
  amount_kobo: number;
  scheduled_for: string | null;
  completion_available_at: string | null;
  created_at: string;
  title: string;
  course_code: string;
  tutor_name: string;
  review_id: string | null;
  review_rating: number | null;
};

type Order = {
  id: string;
  status: string;
  subtotal_kobo: number;
  delivery_fee_kobo: number;
  total_kobo: number;
  created_at: string;
  vendor_name: string;
  delivery_code?: string;
};

type Purchases = { tutorialBookings: Booking[]; orders: Order[] };
type DisputeTarget = { resourceType: "TUTORIAL_BOOKING" | "STORE_ORDER"; id: string; title: string };
type PurchaseItem = Booking | Order;
type PurchaseSection = {
  count: number;
  key: "bookings" | "orders";
  kind: "booking" | "order";
  title: string;
};

const BOOKING_DISPUTE_STATUSES = new Set(["CONFIRMED", "COMPLETED"]);
const ORDER_DISPUTE_STATUSES = new Set(["PAID", "ACCEPTED", "READY", "IN_DELIVERY", "DELIVERED"]);
const POSITIVE_STATUSES = new Set(["COMPLETED", "DELIVERED"]);
const ATTENTION_STATUSES = new Set(["PENDING_PAYMENT", "PENDING", "READY"]);
const CRITICAL_STATUSES = new Set(["CANCELLED", "FAILED", "REJECTED", "REFUNDED"]);

const NAIRA_FORMATTER = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 0,
});
const DATE_FORMATTER = new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "short", year: "numeric" });
const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-NG", {
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});

const naira = (kobo: number) => NAIRA_FORMATTER.format(Number(kobo) / 100);
const date = (value: string) => DATE_FORMATTER.format(new Date(value));
const dateTime = (value: string) => DATE_TIME_FORMATTER.format(new Date(value));

const statusLabel = (status: string) => status.replaceAll("_", " ").toLowerCase();

function statusColor(status: string) {
  if (POSITIVE_STATUSES.has(status)) return theme.statusPositive;
  if (ATTENTION_STATUSES.has(status)) return theme.statusAttention;
  if (CRITICAL_STATUSES.has(status)) return theme.deepBrand;
  return theme.info;
}

function SectionHeading({ title, count }: { title: string; count: number }) {
  return (
    <View style={styles.sectionHeading}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionCount}>{count} {count === 1 ? "record" : "records"}</Text>
    </View>
  );
}

function Status({ value }: { value: string }) {
  const color = statusColor(value);
  const label = statusLabel(value);
  return (
    <View accessible accessibilityLabel={`Status: ${label}`} style={styles.statusRow}>
      <View style={[styles.statusDot, { backgroundColor: color }]} />
      <Text style={[styles.statusText, { color }]}>{label}</Text>
    </View>
  );
}

function PrimaryAction({
  accessibilityLabel,
  busy,
  disabled,
  label,
  onPress,
}: {
  accessibilityLabel: string;
  busy: boolean;
  disabled: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ busy, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.primaryAction, disabled && styles.actionDisabled, pressed && !disabled && styles.pressed]}
    >
      {busy ? <ActivityIndicator color="#FFFFFF" size="small" /> : null}
      <Text style={styles.primaryActionText}>{busy ? "Please wait…" : label}</Text>
    </Pressable>
  );
}

function ProblemAction({ disabled, label, onPress }: { disabled: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [styles.problemAction, disabled && styles.secondaryDisabled, pressed && !disabled && styles.pressed]}
    >
      <Ionicons name="flag-outline" size={16} color={theme.brandPressed} />
      <Text style={styles.problemActionText}>Report a problem</Text>
    </Pressable>
  );
}

function BookingRecord({
  busyId,
  currentTime,
  first,
  item,
  last,
  onConfirm,
  onCancel,
  onDispute,
  onPay,
  onReview,
}: {
  busyId: string;
  currentTime: number;
  first: boolean;
  item: Booking;
  last: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onDispute: () => void;
  onPay: () => void;
  onReview: () => void;
}) {
  const itemBusy = busyId === item.id;
  const canCancel = item.status === "CONFIRMED" && Boolean(item.scheduled_for) && Date.parse(item.scheduled_for!) > currentTime;
  const canReview = item.status === "COMPLETED" && !item.review_id;
  const hasPrimaryAction = item.status === "PENDING_PAYMENT" || item.status === "CONFIRMED" || canReview;
  const canDispute = BOOKING_DISPUTE_STATUSES.has(item.status);
  const completionAvailableTime = item.completion_available_at
    ? Date.parse(item.completion_available_at)
    : Number.NaN;
  const hasValidCompletionTime = Number.isFinite(completionAvailableTime);
  const completionAvailable = hasValidCompletionTime && completionAvailableTime <= currentTime;
  const completionHint = hasValidCompletionTime
    ? `Completion unlocks after the tutorial ends, ${dateTime(item.completion_available_at!)}.`
    : "Completion is unavailable because this booking has no recorded tutorial end time. Contact support if this looks wrong.";

  return (
    <View style={[styles.record, first && styles.recordFirst, last && styles.recordLast, !last && styles.recordDivider]}>
      <View style={styles.recordTop}>
        <View style={styles.bookingMarker}>
          <Ionicons name="school-outline" size={21} color={theme.brandPressed} />
        </View>
        <View style={styles.recordCopy}>
          <Text style={styles.recordOverline}>{item.course_code}</Text>
          <Text style={styles.recordTitle}>{item.title}</Text>
          <Text style={styles.recordMeta}>{item.tutor_name}</Text>
        </View>
        <View style={styles.recordValue}>
          <Text style={styles.amount}>{naira(item.amount_kobo)}</Text>
          <Status value={item.status} />
        </View>
      </View>

      <View style={styles.detailLine}>
        <Ionicons name={item.scheduled_for ? "calendar-outline" : "receipt-outline"} size={15} color={theme.textMuted} />
        <Text style={styles.detailText}>
          {item.scheduled_for ? `Scheduled for ${dateTime(item.scheduled_for)}` : `Booked ${date(item.created_at)}`}
        </Text>
      </View>

      {hasPrimaryAction || canDispute ? (
        <View style={styles.recordActions}>
          {item.status === "PENDING_PAYMENT" ? (
            <PrimaryAction
              accessibilityLabel={`Pay securely for ${item.course_code} tutorial`}
              busy={itemBusy}
              disabled={Boolean(busyId)}
              label="Pay securely"
              onPress={onPay}
            />
          ) : null}
          {item.status === "CONFIRMED" ? (
            <PrimaryAction
              accessibilityLabel={completionAvailable
                ? `Confirm ${item.course_code} tutorial is completed`
                : `${item.course_code} tutorial completion unavailable. ${completionHint}`}
              busy={itemBusy}
              disabled={Boolean(busyId) || !completionAvailable}
              label={completionAvailable ? "Confirm completed" : "Available after session"}
              onPress={onConfirm}
            />
          ) : null}
          {canReview ? (
            <PrimaryAction
              accessibilityLabel={`Review ${item.course_code} tutorial`}
              busy={itemBusy}
              disabled={Boolean(busyId)}
              label="Leave a review"
              onPress={onReview}
            />
          ) : null}
          {canCancel ? (
            <Pressable
              accessibilityLabel={`Cancel ${item.course_code} tutorial booking`}
              accessibilityRole="button"
              accessibilityState={{ disabled: Boolean(busyId) }}
              disabled={Boolean(busyId)}
              onPress={onCancel}
              style={({ pressed }) => [styles.cancelAction, pressed && !busyId && styles.pressed]}
            >
              <Text style={styles.cancelActionText}>Cancel booking</Text>
            </Pressable>
          ) : null}
          {canDispute ? (
            <ProblemAction
              disabled={Boolean(busyId)}
              label={`Report a problem with ${item.course_code} tutorial`}
              onPress={onDispute}
            />
          ) : null}
        </View>
      ) : null}

      {item.status === "CONFIRMED" && !completionAvailable ? (
        <View accessible accessibilityLabel={completionHint} style={styles.completionHint}>
          <Ionicons name="time-outline" size={15} color={theme.textMuted} />
          <Text style={styles.completionHintText}>{completionHint}</Text>
        </View>
      ) : null}
      {item.review_id ? (
        <View style={styles.reviewedRow}>
          <Ionicons name="star" size={14} color={theme.statusAttention} />
          <Text style={styles.reviewedText}>You rated this tutorial {item.review_rating}/5</Text>
        </View>
      ) : null}
    </View>
  );
}

function OrderRecord({
  busyId,
  first,
  item,
  last,
  onDispute,
  onPay,
}: {
  busyId: string;
  first: boolean;
  item: Order;
  last: boolean;
  onDispute: () => void;
  onPay: () => void;
}) {
  const itemBusy = busyId === item.id;
  const canDispute = ORDER_DISPUTE_STATUSES.has(item.status);
  const orderReference = item.id.slice(0, 8);

  return (
    <View style={[styles.record, first && styles.recordFirst, last && styles.recordLast, !last && styles.recordDivider]}>
      <View style={styles.recordTop}>
        <View style={styles.orderMarker}>
          <Ionicons name="bag-handle-outline" size={21} color={theme.text} />
        </View>
        <View style={styles.recordCopy}>
          <Text style={styles.recordOverline}>ORDER #{orderReference}</Text>
          <Text style={styles.recordTitle}>{item.vendor_name}</Text>
          <Text style={styles.recordMeta}>Placed {date(item.created_at)}</Text>
        </View>
        <View style={styles.recordValue}>
          <Text style={styles.amount}>{naira(item.total_kobo)}</Text>
          <Status value={item.status} />
        </View>
      </View>

      <View style={styles.orderBreakdown}>
        <Text style={styles.breakdownLabel}>Items {naira(item.subtotal_kobo)}</Text>
        <View style={styles.breakdownDot} />
        <Text style={styles.breakdownLabel}>Delivery {naira(item.delivery_fee_kobo)}</Text>
      </View>

      {item.delivery_code ? (
        <View accessible accessibilityLabel={`Delivery code ${item.delivery_code}`} style={styles.deliveryCode}>
          <View style={styles.deliveryCopy}>
            <Text style={styles.deliveryLabel}>DELIVERY CODE</Text>
            <Text style={styles.deliveryHelp}>Share only when your order arrives.</Text>
          </View>
          <Text selectable style={styles.deliveryValue}>{item.delivery_code}</Text>
        </View>
      ) : null}

      {item.status === "PENDING_PAYMENT" || canDispute ? (
        <View style={styles.recordActions}>
          {item.status === "PENDING_PAYMENT" ? (
            <PrimaryAction
              accessibilityLabel={`Pay securely for order ${orderReference}`}
              busy={itemBusy}
              disabled={Boolean(busyId)}
              label="Pay securely"
              onPress={onPay}
            />
          ) : null}
          {canDispute ? (
            <ProblemAction
              disabled={Boolean(busyId)}
              label={`Report a problem with order ${orderReference}`}
              onPress={onDispute}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function EmptyIllustration() {
  return (
    <View accessible={false} importantForAccessibility="no-hide-descendants" style={styles.emptyIllustration}>
      <View style={styles.illustrationHalo} />
      <View style={styles.illustrationReceipt}>
        <View style={styles.receiptHandle}>
          <Ionicons name="bag-handle-outline" size={25} color={theme.brandPressed} />
        </View>
        <View style={styles.receiptLineLong} />
        <View style={styles.receiptLineShort} />
        <View style={styles.receiptRule} />
        <View style={styles.receiptTotal} />
      </View>
      <View style={styles.illustrationTicket}>
        <Ionicons name="school-outline" size={26} color="#FFFFFF" />
      </View>
      <View style={styles.illustrationSpark} />
      <View style={styles.illustrationSparkSmall} />
    </View>
  );
}

function EmptyPurchases({ onRefresh }: { onRefresh: () => void }) {
  return (
    <View style={styles.emptyState}>
      <EmptyIllustration />
      <Text style={styles.emptyTitle}>Nothing here yet</Text>
      <Text style={styles.emptyBody}>Your tutorial bookings and campus store orders will be kept here after you make them.</Text>
      <Pressable
        accessibilityLabel="Refresh purchases"
        accessibilityRole="button"
        onPress={onRefresh}
        style={({ pressed }) => [styles.emptyAction, pressed && styles.pressed]}
      >
        <Ionicons name="refresh" size={17} color="#FFFFFF" />
        <Text style={styles.emptyActionText}>Refresh purchases</Text>
      </Pressable>
    </View>
  );
}

function SectionEmpty({ kind }: { kind: "booking" | "order" }) {
  const booking = kind === "booking";
  return (
    <View style={styles.sectionEmpty}>
      <View style={styles.sectionEmptyIcon}>
        <Ionicons name={booking ? "calendar-outline" : "bag-handle-outline"} size={22} color={theme.brandPressed} />
      </View>
      <View style={styles.sectionEmptyCopy}>
        <Text style={styles.sectionEmptyTitle}>No {booking ? "tutorial bookings" : "store orders"}</Text>
        <Text style={styles.sectionEmptyBody}>New {booking ? "bookings" : "orders"} will appear here.</Text>
      </View>
    </View>
  );
}

function LoadingPurchases() {
  return (
    <View accessibilityLabel="Loading bookings and orders" accessibilityRole="progressbar" style={styles.loadingState}>
      <View style={styles.loadingLead}>
        <ActivityIndicator color={theme.brandPressed} />
        <Text style={styles.loadingText}>Loading bookings and orders…</Text>
      </View>
      {[0, 1].map((item) => (
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" key={item} style={styles.skeletonRecord}>
          <View style={styles.skeletonIcon} />
          <View style={styles.skeletonCopy}>
            <View style={styles.skeletonLabel} />
            <View style={styles.skeletonTitle} />
            <View style={styles.skeletonMeta} />
          </View>
          <View style={styles.skeletonAmount} />
        </View>
      ))}
    </View>
  );
}

export default function PurchasesScreen() {
  const { width: windowWidth } = useWindowDimensions();
  const contentWidth = Math.min(windowWidth, 540);
  const [data, setData] = useState<Purchases>({ tutorialBookings: [], orders: [] });
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [completionTarget, setCompletionTarget] = useState<Booking | null>(null);
  const [reviewTarget, setReviewTarget] = useState<Booking | null>(null);
  const [rating, setRating] = useState(5);
  const [reviewBody, setReviewBody] = useState("");
  const [dispute, setDispute] = useState<DisputeTarget | null>(null);
  const [reason, setReason] = useState("");
  const [reasonFocused, setReasonFocused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (active) setReducedMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReducedMotion);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    const now = Date.now();
    const nextCompletionTime = data.tutorialBookings.reduce((next, booking) => {
      if (booking.status !== "CONFIRMED" || !booking.completion_available_at) return next;
      const completionAvailableTime = Date.parse(booking.completion_available_at);
      if (!Number.isFinite(completionAvailableTime) || completionAvailableTime <= now) return next;
      return next === null || completionAvailableTime < next ? completionAvailableTime : next;
    }, null as number | null);
    if (nextCompletionTime === null) return;

    const timer = setTimeout(
      () => setCurrentTime(Date.now()),
      Math.min(Math.max(nextCompletionTime - now + 100, 100), 60_000),
    );
    return () => clearTimeout(timer);
  }, [currentTime, data.tutorialBookings]);

  const load = useCallback(async () => {
    setError("");
    try {
      setData(await api<Purchases>("/v1/student/purchases"));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Purchases could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    setCurrentTime(Date.now());
    setLoading(true);
    void load();
  }, [load]));

  const refresh = useCallback(() => {
    setLoading(true);
    void load();
  }, [load]);

  async function pay(resourceType: DisputeTarget["resourceType"], resourceId: string) {
    setBusy(resourceId);
    setError("");
    try {
      const payment = await api<{ authorizationUrl: string }>("/v1/payments/initialize", {
        method: "POST",
        body: JSON.stringify({
          idempotencyKey: `resume-${resourceId}-${Date.now()}`,
          resourceType,
          resourceId,
        }),
      });
      await Linking.openURL(payment.authorizationUrl);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Payment could not be started.");
    } finally {
      setBusy("");
    }
  }

  async function confirmBooking(id: string) {
    setBusy(id);
    setError("");
    try {
      const result = await api<{ status: string }>(`/v1/student/tutorial-bookings/${id}/confirm`, {
        method: "POST",
        body: JSON.stringify({ confirmed: true }),
      });
      setNotice(result.status === "COMPLETED"
        ? "Tutorial completion confirmed."
        : "Your confirmation is saved. Waiting for the tutor.");
      await load();
      setCompletionTarget(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Completion could not be confirmed.");
    } finally {
      setBusy("");
    }
  }

  async function cancelBooking(id: string) {
    setBusy(id);
    setError("");
    try {
      const result = await api<{ status: string; refundReviewRequired: boolean }>(`/v1/student/tutorial-bookings/${id}/cancel`, {
        method: "POST",
        body: JSON.stringify({ reason: "My plans changed" }),
      });
      setNotice(result.refundReviewRequired
        ? "Your cancellation was sent to support for a refund review."
        : "Your tutorial booking was cancelled.");
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The booking could not be cancelled.");
    } finally {
      setBusy("");
    }
  }

  function requestCancellation(booking: Booking) {
    Alert.alert(
      "Cancel this tutorial?",
      "Your space will be released. Paid bookings may require a support review before any refund.",
      [
        { style: "cancel", text: "Keep booking" },
        { style: "destructive", text: "Cancel tutorial", onPress: () => void cancelBooking(booking.id) },
      ],
    );
  }

  async function submitReview() {
    if (!reviewTarget) return;
    setBusy(reviewTarget.id);
    setError("");
    try {
      await api("/v1/student/tutorial-reviews", {
        method: "POST",
        body: JSON.stringify({
          bookingId: reviewTarget.id,
          rating,
          body: reviewBody.trim() || null,
        }),
      });
      setNotice("Thanks — your verified tutorial review is now published.");
      setReviewTarget(null);
      setReviewBody("");
      setRating(5);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Your review could not be published.");
    } finally {
      setBusy("");
    }
  }

  async function openDispute() {
    if (!dispute) return;
    setBusy(dispute.id);
    setError("");
    try {
      await api("/v1/student/disputes", {
        method: "POST",
        body: JSON.stringify({
          resourceType: dispute.resourceType,
          resourceId: dispute.id,
          category: "OTHER",
          reason,
        }),
      });
      setNotice("Your dispute is open and the related earnings are frozen for review.");
      setDispute(null);
      setReason("");
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Dispute could not be opened.");
    } finally {
      setBusy("");
    }
  }

  const hasPurchases = data.tutorialBookings.length > 0 || data.orders.length > 0;
  const sections = useMemo(() => hasPurchases ? [
    {
      count: data.tutorialBookings.length,
      data: data.tutorialBookings,
      key: "bookings" as const,
      kind: "booking" as const,
      title: "Tutorial bookings",
    },
    {
      count: data.orders.length,
      data: data.orders,
      key: "orders" as const,
      kind: "order" as const,
      title: "Store orders",
    },
  ] : [], [data.orders, data.tutorialBookings, hasPurchases]);
  const reasonLength = reason.trim().length;
  const completionBusy = Boolean(completionTarget && busy === completionTarget.id);
  const reviewBusy = Boolean(reviewTarget && busy === reviewTarget.id);
  const disputeBusy = Boolean(dispute && busy === dispute.id);
  const disputeDisabled = reasonLength < 10 || Boolean(busy);

  return (
    <SafeAreaView edges={["top"]} style={styles.safe}>
      <View pointerEvents="none" style={styles.ambientTop} />
      <View pointerEvents="none" style={styles.ambientBottom} />
      <SectionList<PurchaseItem, PurchaseSection>
        contentContainerStyle={[styles.content, { width: contentWidth }]}
        initialNumToRender={8}
        keyExtractor={(item) => `${"course_code" in item ? "booking" : "order"}-${item.id}`}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={loading ? (
          <LoadingPurchases />
        ) : error ? (
          <View accessibilityRole="alert" style={styles.errorState}>
            <View style={styles.errorIcon}>
              <Ionicons name="cloud-offline-outline" size={29} color={theme.deepBrand} />
            </View>
            <Text style={styles.errorTitle}>Purchases are unavailable</Text>
            <Text style={styles.errorBody}>{error}</Text>
            <Pressable
              accessibilityLabel="Try loading purchases again"
              accessibilityRole="button"
              onPress={refresh}
              style={({ pressed }) => [styles.retryAction, pressed && styles.pressed]}
            >
              <Text style={styles.retryActionText}>Try again</Text>
            </Pressable>
          </View>
        ) : (
          <EmptyPurchases onRefresh={refresh} />
        )}
        ListHeaderComponent={(
          <>
            <View style={styles.header}>
              <Pressable
                accessibilityLabel="Go back"
                accessibilityRole="button"
                hitSlop={4}
                onPress={() => router.back()}
                style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
              >
                <Ionicons name="arrow-back" size={23} color={theme.text} />
              </Pressable>
              <View style={styles.headerCopy}>
                <Text style={styles.heading}>Purchases</Text>
                <Text style={styles.headerSubtitle}>Bookings and campus orders</Text>
              </View>
              <Pressable
                accessibilityLabel={loading ? "Refreshing purchases" : "Refresh purchases"}
                accessibilityRole="button"
                accessibilityState={{ busy: loading, disabled: loading }}
                disabled={loading}
                hitSlop={4}
                onPress={refresh}
                style={({ pressed }) => [styles.headerButton, loading && styles.secondaryDisabled, pressed && !loading && styles.pressed]}
              >
                {loading ? <ActivityIndicator color={theme.brandPressed} size="small" /> : <Ionicons name="refresh" size={21} color={theme.brandPressed} />}
              </Pressable>
            </View>

            {notice ? (
              <View accessibilityRole="alert" style={styles.notice}>
                <Ionicons name="checkmark-circle-outline" size={20} color={theme.statusPositive} />
                <Text style={styles.noticeText}>{notice}</Text>
                <Pressable accessibilityLabel="Dismiss message" accessibilityRole="button" onPress={() => setNotice("")} style={styles.dismissButton}>
                  <Ionicons name="close" size={18} color={theme.textMuted} />
                </Pressable>
              </View>
            ) : null}

            {error && !dispute && hasPurchases ? (
              <View accessibilityRole="alert" style={styles.inlineError}>
                <Ionicons name="alert-circle-outline" size={20} color={theme.deepBrand} />
                <Text style={styles.inlineErrorText}>{error}</Text>
                <Pressable accessibilityLabel="Dismiss error" accessibilityRole="button" onPress={() => setError("")} style={styles.dismissButton}>
                  <Ionicons name="close" size={18} color={theme.deepBrand} />
                </Pressable>
              </View>
            ) : null}
          </>
        )}
        maxToRenderPerBatch={8}
        onRefresh={refresh}
        refreshing={loading && hasPurchases}
        removeClippedSubviews={Platform.OS === "android"}
        renderItem={({ item, index, section }) => {
          const first = index === 0;
          const last = index === section.data.length - 1;
          if (section.kind === "booking") {
            const booking = item as Booking;
            return (
              <BookingRecord
                busyId={busy}
                currentTime={currentTime}
                first={first}
                item={booking}
                last={last}
                onConfirm={() => {
                  setError("");
                  setCompletionTarget(booking);
                }}
                onCancel={() => requestCancellation(booking)}
                onDispute={() => {
                  setError("");
                  setDispute({ resourceType: "TUTORIAL_BOOKING", id: booking.id, title: booking.title });
                }}
                onPay={() => void pay("TUTORIAL_BOOKING", booking.id)}
                onReview={() => {
                  setError("");
                  setReviewTarget(booking);
                }}
              />
            );
          }

          const order = item as Order;
          return (
            <OrderRecord
              busyId={busy}
              first={first}
              item={order}
              last={last}
              onDispute={() => {
                setError("");
                setDispute({ resourceType: "STORE_ORDER", id: order.id, title: `Order #${order.id.slice(0, 8)}` });
              }}
              onPay={() => void pay("STORE_ORDER", order.id)}
            />
          );
        }}
        renderSectionFooter={({ section }) => (
          <View>
            {section.data.length === 0 ? <SectionEmpty kind={section.kind} /> : null}
            <View style={styles.sectionGap} />
          </View>
        )}
        renderSectionHeader={({ section }) => <SectionHeading count={section.count} title={section.title} />}
        sections={sections}
        showsVerticalScrollIndicator={false}
        stickySectionHeadersEnabled={false}
        style={styles.list}
        windowSize={7}
      />

      <Modal
        animationType={reducedMotion ? "none" : "fade"}
        onRequestClose={() => {
          if (!completionBusy) setCompletionTarget(null);
        }}
        statusBarTranslucent
        transparent
        visible={Boolean(completionTarget)}
      >
        <View style={styles.modalBackdrop}>
          <Pressable
            accessibilityLabel="Close completion confirmation"
            accessibilityRole="button"
            disabled={completionBusy}
            onPress={() => setCompletionTarget(null)}
            style={styles.modalDismissArea}
          />
          <View
            accessibilityViewIsModal
            onAccessibilityEscape={() => {
              if (!completionBusy) setCompletionTarget(null);
            }}
            style={[styles.modalSheet, styles.completionSheet]}
          >
            <View style={styles.sheetHandle} />
            <View style={styles.completionIcon}>
              <Ionicons name="checkmark-done-outline" size={27} color={theme.brandPressed} />
            </View>
            <Text style={styles.completionTitle}>Confirm tutorial completion?</Text>
            <Text style={styles.completionTarget}>{completionTarget?.course_code} · {completionTarget?.title}</Text>
            <Text style={styles.completionBody}>
              Only confirm if the tutorial was delivered. This is final. Once the tutor also confirms, it can move their earnings toward payout and start the 48-hour dispute period.
            </Text>

            {error ? (
              <View accessibilityRole="alert" style={styles.modalError}>
                <Ionicons name="alert-circle-outline" size={18} color={theme.deepBrand} />
                <Text style={styles.modalErrorText}>{error}</Text>
              </View>
            ) : null}

            <View style={styles.completionActions}>
              <Pressable
                accessibilityLabel="Cancel completion confirmation"
                accessibilityRole="button"
                accessibilityState={{ disabled: completionBusy }}
                disabled={completionBusy}
                onPress={() => setCompletionTarget(null)}
                style={({ pressed }) => [styles.completionCancel, completionBusy && styles.secondaryDisabled, pressed && !completionBusy && styles.pressed]}
              >
                <Text style={styles.completionCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                accessibilityLabel="Confirm tutorial was completed"
                accessibilityRole="button"
                accessibilityState={{ busy: completionBusy, disabled: completionBusy }}
                disabled={completionBusy}
                onPress={() => {
                  if (completionTarget) void confirmBooking(completionTarget.id);
                }}
                style={({ pressed }) => [styles.completionConfirm, completionBusy && styles.actionDisabled, pressed && !completionBusy && styles.pressed]}
              >
                {completionBusy ? <ActivityIndicator color="#FFFFFF" size="small" /> : null}
                <Text style={styles.completionConfirmText}>{completionBusy ? "Confirming…" : "Yes, confirm"}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        animationType={reducedMotion ? "none" : "slide"}
        onRequestClose={() => { if (!reviewBusy) setReviewTarget(null); }}
        statusBarTranslucent
        transparent
        visible={Boolean(reviewTarget)}
      >
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.modalBackdrop}>
          <Pressable accessibilityLabel="Close tutorial review" accessibilityRole="button" disabled={reviewBusy} onPress={() => setReviewTarget(null)} style={styles.modalDismissArea} />
          <View accessibilityViewIsModal style={styles.modalSheet}>
            <View style={styles.sheetHandle} />
            <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
              <View style={styles.modalTop}>
                <View style={styles.modalHeadingCopy}>
                  <Text style={styles.modalTitle}>Review this tutorial</Text>
                  <Text numberOfLines={1} style={styles.modalTarget}>{reviewTarget?.course_code} · {reviewTarget?.title}</Text>
                </View>
                <Pressable accessibilityLabel="Close review" accessibilityRole="button" disabled={reviewBusy} onPress={() => setReviewTarget(null)} style={styles.modalClose}>
                  <Ionicons name="close" size={23} color={theme.text} />
                </Pressable>
              </View>
              <Text style={styles.modalBody}>Your rating is tied to a completed booking, which helps other students judge the session fairly.</Text>
              <Text style={styles.ratingLabel}>Your rating</Text>
              <View accessibilityRole="radiogroup" style={styles.ratingRow}>
                {[1, 2, 3, 4, 5].map((value) => (
                  <Pressable
                    accessibilityLabel={`${value} out of 5 stars`}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: rating === value, disabled: reviewBusy }}
                    disabled={reviewBusy}
                    key={value}
                    onPress={() => setRating(value)}
                    style={({ pressed }) => [styles.ratingButton, rating === value && styles.ratingButtonSelected, pressed && styles.pressed]}
                  >
                    <Ionicons name={rating >= value ? "star" : "star-outline"} size={23} color={rating >= value ? theme.statusAttention : theme.textMuted} />
                  </Pressable>
                ))}
              </View>
              <Text style={styles.ratingLabel}>Short note (optional)</Text>
              <TextInput
                editable={!reviewBusy}
                maxLength={1000}
                multiline
                onChangeText={setReviewBody}
                placeholder="What was useful?"
                placeholderTextColor={theme.textMuted}
                style={styles.textarea}
                textAlignVertical="top"
                value={reviewBody}
              />
              {error ? <Text accessibilityRole="alert" style={styles.formReviewError}>{error}</Text> : null}
              <Pressable
                accessibilityLabel="Publish tutorial review"
                accessibilityRole="button"
                accessibilityState={{ busy: reviewBusy, disabled: reviewBusy }}
                disabled={reviewBusy}
                onPress={() => void submitReview()}
                style={({ pressed }) => [styles.submitAction, reviewBusy && styles.actionDisabled, pressed && !reviewBusy && styles.pressed]}
              >
                {reviewBusy ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Ionicons name="send-outline" size={18} color="#FFFFFF" />}
                <Text style={styles.submitActionText}>{reviewBusy ? "Publishing…" : "Publish review"}</Text>
              </Pressable>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        animationType={reducedMotion ? "none" : "slide"}
        onRequestClose={() => setDispute(null)}
        statusBarTranslucent
        transparent
        visible={Boolean(dispute)}
      >
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.modalBackdrop}>
          <Pressable accessibilityLabel="Close dispute form" accessibilityRole="button" onPress={() => setDispute(null)} style={styles.modalDismissArea} />
          <View accessibilityViewIsModal onAccessibilityEscape={() => setDispute(null)} style={styles.modalSheet}>
            <View style={styles.sheetHandle} />
            <ScrollView
              contentContainerStyle={styles.modalContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.modalTop}>
                <View style={styles.modalHeadingCopy}>
                  <Text style={styles.modalTitle}>Report a problem</Text>
                  <Text numberOfLines={1} style={styles.modalTarget}>{dispute?.title}</Text>
                </View>
                <Pressable
                  accessibilityLabel="Close dispute form"
                  accessibilityRole="button"
                  hitSlop={4}
                  onPress={() => setDispute(null)}
                  style={({ pressed }) => [styles.modalClose, pressed && styles.pressed]}
                >
                  <Ionicons name="close" size={23} color={theme.text} />
                </Pressable>
              </View>
              <Text style={styles.modalBody}>Tell support what happened. The related earnings will be frozen while the evidence is reviewed.</Text>

              {error ? (
                <View accessibilityRole="alert" style={styles.modalError}>
                  <Ionicons name="alert-circle-outline" size={18} color={theme.deepBrand} />
                  <Text style={styles.modalErrorText}>{error}</Text>
                </View>
              ) : null}

              <View style={styles.inputHeader}>
                <Text style={styles.inputLabel}>What happened?</Text>
                <Text style={[styles.inputCount, reasonLength >= 10 && styles.inputCountValid]}>
                  {reasonLength >= 10 ? `${reasonLength} characters` : `${reasonLength}/10 minimum`}
                </Text>
              </View>
              <TextInput
                accessibilityHint="Enter at least 10 characters"
                accessibilityLabel="Describe the problem"
                editable={!disputeBusy}
                multiline
                onBlur={() => setReasonFocused(false)}
                onChangeText={setReason}
                onFocus={() => setReasonFocused(true)}
                placeholder="Describe the issue clearly"
                placeholderTextColor={theme.textMuted}
                style={[
                  styles.textarea,
                  reasonLength > 0 && reasonLength < 10 && styles.textareaInvalid,
                  reasonLength >= 10 && styles.textareaValid,
                  reasonFocused && styles.textareaFocused,
                  disputeBusy && styles.textareaDisabled,
                ]}
                textAlignVertical="top"
                value={reason}
              />
              <Text style={styles.inputHelp}>Include what you expected, what happened, and any relevant time or handoff detail.</Text>

              <Pressable
                accessibilityLabel="Open dispute"
                accessibilityRole="button"
                accessibilityState={{ busy: disputeBusy, disabled: disputeDisabled }}
                disabled={disputeDisabled}
                onPress={() => void openDispute()}
                style={({ pressed }) => [styles.submitAction, disputeDisabled && styles.actionDisabled, pressed && !disputeDisabled && styles.pressed]}
              >
                {disputeBusy ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Ionicons name="shield-checkmark-outline" size={18} color="#FFFFFF" />}
                <Text style={styles.submitActionText}>{disputeBusy ? "Opening dispute…" : "Open dispute"}</Text>
              </Pressable>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { backgroundColor: theme.canvas, flex: 1, overflow: "hidden" },
  ambientTop: { backgroundColor: "rgba(233,177,142,0.13)", borderRadius: 130, height: 250, position: "absolute", right: -150, top: -122, width: 250 },
  ambientBottom: { backgroundColor: "rgba(241,223,200,0.20)", borderRadius: 120, height: 220, left: -170, position: "absolute", top: 620, width: 220 },
  list: { flex: 1 },
  content: { alignSelf: "center", flexGrow: 1, paddingBottom: 118, paddingHorizontal: 20 },
  header: { alignItems: "center", flexDirection: "row", marginBottom: 24, minHeight: 66, paddingTop: 4 },
  headerButton: { alignItems: "center", height: 44, justifyContent: "center", width: 44 },
  headerCopy: { flex: 1, paddingHorizontal: 8 },
  heading: { color: theme.text, fontFamily: theme.font.display, fontSize: 27, letterSpacing: -0.45, lineHeight: 32 },
  headerSubtitle: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 12.5, lineHeight: 18, marginTop: 1 },
  notice: { alignItems: "flex-start", backgroundColor: "rgba(75,123,84,0.09)", borderRadius: 14, flexDirection: "row", gap: 9, marginBottom: 14, paddingHorizontal: 13, paddingVertical: 12 },
  noticeText: { color: theme.statusPositive, flex: 1, fontFamily: theme.font.medium, fontSize: 12.5, lineHeight: 18 },
  inlineError: { alignItems: "flex-start", backgroundColor: "rgba(168,70,46,0.08)", borderRadius: 14, flexDirection: "row", gap: 9, marginBottom: 14, paddingHorizontal: 13, paddingVertical: 12 },
  inlineErrorText: { color: theme.deepBrand, flex: 1, fontFamily: theme.font.medium, fontSize: 12.5, lineHeight: 18 },
  dismissButton: { alignItems: "center", height: 44, justifyContent: "center", marginBottom: -12, marginRight: -11, marginTop: -12, width: 44 },
  sectionHeading: { alignItems: "baseline", flexDirection: "row", justifyContent: "space-between", marginBottom: 11 },
  sectionTitle: { color: theme.text, fontFamily: theme.font.display, fontSize: 19, lineHeight: 24 },
  sectionCount: { color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 11.5 },
  sectionGap: { height: 28 },
  record: { backgroundColor: theme.surfaceRaised, borderColor: theme.border, borderLeftWidth: 1, borderRightWidth: 1, padding: 16 },
  recordFirst: { borderTopLeftRadius: 20, borderTopRightRadius: 20, borderTopWidth: 1 },
  recordLast: { borderBottomLeftRadius: 20, borderBottomRightRadius: 20, borderBottomWidth: 1 },
  recordDivider: { borderBottomColor: theme.border, borderBottomWidth: 1 },
  recordTop: { alignItems: "flex-start", flexDirection: "row" },
  bookingMarker: { alignItems: "center", backgroundColor: "rgba(233,177,142,0.24)", borderRadius: 13, height: 44, justifyContent: "center", width: 44 },
  orderMarker: { alignItems: "center", backgroundColor: theme.surfaceMuted, borderRadius: 13, height: 44, justifyContent: "center", width: 44 },
  recordCopy: { flex: 1, marginLeft: 11, minWidth: 0 },
  recordOverline: { color: theme.brandPressed, fontFamily: theme.font.bold, fontSize: 9, letterSpacing: 0.65, lineHeight: 13 },
  recordTitle: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 14.5, lineHeight: 19, marginTop: 2 },
  recordMeta: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 11.5, lineHeight: 16, marginTop: 3 },
  recordValue: { alignItems: "flex-end", marginLeft: 8, maxWidth: "34%" },
  amount: { color: theme.text, fontFamily: theme.font.bold, fontSize: 14, fontVariant: ["tabular-nums"], lineHeight: 19 },
  statusRow: { alignItems: "center", flexDirection: "row", gap: 5, justifyContent: "flex-end", marginTop: 5 },
  statusDot: { borderRadius: 3, height: 6, width: 6 },
  statusText: { fontFamily: theme.font.semibold, fontSize: 10, lineHeight: 13, textTransform: "capitalize" },
  detailLine: { alignItems: "center", flexDirection: "row", gap: 7, marginLeft: 55, marginTop: 10 },
  detailText: { color: theme.textMuted, flex: 1, fontFamily: theme.font.body, fontSize: 11.5, lineHeight: 16 },
  recordActions: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 12, marginLeft: 55, marginTop: 14 },
  completionHint: { alignItems: "flex-start", flexDirection: "row", gap: 7, marginLeft: 55, marginTop: 8 },
  completionHintText: { color: theme.textMuted, flex: 1, fontFamily: theme.font.body, fontSize: 10.5, lineHeight: 15 },
  primaryAction: { alignItems: "center", backgroundColor: theme.deepBrand, borderRadius: 13, flexDirection: "row", gap: 8, justifyContent: "center", minHeight: 46, minWidth: 126, paddingHorizontal: 16 },
  primaryActionText: { color: "#FFFFFF", fontFamily: theme.font.semibold, fontSize: 12.5 },
  cancelAction: { alignItems: "center", borderColor: theme.border, borderRadius: 13, borderWidth: 1, justifyContent: "center", minHeight: 44, paddingHorizontal: 14 },
  cancelActionText: { color: theme.deepBrand, fontFamily: theme.font.semibold, fontSize: 12 },
  problemAction: { alignItems: "center", flexDirection: "row", gap: 6, minHeight: 44, paddingHorizontal: 2 },
  problemActionText: { color: theme.brandPressed, fontFamily: theme.font.semibold, fontSize: 12 },
  reviewedRow: { alignItems: "center", flexDirection: "row", gap: 6, marginLeft: 55, marginTop: 10 },
  reviewedText: { color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 11.5, lineHeight: 16 },
  orderBreakdown: { alignItems: "center", flexDirection: "row", gap: 7, marginLeft: 55, marginTop: 10 },
  breakdownLabel: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 10.5, fontVariant: ["tabular-nums"] },
  breakdownDot: { backgroundColor: theme.textMuted, borderRadius: 2, height: 3, opacity: 0.55, width: 3 },
  deliveryCode: { alignItems: "center", backgroundColor: theme.surfaceMuted, borderColor: "rgba(168,70,46,0.22)", borderRadius: 14, borderStyle: "dashed", borderWidth: 1, flexDirection: "row", justifyContent: "space-between", marginLeft: 55, marginTop: 13, paddingHorizontal: 12, paddingVertical: 11 },
  deliveryCopy: { flex: 1, marginRight: 12 },
  deliveryLabel: { color: theme.brandPressed, fontFamily: theme.font.bold, fontSize: 9, letterSpacing: 0.7 },
  deliveryHelp: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 10, lineHeight: 14, marginTop: 3 },
  deliveryValue: { color: theme.text, fontFamily: theme.font.displayStrong, fontSize: 20, fontVariant: ["tabular-nums"], letterSpacing: 2.5 },
  emptyState: { alignItems: "center", paddingHorizontal: 20, paddingTop: 34 },
  emptyIllustration: { height: 142, position: "relative", width: 190 },
  illustrationHalo: { backgroundColor: "rgba(241,223,200,0.60)", borderRadius: 62, bottom: 2, height: 122, left: 34, position: "absolute", width: 122 },
  illustrationReceipt: { backgroundColor: "#FFFFFF", borderColor: theme.border, borderRadius: 15, borderWidth: 1, height: 116, left: 48, padding: 15, position: "absolute", top: 3, transform: [{ rotate: "-5deg" }], width: 94, ...theme.shadow },
  receiptHandle: { alignItems: "center", backgroundColor: "rgba(233,177,142,0.24)", borderRadius: 11, height: 38, justifyContent: "center", width: 38 },
  receiptLineLong: { backgroundColor: theme.sand, borderRadius: 2, height: 5, marginTop: 11, width: 62 },
  receiptLineShort: { backgroundColor: theme.sand, borderRadius: 2, height: 5, marginTop: 6, width: 42 },
  receiptRule: { borderBottomColor: theme.border, borderBottomWidth: 1, marginTop: 9, width: 62 },
  receiptTotal: { backgroundColor: theme.brand, borderRadius: 2, height: 5, marginTop: 8, width: 26 },
  illustrationTicket: { alignItems: "center", backgroundColor: theme.brand, borderRadius: 14, bottom: 6, height: 55, justifyContent: "center", position: "absolute", right: 20, transform: [{ rotate: "8deg" }], width: 63, ...theme.shadow },
  illustrationSpark: { backgroundColor: theme.clay, borderRadius: 5, height: 9, left: 27, position: "absolute", top: 34, transform: [{ rotate: "22deg" }], width: 9 },
  illustrationSparkSmall: { backgroundColor: theme.brandPressed, borderRadius: 3, height: 6, position: "absolute", right: 22, top: 23, width: 6 },
  emptyTitle: { color: theme.text, fontFamily: theme.font.display, fontSize: 22, lineHeight: 27, marginTop: 15 },
  emptyBody: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 13.5, lineHeight: 21, marginTop: 7, maxWidth: 320, textAlign: "center" },
  emptyAction: { alignItems: "center", backgroundColor: theme.deepBrand, borderRadius: 14, flexDirection: "row", gap: 8, justifyContent: "center", marginTop: 20, minHeight: 48, paddingHorizontal: 18 },
  emptyActionText: { color: "#FFFFFF", fontFamily: theme.font.semibold, fontSize: 13 },
  sectionEmpty: { alignItems: "center", flexDirection: "row", paddingHorizontal: 5, paddingVertical: 15 },
  sectionEmptyIcon: { alignItems: "center", backgroundColor: "rgba(233,177,142,0.22)", borderRadius: 13, height: 44, justifyContent: "center", width: 44 },
  sectionEmptyCopy: { marginLeft: 11 },
  sectionEmptyTitle: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 13.5 },
  sectionEmptyBody: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 11.5, marginTop: 3 },
  loadingState: { paddingTop: 18 },
  loadingLead: { alignItems: "center", flexDirection: "row", gap: 9, marginBottom: 17, paddingHorizontal: 3 },
  loadingText: { color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 12.5 },
  skeletonRecord: { alignItems: "center", backgroundColor: theme.surfaceRaised, borderColor: theme.border, borderRadius: 18, borderWidth: 1, flexDirection: "row", marginBottom: 10, padding: 16 },
  skeletonIcon: { backgroundColor: theme.sand, borderRadius: 13, height: 44, opacity: 0.65, width: 44 },
  skeletonCopy: { flex: 1, gap: 7, marginLeft: 11 },
  skeletonLabel: { backgroundColor: theme.sand, borderRadius: 3, height: 7, opacity: 0.7, width: 54 },
  skeletonTitle: { backgroundColor: theme.surfaceMuted, borderRadius: 4, height: 12, width: "72%" },
  skeletonMeta: { backgroundColor: theme.surfaceMuted, borderRadius: 3, height: 8, width: "45%" },
  skeletonAmount: { backgroundColor: theme.sand, borderRadius: 4, height: 12, opacity: 0.75, width: 58 },
  errorState: { alignItems: "center", paddingHorizontal: 22, paddingTop: 58 },
  errorIcon: { alignItems: "center", backgroundColor: "rgba(168,70,46,0.09)", borderRadius: 24, height: 66, justifyContent: "center", width: 66 },
  errorTitle: { color: theme.text, fontFamily: theme.font.display, fontSize: 21, lineHeight: 26, marginTop: 16 },
  errorBody: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 13, lineHeight: 20, marginTop: 7, maxWidth: 310, textAlign: "center" },
  retryAction: { alignItems: "center", backgroundColor: theme.deepBrand, borderRadius: 14, justifyContent: "center", marginTop: 20, minHeight: 48, minWidth: 120, paddingHorizontal: 18 },
  retryActionText: { color: "#FFFFFF", fontFamily: theme.font.semibold, fontSize: 13 },
  modalBackdrop: { backgroundColor: "rgba(41,35,31,0.48)", flex: 1, justifyContent: "flex-end" },
  modalDismissArea: { flex: 1 },
  modalSheet: { backgroundColor: theme.surfaceRaised, borderTopLeftRadius: 30, borderTopRightRadius: 30, maxHeight: "92%", paddingHorizontal: 20, paddingTop: 10 },
  sheetHandle: { alignSelf: "center", backgroundColor: "rgba(41,35,31,0.16)", borderRadius: 2, height: 4, marginBottom: 14, width: 38 },
  completionSheet: { paddingBottom: Platform.OS === "ios" ? 36 : 28 },
  completionIcon: { alignItems: "center", alignSelf: "center", backgroundColor: "rgba(233,177,142,0.22)", borderRadius: 22, height: 62, justifyContent: "center", width: 62 },
  completionTitle: { color: theme.text, fontFamily: theme.font.display, fontSize: 23, lineHeight: 29, marginTop: 14, textAlign: "center" },
  completionTarget: { color: theme.brandPressed, fontFamily: theme.font.semibold, fontSize: 12, lineHeight: 17, marginTop: 5, textAlign: "center" },
  completionBody: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 13, lineHeight: 20, marginTop: 14, textAlign: "center" },
  completionActions: { flexDirection: "row", gap: 10, marginTop: 20 },
  completionCancel: { alignItems: "center", borderColor: theme.border, borderRadius: 14, borderWidth: 1, flex: 1, justifyContent: "center", minHeight: 50, paddingHorizontal: 14 },
  completionCancelText: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 13 },
  completionConfirm: { alignItems: "center", backgroundColor: theme.deepBrand, borderRadius: 14, flex: 1.35, flexDirection: "row", gap: 8, justifyContent: "center", minHeight: 50, paddingHorizontal: 14 },
  completionConfirmText: { color: "#FFFFFF", fontFamily: theme.font.semibold, fontSize: 13 },
  modalContent: { paddingBottom: Platform.OS === "ios" ? 36 : 28 },
  modalTop: { alignItems: "flex-start", flexDirection: "row" },
  modalHeadingCopy: { flex: 1, minWidth: 0, paddingRight: 8 },
  modalTitle: { color: theme.text, fontFamily: theme.font.display, fontSize: 23, letterSpacing: -0.2, lineHeight: 28 },
  modalTarget: { color: theme.brandPressed, fontFamily: theme.font.semibold, fontSize: 12, lineHeight: 17, marginTop: 3 },
  modalClose: { alignItems: "center", height: 44, justifyContent: "center", marginTop: -6, width: 44 },
  modalBody: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 13, lineHeight: 20, marginTop: 13 },
  ratingLabel: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 13, marginBottom: 8, marginTop: 18 },
  ratingRow: { flexDirection: "row", gap: 8 },
  ratingButton: { alignItems: "center", borderColor: theme.border, borderRadius: 12, borderWidth: 1, height: 46, justifyContent: "center", width: 46 },
  ratingButtonSelected: { backgroundColor: "rgba(233,177,142,0.16)", borderColor: theme.brand },
  formReviewError: { color: theme.deepBrand, fontFamily: theme.font.medium, fontSize: 11.5, lineHeight: 17, marginTop: 10 },
  modalError: { alignItems: "flex-start", backgroundColor: "rgba(168,70,46,0.08)", borderRadius: 13, flexDirection: "row", gap: 8, marginTop: 13, padding: 11 },
  modalErrorText: { color: theme.deepBrand, flex: 1, fontFamily: theme.font.medium, fontSize: 11.5, lineHeight: 17 },
  inputHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 7, marginTop: 18 },
  inputLabel: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 13 },
  inputCount: { color: theme.deepBrand, fontFamily: theme.font.medium, fontSize: 10.5, fontVariant: ["tabular-nums"] },
  inputCountValid: { color: theme.statusPositive },
  textarea: { backgroundColor: theme.surfaceRaised, borderColor: theme.border, borderRadius: 15, borderWidth: 1, color: theme.text, fontFamily: theme.font.body, fontSize: 14, lineHeight: 20, minHeight: 116, paddingHorizontal: 13, paddingVertical: 12 },
  textareaFocused: { borderColor: theme.brand, borderWidth: 1.5 },
  textareaInvalid: { borderColor: "rgba(168,70,46,0.58)" },
  textareaValid: { borderColor: "rgba(75,123,84,0.62)" },
  textareaDisabled: { backgroundColor: theme.surfaceMuted, opacity: 0.7 },
  inputHelp: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 10.5, lineHeight: 15, marginTop: 7 },
  submitAction: { alignItems: "center", backgroundColor: theme.deepBrand, borderRadius: 14, flexDirection: "row", gap: 8, justifyContent: "center", marginTop: 18, minHeight: 50 },
  submitActionText: { color: "#FFFFFF", fontFamily: theme.font.semibold, fontSize: 13.5 },
  actionDisabled: { opacity: 0.48 },
  secondaryDisabled: { opacity: 0.42 },
  pressed: { opacity: 0.86, transform: [{ scale: 0.97 }] },
});
