import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Linking, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { randomUUID } from "expo-crypto";
import { router, useFocusEffect } from "expo-router";

import { ToolButton, ToolField, ToolPage } from "@/src/components/toolkit";
import { useAuth } from "@/src/auth/auth-context";
import { useAppearance } from "@/src/lib/appearance";
import { api, ApiError } from "@/src/lib/api";

type Tier = "standard" | "pro";
type Checkout = {
  tier?: Tier;
  pricing_quote_id?: string | null;
  quote_id?: string | null;
  reference: string;
  status: string;
  expires_at: string;
  amount_kobo: number;
  listed_amount_kobo: number;
  discount_amount_kobo?: number;
  offer_discount_percent: number;
  coupon_discount_percent?: number;
  request_id: string;
  discount_code: string | null;
};

type CatalogPlan = {
  tier: Tier;
  planId: string | null;
  version: string | null;
  amountKobo: number;
  listedAmountKobo: number;
  discountPercent: number;
  discountAmountKobo: number;
  active: boolean;
  available: boolean;
  checkoutEnabled: boolean;
  offer: { active: boolean; startsAt: string | null; endsAt: string | null; percent: number };
};

type PricingQuote = {
  quoteId: string;
  tier: Tier;
  version: string;
  amountKobo: number;
  listedAmountKobo: number;
  discountAmountKobo: number;
  discountPercent: number;
  offerDiscountPercent: number;
  couponDiscountPercent: number;
  discountCode: string | null;
  expiresAt: string;
  paystackAmountKobo: number;
  feeBearer: "LEGACY_INCLUSIVE" | "CUSTOMER_PASSTHROUGH";
};

type Plan = {
  amountKobo: number;
  listedAmountKobo: number;
  discountPercent: number;
  available: boolean;
  checkoutEnabled: boolean;
  complimentary?: boolean;
  currentTier?: Tier;
  selectedTier?: Tier;
  catalog?: Partial<Record<Tier, CatalogPlan | null>>;
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
  tier: Tier;
  imports?: { limit:number; used:number; remaining:number };
  subscription: Plan;
  benefits: Benefits;
  proBenefits: Benefits;
  standardBenefits?: Benefits;
  capabilities?: {
    text?: boolean;
    images?: boolean;
    documents?: boolean;
  };
};

const money = (value: number | undefined) => value === undefined ? "Loading price…" :
  new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
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

function offerDates(startsAt: string | null, endsAt: string | null) {
  const date = (value: string) => new Date(value).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
  if (startsAt && endsAt) return `Offer valid ${date(startsAt)} – ${date(endsAt)}.`;
  if (endsAt) return `Offer ends ${date(endsAt)}.`;
  return startsAt ? `Offer started ${date(startsAt)}.` : "Current campus offer.";
}

function CatalogOffer({ plan, now }: { plan: CatalogPlan | null | undefined; now: number }) {
  const { theme } = useAppearance();
  if (!plan?.active || !plan.available || !plan.offer.active || plan.discountPercent <= 0 || plan.discountAmountKobo <= 0 ||
    (plan.offer.startsAt && Date.parse(plan.offer.startsAt) > now) ||
    (plan.offer.endsAt && Date.parse(plan.offer.endsAt) <= now)) return null;
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: theme.textMuted, fontFamily: theme.font.body, fontSize: 12, textDecorationLine: "line-through" }}>{money(plan.listedAmountKobo)} / month</Text>
      <Text style={{ color: theme.deepBrand, fontFamily: theme.font.semibold, fontSize: 12 }}>{plan.discountPercent}% off</Text>
      <Text style={{ color: theme.textMuted, fontFamily: theme.font.body, fontSize: 11, lineHeight: 16 }}>{offerDates(plan.offer.startsAt, plan.offer.endsAt)}</Text>
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
  const [standardBenefits, setStandardBenefits] = useState<Benefits | null>(null);
  const [capabilities, setCapabilities] = useState<StatusResponse["capabilities"]>();
  const [currentTier, setCurrentTier] = useState<"standard"|"pro">("standard");
  const [selectedTier, setSelectedTier] = useState<Tier>("pro");
  const [importLimit, setImportLimit] = useState(30);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checkoutScreen, setCheckoutScreen] = useState(false);
  const [coupon, setCoupon] = useState("");
  const [quote, setQuote] = useState<PricingQuote | null>(null);
  const [now, setNow] = useState(Date.now());
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

  useEffect(() => {
    const current = Date.now();
    const deadlines = Object.values(plan?.catalog ?? {}).flatMap((catalogPlan) => catalogPlan?.offer.endsAt ? [Date.parse(catalogPlan.offer.endsAt)] : []);
    if (checkoutScreen && quote) deadlines.push(Date.parse(quote.expiresAt));
    const future = deadlines.filter((deadline) => Number.isFinite(deadline) && deadline > current);
    if (!future.length) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.min(Math.min(...future) - current + 25, 2_147_483_647));
    return () => clearTimeout(timer);
  }, [plan, quote, checkoutScreen, now]);

  const load = useCallback(async () => {
    const turn = ++request.current;
    setLoading(true);
    try {
      const result = await api<StatusResponse>("/v1/ai/status", { cache: "no-store" });
      if (!alive.current || turn !== request.current) return;
      setPlan(result.subscription);
      setNow(Date.now());
      setCurrentTier(result.subscription.currentTier ?? (result.tier === "pro" ? "pro" : "standard"));
      setImportLimit(result.tier=== "pro" ? result.imports?.limit??30 : 30);
      setBenefits(result.subscription.complimentary ? result.benefits : result.proBenefits);
      setStandardBenefits(result.standardBenefits ?? (result.tier === 'standard' ? result.benefits : null));
      setCapabilities(result.capabilities);
      setError("");
      if (result.subscription.checkout) {
        key.current = result.subscription.checkout.request_id;
        setCoupon(result.subscription.checkout.discount_code ?? "");
        setSelectedTier(result.subscription.checkout.tier ?? "pro");
        setCheckoutScreen(true);
      }
    } catch (caught) {
      if (alive.current && turn === request.current)
        setError(
          caught instanceof Error
            ? caught.message
            : "Your Kira plan could not load. Try again.",
        );
    } finally {
      if (alive.current && turn === request.current) setLoading(false);
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

  const selected = plan?.catalog?.[selectedTier];
  const selectedName = selectedTier === "standard" ? "Standard" : "Pro";
  const checkout = plan?.checkout;
  const offerLive = Boolean(selected?.active && selected.available && selected.offer.active && selected.discountPercent > 0 && selected.discountAmountKobo > 0 &&
    (!selected.offer.startsAt || Date.parse(selected.offer.startsAt) <= now) &&
    (!selected.offer.endsAt || Date.parse(selected.offer.endsAt) > now));
  const listPrice = checkout?.listed_amount_kobo ?? quote?.listedAmountKobo ?? selected?.listedAmountKobo;
  const offerPercent = checkout?.offer_discount_percent ?? quote?.offerDiscountPercent ?? (offerLive ? selected?.discountPercent ?? 0 : 0);
  const amount = checkout?.amount_kobo ?? quote?.amountKobo ?? selected?.amountKobo;
  const discountAmount = checkout?.discount_amount_kobo ?? quote?.discountAmountKobo ?? selected?.discountAmountKobo ?? 0;
  const couponPercent = checkout?.coupon_discount_percent ?? quote?.couponDiscountPercent ?? 0;
  const quoteValid = Boolean(quote && quote.tier === selectedTier && Date.parse(quote.expiresAt) > now);
  const checkoutEnabled = selected?.checkoutEnabled ?? false;

  async function run(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        setQuote(null);
        setNotice("Review the refreshed total before paying.");
        await load();
      }
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
      key.current = randomUUID();
      const result = await fetchQuote(coupon);
      if (result && alive.current)
        setNotice(result.couponDiscountPercent > 0 ? `${result.couponDiscountPercent}% discount applied. Review your server total.` : "Your total is ready to review.");
    });
  }

  async function fetchQuote(discountCode = "", tier: Tier = selectedTier) {
    const result = await api<{ quote: PricingQuote }>("/v1/ai/subscription-quote", {
      method: "POST",
      body: JSON.stringify({ tier, discountCode: discountCode.trim(), requestId: key.current }),
    });
    const next = result?.quote;
    if (!next || next.tier !== tier || !next.quoteId || !Number.isSafeInteger(next.amountKobo) || next.amountKobo < 0 || next.paystackAmountKobo !== next.amountKobo || !Number.isFinite(Date.parse(next.expiresAt)))
      throw new Error("Your checkout quote could not be read. Try again.");
    if (!alive.current) return null;
    setQuote(next);
    setNow(Date.now());
    return next;
  }

  async function enterCheckout(tier: Tier = selectedTier) {
    if (!plan?.catalog?.[tier]?.checkoutEnabled || busy) return;
    await run(async () => {
      if (!checkout) {
        key.current = randomUUID();
        await fetchQuote("", tier);
      }
      if (alive.current) {
        setNotice("");
        setCheckoutScreen(true);
      }
    });
  }

  async function refreshQuote() {
    await run(async () => {
      key.current = randomUUID();
      await fetchQuote(coupon);
      if (alive.current) setNotice("The server total has been refreshed. Review it before paying.");
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
          ? `Payment confirmed. Kira ${selectedName} is active.`
          : result.payment.status === "REQUIRES_REVIEW"
            ? "Payment received and awaiting verification."
            : "Payment is still awaiting confirmation.",
      );
      await load();
    });
  }

  async function pay() {
    if (!checkoutEnabled || amount === undefined || (!checkout && !quoteValid)) return;
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
          tier: selectedTier,
          quoteId: checkout?.pricing_quote_id ?? checkout?.quote_id ?? quote?.quoteId,
          expectedAmountKobo: amount,
        }),
      });
      if (!alive.current) return;
      if (result.amountKobo !== amount)
        throw new Error("Your checkout total changed. Reopen checkout and try again.");
      await load();
      if (!alive.current) return;
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

  const benefitRows = (tier: Tier, allowance: Benefits | null) => allowance
    ? [
        { icon: "cloud-upload-outline" as const, title: `${tier === "standard" ? 5 : importLimit} imports each week`, detail: "Shared across calendars, timetables and Kira source files. Manual entries and grades stay free." },
        { icon: "bulb-outline" as const, title: tier === "standard" ? "Detailed everyday study answers" : "More room for detailed reasoning", detail: tier === "standard" ? "Teaching answers and worked examples for your everyday study." : "Longer teaching answers, worked examples and more conversation context." },
        {
          icon: "sparkles-outline" as const,
          title: allowance.studyLimit
            ? `${allowance.studyLimit} study generations ${tier === "standard" ? "in your trial" : "every month"}`
            : "Unlimited personal study allowance",
          detail: "Turn class material into summaries, detailed lessons, notes and quizzes.",
        },
        {
          icon: "chatbubbles-outline" as const,
          title: allowance.askMessagesPerWindow
            ? `Up to ${allowance.askMessagesPerWindow} Ask Kira messages every 15 minutes`
            : "Unlimited personal Ask Kira allowance",
          detail: "Keep longer study conversations moving without losing the thread.",
        },
        {
          icon: "layers-outline" as const,
          title: `${allowance.historyTurns} turns of conversation context`,
          detail: "Kira can follow your recent questions instead of treating every message as new.",
        },
        {
          icon: "time-outline" as const,
          title: `${allowance.historyDays} days of saved conversations`,
          detail: "Come back to recent study sessions when you need them again.",
        },
        {
          icon: "mic-outline" as const,
          title: `Voice transcription up to ${Math.max(1, Math.round(allowance.voiceMaxSeconds / 60))} minutes`,
          detail: "Speak a question or study prompt instead of typing it.",
        },
        {
          icon: "document-text-outline" as const,
          title: `Files up to ${fileSize(allowance.maxFileBytes)} each`,
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
      <ToolPage title="Kira checkout" refreshing={loading} onRefresh={() => void load()}>
        <View style={{ gap: 18, paddingVertical: 14 }}>
        {plan ? <View accessibilityRole="text" style={{flexDirection:"row",alignItems:"center",gap:8,padding:14,backgroundColor:theme.surfaceMuted,borderRadius:12}}><Ionicons name="checkmark-circle" size={18} color={theme.brand}/><Text style={{color:theme.text,fontFamily:theme.font.semibold}}>Current plan: {currentTier=== "pro" ? "Pro" : "Standard"}</Text></View> : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to Kira plan benefits"
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
            <Text style={{ ...heading, fontSize: 28, lineHeight: 34 }}>Kira {selectedName}</Text>
            <Text style={muted}>One month of {selectedName} access. No automatic renewal.</Text>
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

            {!plan?.checkout && offerPercent === 0 ? (
              <>
                <ToolField
                  label="Discount code"
                  value={coupon}
                  autoCapitalize="characters"
                  maxLength={32}
                  editable={!busy}
                  onChangeText={(value) => {
                    setCoupon(value);
                    setQuote(null);
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
                <Text style={muted}>Kira {selectedName} · 1 month</Text>
                <Text style={text}>{money(listPrice)}</Text>
              </View>
              {discountAmount > 0 ? (
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 16 }}>
                  <Text style={muted}>{offerPercent ? `${offerPercent}% offer` : couponPercent ? `${couponPercent}% discount` : "Discount"}</Text>
                  <Text style={{ ...text, color: theme.deepBrand }}>
                    −{money(discountAmount)}
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
              <Text style={muted}>Estimated total including processing. Paystack confirms its actual fee at checkout.</Text>
              {quote && !checkout ? <Text style={muted}>Total valid until {new Date(quote.expiresAt).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" })}.</Text> : null}
            </View>
          </View>

          {error ? (
            <Text accessibilityRole="alert" style={{ ...text, color: theme.error }}>
              {error}
            </Text>
          ) : null}
          {notice ? <Text style={{ ...text, color: theme.deepBrand }}>{notice}</Text> : null}
          {!checkout && !quoteValid ? (
            <View style={{ gap: 9 }}>
              <Text style={muted}>{quote ? "This quote has expired. Refresh the total before paying." : "Refresh the server total to review your checkout."}</Text>
              <ToolButton secondary label="Refresh total" disabled={busy || !checkoutEnabled} onPress={() => void refreshQuote()} />
            </View>
          ) : null}
          {error ? <ToolButton secondary label="Reload plan and payment" disabled={busy || loading} onPress={() => void load()} /> : null}

          <ToolButton
            label={
              busy
                ? "Please wait…"
                : plan?.checkout
                  ? `Continue payment · ${money(amount)}`
                  : `Pay ${money(amount)}`
            }
            disabled={
              busy ||
              !checkoutEnabled ||
              (!checkout && !quoteValid) ||
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
              Paystack confirms the processing fee at checkout. KampusOne does not store your card details.
            </Text>
          </View>
        </View>
      </ToolPage>
    );
  }

  return (
    <ToolPage title="Kira plans" refreshing={loading} onRefresh={() => void load()}>
      <View style={{ gap: 18, paddingVertical: 14 }}>
        {plan ? <View accessibilityRole="text" style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 14, backgroundColor: theme.surfaceMuted, borderRadius: 12 }}>
          <Ionicons name="checkmark-circle" size={18} color={theme.brand} />
          <Text style={{ color: theme.text, fontFamily: theme.font.semibold }}>Current plan: {currentTier === "pro" ? "Pro" : "Standard"}</Text>
        </View> : null}
        <Text style={muted}>Choose the study support that works for you. Each plan includes the features below.</Text>
        {(["standard", "pro"] as const).map((tier) => {
          const catalog = plan?.catalog?.[tier];
          const allowance = tier === "standard" ? standardBenefits : benefits;
          const name = tier === "standard" ? "Standard" : "Pro";
          const complimentary = tier === "pro" && plan?.complimentary;
          const free = catalog?.amountKobo === 0;
          const isCurrent = currentTier === tier;
          return <View key={tier} style={{ borderRadius: 22, borderWidth: 1, borderColor: tier === "pro" ? theme.brand : theme.border, backgroundColor: tier === "pro" ? theme.surfaceSoft : theme.surface, padding: 18 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <Text style={{ ...heading, fontSize: 24 }}>Kira {name}</Text>
              {isCurrent ? <Text style={{ ...muted, color: theme.deepBrand }}>Current plan</Text> : null}
            </View>
            <Text style={{ ...heading, fontSize: 29, lineHeight: 36, marginTop: 10 }}>
              {complimentary ? "Complimentary" : free ? "Free" : catalog ? `${money(catalog.amountKobo)} / month` : plan ? "Pricing unavailable" : "Loading price…"}
            </Text>
            {!complimentary ? <CatalogOffer plan={catalog} now={now} /> : null}
            <Text style={{ ...muted, marginTop: 7, marginBottom: 8 }}>{tier === "standard" ? "Everyday study help, teaching answers and worked examples." : "More generations, longer lessons and more room to reason through your material."}</Text>
            {benefitRows(tier, allowance).map((row) => <BenefitRow key={row.title} {...row} />)}
            {isCurrent && plan?.currentPeriodEnd ? <Text style={{ ...muted, marginVertical: 10 }}>Active until {new Date(plan.currentPeriodEnd).toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" })}</Text> : null}
            {complimentary ? <Text style={muted}>Your owner account has complimentary Pro access.</Text> : <ToolButton
              label={free ? "Standard is included" : checkout && (checkout.tier ?? "pro") === tier ? "Continue your payment" : catalog?.checkoutEnabled ? `Continue with ${name}` : isCurrent ? `${name} is active` : `${name} is unavailable`}
              disabled={busy || free || !catalog?.checkoutEnabled || Boolean(checkout && (checkout.tier ?? "pro") !== tier)}
              onPress={() => {
                setSelectedTier(tier); setQuote(null); setCoupon(checkout?.discount_code ?? ""); setNotice("");
                if (!checkout) key.current = randomUUID();
                // Quote the selected card explicitly; state updates are async.
                void enterCheckout(tier);
              }}
            />}
          </View>;
        })}
        {error ? <Text accessibilityRole="alert" style={{ ...text, color: theme.error }}>{error}</Text> : null}
        {error ? <ToolButton secondary label="Try again" disabled={busy || loading} onPress={() => void load()} /> : null}
        <Text style={{ ...muted, textAlign: "center", paddingHorizontal: 16 }}>Paystack confirms processing at checkout. No automatic renewal. Access starts when payment is confirmed.</Text>
      </View>
    </ToolPage>
  );
}
