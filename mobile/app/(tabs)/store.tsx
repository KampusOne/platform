import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useMemo, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";

import { AppHeader } from "@/src/components/app-header";
import { EmptyResult, FilterRow, InlineFeedback, ProductScreen, SearchField } from "@/src/components/product-ui";
import { SectionHeading } from "@/src/components/section-heading";
import { FavoriteButton, GlassCard, PressScale, ProductArtwork, useReducedMotionPreference, VerifiedBadge } from "@/src/components/visual-system";
import { theme } from "@/src/theme";

const categories = ["All", "Books", "Food", "Gadgets", "Printing", "Fashion"] as const;

const products = [
  { id: "book", name: "Data Structures Handbook", seller: "Campus Books", category: "Books", price: 9500, rating: "4.8", reviews: 120, art: "books" as const },
  { id: "burger", name: "Campus Classic Burger", seller: "The Kitchen", category: "Food", price: 4800, rating: "4.6", reviews: 89, art: "burger" as const },
  { id: "earbuds", name: "Wireless Earbuds", seller: "Tech Zone", category: "Gadgets", price: 24500, rating: "4.7", reviews: 254, art: "earbuds" as const },
  { id: "hoodie", name: "KampusOne Hoodie", seller: "Campus Originals", category: "Fashion", price: 18500, rating: "4.9", reviews: 312, art: "hoodie" as const },
  { id: "printing", name: "Document Printing", seller: "Print Hub", category: "Printing", price: 150, rating: "4.5", reviews: 98, art: "print" as const },
  { id: "notebook", name: "Brighter Notes Book", seller: "Campus Essentials", category: "Books", price: 3200, rating: "4.8", reviews: 176, art: "notebook" as const },
] as const;

function naira(value: number) {
  return `₦${new Intl.NumberFormat("en-NG").format(value)}`;
}

export default function StoreScreen() {
  const [selected, setSelected] = useState<(typeof categories)[number]>("All");
  const [query, setQuery] = useState("");
  const [favorites, setFavorites] = useState<string[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [feedback, setFeedback] = useState("");
  const cartPulse = useRef(new Animated.Value(1)).current;
  const reducedMotion = useReducedMotionPreference();

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return products.filter((product) => {
      const categoryMatch = selected === "All" || product.category === selected;
      const queryMatch = !needle || `${product.name} ${product.seller} ${product.category}`.toLowerCase().includes(needle);
      return categoryMatch && queryMatch;
    });
  }, [query, selected]);

  const cartCount = Object.values(quantities).reduce((sum, value) => sum + value, 0);
  const cartTotal = products.reduce((sum, product) => sum + product.price * (quantities[product.id] ?? 0), 0);

  function tap() {
    void Haptics.selectionAsync();
  }

  function updateQuantity(id: string, delta: number) {
    const current = quantities[id] ?? 0;
    const next = Math.max(0, current + delta);
    setQuantities((values) => ({ ...values, [id]: next }));
    setFeedback(next > current ? "Added to your preview basket." : "Basket updated.");
    void (next > current ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success) : Haptics.selectionAsync());
    if (reducedMotion) {
      cartPulse.setValue(1);
      return;
    }
    Animated.sequence([
      Animated.timing(cartPulse, { duration: 90, toValue: 0.72, useNativeDriver: true }),
      Animated.spring(cartPulse, { damping: 7, stiffness: 260, toValue: 1.18, useNativeDriver: true }),
      Animated.spring(cartPulse, { damping: 10, stiffness: 230, toValue: 1, useNativeDriver: true }),
    ]).start();
  }

  return (
    <ProductScreen>
      <AppHeader
        badge={{ icon: "flame", text: "Popular this week" }}
        showBell={false}
        subtitle="Books, food, gadgets and more."
        title="Campus store"
        unread={false}
      />
      <SearchField onChangeText={setQuery} placeholder="Search products, brands or categories" value={query} />
      <View style={styles.filters}>
        <FilterRow
          items={categories}
          onSelect={(item) => {
            tap();
            setSelected(item as (typeof categories)[number]);
          }}
          selected={selected}
        />
      </View>
      {feedback ? <InlineFeedback message={feedback} tone={feedback.includes("Added") ? "success" : "brand"} /> : null}

      <GlassCard style={styles.promo}>
        <View style={styles.promoCopy}>
          <Text style={styles.promoTitle}>Gear up for a brighter semester.</Text>
          <Text style={styles.promoBody}>Books, gadgets and essentials, all in one place.</Text>
          <PressScale
            accessibilityLabel="Browse popular products"
            onPress={() => {
              tap();
              setSelected("All");
            }}
            style={styles.shopButton}
          >
            <Text style={styles.shopButtonText}>Shop now</Text>
            <Ionicons name="arrow-forward" size={16} color="#FFFFFF" />
          </PressScale>
        </View>
        <StoreHeroArtwork />
      </GlassCard>

      <View style={styles.section}>
        <SectionHeading meta={`${filtered.length} items`} title={selected === "All" ? "Popular on campus" : selected} />
        {filtered.length ? (
          <View style={styles.grid}>
            {filtered.map((product) => {
              const quantity = quantities[product.id] ?? 0;
              const isFavorite = favorites.includes(product.id);
              return (
                <View style={styles.card} key={product.id}>
                  <View style={styles.productVisual}>
                    <ProductArtwork type={product.art} />
                    <View style={styles.favoritePosition}>
                      <FavoriteButton
                        active={isFavorite}
                        label={isFavorite ? `Remove ${product.name} from favorites` : `Add ${product.name} to favorites`}
                        onPress={() => setFavorites((items) => (isFavorite ? items.filter((item) => item !== product.id) : [...items, product.id]))}
                      />
                    </View>
                  </View>
                  <Text numberOfLines={2} style={styles.productName}>{product.name}</Text>
                  <View style={styles.sellerRow}>
                    <Text numberOfLines={1} style={styles.seller}>{product.seller}</Text>
                    <VerifiedBadge label={`${product.seller} verified vendor preview`} size={12} />
                  </View>
                  <View style={styles.ratingRow}>
                    <Ionicons name="star" size={13} color="#C97824" />
                    <Text style={styles.rating}>{product.rating} ({product.reviews})</Text>
                  </View>
                  <View style={styles.priceRow}>
                    <Text style={styles.price}>{naira(product.price)}</Text>
                    {quantity === 0 ? (
                      <PressScale accessibilityLabel={`Add ${product.name} to basket`} onPress={() => updateQuantity(product.id, 1)} style={styles.addButton}>
                        <Ionicons name="cart-outline" size={19} color={theme.brandPressed} />
                      </PressScale>
                    ) : (
                      <View style={styles.stepper}>
                        <Pressable accessibilityLabel={`Remove one ${product.name}`} hitSlop={7} onPress={() => updateQuantity(product.id, -1)} style={styles.stepButton}><Ionicons name="remove" size={15} color={theme.brandPressed} /></Pressable>
                        <Text style={styles.quantity}>{quantity}</Text>
                        <Pressable accessibilityLabel={`Add one ${product.name}`} hitSlop={7} onPress={() => updateQuantity(product.id, 1)} style={styles.stepButton}><Ionicons name="add" size={15} color={theme.brandPressed} /></Pressable>
                      </View>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        ) : (
          <EmptyResult body="Try another product, seller or category." title="No products found" />
        )}
      </View>

      {cartCount ? (
        <PressScale
          accessibilityLabel="Review preview basket"
          onPress={() => setFeedback("Checkout stays locked until marketplace safeguards are ready.")}
          style={styles.cartBar}
        >
          <Animated.View style={[styles.cartCount, { transform: [{ scale: cartPulse }] }]}><Text style={styles.cartCountText}>{cartCount}</Text></Animated.View>
          <View style={styles.cartCopy}><Text style={styles.cartTitle}>Preview basket</Text><Text style={styles.cartMeta}>{naira(cartTotal)}</Text></View>
          <Text style={styles.cartAction}>Review</Text>
          <Ionicons name="arrow-forward" size={18} color="#FFFFFF" />
        </PressScale>
      ) : null}

      <View style={styles.safety}>
        <Ionicons name="lock-closed-outline" size={18} color={theme.textSubtle} />
        <Text style={styles.safetyText}>Vendor seals are preview-only. Checkout stays locked until real identity checks, payments, refunds and disputes are connected.</Text>
      </View>
    </ProductScreen>
  );
}

function StoreHeroArtwork() {
  return (
    <View pointerEvents="none" style={styles.heroArt}>
      <View style={styles.heroOrb} />
      <View style={styles.heroNotebook}><View style={styles.heroNotebookSpine} /><Text style={styles.heroNotebookText}>GOOD IDEAS{`\n`}BRIGHTER FUTURES</Text></View>
      <View style={styles.heroBottle}><View style={styles.heroBottleCap} /><View style={styles.heroBottleMark}><Text style={styles.heroBottleMarkText}>K1</Text></View></View>
      <View style={styles.heroBookOne} /><View style={styles.heroBookTwo} />
    </View>
  );
}

const styles = StyleSheet.create({
  filters: { marginBottom: 16, marginTop: 12 },
  promo: { minHeight: 215, padding: 18 },
  promoCopy: { maxWidth: "59%", zIndex: 2 },
  promoTitle: { color: theme.text, fontFamily: theme.font.displayStrong, fontSize: 24, letterSpacing: -0.55, lineHeight: 27 },
  promoBody: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 12, lineHeight: 17, marginTop: 7 },
  shopButton: { alignItems: "center", alignSelf: "flex-start", backgroundColor: theme.brand, borderRadius: 13, flexDirection: "row", gap: 7, marginTop: 15, minHeight: 43, paddingHorizontal: 14 },
  shopButtonText: { color: "#FFFFFF", fontFamily: theme.font.semibold, fontSize: 12 },
  heroArt: { bottom: 0, height: 205, overflow: "hidden", position: "absolute", right: 0, width: 190 },
  heroOrb: { backgroundColor: "rgba(233,177,142,0.35)", borderRadius: 80, height: 160, position: "absolute", right: -37, top: 8, width: 160 },
  heroNotebook: { backgroundColor: "#B07A5F", borderRadius: 7, bottom: 24, height: 81, justifyContent: "center", paddingLeft: 24, position: "absolute", right: 52, transform: [{ rotate: "-4deg" }], width: 93, ...theme.shadow },
  heroNotebookSpine: { backgroundColor: "#49372E", bottom: 0, left: 11, position: "absolute", top: 0, width: 4 },
  heroNotebookText: { color: "#FFF7F1", fontFamily: theme.font.bold, fontSize: 7.5, lineHeight: 11 },
  heroBottle: { backgroundColor: "#F7F1EA", borderColor: "#D8CCC2", borderRadius: 16, borderWidth: 1, bottom: 16, height: 130, position: "absolute", right: 12, width: 48, ...theme.shadow },
  heroBottleCap: { backgroundColor: "#D6CBC2", borderTopLeftRadius: 5, borderTopRightRadius: 5, height: 17, left: 9, position: "absolute", top: -10, width: 30 },
  heroBottleMark: { alignItems: "center", backgroundColor: theme.brand, borderRadius: 13, height: 26, justifyContent: "center", left: 10, position: "absolute", top: 52, width: 26 },
  heroBottleMarkText: { color: "#FFFFFF", fontFamily: theme.font.displayStrong, fontSize: 8 },
  heroBookOne: { backgroundColor: "#6B5C54", borderRadius: 3, bottom: 14, height: 14, position: "absolute", right: 44, transform: [{ rotate: "-2deg" }], width: 112 },
  heroBookTwo: { backgroundColor: theme.brand, borderRadius: 3, bottom: 5, height: 13, position: "absolute", right: 38, transform: [{ rotate: "1deg" }], width: 118 },
  section: { marginTop: 27 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  card: { backgroundColor: "rgba(255,253,252,0.94)", borderColor: "rgba(255,255,255,0.98)", borderRadius: 20, borderWidth: 1, padding: 9, width: "48.6%", ...theme.shadow },
  productVisual: { position: "relative" },
  favoritePosition: { position: "absolute", right: 7, top: 7 },
  productName: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 12.5, lineHeight: 16, marginTop: 9, minHeight: 32 },
  sellerRow: { alignItems: "center", flexDirection: "row", gap: 4, marginTop: 2 },
  seller: { color: theme.textSubtle, flexShrink: 1, fontFamily: theme.font.body, fontSize: 10 },
  ratingRow: { alignItems: "center", flexDirection: "row", marginTop: 5 },
  rating: { color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 9.5, marginLeft: 3 },
  priceRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginTop: 7, minHeight: 35 },
  price: { color: theme.brandPressed, fontFamily: theme.font.display, fontSize: 15 },
  addButton: { alignItems: "center", backgroundColor: "rgba(233,177,142,0.27)", borderRadius: 11, height: 35, justifyContent: "center", width: 39 },
  stepper: { alignItems: "center", backgroundColor: theme.surfaceMuted, borderRadius: 11, flexDirection: "row", gap: 3, height: 35, paddingHorizontal: 4 },
  stepButton: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.72)", borderRadius: 8, height: 27, justifyContent: "center", width: 27 },
  quantity: { color: theme.text, fontFamily: theme.font.bold, fontSize: 11, minWidth: 15, textAlign: "center" },
  cartBar: { alignItems: "center", backgroundColor: theme.text, borderRadius: 19, flexDirection: "row", marginTop: 22, minHeight: 68, paddingHorizontal: 14, ...theme.floatingShadow },
  cartCount: { alignItems: "center", backgroundColor: theme.brand, borderRadius: 13, height: 42, justifyContent: "center", width: 42 },
  cartCountText: { color: "#FFFFFF", fontFamily: theme.font.bold, fontSize: 14 },
  cartCopy: { flex: 1, marginLeft: 11 },
  cartTitle: { color: "#FFFFFF", fontFamily: theme.font.semibold, fontSize: 13 },
  cartMeta: { color: "#D8CCC5", fontFamily: theme.font.body, fontSize: 11.5, marginTop: 2 },
  cartAction: { color: "#FFFFFF", fontFamily: theme.font.semibold, fontSize: 12.5, marginRight: 7 },
  safety: { alignItems: "flex-start", flexDirection: "row", gap: 8, marginTop: 22, paddingHorizontal: 7 },
  safetyText: { color: theme.textSubtle, flex: 1, fontFamily: theme.font.body, fontSize: 10.5, lineHeight: 16 },
});
