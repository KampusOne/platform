import { useCallback, useRef, useState } from "react";
import {
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useAuth } from "@/src/auth/auth-context";
import { useAppearance } from "@/src/lib/appearance";
import { api, peekApiCache } from "@/src/lib/api";
import { shareItem } from "@/src/lib/share-content";
import { validPostId } from "@/src/lib/feed-posts";
import { ProfileAvatar } from "@/src/components/profile-avatar";
import { MediaImage } from "@/src/components/media-image";
import { ScreenSkeleton } from "@/src/components/skeleton";
import { useToast } from "@/src/components/toast";

type Product = {
  id: string;
  name: string;
  description: string;
  price_kobo: number;
  stock_quantity: number;
  image_url: string | null;
};
type Tutorial = {
  id: string;
  title: string;
  description: string;
  course_code: string;
  price_kobo: number;
};
type Review = {
  id: string;
  rating: number;
  body: string | null;
  created_at: string;
  reviewer_name: string;
  reviewer_image_url: string | null;
  item_name: string;
};
type Business = {
  id: string;
  agent_type: "VENDOR" | "TUTOR" | "RIDER";
  user_id: string;
  display_name: string;
  biography: string | null;
  owner_name: string;
  username: string | null;
  profile_image_url: string | null;
  cover_image_url: string | null;
  contact_phone_e164: string | null;
  whatsapp_e164: string | null;
  pickup_location: string | null;
  categories: string[];
  follower_count: number;
  followed: boolean;
  product_count: number;
  tutorial_count: number;
  completed_trip_count: number;
  rating: number;
  review_count: number;
};
type Result = {
  service: Business;
  products: Product[];
  tutorials: Tutorial[];
  reviews: Review[];
  selectedProductId?: string;
  commerceAvailable: boolean;
  isOwner: boolean;
  reviewPurchase?:{resourceType:"STORE_ORDER"|"TUTORIAL_BOOKING";resourceId:string}|null;
};
const money = (value: number) =>
  new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0,
  }).format(value / 100);
const labels = {
  VENDOR: "Vendor profile",
  TUTOR: "Tutor profile",
  RIDER: "Rider profile",
};

export default function StudentService() {
  const { id, product } = useLocalSearchParams<{
    id?: string;
    product?: string;
  }>();
  const { user } = useAuth();
  const { theme } = useAppearance();
  const toast = useToast();
  const [data, setData] = useState<Result>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const scope = `${user?.id}:${id}:${product}`;
  const current = useRef(scope);
  current.current = scope;
  const generation = useRef(0);
  const load = useCallback(async () => {
    const n = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const target = product ?? id;
      if (!validPostId(target))
        throw new Error("This campus business link is not valid.");
      const result = await api<Result>(
        `/v1/people/${product ? "products" : "services"}/${target}`,
        { cache: "reload" },
      );
      if (n === generation.current && scope === current.current)
        setData(result);
    } catch (e) {
      if (n === generation.current && scope === current.current)
        setError(
          e instanceof Error ? e.message : "This business could not load.",
        );
    } finally {
      if (n === generation.current && scope === current.current)
        setLoading(false);
    }
  }, [scope, id, product]);
  useFocusEffect(
    useCallback(() => {
      const target = product ?? id;
      setData(validPostId(target) ? peekApiCache<Result>(`/v1/people/${product ? "products" : "services"}/${target}`) : undefined);
      void load();
      return () => {
        generation.current++;
      };
    }, [load]),
  );
  async function follow() {
    if (!data || busy) return;
    setBusy(true);
    try {
      const result = await api<{ followed: boolean; follower_count: number }>(
        `/v1/people/${data.service.user_id}/follow`,
        {
          method: "PUT",
          body: JSON.stringify({ follow: !data.service.followed }),
        },
      );
      setData((previous) =>
        previous
          ? { ...previous, service: { ...previous.service, ...result } }
          : previous,
      );
    } catch (e) {
      toast(
        e instanceof Error ? e.message : "Your follow could not be saved.",
        "error",
      );
    } finally {
      setBusy(false);
    }
  }
  async function message() {
    if (!data || busy) return;
    setBusy(true);
    try {
      const result = await api<{ thread: { id: string } }>(
        "/v1/messages/threads",
        {
          method: "POST",
          body: JSON.stringify({ userId: data.service.user_id }),
        },
      );
      router.push({
        pathname: "/conversation",
        params: { id: result.thread.id },
      });
    } catch (e) {
      toast(
        e instanceof Error ? e.message : "Messaging could not open.",
        "error",
      );
    } finally {
      setBusy(false);
    }
  }
  async function openContact(url: string) {
    try {
      await Linking.openURL(url);
    } catch {
      toast("This contact app could not open on your device.", "error");
    }
  }
  const b = data?.service;
  const body = {
    fontFamily: theme.font.body,
    color: theme.text,
    fontSize: 14,
    lineHeight: 22,
  };
  const muted = { ...body, color: theme.textMuted };
  const items = data?.selectedProductId
    ? data.products.filter((p) => p.id === data.selectedProductId)
    : (data?.products ?? []);
  const iconButton = (
    icon: keyof typeof Ionicons.glyphMap,
    label: string,
    onPress: () => void,
  ) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        width: 44,
        height: 44,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <Ionicons name={icon} color={theme.text} size={22} />
    </Pressable>
  );
  const contact = (
    label: string,
    icon: keyof typeof Ionicons.glyphMap,
    onPress: () => void,
  ) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      disabled={busy}
      onPress={onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 7,
        minHeight: 44,
        paddingHorizontal: 12,
        borderWidth: 1,
        borderColor: theme.border,
        borderRadius: 10,
      }}
    >
      <Ionicons name={icon} size={18} color={theme.text} />
      <Text style={body}>{label}</Text>
    </Pressable>
  );
  return (
    <SafeAreaView
      edges={["top", "bottom"]}
      style={{ flex: 1, backgroundColor: theme.canvas }}
    >
      <View
        style={{ flex: 1, width: "100%", maxWidth: 660, alignSelf: "center" }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: 8,
            minHeight: 54,
          }}
        >
          {iconButton("arrow-back", "Go back", () =>
            router.canGoBack() ? router.back() : router.replace("/(tabs)/feed"),
          )}
          <Text
            style={{
              ...body,
              fontFamily: theme.font.semibold,
              fontSize: 17,
              flex: 1,
            }}
          >
            {b ? labels[b.agent_type] : "Business profile"}
          </Text>
          {b
            ? iconButton("share-outline", "Share business profile", () => {
                void shareItem("business", b.id, b.display_name).catch(() => toast("Sharing could not open.", "error"));
              })
            : null}
        </View>
        {loading && !data ? (
          <ScreenSkeleton />
        ) : !data ? (
          <View style={{ padding: 24, gap: 18 }}>
            <Text accessibilityRole="alert" style={body}>
              {error}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => void load()}
              style={{ minHeight: 44 }}
            >
              <Text style={{ ...body, color: theme.brand }}>Try again</Text>
            </Pressable>
          </View>
        ) : b ? (
          <ScrollView
            refreshControl={
              <RefreshControl
                refreshing={loading}
                onRefresh={() => void load()}
                tintColor={theme.brand}
              />
            }
            contentContainerStyle={{ paddingBottom: 40 }}
          >
            {error ? (
              <Text accessibilityRole="alert" style={{ ...body, padding: 16 }}>
                {error}
              </Text>
            ) : null}
            {b.cover_image_url ? (
              <MediaImage
                uri={b.cover_image_url}
                accessibilityLabel={`${b.display_name} cover`}
                style={{ width: "100%", height: 164 }}
                resizeMode="cover"
              />
            ) : (
              <View
                style={{
                  height: 134,
                  backgroundColor: theme.sand,
                  padding: 24,
                  justifyContent: "center",
                }}
              >
                <Ionicons
                  name={
                    b.agent_type === "VENDOR"
                      ? "storefront-outline"
                      : b.agent_type === "TUTOR"
                        ? "school-outline"
                        : "bicycle-outline"
                  }
                  size={52}
                  color={theme.deepBrand}
                />
              </View>
            )}
            <View style={{ paddingHorizontal: 20 }}>
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "flex-end",
                  marginTop: -35,
                }}
              >
                <View
                  style={{
                    borderWidth: 4,
                    borderColor: theme.canvas,
                    borderRadius: 23,
                    backgroundColor: theme.canvas,
                  }}
                >
                  <ProfileAvatar
                    name={b.display_name}
                    imageUrl={b.profile_image_url}
                    size={88}
                    square
                  />
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: busy }}
                  disabled={busy}
                  onPress={() =>
                    data.isOwner
                      ? router.push({
                          pathname: "/business-profile-edit",
                          params: { id: b.id },
                        })
                      : void follow()
                  }
                  style={{
                    borderWidth: 1,
                    borderColor:
                      data.isOwner || b.followed
                        ? theme.border
                        : theme.deepBrand,
                    backgroundColor:
                      data.isOwner || b.followed
                        ? theme.surface
                        : theme.deepBrand,
                    borderRadius: 12,
                    minHeight: 42,
                    paddingHorizontal: 18,
                    alignItems: "center",
                    justifyContent: "center",
                    opacity: busy ? 0.5 : 1,
                  }}
                >
                  <Text
                    style={{
                      ...body,
                      fontFamily: theme.font.semibold,
                      color: data.isOwner || b.followed ? theme.text : "#fff",
                    }}
                  >
                    {data.isOwner
                      ? "Edit profile"
                      : b.followed
                        ? "Following"
                        : "Follow"}
                  </Text>
                </Pressable>
              </View>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  marginTop: 14,
                }}
              >
                <Text
                  style={{
                    ...body,
                    fontFamily: theme.font.displayStrong,
                    fontSize: 27,
                    lineHeight: 34,
                    flexShrink: 1,
                  }}
                >
                  {b.display_name}
                </Text>
                <Ionicons
                  accessibilityLabel="Approved campus business"
                  name="checkmark-circle"
                  size={21}
                  color={theme.brand}
                />
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`View ${b.owner_name}'s personal profile`}
                onPress={() =>
                  router.push({
                    pathname: "/student-profile",
                    params: { id: b.user_id },
                  })
                }
                style={{ paddingTop: 4, minHeight: 44 }}
              >
                <Text style={{ ...body, fontFamily: theme.font.medium }}>
                  {b.owner_name}
                </Text>
                {b.username ? <Text style={muted}>@{b.username}</Text> : null}
              </Pressable>
              {b.categories.length ? (
                <View
                  style={{
                    flexDirection: "row",
                    flexWrap: "wrap",
                    gap: 7,
                    marginTop: 12,
                  }}
                >
                  {b.categories.map((category) => (
                    <View
                      key={category}
                      style={{
                        backgroundColor: theme.surfaceMuted,
                        borderRadius: 6,
                        paddingHorizontal: 9,
                        paddingVertical: 5,
                      }}
                    >
                      <Text
                        style={{
                          ...body,
                          color: theme.accentText,
                          fontSize: 12,
                          lineHeight: 17,
                        }}
                      >
                        {category}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}
              {b.biography ? (
                <Text selectable style={{ ...body, marginTop: 14 }}>
                  {b.biography}
                </Text>
              ) : null}
              {b.pickup_location ? (
                <View style={{ flexDirection: "row", gap: 6, marginTop: 12 }}>
                  <Ionicons
                    name="location-outline"
                    size={18}
                    color={theme.textMuted}
                  />
                  <Text style={{ ...muted, flex: 1 }}>{b.pickup_location}</Text>
                </View>
              ) : null}
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  gap: 16,
                  padding: 16,
                  marginVertical: 17,
                  borderRadius: 16,
                  backgroundColor: theme.surfaceMuted,
                }}
              >
                <Text style={muted}>
                  <Text
                    style={{
                      color: theme.text,
                      fontFamily: theme.font.semibold,
                    }}
                  >
                    {b.follower_count.toLocaleString()}{" "}
                  </Text>
                  followers
                </Text>
                <Text style={muted}>
                  <Text
                    style={{
                      color: theme.text,
                      fontFamily: theme.font.semibold,
                    }}
                  >
                    {(b.agent_type === "VENDOR"
                      ? b.product_count
                      : b.agent_type === "TUTOR"
                        ? b.tutorial_count
                        : b.completed_trip_count
                    ).toLocaleString()}{" "}
                  </Text>
                  {b.agent_type === "VENDOR"
                    ? "products"
                    : b.agent_type === "TUTOR"
                      ? "tutorials"
                      : "completed rides"}
                </Text>
              </View>
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  gap: 8,
                  paddingBottom: 22,
                }}
              >
                {!data.isOwner
                  ? contact(
                      "Message",
                      "chatbubble-outline",
                      () => void message(),
                    )
                  : null}
                {b.contact_phone_e164
                  ? contact(
                      "Call",
                      "call-outline",
                      () => void openContact(`tel:${b.contact_phone_e164}`),
                    )
                  : null}
                {b.whatsapp_e164
                  ? contact(
                      "WhatsApp",
                      "logo-whatsapp",
                      () =>
                        void openContact(
                          `https://wa.me/${b.whatsapp_e164!.replace(/\D/g, "")}`,
                        ),
                    )
                  : null}
              </View>
            </View>
            <View
              style={{
                borderTopWidth: 1,
                borderBottomWidth: 1,
                borderColor: theme.border,
                paddingVertical: 20,
              }}
            >
              <View
                style={{
                  paddingHorizontal: 20,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <Text
                  style={{
                    ...body,
                    fontFamily: theme.font.semibold,
                    fontSize: 18,
                  }}
                >
                  Reviews
                </Text>
                <Text style={muted}>
                  {b.review_count
                    ? `★ ${b.rating.toFixed(1)} · ${b.review_count}`
                    : "No ratings yet"}
                </Text>
              </View>
              {data.reviewPurchase?<Pressable accessibilityRole="button" onPress={()=>{
                const purchase=data.reviewPurchase!;
                if(purchase.resourceType==='STORE_ORDER')router.push({pathname:'/order-detail',params:{id:purchase.resourceId,review:'1'}});
                else router.push('/(tabs)/purchases');
              }} style={({pressed})=>({paddingHorizontal:20,paddingTop:16,opacity:pressed?0.6:1})}><Text style={{...body,color:theme.accentText,fontFamily:theme.font.semibold}}>Review your purchase</Text></Pressable>:null}
              {data.reviews.length ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{
                    gap: 12,
                    padding: 20,
                    paddingBottom: 0,
                  }}
                >
                  {data.reviews.map((review) => (
                    <View
                      key={review.id}
                      style={{
                        width: 275,
                        padding: 16,
                        backgroundColor: theme.surface,
                        borderWidth: 1,
                        borderColor: theme.border,
                        borderRadius: 14,
                        gap: 8,
                      }}
                    >
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 9,
                        }}
                      >
                        <ProfileAvatar
                          name={review.reviewer_name}
                          imageUrl={review.reviewer_image_url}
                          size={32}
                        />
                        <Text
                          numberOfLines={1}
                          style={{
                            ...body,
                            fontFamily: theme.font.semibold,
                            flex: 1,
                          }}
                        >
                          {review.reviewer_name}
                        </Text>
                      </View>
                      <Text
                        accessibilityLabel={`${review.rating} out of 5 stars`}
                        style={{ color: theme.brand, letterSpacing: 3 }}
                      >
                        {"★".repeat(review.rating)}
                        {"☆".repeat(5 - review.rating)}
                      </Text>
                      {review.body ? (
                        <Text style={body}>{review.body}</Text>
                      ) : null}
                      <Text
                        numberOfLines={1}
                        style={{ ...muted, fontSize: 12 }}
                      >
                        Verified purchase · {review.item_name}
                      </Text>
                      <Text style={{ ...muted, fontSize: 11 }}>
                        {new Date(review.created_at).toLocaleDateString()}
                      </Text>
                    </View>
                  ))}
                </ScrollView>
              ) : (
                <Text
                  style={{ ...muted, paddingHorizontal: 20, paddingTop: 12 }}
                >
                  {b.agent_type === "RIDER"
                    ? "No reviews yet."
                    : "Reviews from completed purchases appear here. You can leave yours from your orders."}
                </Text>
              )}
            </View>
            {b.agent_type !== "RIDER" ? (
              <View style={{ padding: 20 }}>
                <Text
                  style={{
                    ...body,
                    fontFamily: theme.font.semibold,
                    fontSize: 19,
                    marginBottom: 18,
                  }}
                >
                  {data.selectedProductId
                    ? "Product"
                    : b.agent_type === "VENDOR"
                      ? "Products"
                      : "Tutorials"}
                </Text>
                {!data.commerceAvailable ? (
                  <Text style={muted}>
                    This {b.agent_type === "VENDOR" ? "store" : "tutor"} is
                    preparing to open. Follow for updates.
                  </Text>
                ) : b.agent_type === "VENDOR" ? (
                  <>
                    <View
                      style={{
                        flexDirection: "row",
                        flexWrap: "wrap",
                        gap: 14,
                      }}
                    >
                      {items.map((item) => (
                        <Pressable
                          key={item.id}
                          accessibilityRole="button"
                          accessibilityLabel={`${item.name}, ${money(item.price_kobo)}`}
                          onPress={() =>
                            router.push({
                              pathname: "/(tabs)/store",
                              params: { product: item.id },
                            })
                          }
                          style={{
                            width: data.selectedProductId ? "100%" : "47.5%",
                            marginBottom: 4,
                            backgroundColor: theme.surface,
                            borderWidth: 1,
                            borderColor: theme.border,
                            borderRadius: 18,
                            padding: 9,
                          }}
                        >
                          {item.image_url ? (
                            <MediaImage
                              uri={item.image_url}
                              accessibilityLabel={item.name}
                              style={{
                                width: "100%",
                                aspectRatio: 1,
                                borderRadius: 12,
                              }}
                              resizeMode="cover"
                            />
                          ) : (
                            <View
                              style={{
                                width: "100%",
                                aspectRatio: 1,
                                borderRadius: 12,
                                backgroundColor: theme.surfaceMuted,
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                            >
                              <Ionicons
                                name="bag-outline"
                                size={34}
                                color={theme.textMuted}
                              />
                            </View>
                          )}
                          <Text
                            numberOfLines={2}
                            style={{
                              ...body,
                              fontFamily: theme.font.semibold,
                              marginTop: 9,
                              marginBottom: 4,
                            }}
                          >
                            {item.name}
                          </Text>
                          <Text
                            style={{
                              ...body,
                              color: theme.accentText,
                              fontFamily: theme.font.semibold,
                            }}
                          >
                            {money(item.price_kobo)}
                          </Text>
                          {item.stock_quantity <= 0 ? (
                            <Text style={{ ...muted, fontSize: 12 }}>
                              Sold out
                            </Text>
                          ) : null}
                          {data.selectedProductId ? (
                            <Text style={{ ...body, marginTop: 8 }}>
                              {item.description}
                            </Text>
                          ) : null}
                        </Pressable>
                      ))}
                    </View>
                    {!items.length ? (
                      <Text style={muted}>No products are published yet.</Text>
                    ) : null}
                    {data.selectedProductId ? (
                      <Pressable
                        accessibilityRole="button"
                        onPress={() =>
                          router.replace({
                            pathname: "/student-service",
                            params: { id: b.id },
                          })
                        }
                        style={{ minHeight: 44, paddingVertical: 10 }}
                      >
                        <Text style={{ ...body, color: theme.accentText }}>
                          See all store products →
                        </Text>
                      </Pressable>
                    ) : null}
                  </>
                ) : data.tutorials.length ? (
                  data.tutorials.map((item) => (
                    <Pressable
                      key={item.id}
                      accessibilityRole="button"
                      onPress={() =>
                        router.push({
                          pathname: "/(tabs)/tutorials",
                          params: { listing: item.id },
                        })
                      }
                      style={{
                        paddingVertical: 18,
                        borderBottomWidth: 1,
                        borderColor: theme.border,
                      }}
                    >
                      <Text
                        style={{
                          ...body,
                          fontFamily: theme.font.semibold,
                          fontSize: 17,
                        }}
                      >
                        {item.title}
                      </Text>
                      <Text style={{ ...muted, marginTop: 5 }}>
                        {item.course_code} · {money(item.price_kobo)}
                      </Text>
                      <Text numberOfLines={3} style={{ ...body, marginTop: 8 }}>
                        {item.description}
                      </Text>
                      <Text
                        style={{
                          ...body,
                          color: theme.accentText,
                          marginTop: 10,
                        }}
                      >
                        See availability →
                      </Text>
                    </Pressable>
                  ))
                ) : (
                  <Text style={muted}>No tutorials are published yet.</Text>
                )}
              </View>
            ) : null}
          </ScrollView>
        ) : null}
      </View>
    </SafeAreaView>
  );
}
