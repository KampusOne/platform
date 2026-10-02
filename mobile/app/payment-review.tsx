import { useCallback, useRef, useState } from "react";
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { ToolPage } from "@/src/components/toolkit";
import { useAuth } from "@/src/auth/auth-context";
import { api } from "@/src/lib/api";
import { useThemeStyles, type Theme } from "@/src/lib/appearance";

type Summary = {
  id: string;
  title: string;
  status: string;
  base_kobo: number;
  buyer_fee_kobo: number;
  delivery_fee_kobo: number;
  amount_kobo: number;
  cash_due_kobo?: number;
  discount_kobo?: number;
  total_kobo?: number;
  distance_metres?: number | null;
  campus_zone_estimate?: boolean;
  fee_snapshot?: {
    delivery?: {
      distanceMetres: number | null;
      distanceBasis: string;
    };
  };
};

const money = (value: number) =>
  new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0,
  }).format(Number(value || 0) / 100);

export default function PaymentReview() {
  const { id = "", type = "" } = useLocalSearchParams<{
    id: string;
    type: string;
  }>();
  const { user } = useAuth();
  const { theme, styles } = useThemeStyles(createStyles);
  const [purchase, setPurchase] = useState<Summary | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [checkoutEnabled, setCheckoutEnabled] = useState(false);
  const paymentRequest = useRef("");

  const load = useCallback(async () => {
    if (!id || !type) {
      setError("This checkout link is incomplete.");
      return;
    }
    try {
      const result = await api<{
        payment: Summary;
        checkoutEnabled: boolean;
      }>(
        `/v1/payments/summary?resourceType=${encodeURIComponent(type)}&resourceId=${encodeURIComponent(id)}`,
        { cache: "no-store" },
      );
      setPurchase(result.payment);
      setCheckoutEnabled(result.checkoutEnabled);
      setError("");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "This purchase could not be loaded.",
      );
    }
  }, [id, type]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function pay() {
    if (!purchase || busy || !checkoutEnabled) return;
    setBusy(true);
    setError("");
    if (!paymentRequest.current)
      paymentRequest.current = `review-${purchase.id}-${Date.now()}`;
    try {
      const result = await api<{ authorizationUrl: string }>(
        "/v1/payments/initialize",
        {
          method: "POST",
          body: JSON.stringify({
            resourceType: type,
            resourceId: id,
            idempotencyKey: paymentRequest.current,
          }),
        },
      );
      await Linking.openURL(result.authorizationUrl);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Secure checkout could not open.",
      );
    } finally {
      setBusy(false);
    }
  }

  const deliveryDistance =
    purchase?.fee_snapshot?.delivery?.distanceMetres ??
    purchase?.distance_metres ??
    null;
  const complete = purchase
    ? !["PENDING_PAYMENT", "CREATED", "INITIALIZED"].includes(purchase.status)
    : false;

  return (
    <ToolPage title="Checkout">
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        {!purchase && !error ? (
          <View style={styles.loadingCard}>
            <View style={styles.loadingIcon}>
              <Ionicons
                name="receipt-outline"
                size={24}
                color={theme.deepBrand}
              />
            </View>
            <Text style={styles.loadingTitle}>Preparing your checkout</Text>
            <Text style={styles.loadingText}>
              Confirming the latest order total and payment status.
            </Text>
          </View>
        ) : null}

        {purchase ? (
          <>
            <View style={styles.hero}>
              <View style={styles.heroIcon}>
                <Ionicons
                  name={complete ? "checkmark" : "bag-handle-outline"}
                  size={24}
                  color="#FFFFFF"
                />
              </View>
              <View style={styles.heroCopy}>
                <Text style={styles.eyebrow}>
                  {complete ? "PAYMENT STATUS" : "READY TO PAY"}
                </Text>
                <Text style={styles.heroTitle}>{purchase.title}</Text>
                <Text style={styles.heroSubtitle}>
                  {complete
                    ? purchase.status.replaceAll("_", " ")
                    : "Review the total, then continue to secure payment."}
                </Text>
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Order summary</Text>

              <View style={styles.row}>
                <Text style={styles.rowLabel}>Items</Text>
                <Text style={styles.rowValue}>
                  {money(purchase.base_kobo)}
                </Text>
              </View>

              {Number(purchase.discount_kobo) > 0 ? (
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>Savings</Text>
                  <Text style={[styles.rowValue, styles.savings]}>
                    −{money(Number(purchase.discount_kobo))}
                  </Text>
                </View>
              ) : null}

              <View style={styles.row}>
                <Text style={styles.rowLabel}>Delivery</Text>
                <Text style={styles.rowValue}>
                  {Number(purchase.delivery_fee_kobo) > 0
                    ? money(purchase.delivery_fee_kobo)
                    : "Free"}
                </Text>
              </View>

              {Number(purchase.buyer_fee_kobo) > 0 ? (
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>Service fee</Text>
                  <Text style={styles.rowValue}>
                    {money(purchase.buyer_fee_kobo)}
                  </Text>
                </View>
              ) : null}

              {deliveryDistance != null ? (
                <View style={styles.routeLine}>
                  <Ionicons
                    name="navigate-outline"
                    size={17}
                    color={theme.deepBrand}
                  />
                  <Text style={styles.routeText}>
                    {(Number(deliveryDistance) / 1000).toFixed(2)} km delivery
                    estimate
                    {purchase.campus_zone_estimate ? " · campus zone" : ""}
                  </Text>
                </View>
              ) : null}

              {Number(purchase.cash_due_kobo) > 0 ? (
                <View style={styles.cashNotice}>
                  <Ionicons
                    name="cash-outline"
                    size={19}
                    color={theme.statusAttention}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cashTitle}>
                      Cash due at delivery
                    </Text>
                    <Text style={styles.cashText}>
                      Pay {money(Number(purchase.cash_due_kobo))} directly to
                      the rider when your order arrives.
                    </Text>
                  </View>
                </View>
              ) : null}

              <View style={styles.totalDivider} />
              <View style={styles.totalRow}>
                <View>
                  <Text style={styles.totalLabel}>Pay now</Text>
                  <Text style={styles.totalHint}>Secure Paystack checkout</Text>
                </View>
                <Text style={styles.totalValue}>
                  {money(purchase.amount_kobo)}
                </Text>
              </View>
            </View>

            <View style={styles.accountCard}>
              <View style={styles.accountIcon}>
                <Ionicons
                  name="person-outline"
                  size={19}
                  color={theme.deepBrand}
                />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.accountLabel}>Payment receipt account</Text>
                <Text numberOfLines={1} style={styles.accountValue}>
                  {user?.email ?? "Your KampusOne account"}
                </Text>
              </View>
            </View>

            {error ? (
              <View accessibilityRole="alert" style={styles.errorCard}>
                <Ionicons
                  name="alert-circle-outline"
                  size={19}
                  color={theme.error}
                />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            {purchase.status === "PENDING_PAYMENT" ? (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{
                  disabled: busy || !checkoutEnabled,
                  busy,
                }}
                disabled={busy || !checkoutEnabled}
                onPress={() => void pay()}
                style={({ pressed }) => [
                  styles.payButton,
                  (!checkoutEnabled || busy) && styles.payButtonDisabled,
                  pressed && checkoutEnabled && !busy && styles.pressed,
                ]}
              >
                <View style={styles.payButtonIcon}>
                  <Ionicons
                    name="lock-closed"
                    size={16}
                    color="#FFFFFF"
                  />
                </View>
                <Text style={styles.payButtonText}>
                  {busy
                    ? "Opening secure checkout…"
                    : checkoutEnabled
                      ? `Pay ${money(purchase.amount_kobo)}`
                      : "Secure checkout unavailable"}
                </Text>
                {checkoutEnabled && !busy ? (
                  <Ionicons
                    name="arrow-forward"
                    size={19}
                    color="#FFFFFF"
                  />
                ) : null}
              </Pressable>
            ) : (
              <View style={styles.statusCard}>
                <Ionicons
                  name="checkmark-circle"
                  size={22}
                  color={theme.success}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.statusTitle}>
                    {purchase.status.replaceAll("_", " ")}
                  </Text>
                  <Text style={styles.statusText}>
                    Your order remains available in Purchases.
                  </Text>
                </View>
              </View>
            )}

            <View style={styles.securityLine}>
              <Ionicons
                name="shield-checkmark-outline"
                size={18}
                color={theme.textMuted}
              />
              <Text style={styles.securityText}>
                Payment opens in Paystack. KampusOne does not store your card
                details.
              </Text>
            </View>
          </>
        ) : null}

        {error && !purchase ? (
          <View accessibilityRole="alert" style={styles.loadingCard}>
            <View style={[styles.loadingIcon, styles.loadingIconError]}>
              <Ionicons
                name="alert-circle-outline"
                size={24}
                color={theme.error}
              />
            </View>
            <Text style={styles.loadingTitle}>Checkout unavailable</Text>
            <Text style={styles.loadingText}>{error}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => void load()}
              style={styles.retryButton}
            >
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/(tabs)/purchases")}
          style={styles.purchases}
        >
          <Ionicons
            name="receipt-outline"
            size={18}
            color={theme.deepBrand}
          />
          <Text style={styles.purchasesText}>View my purchases</Text>
          <Ionicons
            name="chevron-forward"
            size={17}
            color={theme.deepBrand}
          />
        </Pressable>
      </ScrollView>
    </ToolPage>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    content: { gap: 15, paddingBottom: 42, paddingTop: 5 },
    hero: {
      borderRadius: 24,
      backgroundColor: theme.surfaceSoft,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
      padding: 18,
      flexDirection: "row",
      gap: 13,
      alignItems: "center",
    },
    heroIcon: {
      width: 48,
      height: 48,
      borderRadius: 16,
      backgroundColor: theme.deepBrand,
      alignItems: "center",
      justifyContent: "center",
    },
    heroCopy: { flex: 1, minWidth: 0 },
    eyebrow: {
      color: theme.deepBrand,
      fontFamily: theme.font.bold,
      fontSize: 9.5,
      letterSpacing: 0.85,
    },
    heroTitle: {
      color: theme.text,
      fontFamily: theme.font.display,
      fontSize: 22,
      lineHeight: 28,
      marginTop: 3,
    },
    heroSubtitle: {
      color: theme.textMuted,
      fontFamily: theme.font.body,
      fontSize: 12,
      lineHeight: 18,
      marginTop: 2,
    },
    card: {
      borderRadius: 21,
      backgroundColor: theme.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
      padding: 17,
    },
    cardTitle: {
      color: theme.text,
      fontFamily: theme.font.semibold,
      fontSize: 15,
      marginBottom: 7,
    },
    row: {
      minHeight: 38,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 14,
    },
    rowLabel: {
      color: theme.textMuted,
      fontFamily: theme.font.body,
      fontSize: 13,
    },
    rowValue: {
      color: theme.text,
      fontFamily: theme.font.medium,
      fontSize: 13,
      fontVariant: ["tabular-nums"],
    },
    savings: { color: theme.success, fontFamily: theme.font.semibold },
    routeLine: {
      marginTop: 5,
      borderRadius: 13,
      backgroundColor: theme.surfaceMuted,
      paddingHorizontal: 11,
      minHeight: 42,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    routeText: {
      flex: 1,
      color: theme.textMuted,
      fontFamily: theme.font.medium,
      fontSize: 11.5,
    },
    cashNotice: {
      marginTop: 10,
      borderRadius: 14,
      padding: 12,
      backgroundColor: theme.surfaceMuted,
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 9,
    },
    cashTitle: {
      color: theme.text,
      fontFamily: theme.font.semibold,
      fontSize: 12,
    },
    cashText: {
      color: theme.textMuted,
      fontFamily: theme.font.body,
      fontSize: 11.5,
      lineHeight: 17,
      marginTop: 2,
    },
    totalDivider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: theme.border,
      marginVertical: 11,
    },
    totalRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
    },
    totalLabel: {
      color: theme.text,
      fontFamily: theme.font.semibold,
      fontSize: 14,
    },
    totalHint: {
      color: theme.textMuted,
      fontFamily: theme.font.body,
      fontSize: 10.5,
      marginTop: 2,
    },
    totalValue: {
      color: theme.deepBrand,
      fontFamily: theme.font.display,
      fontSize: 24,
      fontVariant: ["tabular-nums"],
    },
    accountCard: {
      borderRadius: 17,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      padding: 12,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    accountIcon: {
      width: 39,
      height: 39,
      borderRadius: 13,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.surfaceMuted,
    },
    accountLabel: {
      color: theme.textMuted,
      fontFamily: theme.font.body,
      fontSize: 10.5,
    },
    accountValue: {
      color: theme.text,
      fontFamily: theme.font.medium,
      fontSize: 12.5,
      marginTop: 2,
    },
    payButton: {
      minHeight: 56,
      borderRadius: 17,
      paddingHorizontal: 15,
      backgroundColor: theme.deepBrand,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 9,
      ...theme.shadow,
    },
    payButtonDisabled: {
      backgroundColor: theme.textSubtle,
      opacity: 0.62,
    },
    payButtonIcon: {
      width: 26,
      height: 26,
      borderRadius: 13,
      backgroundColor: "rgba(255,255,255,.13)",
      alignItems: "center",
      justifyContent: "center",
    },
    payButtonText: {
      flex: 1,
      color: "#FFFFFF",
      fontFamily: theme.font.semibold,
      fontSize: 14,
      textAlign: "center",
    },
    securityLine: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 7,
      paddingHorizontal: 7,
    },
    securityText: {
      flex: 1,
      color: theme.textMuted,
      fontFamily: theme.font.body,
      fontSize: 10.5,
      lineHeight: 16,
    },
    statusCard: {
      minHeight: 66,
      borderRadius: 17,
      backgroundColor: theme.surfaceMuted,
      padding: 13,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    statusTitle: {
      color: theme.text,
      fontFamily: theme.font.semibold,
      fontSize: 13,
      textTransform: "capitalize",
    },
    statusText: {
      color: theme.textMuted,
      fontFamily: theme.font.body,
      fontSize: 11,
      marginTop: 2,
    },
    errorCard: {
      borderRadius: 14,
      backgroundColor: theme.surfaceMuted,
      padding: 12,
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 8,
    },
    errorText: {
      flex: 1,
      color: theme.error,
      fontFamily: theme.font.medium,
      fontSize: 12,
      lineHeight: 17,
    },
    purchases: {
      minHeight: 48,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 7,
    },
    purchasesText: {
      color: theme.deepBrand,
      fontFamily: theme.font.semibold,
      fontSize: 12.5,
    },
    loadingCard: {
      minHeight: 230,
      borderRadius: 21,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      padding: 24,
      alignItems: "center",
      justifyContent: "center",
    },
    loadingIcon: {
      width: 54,
      height: 54,
      borderRadius: 18,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.surfaceMuted,
      marginBottom: 12,
    },
    loadingIconError: { backgroundColor: theme.surfaceSoft },
    loadingTitle: {
      color: theme.text,
      fontFamily: theme.font.semibold,
      fontSize: 16,
      textAlign: "center",
    },
    loadingText: {
      color: theme.textMuted,
      fontFamily: theme.font.body,
      fontSize: 12.5,
      lineHeight: 19,
      textAlign: "center",
      marginTop: 5,
    },
    retryButton: {
      minHeight: 43,
      marginTop: 14,
      paddingHorizontal: 18,
      borderRadius: 13,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.deepBrand,
    },
    retryText: {
      color: "#FFFFFF",
      fontFamily: theme.font.semibold,
      fontSize: 12,
    },
    pressed: { opacity: 0.82, transform: [{ scale: 0.985 }] },
  });
