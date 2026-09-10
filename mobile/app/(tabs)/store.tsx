import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { AppHeader } from "@/src/components/app-header";
import { EmptyResult, FilterRow, InlineFeedback, ProductScreen, SearchField } from "@/src/components/product-ui";
import { SectionHeading } from "@/src/components/section-heading";
import { theme } from "@/src/theme";

const categories = ["All", "Academic", "Essentials", "Services"] as const;

const products = [
  { id: "drawing", name: "Drawing set", seller: "Ugbowo Stationers", category: "Academic", price: 4200, icon: "create-outline" },
  { id: "calculator", name: "Scientific calculator", seller: "Campus Tech Hub", category: "Academic", price: 18500, icon: "calculator-outline" },
  { id: "notebook", name: "A4 notebook pack", seller: "Bright Pages", category: "Essentials", price: 3500, icon: "book-outline" },
  { id: "laundry", name: "Laundry pickup", seller: "Hall 3 Laundry", category: "Services", price: 2500, icon: "shirt-outline" },
] as const;

function naira(value: number) {
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(value);
}

export default function StoreScreen() {
  const [selected, setSelected] = useState<(typeof categories)[number]>("All");
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [feedback, setFeedback] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return products.filter((product) => {
      const categoryMatch = selected === "All" || product.category === selected;
      const searchMatch = !needle || `${product.name} ${product.seller} ${product.category}`.toLowerCase().includes(needle);
      return categoryMatch && searchMatch;
    });
  }, [query, selected]);

  const cartCount = Object.values(cart).reduce((sum, quantity) => sum + quantity, 0);
  const cartTotal = products.reduce((sum, product) => sum + product.price * (cart[product.id] ?? 0), 0);

  function changeQuantity(id: string, amount: number) {
    void Haptics.selectionAsync();
    setCart((current) => {
      const next = Math.max(0, (current[id] ?? 0) + amount);
      return { ...current, [id]: next };
    });
    setFeedback(amount > 0 ? "Added to preview basket." : "Removed from preview basket.");
  }

  return (
    <ProductScreen>
      <AppHeader title="Campus store" subtitle="Verified campus sellers · Preview" showBell={false} unread={false} />
      <SearchField onChangeText={setQuery} placeholder="Search products or services" value={query} />
      <View style={styles.filters}>
        <FilterRow
          items={categories}
          onSelect={(item) => {
            void Haptics.selectionAsync();
            setSelected(item as (typeof categories)[number]);
          }}
          selected={selected}
        />
      </View>

      {feedback ? <InlineFeedback message={feedback} tone={feedback.includes("Added") ? "success" : "brand"} /> : null}

      <View style={styles.section}>
        <SectionHeading meta={`${filtered.length} items`} title={selected === "All" ? "Useful on campus" : selected} />
        {filtered.length ? (
          <View style={styles.grid}>
            {filtered.map((product) => {
              const quantity = cart[product.id] ?? 0;
              return (
                <View style={styles.card} key={product.id}>
                  <View style={styles.productVisual}>
                    <Ionicons name={product.icon} size={36} color={theme.brand} />
                    <View style={styles.verified}><Ionicons name="shield-checkmark" size={14} color={theme.success} /></View>
                  </View>
                  <Text style={styles.productName}>{product.name}</Text>
                  <Text style={styles.seller} numberOfLines={1}>{product.seller}</Text>
                  <Text style={styles.price}>{naira(product.price)}</Text>
                  {quantity ? (
                    <View style={styles.stepper}>
                      <Pressable accessibilityLabel={`Remove one ${product.name}`} hitSlop={7} onPress={() => changeQuantity(product.id, -1)} style={({ pressed }) => [styles.stepButton, pressed && styles.pressed]}>
                        <Ionicons name="remove" size={18} color={theme.brandPressed} />
                      </Pressable>
                      <Text style={styles.quantity}>{quantity}</Text>
                      <Pressable accessibilityLabel={`Add one ${product.name}`} hitSlop={7} onPress={() => changeQuantity(product.id, 1)} style={({ pressed }) => [styles.stepButton, pressed && styles.pressed]}>
                        <Ionicons name="add" size={18} color={theme.brandPressed} />
                      </Pressable>
                    </View>
                  ) : (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => changeQuantity(product.id, 1)}
                      style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}
                    >
                      <Text style={styles.addButtonText}>Add to basket</Text>
                    </Pressable>
                  )}
                </View>
              );
            })}
          </View>
        ) : (
          <EmptyResult body="Try another product, service or category." title="No store item found" />
        )}
      </View>

      {cartCount ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setFeedback("Checkout stays disabled until payment and dispute safeguards are live.")}
          style={({ pressed }) => [styles.cartBar, pressed && styles.pressed]}
        >
          <View style={styles.cartCount}><Text style={styles.cartCountText}>{cartCount}</Text></View>
          <View style={styles.cartCopy}>
            <Text style={styles.cartTitle}>Preview basket</Text>
            <Text style={styles.cartMeta}>{naira(cartTotal)}</Text>
          </View>
          <Text style={styles.cartAction}>Review</Text>
          <Ionicons name="arrow-forward" size={18} color="#FFFFFF" />
        </Pressable>
      ) : null}

      <View style={styles.safety}>
        <Ionicons name="lock-closed-outline" size={19} color={theme.textSubtle} />
        <Text style={styles.safetyText}>Purchases remain off until seller verification, payments, refunds and disputes are connected.</Text>
      </View>
    </ProductScreen>
  );
}

const styles = StyleSheet.create({
  filters: { marginBottom: 16, marginTop: 12 },
  section: { marginTop: 23 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  card: { backgroundColor: theme.surfaceRaised, borderColor: theme.border, borderRadius: 19, borderWidth: 1, padding: 13, width: "48.5%", ...theme.shadow },
  productVisual: { alignItems: "center", backgroundColor: theme.surfaceSoft, borderRadius: 16, height: 112, justifyContent: "center", position: "relative" },
  verified: { alignItems: "center", backgroundColor: "#FFFFFF", borderRadius: 11, bottom: 8, height: 24, justifyContent: "center", position: "absolute", right: 8, width: 24, ...theme.shadow },
  productName: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 14, lineHeight: 19, marginTop: 12 },
  seller: { color: theme.textSubtle, fontFamily: theme.font.body, fontSize: 11.5, marginTop: 3 },
  price: { color: theme.text, fontFamily: theme.font.display, fontSize: 17, marginTop: 8 },
  addButton: { alignItems: "center", backgroundColor: theme.brand, borderRadius: 11, justifyContent: "center", marginTop: 11, minHeight: 41 },
  addButtonText: { color: "#FFFFFF", fontFamily: theme.font.semibold, fontSize: 12.5 },
  stepper: { alignItems: "center", borderColor: "rgba(195,93,56,0.22)", borderRadius: 11, borderWidth: 1, flexDirection: "row", justifyContent: "space-between", marginTop: 11, minHeight: 41, paddingHorizontal: 6 },
  stepButton: { alignItems: "center", backgroundColor: theme.surfaceMuted, borderRadius: 9, height: 30, justifyContent: "center", width: 30 },
  quantity: { color: theme.text, fontFamily: theme.font.bold, fontSize: 13.5 },
  cartBar: { alignItems: "center", backgroundColor: theme.text, borderRadius: 18, flexDirection: "row", marginTop: 22, minHeight: 66, paddingHorizontal: 14, ...theme.floatingShadow },
  cartCount: { alignItems: "center", backgroundColor: theme.brand, borderRadius: 12, height: 40, justifyContent: "center", width: 40 },
  cartCountText: { color: "#FFFFFF", fontFamily: theme.font.bold, fontSize: 14 },
  cartCopy: { flex: 1, marginLeft: 11 },
  cartTitle: { color: "#FFFFFF", fontFamily: theme.font.semibold, fontSize: 13.5 },
  cartMeta: { color: "#D8CCC5", fontFamily: theme.font.body, fontSize: 12, marginTop: 2 },
  cartAction: { color: "#FFFFFF", fontFamily: theme.font.semibold, fontSize: 13, marginRight: 7 },
  safety: { alignItems: "flex-start", flexDirection: "row", gap: 9, marginTop: 22, paddingHorizontal: 8 },
  safetyText: { color: theme.textSubtle, flex: 1, fontFamily: theme.font.body, fontSize: 11.5, lineHeight: 17 },
  pressed: { opacity: 0.72, transform: [{ scale: 0.98 }] },
});
