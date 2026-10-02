import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Linking, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { randomUUID } from "expo-crypto";
import { router, useFocusEffect } from "expo-router";

import { ToolButton, ToolField, ToolPage } from "@/src/components/toolkit";
import { useAuth } from "@/src/auth/auth-context";
import { useAppearance } from "@/src/lib/appearance";
import { api } from "@/src/lib/api";

type Checkout = {
  reference: string;
  status: string;
  expires_at: string;
  amount_kobo: number;
  request_id: string;
  discount_code: string | null;
};

type Plan = {
  amountKobo: number;
  available: boolean;
  checkoutEnabled: boolean;
  complimentary?: boolean;
  currentPeriodEnd: string | null;
  checkout: Checkout | null;
};

type Benefits = {
  historyTurns: number;
  historyDays: number;
  maxFileBytes: number;
  voiceMaxSeconds: number;
  studyLimit: number | null;
  askMessagesPerWindow: number | null;
};

type StatusResponse = {
  subscription: Plan;
  benefits: Benefits;
  proBenefits: Benefits;
  capabilities?: {
    text?: boolean;
    images?: boolean;
    documents?: boolean;
  };
};

const money = (value: number) =>
  new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0,
  }).format(value / 100);

const fileSize = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

function BenefitRow({
  icon,
  title,
  detail,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  detail: string;
}) {
  const { theme } = useAppearance();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 12,
        paddingVertical: 12,
      }}
    >
      <View
        style={{
          width: 38,
          height: 38,
          borderRadius: 19,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: theme.surfaceMuted,
        }}
      >
        <Ionicons name={icon} size={19} color={theme.deepBrand} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          style={{
            color: theme.text,
            fontFamily: theme.font.semibold,
            fontSize: 14.5,
          }}
        >
          {title}
        </Text>
        <Text
          style={{
            color: theme.textMuted,
            fontFamily: theme.font.body,
            fontSize: 12,
            lineHeight: 18,
            marginTop: 2,
          }}
        >
          {detail}
        </Text>
      </View>
    </View>
  );
}

export default function KiraSubscription() {
  const { user } = useAuth();
  return <AccountSubscription key={user?.id} />;
}

function AccountSubscription() {
  const { user, profile } = useAuth();
  const { theme } = useAppearance();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [benefits, setBenefits] = useState<Benefits | null>(null);
  const [capabilities, setCapabilities] = useState<StatusResponse["capabilities"]>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [checkoutScreen, setCheckoutScreen] = useState(false);
  const [coupon, setCoupon] = useState("");
  const [discount, setDiscount] = useState<{ code: string; percent: number } | null>(null);
  const key = useRef(randomUUID());
  const alive = useRef(true);
  const opening = useRef(false);
  const request = useRef(0);
  const lock = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      request.current += 1;
    };
  }, []);

  const load = useCallback(async () => {
    const turn = ++request.current;
    try {
      const result = await api<StatusResponse>("/v1/ai/status", { cache: "no-store" });
      if (!alive.current || turn !== request.current) return;
      setPlan(result.subscription);
      setBenefits(result.proBenefits);
      setCapabilities(result.capabilities);
      setError("");
      if (result.subscription.checkout) {
        key.current = result.subscription.checkout.request_id;
        setCoupon(result.subscription.checkout.discount_code ?? "");
        setCheckoutScreen(true);
      }
    } catch (caught) {
      if (alive.current && turn === request.current)
        setError(
          caught instanceof Error
            ? caught.message
            : "Your Kira plan could not load. Try again.",
        );
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && opening.current) {
        opening.current = false;
        void load();
      }
    });
    return () => sub.remove();
  }, [load]);

  const listPrice = plan?.amountKobo ?? 600000;
  const amount =
    plan?.checkout?.amount_kobo ??
    Math.floor(listPrice * (100 - (discount?.percent ?? 0)) / 100);

  async function run(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (caught) {
      if (alive.current)
        setError(
          caught instanceof Error
            ? caught.message
            : "This could not finish. Your checkout is kept.",
        );
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }

  async function applyCoupon() {
    await run(async () => {
      const result = await api<{ code: string; percent: number }>(
        "/v1/discounts/validate",
        {
          method: "POST",
          body: JSON.stringify({ code: coupon, scope: "KIRA" }),
        },
      );
      if (!alive.current) return;
      setDiscount(result);
      key.current = randomUUID();
      setNotice(`${result.percent}% discount applied`);
    });
  }

  async function check() {
    if (!plan?.checkout) return;
    await run(async () => {
      const result = await api<{ payment: { status: string } }>(
        "/v1/payments/status/" + encodeURIComponent(plan.checkout!.reference),
        { cache: "no-store" },
      );
      if (!alive.current) return;
      setNotice(
        result.payment.status === "SUCCEEDED"
          ? "Payment confirmed. Kira Pro is active."
          : result.payment.status === "REQUIRES_REVIEW"
            ? "Payment received and awaiting verification."
            : "Payment is still awaiting confirmation.",
      );
      await load();
    });
  }

  async function pay() {
    if (!plan?.checkoutEnabled) return;
    await run(async () => {
      const result = await api<{
        authorizationUrl: string;
        reference: string;
        amountKobo: number;
      }>("/v1/ai/subscription-checkout", {
        method: "POST",
        body: JSON.stringify({
          requestId: key.current,
          consent: true,
          discountCode:
            plan.checkout?.discount_code ?? discount?.code ?? "",
        }),
      });
      if (!alive.current) return;
      if (result.amountKobo !== amount)
        throw new Error("Your checkout total changed. Reopen checkout and try again.");
      opening.current = true;
      await Linking.openURL(result.authorizationUrl);
    });
  }

  const heading = {
    color: theme.text,
    fontFamily: theme.font.display,
  };
  const text = {
    color: theme.text,
    fontFamily: theme.font.body,
    lineHeight: 22,
  };
  const muted = {
    ...text,
    color: theme.textMuted,
    fontSize: 12.5,
    lineHeight: 19,
  };

  const benefitRows = benefits
    ? [
        {
          icon: "sparkles-outline" as const,
          title: benefits.studyLimit
            ? `${benefits.studyLimit} study generations every month`
            : "Unlimited personal study allowance",
          detail: "Turn class material into summaries, notes and quizzes.",
        },
        {
          icon: "chatbubbles-outline" as const,
          title: benefits.askMessagesPerWindow
            ? `Up to ${benefits.askMessagesPerWindow} Ask Kira messages every 15 minutes`
            : "Unlimited personal Ask Kira allowance",
          detail: "Keep longer study conversations moving without losing the thread.",
        },
        {
          icon: "layers-outline" as const,
          title: `${benefits.historyTurns} turns of conversation context`,
          detail: "Kira can follow your recent questions instead of treating every message as new.",
        },
        {
          icon: "time-outline" as const,
          title: `${benefits.historyDays} days of saved conversations`,
          detail: "Come back to recent study sessions when you need them again.",
        },
        {
          icon: "mic-outline" as const,
          title: `Voice transcription up to ${Math.max(1, Math.round(benefits.voiceMaxSeconds / 60))} minutes`,
          detail: "Speak a question or study prompt instead of typing it.",
        },
        {
          icon: "document-text-outline" as const,
          title: `Files up to ${fileSize(benefits.maxFileBytes)} each`,
          detail: capabilities?.documents === false
            ? "File support appears automatically when the study service is available."
            : "Study from supported PDFs and documents inside Kira.",
        },
        ...(capabilities?.images === false
          ? []
          : [
              {
                icon: "image-outline" as const,
                title: "Study with images",
                detail: "Add a supported image when a diagram, page or question needs visual context.",
              },
            ]),
        {
          icon: "school-outline" as const,
          title: "Personal campus context",
          detail: "Kira uses your programme and level when they help answer an academic question.",
        },
      ]
    : [];

  if (checkoutScreen) {
    return (
      <ToolPage title="Kira checkout">
        <View style={{ gap: 18, paddingVertical: 14 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to Kira Pro benefits"
            disabled={busy}
            onPress={() => setCheckoutScreen(false)}
            style={{ alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 5 }}
          >
            <Ionicons name="arrow-back" size={18} color={theme.deepBrand} />
            <Text style={{ ...text, color: theme.deepBrand, fontFamily: theme.font.semibold }}>
              Benefits
            </Text>
          </Pressable>

          <View
            style={{
              borderRadius: 26,
              backgroundColor: theme.surfaceSoft,
              borderWidth: 1,
              borderColor: theme.border,
              padding: 20,
              gap: 7,
            }}
          >
            <View
              style={{
                width: 46,
                height: 46,
                borderRadius: 23,
                backgroundColor: theme.surface,
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 4,
              }}
            >
              <Ionicons name="sparkles" size={22} color={theme.deepBrand} />
            </View>
            <Text style={{ ...heading, fontSize: 28, lineHeight: 34 }}>Kira Pro</Text>
            <Text style={muted}>One month of Pro access. No automatic renewal.</Text>
          </View>

          <View
            style={{
              borderRadius: 22,
              borderWidth: 1,
              borderColor: theme.border,
              backgroundColor: theme.surface,
              padding: 18,
              gap: 13,
            }}
          >
            <Text style={{ ...text, fontFamily: theme.font.semibold, fontSize: 15 }}>
              Checkout details
            </Text>
            <View>
              <Text style={{ ...text, fontFamily: theme.font.semibold }}>
                {profile?.display_name ?? "Your KampusOne account"}
              </Text>
              <Text style={muted}>{user?.email}</Text>
            </View>
            <ToolButton
              secondary
              label="Edit account details"
              disabled={busy || !!plan?.checkout}
              onPress={() => router.push("/account")}
            />

            {!plan?.checkout ? (
              <>
                <ToolField
                  label="Discount code"
                  value={coupon}
                  autoCapitalize="characters"
                  maxLength={32}
                  editable={!busy}
                  onChangeText={(value) => {
                    setCoupon(value);
                    setDiscount(null);
                    setNotice("");
                    key.current = randomUUID();
                  }}
                />
                <ToolButton
                  secondary
                  label="Apply code"
                  disabled={busy || coupon.trim().length < 3}
                  onPress={() => void applyCoupon()}
                />
              </>
            ) : null}

            <View
              style={{
                borderTopWidth: 1,
                borderTopColor: theme.border,
                paddingTop: 13,
                gap: 9,
              }}
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 16 }}>
                <Text style={muted}>Kira Pro · 1 month</Text>
                <Text style={text}>{money(listPrice)}</Text>
              </View>
              {amount < listPrice ? (
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 16 }}>
                  <Text style={muted}>Discount</Text>
                  <Text style={{ ...text, color: theme.deepBrand }}>
                    −{money(listPrice - amount)}
                  </Text>
                </View>
              ) : null}
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 16 }}>
                <Text style={{ ...text, fontFamily: theme.font.semibold, fontSize: 15 }}>
                  Total
                </Text>
                <Text style={{ ...text, fontFamily: theme.font.bold, fontSize: 18 }}>
                  {money(amount)}
                </Text>
              </View>
            </View>
          </View>

          {error ? (
            <Text accessibilityRole="alert" style={{ ...text, color: theme.error }}>
              {error}
            </Text>
          ) : null}
          {notice ? <Text style={{ ...text, color: theme.deepBrand }}>{notice}</Text> : null}

          <ToolButton
            label={
              busy
                ? "Please wait…"
                : plan?.checkout
                  ? `Continue payment · ${money(amount)}`
                  : `Pay securely · ${money(amount)}`
            }
            disabled={
              busy ||
              !plan?.checkoutEnabled ||
              plan?.checkout?.status === "REQUIRES_REVIEW"
            }
            onPress={() => void pay()}
          />

          {plan?.checkout ? (
            <View style={{ gap: 9 }}>
              <Text selectable style={muted}>
                Reference: {plan.checkout.reference}
              </Text>
              <ToolButton
                secondary
                label="I have paid — check payment"
                disabled={busy}
                onPress={() => void check()}
              />
            </View>
          ) : null}

          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Ionicons name="shield-checkmark-outline" size={18} color={theme.textMuted} />
            <Text style={{ ...muted, flex: 1 }}>
              Payment opens in Paystack. KampusOne does not store your card details.
            </Text>
          </View>
        </View>
      </ToolPage>
    );
  }

  return (
    <ToolPage title="Kira Pro">
      <View style={{ gap: 18, paddingVertical: 14 }}>
        <View
          style={{
            borderRadius: 28,
            backgroundColor: theme.surfaceSoft,
            borderWidth: 1,
            borderColor: theme.border,
            padding: 22,
            gap: 10,
          }}
        >
          <View
            style={{
              alignSelf: "flex-start",
              flexDirection: "row",
              alignItems: "center",
              gap: 7,
              backgroundColor: theme.surface,
              paddingHorizontal: 11,
              paddingVertical: 7,
              borderRadius: 999,
            }}
          >
            <Ionicons name="sparkles" size={15} color={theme.deepBrand} />
            <Text
              style={{
                color: theme.deepBrand,
                fontFamily: theme.font.semibold,
                fontSize: 11,
                letterSpacing: 0.4,
              }}
            >
              KIRA PRO
            </Text>
          </View>
          <Text style={{ ...heading, fontSize: 37, lineHeight: 43 }}>
            {plan?.complimentary ? "Pro is active" : `${money(listPrice)} / month`}
          </Text>
          <Text style={{ ...muted, fontSize: 13.5, lineHeight: 21 }}>
            {plan?.complimentary
              ? "Your KampusOne owner account has complimentary Pro access."
              : "More study generations, longer context, voice and file support. One month at a time with no automatic renewal."}
          </Text>
          {plan?.currentPeriodEnd ? (
            <View
              style={{
                alignSelf: "flex-start",
                flexDirection: "row",
                gap: 6,
                alignItems: "center",
                marginTop: 2,
              }}
            >
              <Ionicons name="checkmark-circle" size={17} color={theme.deepBrand} />
              <Text style={{ ...muted, color: theme.deepBrand }}>
                Active until{" "}
                {new Date(plan.currentPeriodEnd).toLocaleDateString("en-NG", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </Text>
            </View>
          ) : null}
        </View>

        <View
          style={{
            borderRadius: 22,
            borderWidth: 1,
            borderColor: theme.border,
            backgroundColor: theme.surface,
            paddingHorizontal: 17,
            paddingVertical: 8,
          }}
        >
          <Text
            style={{
              color: theme.text,
              fontFamily: theme.font.semibold,
              fontSize: 16,
              paddingTop: 9,
              paddingBottom: 3,
            }}
          >
            What you get
          </Text>
          {benefitRows.map((row) => (
            <BenefitRow key={row.title} {...row} />
          ))}
        </View>

        {error ? (
          <Text accessibilityRole="alert" style={{ ...text, color: theme.error }}>
            {error}
          </Text>
        ) : null}
        {!plan && !error ? <Text style={muted}>Loading your plan…</Text> : null}
        {plan && !plan.available && !plan.complimentary ? (
          <Text style={muted}>
            Kira Pro checkout is not available for this campus yet.
          </Text>
        ) : null}

        {!plan?.complimentary ? (
          <ToolButton
            label={
              plan?.currentPeriodEnd && !plan.checkoutEnabled
                ? "Pro is active"
                : "Continue to checkout"
            }
            disabled={
              busy ||
              !plan?.checkoutEnabled ||
              Boolean(plan?.currentPeriodEnd && !plan.checkoutEnabled)
            }
            onPress={() => setCheckoutScreen(true)}
          />
        ) : null}

        <Text style={{ ...muted, textAlign: "center", paddingHorizontal: 16 }}>
          No automatic renewal. Access starts when payment is confirmed.
        </Text>
      </View>
    </ToolPage>
  );
}
