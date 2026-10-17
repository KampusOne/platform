import { useThemeStyles, type Theme } from "@/src/lib/appearance";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Animated, PanResponder, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/src/theme";

type Notice = {
  id: number;
  message: string;
  tone: "info" | "success" | "error";
  onOpen?: (()=>void)|undefined;
};
const ToastContext = createContext<
  (message: string, tone?: Notice["tone"],onOpen?:()=>void) => void
>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const { theme, styles } = useThemeStyles(createStyles);

  const [notice, setNotice] = useState<Notice | null>(null);
  const sequence = useRef(0);
  const opacity = useRef(new Animated.Value(0)).current;
  const dismissGesture = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 12 || gesture.dy < -12,
    onPanResponderRelease: (_, gesture) => { if (Math.abs(gesture.dx) > 32 || gesture.dy < -24) setNotice(null); },
  })).current;
  const show = useCallback((message: string, tone: Notice["tone"] = "info",onOpen?:()=>void) => {
    if (message.trim()) setNotice({ id: ++sequence.current, message, tone,onOpen });
  }, []);
  useEffect(() => {
    if (!notice) return;
    opacity.setValue(1);
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice, opacity]);
  return (
    <ToastContext.Provider value={show}>
      {children}
      {notice ? (
        <View pointerEvents="box-none" style={styles.position}>
          <Animated.View
            {...dismissGesture.panHandlers}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            style={[styles.toast, { opacity }]}
          >
            <Ionicons
              name={
                notice.tone === "success"
                  ? "checkmark-circle-outline"
                  : "information-circle-outline"
              }
              color={theme.peach}
              size={22}
            />
            <Pressable style={{flex:1,paddingVertical:8}} disabled={!notice.onOpen} accessibilityRole={notice.onOpen?"button":"text"} onPress={()=>{notice.onOpen?.();setNotice(null);}}><Text numberOfLines={4} style={styles.message}>{notice.message}</Text></Pressable>
            <Pressable
              accessibilityLabel="Dismiss notification"
              accessibilityRole="button"
              onPress={() => setNotice(null)}
              style={styles.close}
            >
              <Ionicons name="close" size={20} color="#fff" />
            </Pressable>
          </Animated.View>
        </View>
      ) : null}
    </ToastContext.Provider>
  );
}
export function useToast() {
  return useContext(ToastContext);
}
const createStyles = (theme: Theme) =>
  StyleSheet.create({
    position: {
      position: "absolute",
      top: 54,
      left: 16,
      right: 16,
      zIndex: 9999,
      alignItems: "center",
    },
    toast: {
      backgroundColor: "#29231F",
      borderRadius: 16,
      paddingVertical: 8,
      paddingLeft: 16,
      paddingRight: 4,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      maxWidth: 520,
      width: "100%",
      elevation: 10,
    },
    message: {
      color: "#fff",
      fontFamily: theme.font.medium,
      fontSize: 13,
      lineHeight: 20,
      flex: 1,
    },
    close: {
      width: 44,
      minHeight: 44,
      alignItems: "center",
      justifyContent: "center",
    },
  });
const styles = createStyles(theme);
