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
  feeBearer: "INCLUDED_IN_PRICE";
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
  const selectedBenefits = selectedTier === "standard" ? standardBenefits : benefits;
  const checkout = plan?.checkout;
  const offerLive = Boolean(selected?.active && selected.available && selected.offer.active && selected.discountPercent > 0 && selected.discountAmountKobo > 0 &&
    (!selected.offer.startsAt || Date.parse(selected.offer.startsAt) <= now) &&
    (!selected.offer.endsAt || Date.parse(selected.offer.endsAt) > now));
  const listPrice = checkout?.listed_amount_kobo ?? quote?.listedAmountKobo ?? selected?.listedAmountKobo;
  const offerPrice = selected?.amountKobo;
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

  async function fetchQuote(discountCode = "") {
    const result = await api<{ quote: PricingQuote }>("/v1/ai/subscription-quote", {
      method: "POST",
      body: JSON.stringify({ tier: selectedTier, discountCode: discountCode.trim(), requestId: key.current }),
    });
    const next = result?.quote;
    if (!next || next.tier !== selectedTier || !next.quoteId || !Number.isSafeInteger(next.amountKobo) || next.amountKobo < 0 || next.paystackAmountKobo !== next.amountKobo || !Number.isFinite(Date.parse(next.expiresAt)))
      throw new Error("Your checkout quote could not be read. Try again.");
    if (!alive.current) return null;
    setQuote(next);
    setNow(Date.now());
    return next;
  }

  async function enterCheckout() {
    if (!checkoutEnabled || busy) return;
    await run(async () => {
      if (!checkout) {
        key.current = randomUUID();
        await fetchQuote();
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

  const benefitRows = selectedBenefits
    ? [
        { icon: "cloud-upload-outline" as const, title: `${selectedTier === "standard" ? 5 : importLimit} imports each week`, detail: "Shared across calendars, timetables and Kira source files. Manual entries and grades stay free." },
        { icon: "bulb-outline" as const, title: selectedTier === "standard" ? "Detailed everyday study answers" : "More room for detailed reasoning", detail: selectedTier === "standard" ? "Teaching answers and worked examples for your everyday study." : "Longer teaching answers, worked examples and more conversation context." },
        {
          icon: "sparkles-outline" as const,
          title: selectedBenefits.studyLimit
            ? `${selectedBenefits.studyLimit} study generations ${selectedTier === "standard" ? "in your trial" : "every month"}`
            : "Unlimited personal study allowance",
          detail: "Turn class material into summaries, detailed lessons, notes and quizzes.",
        },
        {
          icon: "chatbubbles-outline" as const,
          title: selectedBenefits.askMessagesPerWindow
            ? `Up to ${selectedBenefits.askMessagesPerWindow} Ask Kira messages every 15 minutes`
            : "Unlimited personal Ask Kira allowance",
          detail: "Keep longer study conversations moving without losing the thread.",
        },
        {
          icon: "layers-outline" as const,
          title: `${selectedBenefits.historyTurns} turns of conversation context`,
          detail: "Kira can follow your recent questions instead of treating every message as new.",
        },
        {
          icon: "time-outline" as const,
          title: `${selectedBenefits.historyDays} days of saved conversations`,
          detail: "Come back to recent study sessions when you need them again.",
        },
        {
          icon: "mic-outline" as const,
          title: `Voice transcription up to ${Math.max(1, Math.round(selectedBenefits.voiceMaxSeconds / 60))} minutes`,
          detail: "Speak a question or study prompt instead of typing it.",
        },
        {
          icon: "document-text-outline" as const,
          title: `Files up to ${fileSize(selectedBenefits.maxFileBytes)} each`,
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
              <Text style={muted}>This is the amount you’ll pay in Paystack. Processing is included.</Text>
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
              Payment opens in Paystack. KampusOne does not store your card details.
            </Text>
          </View>
        </View>
      </ToolPage>
    );
  }

  return (
    <ToolPage title="Kira plans" refreshing={loading} onRefresh={() => void load()}>
      <View style={{ gap: 18, paddingVertical: 14 }}>
        {plan ? <View accessibilityRole="text" style={{flexDirection:"row",alignItems:"center",gap:8,padding:14,backgroundColor:theme.surfaceMuted,borderRadius:12}}><Ionicons name="checkmark-circle" size={18} color={theme.brand}/><Text style={{color:theme.text,fontFamily:theme.font.semibold}}>Current plan: {currentTier=== "pro" ? "Pro" : "Standard"}</Text></View> : null}
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
              KIRA {selectedName.toUpperCase()}
            </Text>
          </View>
          <Text style={{ ...heading, fontSize: 37, lineHeight: 43 }}>
            {plan?.complimentary && selectedTier === "pro" ? "Pro is active" : offerPrice === 0 ? "Free" : selected ? `${money(offerPrice)} / month` : plan ? "Pricing unavailable" : "Loading price…"}
          </Text>
          {!plan?.complimentary && offerLive ? (
            <View style={{flexDirection:"row",flexWrap:"wrap",gap:10,alignItems:"center"}}>
              <Text style={{...muted,textDecorationLine:"line-through"}}>{money(selected?.listedAmountKobo)} / month</Text>
              <Text style={{color:theme.deepBrand,fontFamily:theme.font.semibold,fontSize:13}}>{selected?.discountPercent}% off</Text>
            </View>
          ) : null}
          {offerLive && !plan?.complimentary && selected?.offer ? <Text style={muted}>{offerDates(selected.offer.startsAt, selected.offer.endsAt)}</Text> : null}
          <Text style={{ ...muted, fontSize: 13.5, lineHeight: 21 }}>
            {plan?.complimentary && selectedTier === "pro"
              ? "Your KampusOne owner account has complimentary Pro access."
              : selectedTier === "standard" ? "Detailed everyday study answers with Standard allowances." : "More study generations, longer context, voice and file support. One month at a time with no automatic renewal."}
          </Text>
          {plan?.currentPeriodEnd && selectedTier === currentTier ? (
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

        {standardBenefits && benefits ? (
          <View style={{borderRadius:18,borderWidth:1,borderColor:theme.border,backgroundColor:theme.surface,padding:17,gap:12}}>
            <Text style={{...heading,fontSize:18}}>Choose your study pace</Text>
            <View style={{flexDirection:"row",gap:12}}>
              <View style={{flex:1,gap:6}}>
                <Text style={{...text,fontFamily:theme.font.semibold}}>Standard{currentTier === 'standard' ? ' · Selected' : ''}</Text>
                <Text style={muted}>{plan?.catalog?.standard?.amountKobo === 0 ? "Free" : plan?.catalog?.standard ? `${money(plan.catalog.standard.amountKobo)} / month` : "Pricing unavailable"}</Text>
                <CatalogOffer plan={plan?.catalog?.standard} now={now} />
                <Text style={muted}>5 imports / week</Text>
                <Text style={muted}>{standardBenefits.studyLimit} study generations in your trial</Text>
                <Text style={muted}>{standardBenefits.askMessagesPerWindow} messages / 15 min</Text>
                <Text style={muted}>{standardBenefits.historyTurns} turns of context</Text>
                <Text style={muted}>Detailed answers for everyday study</Text>
                <ToolButton secondary label={selectedTier === "standard" ? "Viewing Standard" : "View Standard"} disabled={busy || Boolean(checkout)} onPress={() => { setSelectedTier("standard"); setQuote(null); setCoupon(""); setNotice(""); key.current = randomUUID(); }} />
              </View>
              <View style={{flex:1,gap:6,borderLeftWidth:1,borderLeftColor:theme.border,paddingLeft:12}}>
                <Text style={{...text,fontFamily:theme.font.semibold,color:theme.deepBrand}}>Pro{currentTier === 'pro' ? ' · Selected' : ''}</Text>
                <Text style={muted}>{plan?.complimentary ? 'Complimentary' : plan?.catalog?.pro ? `${money(plan.catalog.pro.amountKobo)} / month` : "Pricing unavailable"}</Text>
                {!plan?.complimentary ? <CatalogOffer plan={plan?.catalog?.pro} now={now} /> : null}
                <Text style={muted}>{importLimit} imports / week</Text>
                <Text style={muted}>{benefits.studyLimit === null ? 'Unlimited personal study allowance' : `${benefits.studyLimit} study generations / month`}</Text>
                <Text style={muted}>{benefits.askMessagesPerWindow === null ? 'Unlimited personal Ask Kira allowance' : `${benefits.askMessagesPerWindow} messages / 15 min`}</Text>
                <Text style={muted}>{benefits.historyTurns} turns of context</Text>
                <Text style={muted}>Longer lessons and more reasoning space</Text>
                <ToolButton secondary label={selectedTier === "pro" ? "Viewing Pro" : "View Pro"} disabled={busy || Boolean(checkout)} onPress={() => { setSelectedTier("pro"); setQuote(null); setCoupon(""); setNotice(""); key.current = randomUUID(); }} />
              </View>
            </View>
          </View>
        ) : null}

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
        {error ? <ToolButton secondary label="Try again" disabled={busy || loading} onPress={() => void load()} /> : null}
        {plan && !selected?.available && !plan.complimentary ? (
          <Text style={muted}>
            Kira {selectedName} checkout is not available for this campus yet.
          </Text>
        ) : null}

        {!plan?.complimentary ? (
          <ToolButton
            label={
              offerPrice === 0 ? "Standard is included" : plan?.currentPeriodEnd && selectedTier === currentTier && !checkoutEnabled
                ? `${selectedName} is active`
                : `Continue with ${selectedName}`
            }
            disabled={
              busy ||
              !checkoutEnabled ||
              offerPrice === 0
            }
            onPress={() => void enterCheckout()}
          />
        ) : null}

        <Text style={{ ...muted, textAlign: "center", paddingHorizontal: 16 }}>
          No automatic renewal. Access starts when payment is confirmed.
        </Text>
      </View>
    </ToolPage>
  );
}
