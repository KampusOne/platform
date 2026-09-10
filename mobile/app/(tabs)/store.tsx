import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { AppHeader } from "@/src/components/app-header";
import { EmptyResult, ProductScreen, SearchField } from "@/src/components/product-ui";
import { ApiError, api } from "@/src/lib/api";
import { theme } from "@/src/theme";

type Product = {
  id: string;
  vendor_profile_id: string;
  name: string;
  description: string;
  category: string;
  price_kobo: number;
  stock_quantity: number;
  image_url: string | null;
  vendor_name: string;
};

type Zone = { id: string; name: string; base_fee_kobo: number };
type Cart = Record<string, number>;

const naira = (kobo: number) => new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 0,
}).format(Number(kobo) / 100);

export default function StoreScreen() {
  const [products, setProducts] = useState<Product[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [cart, setCart] = useState<Cart>({});
  const [query, setQuery] = useState("");
  const [selectedZoneId, setSelectedZoneId] = useState("");
  const [deliveryNote, setDeliveryNote] = useState("");
  const [cartOpen, setCartOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const data = await api<{ products: Product[]; deliveryZones: Zone[] }>("/v1/student/store");
      setProducts(data.products);
      setZones(data.deliveryZones);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The campus store could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return products.filter((item) => `${item.name} ${item.description} ${item.category} ${item.vendor_name}`.toLowerCase().includes(term));
  }, [products, query]);
  const cartItems = useMemo(() => products
    .filter((product) => Boolean(cart[product.id]))
    .map((product) => ({ product, quantity: cart[product.id] ?? 0 })), [cart, products]);
  const cartCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = cartItems.reduce((sum, item) => sum + Number(item.product.price_kobo) * item.quantity, 0);
  const selectedZone = zones.find((zone) => zone.id === selectedZoneId);
  const total = subtotal + Number(selectedZone?.base_fee_kobo ?? 0);

  function add(product: Product) {
    const activeVendor = cartItems[0]?.product.vendor_profile_id;
    if (activeVendor && activeVendor !== product.vendor_profile_id) {
      Alert.alert(
        "One vendor per order",
        "Checkout or clear your current cart before adding an item from another campus vendor.",
      );
      return;
    }
    const stock = Number(product.stock_quantity);
    setCart((current) => ({ ...current, [product.id]: Math.min((current[product.id] ?? 0) + 1, stock) }));
    setNotice(`${product.name} added to your cart.`);
  }

  function changeQuantity(product: Product, delta: number) {
    setCart((current) => {
      const nextQuantity = Math.min(Number(product.stock_quantity), Math.max(0, (current[product.id] ?? 0) + delta));
      const next = { ...current };
      if (nextQuantity === 0) delete next[product.id];
      else next[product.id] = nextQuantity;
      return next;
    });
  }

  async function checkout() {
    if (!cartItems.length || !selectedZone) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const order = await api<{ id: string; totalKobo: number }>("/v1/student/orders", {
        method: "POST",
        body: JSON.stringify({
          vendorProfileId: cartItems[0]?.product.vendor_profile_id,
          deliveryZoneId: selectedZone.id,
          deliveryNote: deliveryNote.trim() || null,
          items: cartItems.map(({ product, quantity }) => ({ productId: product.id, quantity })),
        }),
      });
      setCart({});
      setCartOpen(false);
      setDeliveryNote("");
      setSelectedZoneId("");
      setNotice(`Order #${order.id.slice(0, 8)} was created. You can always resume it from Purchases.`);
      try {
        const payment = await api<{ authorizationUrl: string }>("/v1/payments/initialize", {
          method: "POST",
          body: JSON.stringify({ resourceType: "STORE_ORDER", resourceId: order.id }),
        });
        await Linking.openURL(payment.authorizationUrl);
      } catch (paymentError) {
        const message = paymentError instanceof ApiError
          ? paymentError.message
          : "The secure payment page could not be opened.";
        setNotice(`Your unpaid order is safely saved. ${message} Resume payment from Purchases.`);
      }
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The order could not be created.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ProductScreen>
      <AppHeader
        badge={{ icon: "shield-checkmark", text: "Approved campus vendors", verified: true }}
        showBell={false}
        subtitle="Student essentials from verified sellers"
        title="Campus store"
        unread={false}
      />
      <View style={styles.hero}>
        <Image resizeMode="cover" source={require("@/assets/brand-scenes/rider.png")} style={styles.heroImage} />
        <View style={styles.heroCopy}>
          <Text style={styles.heroEyebrow}>BICYCLE DELIVERY</Text>
          <Text style={styles.heroTitle}>Campus essentials, brought closer.</Text>
          <Text style={styles.heroBody}>Track every handoff from an approved vendor to an approved rider.</Text>
        </View>
      </View>
      <View style={styles.searchRow}>
        <View style={styles.searchWrap}><SearchField onChangeText={setQuery} placeholder="Search products or vendors" value={query} /></View>
        <Pressable accessibilityLabel={`Open cart with ${cartCount} items`} onPress={() => setCartOpen(true)} style={styles.cartButton}>
          <Ionicons name="bag-handle" size={22} color="#FFFFFF" />
          {cartCount ? <View style={styles.cartBadge}><Text style={styles.cartBadgeText}>{cartCount}</Text></View> : null}
        </Pressable>
      </View>
      {notice ? <View style={styles.notice}><Ionicons name="information-circle-outline" size={19} color={theme.statusAttention} /><Text style={styles.noticeText}>{notice}</Text></View> : null}
      {notice.includes("Purchases") ? <Pressable onPress={() => router.push("/purchases")} style={styles.purchasesLink}><Text style={styles.purchasesLinkText}>Open Purchases</Text><Ionicons name="arrow-forward" size={16} color={theme.brandPressed} /></Pressable> : null}
      {loading ? <View style={styles.loading}><ActivityIndicator color={theme.brand} /><Text style={styles.loadingText}>Loading published products…</Text></View> : null}
      {error ? <Pressable onPress={() => { setLoading(true); void load(); }} style={styles.error}><Ionicons name="alert-circle-outline" size={20} color={theme.deepBrand} /><Text style={styles.errorText}>{error} Tap to retry.</Text></Pressable> : null}
      {!loading && !error && !filtered.length ? <EmptyResult body="Approved vendors can add products from the agent portal. Only published, in-stock items appear here." title="No products published yet" /> : null}
      <View style={styles.grid}>{filtered.map((product) => {
        const quantity = cart[product.id] ?? 0;
        return (
          <View key={product.id} style={styles.card}>
            {product.image_url ? <Image accessibilityLabel={product.name} resizeMode="cover" source={{ uri: product.image_url }} style={styles.productImage} /> : <View style={styles.productFallback}><Ionicons name="bag-handle-outline" size={34} color={theme.brandPressed} /></View>}
            <View style={styles.cardBody}>
              <Text style={styles.category}>{product.category.toUpperCase()}</Text>
              <Text numberOfLines={2} style={styles.name}>{product.name}</Text>
              <Text numberOfLines={2} style={styles.description}>{product.description}</Text>
              <View style={styles.vendor}><Ionicons name="checkmark-circle" size={14} color={theme.brand} /><Text numberOfLines={1} style={styles.vendorText}>{product.vendor_name}</Text></View>
              <View style={styles.footer}>
                <View><Text style={styles.price}>{naira(product.price_kobo)}</Text><Text style={styles.stock}>{product.stock_quantity} in stock</Text></View>
                {quantity ? (
                  <View style={styles.stepper}>
                    <Pressable accessibilityLabel={`Remove one ${product.name}`} onPress={() => changeQuantity(product, -1)} style={styles.stepperButton}><Ionicons name="remove" size={16} color={theme.brandPressed} /></Pressable>
                    <Text style={styles.quantity}>{quantity}</Text>
                    <Pressable accessibilityLabel={`Add one ${product.name}`} disabled={quantity >= Number(product.stock_quantity)} onPress={() => changeQuantity(product, 1)} style={styles.stepperButton}><Ionicons name="add" size={16} color={theme.brandPressed} /></Pressable>
                  </View>
                ) : <Pressable accessibilityLabel={`Add ${product.name} to cart`} onPress={() => add(product)} style={styles.buy}><Ionicons name="add" size={21} color="#FFFFFF" /></Pressable>}
              </View>
            </View>
          </View>
        );
      })}</View>

      <Modal animationType="slide" onRequestClose={() => setCartOpen(false)} transparent visible={cartOpen}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modal}>
            <View style={styles.modalTop}>
              <View><Text style={styles.modalEyebrow}>CHECKOUT</Text><Text style={styles.modalTitle}>Your campus cart</Text></View>
              <Pressable accessibilityLabel="Close cart" onPress={() => setCartOpen(false)} style={styles.closeButton}><Ionicons name="close" size={22} color={theme.text} /></Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.cartContent} showsVerticalScrollIndicator={false}>
              {!cartItems.length ? <EmptyResult body="Add an item from a campus-approved vendor to begin your order." title="Your cart is empty" /> : null}
              {cartItems.map(({ product, quantity }) => (
                <View key={product.id} style={styles.cartItem}>
                  <View style={styles.cartItemCopy}><Text style={styles.cartItemName}>{product.name}</Text><Text style={styles.cartItemMeta}>{naira(product.price_kobo)} each</Text></View>
                  <View style={styles.stepper}><Pressable onPress={() => changeQuantity(product, -1)} style={styles.stepperButton}><Ionicons name="remove" size={16} color={theme.brandPressed} /></Pressable><Text style={styles.quantity}>{quantity}</Text><Pressable disabled={quantity >= Number(product.stock_quantity)} onPress={() => changeQuantity(product, 1)} style={styles.stepperButton}><Ionicons name="add" size={16} color={theme.brandPressed} /></Pressable></View>
                </View>
              ))}
              {cartItems.length ? <>
                <Text style={styles.fieldLabel}>Delivery zone</Text>
                <View style={styles.zoneList}>{zones.map((zone) => {
                  const selected = zone.id === selectedZoneId;
                  return <Pressable accessibilityState={{ selected }} key={zone.id} onPress={() => setSelectedZoneId(zone.id)} style={[styles.zone, selected && styles.zoneSelected]}><View><Text style={[styles.zoneName, selected && styles.zoneNameSelected]}>{zone.name}</Text><Text style={[styles.zoneFee, selected && styles.zoneFeeSelected]}>{naira(zone.base_fee_kobo)} delivery</Text></View>{selected ? <Ionicons name="checkmark-circle" size={21} color="#FFFFFF" /> : null}</Pressable>;
                })}</View>
                {!zones.length ? <Text style={styles.zoneWarning}>Checkout is unavailable until your university publishes a delivery zone.</Text> : null}
                <Text style={styles.fieldLabel}>Delivery note <Text style={styles.optional}>(optional)</Text></Text>
                <TextInput maxLength={500} multiline onChangeText={setDeliveryNote} placeholder="Hostel, landmark, or handoff instruction" placeholderTextColor={theme.textSubtle} style={styles.noteInput} value={deliveryNote} />
                <View style={styles.totals}><View style={styles.totalRow}><Text style={styles.totalLabel}>Items</Text><Text style={styles.totalValue}>{naira(subtotal)}</Text></View><View style={styles.totalRow}><Text style={styles.totalLabel}>Delivery</Text><Text style={styles.totalValue}>{selectedZone ? naira(selectedZone.base_fee_kobo) : "Select a zone"}</Text></View><View style={[styles.totalRow, styles.grandTotal]}><Text style={styles.grandLabel}>Total</Text><Text style={styles.grandValue}>{naira(total)}</Text></View></View>
                <Pressable disabled={busy || !selectedZone} onPress={() => void checkout()} style={[styles.checkout, (busy || !selectedZone) && styles.disabled]}>{busy ? <ActivityIndicator color="#FFFFFF" /> : <><Ionicons name="lock-closed" size={17} color="#FFFFFF" /><Text style={styles.checkoutText}>Create order & pay securely</Text></>}</Pressable>
                <Text style={styles.paymentHelp}>Your inventory is reserved only after the order is created. Payment opens on the provider's secure page.</Text>
              </> : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </ProductScreen>
  );
}

const styles = StyleSheet.create({
  hero: { backgroundColor: theme.sand, borderRadius: 25, height: 210, marginBottom: 16, overflow: "hidden", position: "relative" },
  heroImage: { height: "100%", opacity: 0.92, position: "absolute", right: -55, width: "78%" },
  heroCopy: { bottom: 18, justifyContent: "flex-end", left: 17, top: 18, width: "53%" },
  heroEyebrow: { color: theme.brandPressed, fontFamily: theme.font.bold, fontSize: 9, letterSpacing: 1.1 },
  heroTitle: { color: theme.text, fontFamily: theme.font.displayStrong, fontSize: 23, lineHeight: 26, marginTop: 5 },
  heroBody: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 10.5, lineHeight: 15, marginTop: 7 },
  searchRow: { alignItems: "center", flexDirection: "row", gap: 9 },
  searchWrap: { flex: 1 },
  cartButton: { alignItems: "center", backgroundColor: theme.brand, borderRadius: 18, height: 58, justifyContent: "center", position: "relative", width: 58, ...theme.shadow },
  cartBadge: { alignItems: "center", backgroundColor: theme.text, borderRadius: 10, height: 20, justifyContent: "center", minWidth: 20, paddingHorizontal: 4, position: "absolute", right: -4, top: -5 },
  cartBadgeText: { color: "#FFFFFF", fontFamily: theme.font.bold, fontSize: 9 },
  notice: { alignItems: "flex-start", backgroundColor: "#FFF7E9", borderRadius: 15, flexDirection: "row", gap: 8, marginTop: 13, padding: 13 },
  noticeText: { color: theme.statusAttention, flex: 1, fontFamily: theme.font.medium, fontSize: 11.5, lineHeight: 17 },
  purchasesLink: { alignItems: "center", alignSelf: "flex-start", flexDirection: "row", gap: 6, marginLeft: 4, marginTop: 9 },
  purchasesLinkText: { color: theme.brandPressed, fontFamily: theme.font.bold, fontSize: 11 },
  loading: { alignItems: "center", gap: 9, paddingVertical: 34 },
  loadingText: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 12.5 },
  error: { alignItems: "center", backgroundColor: "#FFF0EB", borderRadius: 16, flexDirection: "row", gap: 9, marginTop: 14, padding: 13 },
  errorText: { color: theme.deepBrand, flex: 1, fontFamily: theme.font.medium, fontSize: 12 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 11, marginTop: 17 },
  card: { backgroundColor: theme.surfaceRaised, borderColor: theme.border, borderRadius: 21, borderWidth: 1, overflow: "hidden", width: "48.5%", ...theme.shadow },
  productImage: { aspectRatio: 1, width: "100%" },
  productFallback: { alignItems: "center", aspectRatio: 1, backgroundColor: theme.surfaceMuted, justifyContent: "center", width: "100%" },
  cardBody: { padding: 11 },
  category: { color: theme.brandPressed, fontFamily: theme.font.bold, fontSize: 7.5, letterSpacing: 0.7 },
  name: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 13.5, lineHeight: 17, marginTop: 4 },
  description: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 9.5, lineHeight: 14, marginTop: 4 },
  vendor: { alignItems: "center", flexDirection: "row", gap: 4, marginTop: 7 },
  vendorText: { color: theme.textSubtle, flex: 1, fontFamily: theme.font.medium, fontSize: 8.5 },
  footer: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginTop: 10 },
  price: { color: theme.text, fontFamily: theme.font.displayStrong, fontSize: 15 },
  stock: { color: theme.textSubtle, fontFamily: theme.font.body, fontSize: 8, marginTop: 2 },
  buy: { alignItems: "center", backgroundColor: theme.brand, borderRadius: 13, height: 38, justifyContent: "center", width: 38 },
  stepper: { alignItems: "center", backgroundColor: theme.surfaceMuted, borderRadius: 13, flexDirection: "row", gap: 4, padding: 3 },
  stepperButton: { alignItems: "center", backgroundColor: theme.surfaceRaised, borderRadius: 10, height: 30, justifyContent: "center", width: 30 },
  quantity: { color: theme.text, fontFamily: theme.font.bold, fontSize: 11, minWidth: 18, textAlign: "center" },
  modalBackdrop: { backgroundColor: "rgba(41,35,31,0.52)", flex: 1, justifyContent: "flex-end" },
  modal: { backgroundColor: theme.surfaceRaised, borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: "88%", paddingHorizontal: 20, paddingTop: 20 },
  modalTop: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  modalEyebrow: { color: theme.brandPressed, fontFamily: theme.font.bold, fontSize: 8, letterSpacing: 1 },
  modalTitle: { color: theme.text, fontFamily: theme.font.displayStrong, fontSize: 23, marginTop: 2 },
  closeButton: { alignItems: "center", backgroundColor: theme.surfaceMuted, borderRadius: 14, height: 42, justifyContent: "center", width: 42 },
  cartContent: { paddingBottom: 38, paddingTop: 18 },
  cartItem: { alignItems: "center", borderBottomColor: theme.border, borderBottomWidth: 1, flexDirection: "row", paddingVertical: 11 },
  cartItemCopy: { flex: 1, paddingRight: 9 },
  cartItemName: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 12.5 },
  cartItemMeta: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 10, marginTop: 3 },
  fieldLabel: { color: theme.text, fontFamily: theme.font.bold, fontSize: 11, marginBottom: 8, marginTop: 18 },
  optional: { color: theme.textSubtle, fontFamily: theme.font.body },
  zoneList: { gap: 8 },
  zone: { alignItems: "center", borderColor: theme.border, borderRadius: 15, borderWidth: 1, flexDirection: "row", justifyContent: "space-between", minHeight: 58, paddingHorizontal: 14 },
  zoneSelected: { backgroundColor: theme.brand, borderColor: theme.brand },
  zoneName: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 12 },
  zoneNameSelected: { color: "#FFFFFF" },
  zoneFee: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 9.5, marginTop: 3 },
  zoneFeeSelected: { color: "rgba(255,255,255,0.82)" },
  zoneWarning: { color: theme.deepBrand, fontFamily: theme.font.medium, fontSize: 11, lineHeight: 17 },
  noteInput: { borderColor: theme.border, borderRadius: 15, borderWidth: 1, color: theme.text, fontFamily: theme.font.body, fontSize: 12, minHeight: 82, padding: 12, textAlignVertical: "top" },
  totals: { backgroundColor: theme.surfaceMuted, borderRadius: 16, marginTop: 18, padding: 14 },
  totalRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  totalLabel: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 11 },
  totalValue: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 11 },
  grandTotal: { borderTopColor: theme.border, borderTopWidth: 1, marginTop: 6, paddingTop: 11 },
  grandLabel: { color: theme.text, fontFamily: theme.font.bold, fontSize: 13 },
  grandValue: { color: theme.brandPressed, fontFamily: theme.font.displayStrong, fontSize: 17 },
  checkout: { alignItems: "center", backgroundColor: theme.brand, borderRadius: 15, flexDirection: "row", gap: 8, justifyContent: "center", marginTop: 14, minHeight: 52 },
  checkoutText: { color: "#FFFFFF", fontFamily: theme.font.bold, fontSize: 12 },
  paymentHelp: { color: theme.textSubtle, fontFamily: theme.font.body, fontSize: 9.5, lineHeight: 15, marginTop: 9, textAlign: "center" },
  disabled: { opacity: 0.5 },
});
