import { InlineLoading } from "@/src/components/skeleton";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  Image,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { useAppearance } from "@/src/lib/appearance";
import { clamp, photoCrop } from "@/src/lib/photo-crop";
import {
  finishPhotoEdit,
  getPhotoEdit,
  getServerPhotoEdit,
  subscribePhotoEdit,
  type PhotoEditRequest,
} from "@/src/lib/photo-edit-session";

const POST_ASPECTS = [
  { key: "original", label: "Original" },
  { key: "3:2", label: "3:2", aspect: 3 / 2 },
  { key: "4:3", label: "4:3", aspect: 4 / 3 },
  { key: "5:4", label: "5:4", aspect: 5 / 4 },
  { key: "1:1", label: "1:1", aspect: 1 },
  { key: "4:5", label: "4:5", aspect: 4 / 5 },
  { key: "3:4", label: "3:4", aspect: 3 / 4 },
  { key: "2:3", label: "2:3", aspect: 2 / 3 },
] as const;

/** One editor serves profile, cover and post-photo pickers. */
export function PhotoEditorHost() {
  const request = useSyncExternalStore(
    subscribePhotoEdit,
    getPhotoEdit,
    getServerPhotoEdit,
  );
  useEffect(
    () => () => {
      const pending = getPhotoEdit();
      if (pending) finishPhotoEdit(pending.id, null);
    },
    [],
  );
  if (!request) return null;
  return <PhotoEditor key={request.id} request={request} />;
}

function PhotoEditor({ request }: { request: PhotoEditRequest }) {
  const { theme } = useAppearance();
  const window = useWindowDimensions();
  const originalAspect = request.image.width / request.image.height;
  const [postAspect, setPostAspect] = useState(originalAspect);
  const [selectedAspect, setSelectedAspect] = useState("original");
  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const saving = useRef(false);
  const alive = useRef(true);

  const aspect =
    request.kind === "avatar" ? 1 : request.kind === "cover" ? 3 : postAspect;
  const maxFrameWidth = Math.max(80, Math.min(window.width - 32, 560));
  const maxFrameHeight = Math.max(180, Math.min(window.height * 0.52, 540));
  const frameWidth = Math.max(
    48,
    Math.min(maxFrameWidth, maxFrameHeight * aspect),
  );
  const geometry = photoCrop(
    request.image,
    frameWidth,
    aspect,
    zoom,
    position,
  );
  const current = useRef({ geometry, busy });
  current.current = { geometry, busy };
  const dragStart = useRef({ x: 0, y: 0 });

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !current.current.busy,
        onMoveShouldSetPanResponder: () => !current.current.busy,
        onPanResponderGrant: () => {
          dragStart.current = current.current.geometry.position;
        },
        onPanResponderMove: (_event, gesture) => {
          if (!current.current.busy)
            setPosition({
              x: dragStart.current.x + gesture.dx,
              y: dragStart.current.y + gesture.dy,
            });
        },
        onPanResponderRelease: () =>
          setPosition(current.current.geometry.position),
        onPanResponderTerminationRequest: () => false,
      }),
    [],
  );

  function cancel() {
    if (!saving.current) finishPhotoEdit(request.id, null);
  }

  function move(x: number, y: number) {
    setPosition({
      x: geometry.position.x + x,
      y: geometry.position.y + y,
    });
  }

  function chooseAspect(
    key: string,
    nextAspect: number,
  ) {
    if (busy) return;
    setSelectedAspect(key);
    setPostAspect(nextAspect);
    setZoom(1);
    setPosition({ x: 0, y: 0 });
  }

  async function save() {
    if (saving.current || !ready) return;
    saving.current = true;
    setBusy(true);
    setError("");
    let context: ReturnType<typeof ImageManipulator.manipulate> | undefined;
    try {
      context = ImageManipulator.manipulate(request.image.uri);
      context.crop(geometry.rect);
      const targetWidth = Math.min(
        geometry.rect.width,
        request.kind === "avatar"
          ? 512
          : request.kind === "cover"
            ? 1200
            : 1280,
      );
      context.resize({ width: targetWidth });
      const rendered = await context.renderAsync();
      try {
        const result = await rendered.saveAsync({
          format: SaveFormat.JPEG,
          compress: request.kind === "post" ? 0.84 : 0.82,
        });
        if (alive.current) finishPhotoEdit(request.id, result);
      } finally {
        rendered.release();
      }
    } catch {
      if (alive.current)
        setError(
          "This crop could not be prepared. Try again, or cancel and choose another photo.",
        );
    } finally {
      context?.release();
      saving.current = false;
      if (alive.current) setBusy(false);
    }
  }

  const text = { color: theme.text, fontFamily: theme.font.body };
  const title =
    request.kind === "avatar"
      ? "Crop profile photo"
      : request.kind === "cover"
        ? "Crop cover photo"
        : "Crop image";
  const frameLabel =
    request.kind === "avatar"
      ? "Circular profile photo preview"
      : request.kind === "cover"
        ? "Wide cover photo preview"
        : "Post photo crop preview";

  function control(
    label: string,
    symbol: string,
    action: () => void,
    disabled = false,
  ) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        disabled={busy || disabled}
        onPress={action}
        style={({ pressed }) => [
          styles.control,
          {
            borderColor: theme.textMuted,
            opacity: busy || disabled ? 0.4 : pressed ? 0.65 : 1,
          },
        ]}
      >
        <Text style={[text, styles.controlText]}>{symbol}</Text>
      </Pressable>
    );
  }

  return (
    <Modal
      visible
      animationType="none"
      presentationStyle="fullScreen"
      onRequestClose={cancel}
    >
      <SafeAreaView
        style={[styles.screen, { backgroundColor: theme.canvas }]}
        accessibilityViewIsModal
      >
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel photo edit"
            disabled={busy}
            onPress={cancel}
            style={styles.headerAction}
          >
            <Text
              style={[
                text,
                { color: theme.deepBrand, opacity: busy ? 0.4 : 1 },
              ]}
            >
              Cancel
            </Text>
          </Pressable>
          <Text accessibilityRole="header" style={[text, styles.title]}>
            {title}
          </Text>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          bounces={false}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={[text, styles.hint, { color: theme.textMuted }]}>
            Drag to position. Use − and + to zoom.
          </Text>

          {request.kind === "post" ? (
            <View
              accessibilityLabel="Photo crop ratio"
              style={styles.aspectRow}
            >
              {POST_ASPECTS.map((choice) => {
                const selected = selectedAspect === choice.key;
                const next =
                  "aspect" in choice ? choice.aspect : originalAspect;
                return (
                  <Pressable
                    key={choice.key}
                    accessibilityRole="button"
                    accessibilityState={{ selected, disabled: busy }}
                    disabled={busy}
                    onPress={() => chooseAspect(choice.key, next)}
                    style={({ pressed }) => [
                      styles.aspectButton,
                      {
                        borderColor: selected
                          ? theme.deepBrand
                          : theme.border,
                        backgroundColor: selected
                          ? theme.surfaceMuted
                          : theme.surface,
                        opacity: pressed ? 0.7 : 1,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        text,
                        styles.aspectText,
                        selected ? { color: theme.deepBrand } : null,
                      ]}
                    >
                      {choice.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          <View
            {...pan.panHandlers}
            testID="photo-crop-preview"
            accessibilityLabel={frameLabel}
            style={[
              styles.frame,
              {
                width: frameWidth,
                height: geometry.frameHeight,
                borderRadius:
                  request.kind === "avatar" ? frameWidth / 2 : 12,
              },
              Platform.OS === "web"
                ? ({ touchAction: "none" } as ViewStyle)
                : null,
            ]}
          >
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
              <Image
                source={{ uri: request.image.uri }}
                resizeMode="stretch"
                onLoad={() => setReady(true)}
                onError={() => {
                  setReady(false);
                  setError(
                    "This photo could not be displayed. Cancel and choose a JPG, PNG or WebP image.",
                  );
                }}
                style={{
                  position: "absolute",
                  width: geometry.width,
                  height: geometry.height,
                  left: geometry.left,
                  top: geometry.top,
                }}
              />
            </View>
            {!ready && !error ? (
              <InlineLoading
                color={theme.brand}
                style={StyleSheet.absoluteFill}
              />
            ) : null}

            {ready ? (
              request.kind === "avatar" ? (
                <View
                  pointerEvents="none"
                  style={[StyleSheet.absoluteFill, styles.avatarGuide]}
                />
              ) : (
                <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                  <View
                    style={[StyleSheet.absoluteFill, styles.cropOutline]}
                  />
                  <View style={[styles.gridVertical, { left: "33.333%" }]} />
                  <View style={[styles.gridVertical, { left: "66.666%" }]} />
                  <View style={[styles.gridHorizontal, { top: "33.333%" }]} />
                  <View style={[styles.gridHorizontal, { top: "66.666%" }]} />
                </View>
              )
            ) : null}
          </View>

          <View style={styles.row}>
            {control(
              "Zoom out",
              "−",
              () => {
                setPosition(geometry.position);
                setZoom((value) => clamp(value - 0.2, 1, 4));
              },
              zoom <= 1,
            )}
            <Text
              accessibilityLiveRegion="polite"
              style={[text, styles.zoom]}
            >
              {Math.round(zoom * 100)}%
            </Text>
            {control(
              "Zoom in",
              "+",
              () => {
                setPosition(geometry.position);
                setZoom((value) => clamp(value + 0.2, 1, 4));
              },
              zoom >= 4,
            )}
          </View>

          <View style={styles.row}>
            {control("Move photo left", "←", () => move(-20, 0))}
            {control("Move photo up", "↑", () => move(0, -20))}
            {control("Move photo down", "↓", () => move(0, 20))}
            {control("Move photo right", "→", () => move(20, 0))}
          </View>

          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => {
              setZoom(1);
              setPosition({ x: 0, y: 0 });
            }}
            style={styles.reset}
          >
            <Text style={[text, { color: theme.deepBrand }]}>
              Reset position
            </Text>
          </Pressable>

          <Text style={[text, styles.hint, { color: theme.textMuted }]}>
            {request.kind === "avatar"
              ? "Your profile photo appears in a circle."
              : request.kind === "cover"
                ? "Your cover photo uses a wide 3:1 frame."
                : "Choose a ratio, crop the photo, then save it before attaching."}{" "}
            Nothing is uploaded until you save.
          </Text>

          {error ? (
            <Text
              accessibilityRole="alert"
              style={[text, styles.hint, { color: theme.error }]}
            >
              {error}
            </Text>
          ) : null}
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Save cropped photo"
            disabled={busy || !ready}
            onPress={() => void save()}
            style={({ pressed }) => [
              styles.save,
              {
                backgroundColor: theme.brand,
                opacity: busy || !ready ? 0.5 : pressed ? 0.8 : 1,
              },
            ]}
          >
            {busy ? <InlineLoading color="#FFFFFF" /> : null}
            <Text
              style={[styles.saveText, { fontFamily: theme.font.body }]}
            >
              {busy
                ? "Preparing photo…"
                : request.kind === "post"
                  ? "Use photo"
                  : "Save photo"}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    minHeight: 64,
  },
  headerAction: {
    minHeight: 44,
    minWidth: 64,
    justifyContent: "center",
    padding: 8,
  },
  headerSpacer: { width: 64 },
  title: { flex: 1, textAlign: "center", fontSize: 18, fontWeight: "700" },
  content: {
    alignItems: "center",
    paddingHorizontal: 24,
    paddingBottom: 16,
    gap: 12,
  },
  hint: {
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
    maxWidth: 480,
    marginVertical: 6,
  },
  aspectRow: {
    width: "100%",
    maxWidth: 480,
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  aspectButton: {
    minHeight: 40,
    minWidth: 58,
    paddingHorizontal: 11,
    borderWidth: 1,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  aspectText: { fontSize: 13, fontWeight: "600" },
  frame: {
    overflow: "hidden",
    backgroundColor: "#1F1B18",
    shadowColor: "#29231F",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.14,
    shadowRadius: 18,
    elevation: 4,
  },
  avatarGuide: {
    borderColor: "rgba(255,255,255,0.96)",
    borderWidth: 2,
    borderRadius: 999,
  },
  cropOutline: {
    borderColor: "rgba(255,255,255,0.96)",
    borderWidth: 2,
  },
  gridVertical: {
    backgroundColor: "rgba(255,255,255,0.52)",
    bottom: 0,
    position: "absolute",
    top: 0,
    width: StyleSheet.hairlineWidth,
  },
  gridHorizontal: {
    backgroundColor: "rgba(255,255,255,0.52)",
    height: StyleSheet.hairlineWidth,
    left: 0,
    position: "absolute",
    right: 0,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
  },
  control: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: 10,
  },
  controlText: { fontSize: 24 },
  zoom: {
    width: 68,
    textAlign: "center",
    fontSize: 15,
    fontWeight: "600",
  },
  reset: { minHeight: 44, justifyContent: "center", paddingHorizontal: 12 },
  footer: { padding: 20 },
  save: {
    minHeight: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 10,
  },
  saveText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
});
