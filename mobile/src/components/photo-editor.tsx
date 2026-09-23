import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, Image, Modal, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, type ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { useAppearance } from "@/src/lib/appearance";
import { clamp, photoCrop } from "@/src/lib/photo-crop";
import { finishPhotoEdit, getPhotoEdit, getServerPhotoEdit, subscribePhotoEdit, type PhotoEditRequest } from "@/src/lib/photo-edit-session";

/** One editor serves profile, cover, onboarding and account photo pickers. */
export function PhotoEditorHost() {
  const request = useSyncExternalStore(subscribePhotoEdit, getPhotoEdit, getServerPhotoEdit);
  useEffect(() => () => {
    const pending = getPhotoEdit();
    if (pending) finishPhotoEdit(pending.id, null);
  }, []);
  if (!request) return null;
  return <PhotoEditor key={request.id} request={request} />;
}

function PhotoEditor({ request }: { request: PhotoEditRequest }) {
  const { theme } = useAppearance();
  const window = useWindowDimensions();
  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const saving = useRef(false), alive = useRef(true);
  const aspect = request.kind === "avatar" ? 1 : 3;
  const frameWidth = Math.max(120, Math.min(window.width - 48, 520, request.kind === "avatar" ? window.height * 0.44 : 520));
  const geometry = photoCrop(request.image, frameWidth, aspect, zoom, position);
  const current = useRef({ geometry, busy });
  current.current = { geometry, busy };
  const dragStart = useRef({ x: 0, y: 0 });
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !current.current.busy,
    onMoveShouldSetPanResponder: () => !current.current.busy,
    onPanResponderGrant: () => { dragStart.current = current.current.geometry.position; },
    onPanResponderMove: (_event, gesture) => {
      if (!current.current.busy) setPosition({ x: dragStart.current.x + gesture.dx, y: dragStart.current.y + gesture.dy });
    },
    onPanResponderRelease: () => setPosition(current.current.geometry.position),
    onPanResponderTerminationRequest: () => false,
  }), []);
  function cancel() { if (!saving.current) finishPhotoEdit(request.id, null); }
  function move(x: number, y: number) { setPosition({ x: geometry.position.x + x, y: geometry.position.y + y }); }
  async function save() {
    if (saving.current || !ready) return;
    saving.current = true;
    setBusy(true); setError("");
    const context = ImageManipulator.manipulate(request.image.uri);
    try {
      context.crop(geometry.rect);
      const targetWidth = Math.min(geometry.rect.width, request.kind === "avatar" ? 768 : 1500);
      context.resize({ width: targetWidth });
      const rendered = await context.renderAsync();
      try {
        const result = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.88 });
        if (alive.current) finishPhotoEdit(request.id, result);
      } finally { rendered.release(); }
    } catch {
      if (alive.current) setError("This crop could not be prepared. Try again, or cancel and choose another photo.");
    } finally {
      context.release();
      saving.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const text = { color: theme.text, fontFamily: theme.font.body };
  function control(label: string, symbol: string, action: () => void, disabled = false) {
    return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={busy || disabled} onPress={action}
      style={({ pressed }) => [styles.control, { borderColor: theme.textMuted, opacity: busy || disabled ? 0.4 : pressed ? 0.65 : 1 }]}>
      <Text style={[text, styles.controlText]}>{symbol}</Text>
    </Pressable>;
  }
  return (
    <Modal visible animationType="none" presentationStyle="fullScreen" onRequestClose={cancel}>
      <SafeAreaView style={[styles.screen, { backgroundColor: theme.canvas }]} accessibilityViewIsModal>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Cancel photo edit" disabled={busy} onPress={cancel} style={styles.headerAction}>
            <Text style={[text, { color: theme.deepBrand, opacity: busy ? 0.4 : 1 }]}>Cancel</Text>
          </Pressable>
          <Text accessibilityRole="header" style={[text, styles.title]}>{request.kind === "avatar" ? "Edit profile photo" : "Edit cover photo"}</Text>
          <View style={styles.headerSpacer} />
        </View>
        <ScrollView contentContainerStyle={styles.content} bounces={false}>
          <Text style={[text, styles.hint, { color: theme.textMuted }]}>Drag to position. Use − and + to zoom.</Text>
          <View {...pan.panHandlers} testID="photo-crop-preview" accessibilityLabel={request.kind === "avatar" ? "Circular profile photo preview" : "Wide cover photo preview"}
            style={[styles.frame, { width: frameWidth, height: geometry.frameHeight, borderRadius: request.kind === "avatar" ? frameWidth / 2 : 12 }, Platform.OS === "web" ? { touchAction: "none" } as ViewStyle : null]}>
            <Image source={{ uri: request.image.uri }} resizeMode="stretch" pointerEvents="none"
              onLoad={() => setReady(true)} onError={() => { setReady(false); setError("This photo could not be displayed. Cancel and choose a JPG, PNG or WebP image."); }}
              style={{ position: "absolute", width: geometry.width, height: geometry.height, left: geometry.left, top: geometry.top }} />
            {!ready && !error ? <ActivityIndicator color={theme.brand} style={StyleSheet.absoluteFill} /> : null}
          </View>
          <View style={styles.row}>
            {control("Zoom out", "−", () => { setPosition(geometry.position); setZoom((z) => clamp(z - 0.2, 1, 4)); }, zoom <= 1)}
            <Text accessibilityLiveRegion="polite" style={[text, styles.zoom]}>{Math.round(zoom * 100)}%</Text>
            {control("Zoom in", "+", () => { setPosition(geometry.position); setZoom((z) => clamp(z + 0.2, 1, 4)); }, zoom >= 4)}
          </View>
          <View style={styles.row}>
            {control("Move photo left", "←", () => move(-20, 0))}
            {control("Move photo up", "↑", () => move(0, -20))}
            {control("Move photo down", "↓", () => move(0, 20))}
            {control("Move photo right", "→", () => move(20, 0))}
          </View>
          <Pressable accessibilityRole="button" disabled={busy} onPress={() => { setZoom(1); setPosition({ x: 0, y: 0 }); }} style={styles.reset}>
            <Text style={[text, { color: theme.deepBrand }]}>Reset position</Text>
          </Pressable>
          <Text style={[text, styles.hint, { color: theme.textMuted }]}>{request.kind === "avatar" ? "Your profile photo appears in a circle." : "Your cover photo uses a wide 3:1 frame."} Nothing is uploaded until you save.</Text>
          {error ? <Text accessibilityRole="alert" style={[text, styles.hint, { color: theme.deepBrand }]}>{error}</Text> : null}
        </ScrollView>
        <View style={styles.footer}>
          <Pressable accessibilityRole="button" accessibilityLabel="Save cropped photo" disabled={busy || !ready} onPress={() => void save()}
            style={({ pressed }) => [styles.save, { backgroundColor: theme.brand, opacity: busy || !ready ? 0.5 : pressed ? 0.8 : 1 }]}>
            {busy ? <ActivityIndicator color="#FFFFFF" /> : null}
            <Text style={[styles.saveText, { fontFamily: theme.font.body }]}>{busy ? "Preparing photo…" : "Save photo"}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1 }, header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, minHeight: 64 },
  headerAction: { minHeight: 44, minWidth: 64, justifyContent: "center", padding: 8 }, headerSpacer: { width: 64 },
  title: { flex: 1, textAlign: "center", fontSize: 18, fontWeight: "700" },
  content: { alignItems: "center", paddingHorizontal: 24, paddingBottom: 16, gap: 12 },
  hint: { fontSize: 13, lineHeight: 20, textAlign: "center", maxWidth: 480, marginVertical: 6 },
  frame: { overflow: "hidden", backgroundColor: "#1F1B18" }, row: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 16 },
  control: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderWidth: 1, borderRadius: 10 },
  controlText: { fontSize: 24 }, zoom: { width: 68, textAlign: "center", fontSize: 15, fontWeight: "600" },
  reset: { minHeight: 44, justifyContent: "center", paddingHorizontal: 12 }, footer: { padding: 20 },
  save: { minHeight: 52, borderRadius: 14, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 10 },
  saveText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
});
