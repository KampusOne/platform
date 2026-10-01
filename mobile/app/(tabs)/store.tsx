import {DiscountCodeField} from "@/src/components/discount-code-field";
import { CampusPlaceChoice } from "@/src/components/campus-place-choice";
import * as Crypto from "expo-crypto";
import { InlineLoading } from "@/src/components/skeleton";
import { useThemeStyles, type Theme } from "@/src/lib/appearance";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Easing,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PopularShops } from "@/src/components/popular-shops";
import { CreateAction } from "@/src/components/create-action";

import { useReducedMotionPreference } from "@/src/components/visual-system";
import { ApiError, api } from "@/src/lib/api";
import { useToast } from "@/src/components/toast";
import { shareItem } from "@/src/lib/share-content";
import { theme } from "@/src/theme";

type Product = {
  id: string;
  vendor_profile_id: string;
  name: string;
  description: string;
  category: string;
  price_kobo: number;
  pricing_ready?: boolean;
  stock_quantity: number;
  image_url: string | null;
  vendor_name: string;
  pickup_enabled?: boolean;
  self_delivery_enabled?: boolean;
  pickup_location?: string;
  is_demo?: boolean;
};

type Zone = { id: string; name: string; base_fee_kobo: number };
type CheckoutQuote = {
  id: string;
  pricing: {
    listedItemsKobo: number;
    discountKobo: number;
    fareKobo: number;
    cashDueKobo: number;
    payableKobo: number;
    totalKobo: number;
  };
  expiresAt: string;
  fare: { routeMetres: number; distanceBasis: string;routeAccessNotice?:string|null } | null;
};
type Cart = Record<string, number>;
type CatalogIssue = { code: string; message: string };
type CatalogueMode = "DEMO" | "LIVE";
type CatalogResponse = {
  products: Product[];
  deliveryZones: Zone[];
  catalogueMode?: CatalogueMode;
  checkoutEnabled?: boolean;
  riderDeliveryEnabled?: boolean;
};

const naira = (kobo: number) =>
  new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0,
  }).format(Number(kobo) / 100);

export default function StoreScreen() {
  const { product: focusedProduct } = useLocalSearchParams<{
    product?: string;
  }>();
  useFocusEffect(
    useCallback(
      () => () => {
        if (focusedProduct) router.setParams({ product: undefined });
      },
      [focusedProduct],
    ),
  );
  const { theme, styles } = useThemeStyles(createStyles);

  const { width: windowWidth } = useWindowDimensions();
  const compactPhone = windowWidth < 400;
  const contentWidth = Math.min(windowWidth, 540);
  const horizontalPadding = compactPhone ? 14 : 20;
  const productWidth = compactPhone
    ? contentWidth - horizontalPadding * 2
    : (contentWidth - 52) / 2;
  const entry = useRef(new Animated.Value(0)).current;
  const [products, setProducts] = useState<Product[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [riderDeliveryEnabled, setRiderDeliveryEnabled] = useState(false);
  const [fulfilmentMode, setFulfilmentMode] = useState<
    "RIDER" | "PICKUP" | "VENDOR_DELIVERY"
  >("RIDER");
  const [deliveryPlace, setDeliveryPlace] = useState<string | null>(null);
  const [recipientName, setRecipientName] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [deliveryLocation, setDeliveryLocation] = useState("");
  const [cart, setCart] = useState<Cart>({});
  const [query, setQuery] = useState("");
  const [selectedShop, setSelectedShop] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [selectedZoneId, setSelectedZoneId] = useState("");
  const [deliveryNote, setDeliveryNote] = useState("");
  const [cartOpen, setCartOpen] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const [noteFocused, setNoteFocused] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [catalogueMode, setCatalogueMode] = useState<CatalogueMode>("LIVE");
  const [checkoutEnabled, setCheckoutEnabled] = useState(false);
  const [catalogIssue, setCatalogIssue] = useState<CatalogIssue | null>(null);
  const [discountCode,setDiscountCode]=useState("");
  const [checkoutError, setCheckoutError] = useState("");
  const [deliveryPaymentMethod, setDeliveryPaymentMethod] = useState<
    "IN_APP" | "CASH"
  >("IN_APP");
  const [reviewedQuote, setReviewedQuote] = useState<{
    payload: string;
    quote: CheckoutQuote;
  } | null>(null);
  const quoteRequest = useRef({ payload: "", id: "" });
  const [notice, setNotice] = useState("");
  const reducedMotion = useReducedMotionPreference();

  useEffect(() => {
    if (reducedMotion) {
      entry.stopAnimation();
      entry.setValue(1);
      return;
    }
    entry.setValue(0);
    const animation = Animated.timing(entry, {
      duration: theme.motion.screen,
      easing: Easing.out(Easing.cubic),
      toValue: 1,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [entry, reducedMotion]);

  const load = useCallback(async () => {
    setCatalogIssue(null);
    try {
      const data = await api<CatalogResponse>("/v1/student/store");
      const mode = data.catalogueMode ?? "LIVE";
      setProducts(data.products);
      setZones(data.deliveryZones);
      setRiderDeliveryEnabled(data.riderDeliveryEnabled === true);
      setCatalogueMode(mode);
      setCheckoutEnabled(data.checkoutEnabled ?? mode === "LIVE");
    } catch (caught) {
      setCatalogIssue(
        caught instanceof ApiError
          ? { code: caught.code, message: caught.message }
          : {
              code: "NETWORK_UNAVAILABLE",
              message: "The campus store could not be loaded.",
            },
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const categories = useMemo(
    () => [
      "All",
      ...Array.from(
        new Set(products.map((product) => product.category).filter(Boolean)),
      ),
    ],
    [products],
  );

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return products.filter((item) => {
      const matchesCategory =
        Boolean(focusedProduct) ||
        selectedCategory === "All" ||
        item.category === selectedCategory;
      const matchesQuery =
        Boolean(focusedProduct) ||
        `${item.name} ${item.description} ${item.category} ${item.vendor_name}`
          .toLowerCase()
          .includes(term);
      return (
        (!selectedShop || item.vendor_profile_id === selectedShop) &&
        (!focusedProduct || item.id === focusedProduct) &&
        matchesCategory &&
        matchesQuery
      );
    });
  }, [products, query, selectedCategory, focusedProduct, selectedShop]);

  const cartItems = useMemo(
    () =>
      products
        .filter((product) => Boolean(cart[product.id]))
        .map((product) => ({ product, quantity: cart[product.id] ?? 0 })),
    [cart, products],
  );
  const cartCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = cartItems.reduce(
    (sum, item) => sum + Number(item.product.price_kobo) * item.quantity,
    0,
  );
  const selectedZone = zones.find((zone) => zone.id === selectedZoneId);
  const vendorProduct = cartItems[0]?.product;
  const fulfilmentModes = (
    ["RIDER", "PICKUP", "VENDOR_DELIVERY"] as const
  ).filter((mode) =>
    mode === "RIDER"
      ? riderDeliveryEnabled
      : mode === "PICKUP"
        ? vendorProduct?.pickup_enabled
        : vendorProduct?.self_delivery_enabled,
  );
  const effectiveMode = fulfilmentModes.includes(fulfilmentMode)
    ? fulfilmentMode
    : fulfilmentModes[0];
  const deliveryFee =
    effectiveMode === "RIDER" ? Number(reviewedQuote?.quote.pricing.fareKobo ?? 0) : 0;
  const total = subtotal + deliveryFee;
  const checkoutReady =
    !!effectiveMode && (effectiveMode !== "RIDER" || !!selectedZone);
  const orderPayload = JSON.stringify({
    vendorProfileId: cartItems[0]?.product.vendor_profile_id,
    ...(discountCode?{discountCode}:{}),
    fulfilmentMode: effectiveMode,
    recipientName,
    recipientPhoneE164: recipientPhone,
    deliveryLocation: effectiveMode === "PICKUP" ? null : deliveryLocation,
    deliveryPaymentMethod:
      effectiveMode === "RIDER" ? deliveryPaymentMethod : "IN_APP",
    deliveryZoneId: effectiveMode === "RIDER" ? selectedZone?.id : null,
    deliveryPlaceId: effectiveMode === "PICKUP" ? null : deliveryPlace,
    deliveryNote: deliveryNote.trim() || null,
    items: cartItems.map(({ product, quantity }) => ({
      productId: product.id,
      quantity,
      expectedUnitPriceKobo: Number(product.price_kobo),
    })),
  });
  const validQuote =
    reviewedQuote?.payload === orderPayload ? reviewedQuote.quote : null;
  const featureDisabled = catalogIssue?.code === "FEATURE_DISABLED";

  function retryLoad() {
    setLoading(true);
    void load();
  }

  function clearFilters() {
    setQuery("");
    setSelectedCategory("All");
    setSelectedShop(null);
  }

  function closeCart() {
    if (!busy) setCartOpen(false);
  }

  function openCart() {
    setCheckoutError("");
    setCartOpen(true);
  }

  function add(product: Product) {
    if (product.pricing_ready === false) {
      setNotice("This product is awaiting an approved checkout price.");
      return;
    }
    const activeVendor = cartItems[0]?.product.vendor_profile_id;
    if (activeVendor && activeVendor !== product.vendor_profile_id) {
      const activeSeller =
        cartItems[0]?.product.vendor_name ?? "another seller";
      Alert.alert(
        "One seller per cart",
        `${activeSeller} is already in your cart. Remove those items before adding a product from ${product.vendor_name}.`,
      );
      return;
    }
    const stock = Number(product.stock_quantity);
    if (stock <= 0) return;
    setCart((current) => ({
      ...current,
      [product.id]: Math.min((current[product.id] ?? 0) + 1, stock),
    }));
    setNotice(`${product.name} added to your cart.`);
  }

  function changeQuantity(product: Product, delta: number) {
    setCart((current) => {
      const nextQuantity = Math.min(
        Number(product.stock_quantity),
        Math.max(0, (current[product.id] ?? 0) + delta),
      );
      const next = { ...current };
      if (nextQuantity === 0) delete next[product.id];
      else next[product.id] = nextQuantity;
      return next;
    });
  }

  async function checkout() {
    if (!checkoutEnabled || !cartItems.length || !checkoutReady) return;
    setBusy(true);
    setCheckoutError("");
    setNotice("");
    try {
      if (!validQuote) {
        if (quoteRequest.current.payload !== orderPayload)
          quoteRequest.current = {
            payload: orderPayload,
            id: Crypto.randomUUID(),
          };
        const result = await api<{ quote: CheckoutQuote }>(
          "/v1/student/order-quotes",
          {
            method: "POST",
            body: JSON.stringify({
              ...JSON.parse(orderPayload),
              requestId: quoteRequest.current.id,
            }),
          },
        );
        setReviewedQuote({ payload: orderPayload, quote: result.quote });
        return;
      }
      const order = await api<{ id: string; totalKobo: number }>(
        "/v1/student/orders",
        {
          method: "POST",
          body: JSON.stringify({
            ...JSON.parse(orderPayload),
            quoteId: validQuote.id,
          }),
        },
      );
      setCart({});
      setReviewedQuote(null);
      quoteRequest.current = { payload: "", id: "" };
      setCartOpen(false);
      setDeliveryNote("");
      setSelectedZoneId("");
      setNotice(
        `Order #${order.id.slice(0, 8)} was created. You can always resume it from Purchases.`,
      );
      router.push({
        pathname: "/payment-review",
        params: { id: order.id, type: "STORE_ORDER" },
      });
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "CONFLICT") {
        setReviewedQuote(null);
        quoteRequest.current = { payload: "", id: "" };
      }
      setCheckoutError(
        caught instanceof ApiError
          ? caught.message
          : "The order could not be created.",
      );
    } finally {
      setBusy(false);
    }
  }

  const catalogueData =
    !loading && !featureDisabled && products.length > 0 ? filtered : [];
  const catalogueEmpty = loading ? (
    <CatalogSkeleton />
  ) : featureDisabled ? (
    <StateMessage
      body="We’re finishing vendor verification, delivery safeguards, and secure checkout before opening the campus pilot."
      icon="storefront-outline"
      title="The store is opening soon"
    />
  ) : catalogIssue && !products.length ? (
    <StateMessage
      actionLabel="Try again"
      body={catalogIssue.message}
      icon="cloud-offline-outline"
      onAction={retryLoad}
      title="Store unavailable"
      tone="error"
    />
  ) : !catalogIssue && !products.length ? (
    <StateMessage
      actionLabel="Refresh"
      body="Published products from approved campus vendors will appear here."
      icon="storefront-outline"
      onAction={retryLoad}
      title="No products yet"
    />
  ) : products.length > 0 && !filtered.length ? (
    <StateMessage
      actionLabel="Clear filters"
      body="Try a different product name, seller, or category."
      icon="search-outline"
      onAction={clearFilters}
      title="Nothing matches your search"
    />
  ) : null;

  return (
    <SafeAreaView edges={["top"]} style={styles.safe}>
      <View pointerEvents="none" style={styles.ambientTop} />
      <View pointerEvents="none" style={styles.ambientBottom} />
      <Animated.View
        style={[
          styles.listFrame,
          {
            opacity: entry,
            transform: [
              {
                translateY: entry.interpolate({
                  inputRange: [0, 1],
                  outputRange: [8, 0],
                }),
              },
            ],
            width: contentWidth,
          },
        ]}
      >
        <FlatList
          accessibilityLabel="Campus store products"
          columnWrapperStyle={compactPhone ? undefined : styles.productRow}
          contentContainerStyle={[
            styles.listContent,
            compactPhone && styles.listContentCompact,
          ]}
          data={catalogueData}
          extraData={cart}
          initialNumToRender={8}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          keyExtractor={(product) => product.id}
          ListEmptyComponent={catalogueEmpty}
          ListHeaderComponent={
            <>
              <View style={styles.storeToolbar}>
                {!featureDisabled ? (
                  <View
                    style={[
                      styles.search,
                      styles.toolbarSearch,
                      searchFocused && styles.inputFocused,
                    ]}
                  >
                    <Ionicons
                      name="search-outline"
                      size={20}
                      color={theme.brandPressed}
                    />
                    <TextInput
                      accessibilityLabel="Search products or vendors"
                      autoCapitalize="none"
                      onBlur={() => setSearchFocused(false)}
                      onChangeText={setQuery}
                      onFocus={() => setSearchFocused(true)}
                      placeholder="Search products or vendors"
                      placeholderTextColor={theme.textSubtle}
                      returnKeyType="search"
                      style={styles.searchInput}
                      value={query}
                    />
                    {query ? (
                      <Pressable
                        accessibilityLabel="Clear search"
                        accessibilityRole="button"
                        hitSlop={4}
                        onPress={() => setQuery("")}
                        style={({ pressed }) => [
                          styles.clearSearch,
                          pressed && styles.pressed,
                        ]}
                      >
                        <Ionicons
                          name="close"
                          size={20}
                          color={theme.textMuted}
                        />
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}

                <Pressable
                  accessibilityLabel={
                    cartCount
                      ? `Open cart with ${cartCount} ${cartCount === 1 ? "item" : "items"}`
                      : "Open cart"
                  }
                  accessibilityRole="button"
                  hitSlop={4}
                  onPress={openCart}
                  style={({ pressed }) => [
                    styles.cartButton,
                    pressed && styles.pressed,
                  ]}
                >
                  <Ionicons
                    name="cart-outline"
                    size={25}
                    color={theme.brandPressed}
                  />
                  {cartCount ? (
                    <View style={styles.cartBadge}>
                      <Text style={styles.cartBadgeText}>
                        {cartCount > 99 ? "99+" : cartCount}
                      </Text>
                    </View>
                  ) : null}
                </Pressable>
              </View>

              {!featureDisabled && catalogueMode === "LIVE" && (
                <PopularShops
                  selected={selectedShop}
                  onSelect={setSelectedShop}
                />
              )}
              {!featureDisabled && categories.length > 1 ? (
                <ScrollView
                  accessibilityLabel="Product categories"
                  contentContainerStyle={[
                    styles.categories,
                    compactPhone && styles.categoriesCompact,
                  ]}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={[
                    styles.categoryScroller,
                    compactPhone && styles.categoryScrollerCompact,
                  ]}
                >
                  {categories.map((category) => {
                    const selected = category === selectedCategory;
                    return (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        key={category}
                        onPress={() => setSelectedCategory(category)}
                        style={({ pressed }) => [
                          styles.categoryChip,
                          selected && styles.categoryChipSelected,
                          pressed && styles.pressed,
                        ]}
                      >
                        <Text
                          style={[
                            styles.categoryChipText,
                            selected && styles.categoryChipTextSelected,
                          ]}
                        >
                          {category}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              ) : null}

              {!featureDisabled && notice ? (
                <View
                  accessibilityLiveRegion="polite"
                  accessibilityRole="alert"
                  style={[
                    styles.notice,
                    notice.includes("unpaid") && styles.noticeWarning,
                  ]}
                >
                  <Ionicons
                    name={
                      notice.includes("unpaid")
                        ? "information-circle-outline"
                        : "checkmark-circle-outline"
                    }
                    size={19}
                    color={
                      notice.includes("unpaid") ? theme.warning : theme.success
                    }
                  />
                  <Text style={styles.noticeText}>{notice}</Text>
                </View>
              ) : null}
              {!featureDisabled && notice.includes("Purchases") ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push("/purchases")}
                  style={({ pressed }) => [
                    styles.purchasesLink,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.purchasesLinkText}>Open Purchases</Text>
                  <Ionicons
                    name="arrow-forward"
                    size={17}
                    color={theme.brandPressed}
                  />
                </Pressable>
              ) : null}

              {!loading &&
              catalogIssue &&
              !featureDisabled &&
              products.length ? (
                <View accessibilityRole="alert" style={styles.partialError}>
                  <Ionicons
                    name="cloud-offline-outline"
                    size={20}
                    color={theme.error}
                  />
                  <Text style={styles.partialErrorText}>
                    Couldn’t refresh. Showing the last products we loaded.
                  </Text>
                  <Pressable
                    accessibilityLabel="Retry loading the store"
                    accessibilityRole="button"
                    onPress={retryLoad}
                    style={({ pressed }) => [
                      styles.inlineRetry,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={styles.inlineRetryText}>Retry</Text>
                  </Pressable>
                </View>
              ) : null}

              {!loading && !featureDisabled && products.length > 0 ? (
                <View style={styles.resultsHeader}>
                  <Text style={styles.resultsTitle}>
                    {selectedCategory === "All"
                      ? catalogueMode === "DEMO"
                        ? "Demo products"
                        : "All products"
                      : selectedCategory}
                  </Text>
                  <Text style={styles.resultsCount}>
                    {filtered.length} {filtered.length === 1 ? "item" : "items"}
                  </Text>
                </View>
              ) : null}
            </>
          }
          key={compactPhone ? "store-compact" : "store-regular"}
          maxToRenderPerBatch={10}
          numColumns={compactPhone ? 1 : 2}
          ItemSeparatorComponent={
            compactPhone
              ? () => <View style={styles.compactProductGap} />
              : undefined
          }
          removeClippedSubviews={Platform.OS === "android"}
          renderItem={({ item: product }) => (
            <ProductCard
              onAdd={() => add(product)}
              onChangeQuantity={(delta) => changeQuantity(product, delta)}
              product={product}
              quantity={cart[product.id] ?? 0}
              width={productWidth}
            />
          )}
          showsVerticalScrollIndicator={false}
          style={styles.catalogue}
          windowSize={7}
        />
      </Animated.View>

      <Modal
        animationType={reducedMotion ? "none" : "slide"}
        onRequestClose={closeCart}
        transparent
        visible={cartOpen}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalBackdrop}
        >
          <Pressable
            accessibilityLabel="Close cart"
            accessibilityRole="button"
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            onPress={closeCart}
            style={StyleSheet.absoluteFill}
          />
          <View
            accessibilityViewIsModal
            onAccessibilityEscape={closeCart}
            style={styles.modal}
          >
            <View style={styles.sheetHandle} />
            <View style={styles.modalTop}>
              <View style={styles.modalHeading}>
                <Text style={styles.modalTitle}>Your cart</Text>
                <Text style={styles.modalSubtitle}>
                  {cartCount} {cartCount === 1 ? "item" : "items"}
                </Text>
              </View>
              <Pressable
                accessibilityLabel="Close cart"
                accessibilityRole="button"
                accessibilityState={{ disabled: busy }}
                disabled={busy}
                onPress={closeCart}
                style={({ pressed }) => [
                  styles.closeButton,
                  busy && styles.controlDisabled,
                  pressed && !busy && styles.pressed,
                ]}
              >
                <Ionicons
                  name="close"
                  size={22}
                  color={busy ? theme.textSubtle : theme.text}
                />
              </Pressable>
            </View>

            <ScrollView
              contentContainerStyle={styles.cartContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {!cartItems.length ? (
                <StateMessage
                  actionLabel="Continue shopping"
                  body="Choose an item from a campus seller to begin your cart."
                  icon="cart-outline"
                  onAction={() => setCartOpen(false)}
                  title="Your cart is empty"
                />
              ) : null}

              {cartItems.map(({ product, quantity }) => (
                <View key={product.id} style={styles.cartItem}>
                  {product.image_url ? (
                    <Image
                      accessible={false}
                      resizeMode="cover"
                      source={{ uri: product.image_url }}
                      style={styles.cartItemImage}
                    />
                  ) : (
                    <View style={styles.cartItemFallback}>
                      <Ionicons
                        name={productIcon(product)}
                        size={20}
                        color={theme.brandPressed}
                      />
                    </View>
                  )}
                  <View style={styles.cartItemCopy}>
                    <Text numberOfLines={2} style={styles.cartItemName}>
                      {product.name}
                    </Text>
                    <Text style={styles.cartItemMeta}>
                      {naira(product.price_kobo)} each
                    </Text>
                  </View>
                  <QuantityStepper
                    compact
                    onChange={(delta) => changeQuantity(product, delta)}
                    product={product}
                    quantity={quantity}
                  />
                </View>
              ))}

              {cartItems.length && checkoutEnabled ? (
                <>
                  <DiscountCodeField scope="STORE" disabled={busy} onApply={setDiscountCode}/>
                  {checkoutError ? (
                    <View
                      accessibilityRole="alert"
                      style={styles.checkoutError}
                    >
                      <Ionicons
                        name="alert-circle-outline"
                        size={20}
                        color={theme.error}
                      />
                      <Text style={styles.checkoutErrorText}>
                        {checkoutError}
                      </Text>
                    </View>
                  ) : null}

                  <Text style={styles.sectionLabel}>
                    How would you like your order?
                  </Text>
                  <View accessibilityRole="radiogroup" style={styles.zoneList}>
                    {fulfilmentModes.map((mode) => (
                      <Pressable
                        key={mode}
                        accessibilityRole="radio"
                        accessibilityState={{
                          selected: effectiveMode === mode,
                          disabled: busy,
                        }}
                        disabled={busy}
                        onPress={() => {
                          setFulfilmentMode(mode);
                          setCheckoutError("");
                        }}
                        style={({ pressed }) => [
                          styles.zone,
                          effectiveMode === mode && styles.zoneSelected,
                          pressed && styles.pressed,
                        ]}
                      >
                        <View style={styles.zoneCopy}>
                          <Text style={styles.zoneName}>
                            {mode === "RIDER"
                              ? "Rider · Recommended"
                              : mode === "PICKUP"
                                ? "Pick up at the store"
                                : "Delivery by the vendor"}
                          </Text>
                          <Text style={styles.zoneFee}>
                            {mode === "RIDER"
                              ? "A campus rider collects your order"
                              : mode === "PICKUP"
                                ? (vendorProduct?.pickup_location ??
                                  "Collect from the vendor")
                                : "The vendor brings the order to your address"}
                          </Text>
                        </View>
                        <Ionicons
                          name={
                            effectiveMode === mode
                              ? "radio-button-on"
                              : "radio-button-off"
                          }
                          size={22}
                          color={
                            effectiveMode === mode
                              ? theme.brandPressed
                              : theme.textSubtle
                          }
                        />
                      </Pressable>
                    ))}
                  </View>
                  {effectiveMode === "RIDER" ? (
                    <>
                      <Text style={styles.sectionLabel}>Delivery zone</Text>
                      <View
                        accessibilityRole="radiogroup"
                        style={styles.zoneList}
                      >
                        {zones.map((zone) => {
                          const selected = zone.id === selectedZoneId;
                          return (
                            <Pressable
                              accessibilityRole="radio"
                              accessibilityState={{ selected }}
                              key={zone.id}
                              onPress={() => {
                                setCheckoutError("");
                                setSelectedZoneId(zone.id);
                              }}
                              style={({ pressed }) => [
                                styles.zone,
                                selected && styles.zoneSelected,
                                pressed && styles.pressed,
                              ]}
                            >
                              <View style={styles.zoneCopy}>
                                <Text style={styles.zoneName}>{zone.name}</Text>
                                <Text style={styles.zoneFee}>
                                  Fare shown after route review
                                </Text>
                              </View>
                              <Ionicons
                                name={
                                  selected
                                    ? "radio-button-on"
                                    : "radio-button-off"
                                }
                                size={22}
                                color={
                                  selected
                                    ? theme.brandPressed
                                    : theme.textSubtle
                                }
                              />
                            </Pressable>
                          );
                        })}
                      </View>
                      {!zones.length ? (
                        <View style={styles.zoneWarning}>
                          <Ionicons
                            name="information-circle-outline"
                            size={19}
                            color={theme.warning}
                          />
                          <Text style={styles.zoneWarningText}>
                            Checkout is unavailable until your university
                            publishes a delivery zone.
                          </Text>
                        </View>
                      ) : null}
                    </>
                  ) : null}

                  <Text style={styles.sectionLabel}>Recipient name</Text>
                  <TextInput
                    accessibilityLabel="Recipient name"
                    value={recipientName}
                    onChangeText={setRecipientName}
                    maxLength={120}
                    style={styles.noteInput}
                  />
                  <Text style={styles.sectionLabel}>
                    Recipient phone (+234)
                  </Text>
                  <TextInput
                    accessibilityLabel="Recipient phone"
                    value={recipientPhone}
                    onChangeText={setRecipientPhone}
                    keyboardType="phone-pad"
                    maxLength={14}
                    style={styles.noteInput}
                  />
                  {effectiveMode !== "PICKUP" ? (
                    <>
                      <Text style={styles.sectionLabel}>Delivery address</Text>
                      <TextInput
                        accessibilityLabel="Delivery address"
                        value={deliveryLocation}
                        onChangeText={setDeliveryLocation}
                        maxLength={500}
                        style={styles.noteInput}
                      />
                      <CampusPlaceChoice
                        label="Delivery point on the campus map"
                        value={deliveryPlace}
                        onChange={setDeliveryPlace}
                      />
                    </>
                  ) : null}
                  <Text style={styles.sectionLabel}>
                    Delivery note{" "}
                    <Text style={styles.optional}>(optional)</Text>
                  </Text>
                  <TextInput
                    accessibilityLabel="Delivery note, optional"
                    maxLength={500}
                    multiline
                    onBlur={() => setNoteFocused(false)}
                    onChangeText={setDeliveryNote}
                    onFocus={() => setNoteFocused(true)}
                    placeholder="Hostel, landmark, or handoff instruction"
                    placeholderTextColor={theme.textSubtle}
                    style={[
                      styles.noteInput,
                      noteFocused && styles.inputFocused,
                    ]}
                    value={deliveryNote}
                  />

                  {effectiveMode === "RIDER" ? (
                    <View style={{ marginVertical: 16 }}>
                      <Text style={styles.sectionLabel}>
                        Pay the rider fare
                      </Text>
                      <View style={styles.zoneList}>
                        {(["IN_APP", "CASH"] as const).map((method) => (
                          <Pressable
                            key={method}
                            accessibilityRole="radio"
                            accessibilityState={{
                              selected: deliveryPaymentMethod === method,
                            }}
                            disabled={busy}
                            onPress={() => setDeliveryPaymentMethod(method)}
                            style={[
                              styles.zone,
                              method === deliveryPaymentMethod &&
                                styles.zoneSelected,
                            ]}
                          >
                            <Text style={styles.zoneName}>
                              {method === "IN_APP"
                                ? "In app"
                                : "Cash at delivery"}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    </View>
                  ) : null}
                  <View style={styles.totals}>
                    <View style={styles.totalRow}>
                      <Text style={styles.totalLabel}>Items</Text>
                      <Text style={styles.totalValue}>{naira(subtotal)}</Text>
                    </View>
                    <View style={styles.totalRow}>
                      <Text style={styles.totalLabel}>Delivery</Text>
                      <Text style={styles.totalValue}>
                        {effectiveMode !== "RIDER"
                          ? naira(0)
                          : selectedZone
                            ? validQuote ? naira(validQuote.pricing.fareKobo) : "Review route for fare"
                            : "Select a zone"}
                      </Text>
                    </View>
                    {Number(validQuote?.pricing.discountKobo) > 0 ? (
                      <View style={styles.totalRow}>
                        <Text style={styles.totalLabel}>Checkout savings</Text>
                        <Text style={styles.totalValue}>
                          −{naira(validQuote!.pricing.discountKobo)}
                        </Text>
                      </View>
                    ) : null}
                    {effectiveMode === "RIDER" &&
                    deliveryPaymentMethod === "CASH" ? (
                      <Text style={styles.totalLabel}>
                        Pay the product total in app and{" "}
                        {validQuote?naira(validQuote.pricing.cashDueKobo):"the reviewed fare"}{" "}
                        to the rider at delivery.
                      </Text>
                    ) : null}
                    {validQuote?.fare ? (
                      <Text style={styles.totalLabel}>
                        Mapped rider route ·{" "}
                        {(validQuote.fare.routeMetres / 1000).toFixed(2)} km
                      </Text>
                    ) : null}
                    {validQuote?.fare?.routeAccessNotice?<Text style={styles.totalLabel}>{validQuote.fare.routeAccessNotice}</Text>:null}
                    <View style={[styles.totalRow, styles.grandTotal]}>
                      <Text style={styles.grandLabel}>Total</Text>
                      <Text style={styles.grandValue}>
                        {effectiveMode==="RIDER"&&!validQuote?"Review route for total":naira(validQuote?.pricing.totalKobo ?? total)}
                      </Text>
                    </View>
                  </View>

                  <Pressable
                    accessibilityLabel={
                      busy
                        ? "Creating order and opening secure payment"
                        : checkoutReady
                          ? validQuote
                            ? "Confirm order"
                            : "Review route and checkout total"
                          : "Select a delivery zone to continue"
                    }
                    accessibilityHint={
                      checkoutReady
                        ? "Reviews the exact agreed total before reserving your order"
                        : "Select a delivery zone first"
                    }
                    accessibilityRole="button"
                    accessibilityState={{
                      busy,
                      disabled: busy || !checkoutReady,
                    }}
                    disabled={busy || !checkoutReady}
                    onPress={() => void checkout()}
                    style={({ pressed }) => [
                      styles.checkout,
                      (busy || !checkoutReady) && styles.checkoutDisabled,
                      pressed && !busy && checkoutReady && styles.buttonPressed,
                    ]}
                  >
                    {busy ? (
                      <InlineLoading color="#FFFFFF" />
                    ) : (
                      <>
                        <Ionicons
                          name="lock-closed-outline"
                          size={18}
                          color={checkoutReady ? "#FFFFFF" : theme.textSubtle}
                        />
                        <Text
                          style={[
                            styles.checkoutText,
                            !checkoutReady && styles.checkoutTextDisabled,
                          ]}
                        >
                          {checkoutReady
                            ? validQuote
                              ? "Confirm order"
                              : "Review total"
                            : "Select a zone to continue"}
                        </Text>
                      </>
                    )}
                  </Pressable>
                  <Text style={styles.paymentHelp}>
                    Payment opens on the provider’s secure page after your order
                    is created.
                  </Text>
                </>
              ) : null}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <CreateAction role="VENDOR" />
    </SafeAreaView>
  );
}

function ProductCard({
  onAdd,
  onChangeQuantity,
  product,
  quantity,
  width,
}: {
  onAdd: () => void;
  onChangeQuantity: (delta: number) => void;
  product: Product;
  quantity: number;
  width: number;
}) {
  const { theme, styles } = useThemeStyles(createStyles);

  const outOfStock = Number(product.stock_quantity) <= 0;
  const toast = useToast();

  return (
    <View style={[styles.card, { width }]}>
      {product.image_url ? (
        <Image
          accessible={false}
          resizeMode="cover"
          source={{ uri: product.image_url }}
          style={styles.productImage}
        />
      ) : (
        <View style={styles.productFallback}>
          <View style={styles.fallbackDisc}>
            <Ionicons
              name={productIcon(product)}
              size={30}
              color={theme.brandPressed}
            />
          </View>
        </View>
      )}
      <View style={styles.cardBody}>
        <View style={styles.categoryRow}>
          <Text numberOfLines={1} style={styles.category}>
            {product.category}
          </Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`Share ${product.name}`} onPress={()=>void shareItem("product",product.id,product.name).catch(()=>toast("Sharing could not open.","error"))} style={{minWidth:44,minHeight:44,justifyContent:"center",alignItems:"center",marginLeft:"auto"}}><Ionicons name="share-outline" color={theme.brand} size={19}/></Pressable>
        </View>
        <Text
          android_hyphenationFrequency="none"
          numberOfLines={2}
          style={styles.name}
          textBreakStrategy="simple"
        >
          {product.name}
        </Text>
        <View style={styles.vendor}>
          <Ionicons
            name="checkmark-circle"
            size={15}
            color={theme.verification}
          />
          <Text numberOfLines={1} style={styles.vendorText}>
            {product.vendor_name}
          </Text>
        </View>
        <View style={styles.priceRow}>
          <Text
            android_hyphenationFrequency="none"
            numberOfLines={1}
            style={styles.price}
            textBreakStrategy="simple"
          >
            {naira(product.price_kobo)}
          </Text>
          <Text style={[styles.stock, outOfStock && styles.outOfStock]}>
            {outOfStock ? "Out of stock" : `${product.stock_quantity} in stock`}
          </Text>
        </View>
        {quantity ? (
          <QuantityStepper
            onChange={onChangeQuantity}
            product={product}
            quantity={quantity}
          />
        ) : (
          <Pressable
            accessibilityLabel={
              outOfStock
                ? `${product.name} is out of stock`
                : `Add ${product.name} to cart`
            }
            accessibilityRole="button"
            accessibilityState={{ disabled: outOfStock }}
            disabled={outOfStock}
            onPress={onAdd}
            style={({ pressed }) => [
              styles.addButton,
              outOfStock && styles.addButtonDisabled,
              pressed && !outOfStock && styles.buttonPressed,
            ]}
          >
            <Ionicons
              name="add"
              size={18}
              color={outOfStock ? theme.textSubtle : "#FFFFFF"}
            />
            <Text
              style={[
                styles.addButtonText,
                outOfStock && styles.addButtonTextDisabled,
              ]}
            >
              {outOfStock ? "Unavailable" : "Add to cart"}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function productIcon(product: Product): keyof typeof Ionicons.glyphMap {
  const name = product.name.toLowerCase();
  if (name.includes("calculator")) return "calculator-outline";
  if (name.includes("notebook")) return "book-outline";
  if (name.includes("bottle")) return "water-outline";
  if (name.includes("mattress")) return "bed-outline";
  if (name.includes("lamp")) return "bulb-outline";
  if (
    name.includes("cable") ||
    name.includes("power") ||
    name.includes("extension")
  )
    return "flash-outline";
  return "cube-outline";
}

function QuantityStepper({
  compact = false,
  product,
  quantity,
  onChange,
}: {
  compact?: boolean;
  product: Product;
  quantity: number;
  onChange: (delta: number) => void;
}) {
  const { theme, styles } = useThemeStyles(createStyles);

  const atLimit = quantity >= Number(product.stock_quantity);

  return (
    <View
      accessibilityLabel={`${quantity} ${product.name} in cart`}
      style={[styles.stepper, compact && styles.stepperCompact]}
    >
      <Pressable
        accessibilityLabel={`Remove one ${product.name}`}
        accessibilityRole="button"
        onPress={() => onChange(-1)}
        style={({ pressed }) => [
          styles.stepperButton,
          compact && styles.stepperButtonCompact,
          pressed && styles.pressed,
        ]}
      >
        <Ionicons name="remove" size={17} color={theme.brandPressed} />
      </Pressable>
      <Text style={styles.quantity}>{quantity}</Text>
      <Pressable
        accessibilityLabel={`Add one ${product.name}`}
        accessibilityRole="button"
        accessibilityState={{ disabled: atLimit }}
        disabled={atLimit}
        onPress={() => onChange(1)}
        style={({ pressed }) => [
          styles.stepperButton,
          compact && styles.stepperButtonCompact,
          atLimit && styles.stepperButtonDisabled,
          pressed && !atLimit && styles.pressed,
        ]}
      >
        <Ionicons
          name="add"
          size={17}
          color={atLimit ? theme.textSubtle : theme.brandPressed}
        />
      </Pressable>
    </View>
  );
}

function CatalogSkeleton() {
  const { theme, styles } = useThemeStyles(createStyles);

  return (
    <View
      accessibilityLabel="Loading products"
      accessibilityRole="progressbar"
      style={styles.skeletonSection}
    >
      <View style={styles.loadingLine}>
        <InlineLoading color={theme.brand} size="small" />
        <Text style={styles.loadingText}>Loading campus products…</Text>
      </View>
      <View style={styles.grid}>
        {[0, 1, 2, 3].map((item) => (
          <View key={item} style={styles.skeletonCard}>
            <View style={styles.skeletonImage} />
            <View style={styles.skeletonBody}>
              <View style={[styles.skeletonBar, styles.skeletonBarShort]} />
              <View style={styles.skeletonBar} />
              <View style={[styles.skeletonBar, styles.skeletonBarMedium]} />
              <View style={styles.skeletonButton} />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

function StateMessage({
  title,
  body,
  icon,
  actionLabel,
  onAction,
  tone = "default",
}: {
  title: string;
  body: string;
  icon: keyof typeof Ionicons.glyphMap;
  actionLabel?: string;
  onAction?: () => void;
  tone?: "default" | "error";
}) {
  const { theme, styles } = useThemeStyles(createStyles);

  return (
    <View
      accessibilityRole={tone === "error" ? "alert" : undefined}
      style={styles.state}
    >
      <View
        style={[
          styles.stateIllustration,
          tone === "error" && styles.stateIllustrationError,
        ]}
      >
        <View style={styles.stateDotLarge} />
        <View style={styles.stateDotSmall} />
        <Ionicons
          name={icon}
          size={40}
          color={tone === "error" ? theme.error : theme.brandPressed}
        />
      </View>
      <Text style={styles.stateTitle}>{title}</Text>
      <Text style={styles.stateBody}>{body}</Text>
      {actionLabel && onAction ? (
        <Pressable
          accessibilityRole="button"
          onPress={onAction}
          style={({ pressed }) => [
            styles.stateAction,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.stateActionText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    safe: { backgroundColor: theme.canvas, flex: 1, overflow: "hidden" },
    ambientTop: {
      backgroundColor: "rgba(233,177,142,0.13)",
      borderRadius: 130,
      height: 250,
      position: "absolute",
      right: -150,
      top: -122,
      width: 250,
    },
    ambientBottom: {
      backgroundColor: "rgba(241,223,200,0.20)",
      borderRadius: 120,
      height: 220,
      left: -170,
      position: "absolute",
      top: 620,
      width: 220,
    },
    listFrame: { alignSelf: "center", flex: 1 },
    catalogue: { flex: 1 },
    listContent: { paddingBottom: 118, paddingHorizontal: 20, paddingTop: 8 },
    listContentCompact: { paddingHorizontal: 14 },
    productRow: { gap: 12, marginBottom: 12 },
    compactProductGap: { height: 12 },
    storeToolbar: {
      alignItems: "center",
      flexDirection: "row",
      gap: 10,
      justifyContent: "flex-end",
    },
    toolbarSearch: { flex: 1 },
    cartButton: {
      alignItems: "center",
      backgroundColor: theme.surface,
      borderColor: theme.border,
      borderRadius: 15,
      borderWidth: 1,
      height: 52,
      justifyContent: "center",
      position: "relative",
      width: 52,
      ...theme.shadow,
    },
    cartBadge: {
      alignItems: "center",
      backgroundColor: theme.deepBrand,
      borderColor: theme.surface,
      borderRadius: 9,
      borderWidth: 2,
      justifyContent: "center",
      minHeight: 18,
      minWidth: 18,
      paddingHorizontal: 3,
      position: "absolute",
      right: -5,
      top: -5,
    },
    cartBadgeText: {
      color: "#FFFFFF",
      fontFamily: theme.font.bold,
      fontSize: 9.5,
      fontVariant: ["tabular-nums"],
      lineHeight: 12,
    },
    search: {
      alignItems: "center",
      backgroundColor: theme.surface,
      borderColor: theme.border,
      borderRadius: 15,
      borderWidth: 1,
      flexDirection: "row",
      gap: 10,
      minHeight: 52,
      paddingLeft: 15,
      paddingRight: 4,
    },
    inputFocused: { borderColor: theme.brand, borderWidth: 1.5 },
    searchInput: {
      color: theme.text,
      flex: 1,
      fontFamily: theme.font.body,
      fontSize: 14.5,
      height: 50,
    },
    clearSearch: {
      alignItems: "center",
      height: 44,
      justifyContent: "center",
      width: 44,
    },
    categoryScroller: { marginHorizontal: -20, marginTop: 12 },
    categoryScrollerCompact: { marginHorizontal: -14 },
    categories: { gap: 8, paddingHorizontal: 20 },
    categoriesCompact: { paddingHorizontal: 14 },
    categoryChip: {
      alignItems: "center",
      backgroundColor: theme.surface,
      borderColor: theme.border,
      borderRadius: 12,
      borderWidth: 1,
      justifyContent: "center",
      minHeight: 44,
      paddingHorizontal: 15,
    },
    categoryChipSelected: {
      backgroundColor: theme.deepBrand,
      borderColor: theme.deepBrand,
    },
    categoryChipText: {
      color: theme.textMuted,
      fontFamily: theme.font.medium,
      fontSize: 13,
    },
    categoryChipTextSelected: {
      color: "#FFFFFF",
      fontFamily: theme.font.semibold,
    },
    notice: {
      alignItems: "flex-start",
      backgroundColor: theme.surface,
      borderLeftColor: theme.success,
      borderLeftWidth: 3,
      flexDirection: "row",
      gap: 9,
      marginTop: 16,
      paddingHorizontal: 12,
      paddingVertical: 11,
    },
    noticeWarning: { borderLeftColor: theme.warning },
    noticeText: {
      color: theme.textMuted,
      flex: 1,
      fontFamily: theme.font.medium,
      fontSize: 12.5,
      lineHeight: 18,
    },
    purchasesLink: {
      alignItems: "center",
      alignSelf: "flex-start",
      flexDirection: "row",
      gap: 6,
      minHeight: 44,
      paddingHorizontal: 2,
    },
    purchasesLinkText: {
      color: theme.brandPressed,
      fontFamily: theme.font.semibold,
      fontSize: 13,
    },
    resultsHeader: {
      alignItems: "baseline",
      flexDirection: "row",
      justifyContent: "space-between",
      marginBottom: 12,
      marginTop: 22,
    },
    resultsTitle: {
      color: theme.text,
      fontFamily: theme.font.display,
      fontSize: 19,
      lineHeight: 24,
    },
    resultsCount: {
      color: theme.textMuted,
      fontFamily: theme.font.body,
      fontSize: 12.5,
      fontVariant: ["tabular-nums"],
    },
    partialError: {
      alignItems: "center",
      borderBottomColor: "rgba(168,70,46,0.22)",
      borderBottomWidth: 1,
      flexDirection: "row",
      gap: 9,
      marginTop: 18,
      paddingBottom: 12,
    },
    partialErrorText: {
      color: theme.textMuted,
      flex: 1,
      fontFamily: theme.font.body,
      fontSize: 12.5,
      lineHeight: 18,
    },
    inlineRetry: {
      alignItems: "center",
      justifyContent: "center",
      minHeight: 44,
      paddingHorizontal: 8,
    },
    inlineRetryText: {
      color: theme.brandPressed,
      fontFamily: theme.font.semibold,
      fontSize: 13,
    },
    grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
    card: {
      backgroundColor: theme.surface,
      borderColor: theme.border,
      borderRadius: 18,
      borderWidth: 1,
      overflow: "hidden",
    },
    productImage: {
      aspectRatio: 1.04,
      backgroundColor: theme.surfaceMuted,
      width: "100%",
    },
    productFallback: {
      alignItems: "center",
      aspectRatio: 1.04,
      backgroundColor: theme.surfaceMuted,
      justifyContent: "center",
      overflow: "hidden",
      width: "100%",
    },
    fallbackDisc: {
      alignItems: "center",
      backgroundColor: theme.sand,
      borderRadius: 34,
      height: 66,
      justifyContent: "center",
      transform: [{ rotate: "-7deg" }],
      width: 66,
    },
    cardBody: { padding: 12 },
    categoryRow: { alignItems: "center", flexDirection: "row", gap: 6 },
    category: {
      color: theme.brandPressed,
      flex: 1,
      fontFamily: theme.font.semibold,
      fontSize: 11.5,
      lineHeight: 15,
    },
    demoLabel: {
      backgroundColor: theme.surfaceTint,
      borderRadius: 6,
      color: theme.brandPressed,
      fontFamily: theme.font.bold,
      fontSize: 9,
      lineHeight: 14,
      overflow: "hidden",
      paddingHorizontal: 5,
      textTransform: "uppercase",
    },
    name: {
      color: theme.text,
      fontFamily: theme.font.semibold,
      fontSize: 14.5,
      lineHeight: 19,
      marginTop: 4,
      minHeight: 38,
    },
    description: {
      color: theme.textMuted,
      fontFamily: theme.font.body,
      fontSize: 12,
      lineHeight: 17,
      marginTop: 4,
      minHeight: 34,
    },
    vendor: {
      alignItems: "center",
      flexDirection: "row",
      gap: 5,
      marginTop: 9,
    },
    vendorText: {
      color: theme.textMuted,
      flex: 1,
      fontFamily: theme.font.medium,
      fontSize: 11.5,
    },
    priceRow: { marginTop: 12 },
    price: {
      color: theme.text,
      fontFamily: theme.font.display,
      fontSize: 17,
      fontVariant: ["tabular-nums"],
      lineHeight: 21,
    },
    stock: {
      color: theme.success,
      fontFamily: theme.font.medium,
      fontSize: 11.5,
      marginTop: 3,
    },
    outOfStock: { color: theme.error },
    addButton: {
      alignItems: "center",
      backgroundColor: theme.deepBrand,
      borderRadius: 12,
      flexDirection: "row",
      gap: 6,
      justifyContent: "center",
      marginTop: 12,
      minHeight: 44,
    },
    addButtonDisabled: {
      backgroundColor: theme.surfaceMuted,
      borderColor: theme.border,
      borderWidth: 1,
    },
    addButtonText: {
      color: "#FFFFFF",
      fontFamily: theme.font.semibold,
      fontSize: 12.5,
    },
    addButtonTextDisabled: { color: theme.textSubtle },
    stepper: {
      alignItems: "center",
      alignSelf: "stretch",
      backgroundColor: theme.surfaceMuted,
      borderColor: theme.border,
      borderRadius: 12,
      borderWidth: 1,
      flexDirection: "row",
      justifyContent: "space-between",
      marginTop: 12,
      minHeight: 46,
    },
    stepperCompact: { alignSelf: "auto", marginTop: 0, minHeight: 44 },
    stepperButton: {
      alignItems: "center",
      height: 44,
      justifyContent: "center",
      width: 44,
    },
    stepperButtonCompact: { width: 44 },
    stepperButtonDisabled: { opacity: 0.42 },
    quantity: {
      color: theme.text,
      fontFamily: theme.font.bold,
      fontSize: 12.5,
      fontVariant: ["tabular-nums"],
      minWidth: 20,
      textAlign: "center",
    },
    skeletonSection: { marginTop: 22 },
    loadingLine: {
      alignItems: "center",
      flexDirection: "row",
      gap: 9,
      marginBottom: 14,
    },
    loadingText: {
      color: theme.textMuted,
      fontFamily: theme.font.body,
      fontSize: 13,
    },
    skeletonCard: {
      backgroundColor: theme.surface,
      borderColor: theme.border,
      borderRadius: 18,
      borderWidth: 1,
      overflow: "hidden",
      width: "48%",
    },
    skeletonImage: {
      aspectRatio: 1.04,
      backgroundColor: theme.surfaceMuted,
      width: "100%",
    },
    skeletonBody: { gap: 9, padding: 12 },
    skeletonBar: {
      backgroundColor: theme.surfaceMuted,
      borderRadius: 4,
      height: 10,
      width: "100%",
    },
    skeletonBarShort: { width: "42%" },
    skeletonBarMedium: { width: "72%" },
    skeletonButton: {
      backgroundColor: theme.sand,
      borderRadius: 10,
      height: 44,
      marginTop: 3,
    },
    state: { alignItems: "center", paddingHorizontal: 24, paddingVertical: 48 },
    stateIllustration: {
      alignItems: "center",
      backgroundColor: theme.sand,
      borderRadius: 34,
      height: 84,
      justifyContent: "center",
      marginBottom: 17,
      position: "relative",
      width: 84,
    },
    stateIllustrationError: { backgroundColor: "rgba(233,177,142,0.30)" },
    stateDotLarge: {
      backgroundColor: theme.peach,
      borderRadius: 9,
      height: 18,
      position: "absolute",
      right: -5,
      top: 8,
      width: 18,
    },
    stateDotSmall: {
      backgroundColor: theme.brand,
      borderRadius: 4,
      bottom: 10,
      height: 8,
      left: -2,
      position: "absolute",
      width: 8,
    },
    stateTitle: {
      color: theme.text,
      fontFamily: theme.font.display,
      fontSize: 19,
      lineHeight: 24,
      textAlign: "center",
    },
    stateBody: {
      color: theme.textMuted,
      fontFamily: theme.font.body,
      fontSize: 13.5,
      lineHeight: 20,
      marginTop: 6,
      maxWidth: 330,
      textAlign: "center",
    },
    stateAction: {
      alignItems: "center",
      justifyContent: "center",
      marginTop: 12,
      minHeight: 44,
      paddingHorizontal: 16,
    },
    stateActionText: {
      color: theme.brandPressed,
      fontFamily: theme.font.semibold,
      fontSize: 13.5,
    },
    pressed: { opacity: 0.72, transform: [{ scale: 0.97 }] },
    buttonPressed: { opacity: 0.9, transform: [{ scale: 0.97 }] },
    modalBackdrop: {
      backgroundColor: "rgba(41,35,31,0.48)",
      flex: 1,
      justifyContent: "flex-end",
    },
    modal: {
      backgroundColor: theme.surface,
      borderTopLeftRadius: 30,
      borderTopRightRadius: 30,
      maxHeight: "90%",
      paddingHorizontal: 20,
      paddingTop: 10,
    },
    sheetHandle: {
      alignSelf: "center",
      backgroundColor: "rgba(41,35,31,0.18)",
      borderRadius: 2,
      height: 4,
      marginBottom: 12,
      width: 40,
    },
    modalTop: {
      alignItems: "center",
      flexDirection: "row",
      justifyContent: "space-between",
    },
    modalHeading: { flex: 1, paddingRight: 12 },
    modalTitle: {
      color: theme.text,
      fontFamily: theme.font.display,
      fontSize: 24,
      letterSpacing: -0.3,
      lineHeight: 29,
    },
    modalSubtitle: {
      color: theme.textMuted,
      fontFamily: theme.font.body,
      fontSize: 13,
      fontVariant: ["tabular-nums"],
      marginTop: 2,
    },
    closeButton: {
      alignItems: "center",
      height: 44,
      justifyContent: "center",
      width: 44,
    },
    cartContent: { paddingBottom: 38, paddingTop: 18 },
    cartItem: {
      alignItems: "center",
      borderBottomColor: theme.border,
      borderBottomWidth: 1,
      flexDirection: "row",
      gap: 11,
      paddingVertical: 12,
    },
    cartItemImage: {
      backgroundColor: theme.surfaceMuted,
      borderRadius: 12,
      height: 58,
      width: 58,
    },
    cartItemFallback: {
      alignItems: "center",
      backgroundColor: theme.surfaceMuted,
      borderRadius: 12,
      height: 58,
      justifyContent: "center",
      width: 58,
    },
    cartItemCopy: { flex: 1, minWidth: 0 },
    cartItemName: {
      color: theme.text,
      fontFamily: theme.font.semibold,
      fontSize: 13.5,
      lineHeight: 18,
    },
    cartItemMeta: {
      color: theme.textMuted,
      fontFamily: theme.font.body,
      fontSize: 12,
      fontVariant: ["tabular-nums"],
      marginTop: 3,
    },
    demoCheckoutNotice: {
      backgroundColor: theme.surfaceMuted,
      borderColor: theme.border,
      borderRadius: 16,
      borderWidth: 1,
      marginTop: 18,
      padding: 14,
    },
    demoCheckoutHeading: {
      alignItems: "flex-start",
      flexDirection: "row",
      gap: 10,
    },
    demoCheckoutCopy: { flex: 1 },
    demoCheckoutTitle: {
      color: theme.text,
      fontFamily: theme.font.semibold,
      fontSize: 14,
      lineHeight: 19,
    },
    demoCheckoutText: {
      color: theme.textMuted,
      fontFamily: theme.font.body,
      fontSize: 12.5,
      lineHeight: 18,
      marginTop: 3,
    },
    demoSubtotal: {
      alignItems: "center",
      borderTopColor: theme.border,
      borderTopWidth: 1,
      flexDirection: "row",
      justifyContent: "space-between",
      marginTop: 13,
      paddingTop: 12,
    },
    checkoutError: {
      alignItems: "flex-start",
      backgroundColor: "rgba(233,177,142,0.20)",
      borderRadius: 14,
      flexDirection: "row",
      gap: 9,
      marginTop: 16,
      padding: 12,
    },
    checkoutErrorText: {
      color: theme.error,
      flex: 1,
      fontFamily: theme.font.medium,
      fontSize: 12.5,
      lineHeight: 18,
    },
    sectionLabel: {
      color: theme.text,
      fontFamily: theme.font.semibold,
      fontSize: 13.5,
      marginBottom: 9,
      marginTop: 22,
    },
    optional: { color: theme.textMuted, fontFamily: theme.font.body },
    zoneList: { gap: 8 },
    zone: {
      alignItems: "center",
      borderColor: theme.border,
      borderRadius: 14,
      borderWidth: 1,
      flexDirection: "row",
      justifyContent: "space-between",
      minHeight: 62,
      paddingHorizontal: 14,
      paddingVertical: 9,
    },
    zoneSelected: {
      backgroundColor: "rgba(241,223,200,0.46)",
      borderColor: "rgba(168,70,46,0.40)",
    },
    zoneCopy: { flex: 1, paddingRight: 12 },
    zoneName: {
      color: theme.text,
      fontFamily: theme.font.semibold,
      fontSize: 13.5,
    },
    zoneFee: {
      color: theme.textMuted,
      fontFamily: theme.font.body,
      fontSize: 12,
      fontVariant: ["tabular-nums"],
      marginTop: 3,
    },
    zoneWarning: {
      alignItems: "flex-start",
      flexDirection: "row",
      gap: 8,
      marginTop: 8,
    },
    zoneWarningText: {
      color: theme.warning,
      flex: 1,
      fontFamily: theme.font.medium,
      fontSize: 12.5,
      lineHeight: 18,
    },
    noteInput: {
      borderColor: theme.border,
      borderRadius: 14,
      borderWidth: 1,
      color: theme.text,
      fontFamily: theme.font.body,
      fontSize: 14,
      minHeight: 92,
      paddingHorizontal: 13,
      paddingVertical: 12,
      textAlignVertical: "top",
    },
    totals: {
      borderTopColor: theme.border,
      borderTopWidth: 1,
      marginTop: 22,
      paddingTop: 12,
    },
    totalRow: {
      alignItems: "center",
      flexDirection: "row",
      justifyContent: "space-between",
      paddingVertical: 5,
    },
    totalLabel: {
      color: theme.textMuted,
      fontFamily: theme.font.body,
      fontSize: 13,
    },
    totalValue: {
      color: theme.text,
      fontFamily: theme.font.medium,
      fontSize: 13,
      fontVariant: ["tabular-nums"],
    },
    grandTotal: { marginTop: 4, paddingTop: 10 },
    grandLabel: {
      color: theme.text,
      fontFamily: theme.font.semibold,
      fontSize: 15,
    },
    grandValue: {
      color: theme.brandPressed,
      fontFamily: theme.font.display,
      fontSize: 20,
      fontVariant: ["tabular-nums"],
    },
    checkout: {
      alignItems: "center",
      backgroundColor: theme.deepBrand,
      borderRadius: 14,
      flexDirection: "row",
      gap: 8,
      justifyContent: "center",
      marginTop: 16,
      minHeight: 54,
      paddingHorizontal: 16,
    },
    checkoutDisabled: {
      backgroundColor: theme.surfaceMuted,
      borderColor: theme.border,
      borderWidth: 1,
    },
    controlDisabled: { opacity: 0.48 },
    checkoutText: {
      color: "#FFFFFF",
      fontFamily: theme.font.semibold,
      fontSize: 14.5,
    },
    checkoutTextDisabled: { color: theme.textSubtle },
    paymentHelp: {
      color: theme.textMuted,
      fontFamily: theme.font.body,
      fontSize: 12.5,
      lineHeight: 18,
      marginTop: 9,
      textAlign: "center",
    },
  });
const styles = createStyles(theme);
