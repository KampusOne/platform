import { Component, type ErrorInfo, type ReactNode, useEffect } from "react";
import { Platform, SafeAreaView, StyleSheet, Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { useThemeStyles, type Theme } from "@/src/lib/appearance";
import { useStartup } from "@/src/lib/startup";

const REFRESH_RECOVERY_KEY = "kampusone.refresh-recovery";
const REFRESH_RECOVERY_WINDOW_MS = 60_000;

function isHardRefresh(): boolean {
  if (Platform.OS !== "web" || typeof performance === "undefined") return false;
  const [navigation] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
  return navigation?.type === "reload";
}

function tryRefreshRecovery(): boolean {
  if (
    Platform.OS !== "web" ||
    typeof window === "undefined" ||
    typeof sessionStorage === "undefined" ||
    !isHardRefresh()
  )
    return false;

  try {
    const lastAttempt = Number(sessionStorage.getItem(REFRESH_RECOVERY_KEY) ?? 0);
    const now = Date.now();
    if (Number.isFinite(lastAttempt) && now - lastAttempt < REFRESH_RECOVERY_WINDOW_MS)
      return false;

    sessionStorage.setItem(REFRESH_RECOVERY_KEY, String(now));
    // A hard reload can land between two Vercel/Expo route-bundle versions.
    // Re-request the document once so the HTML and hashed route chunks agree.
    window.location.reload();
    return true;
  } catch {
    return false;
  }
}

export class AppErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean; refreshing: boolean }
> {
  state = { failed: false, refreshing: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("kampusone.ui.crash", {
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack,
    });

    if (tryRefreshRecovery()) {
      this.setState({ refreshing: true });
    }
  }

  private recover = () => {
    this.setState({ failed: false, refreshing: false });
  };

  render() {
    if (!this.state.failed) return this.props.children;
    return <ScreenRecovery recover={this.recover} refreshing={this.state.refreshing} />;
  }
}

function ScreenRecovery({
  recover,
  refreshing,
}: {
  recover: () => void;
  refreshing: boolean;
}) {
  const { styles } = useThemeStyles(createStyles);
  const { markHomeReady } = useStartup();

  useEffect(() => {
    markHomeReady();
  }, [markHomeReady]);

  return (
    <SafeAreaView
      style={styles.safe}
    >
      <View style={styles.recovery}>
        <Text accessibilityRole="header" style={styles.title}>{refreshing ? "Reopening this screen…" : "This screen needs another try"}</Text>
        <Text style={styles.message}>You can retry here or return to the previous screen.</Text>
        {!refreshing && <Pressable accessibilityRole="button" onPress={recover} style={styles.button}><Text style={styles.buttonText}>Try again</Text></Pressable>}
        {router.canGoBack() && <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.back}><Text style={styles.message}>Go back</Text></Pressable>}
      </View>
    </SafeAreaView>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    safe: {
      backgroundColor: theme.canvas,
      flex: 1,
    },
    recovery: { flex: 1, padding: 28, alignItems: "center", justifyContent: "center", gap: 16 },
    title: { color: theme.text, fontSize: 20, fontFamily: theme.font.bold, textAlign: "center" },
    message: { color: theme.textMuted, fontSize: 14, lineHeight: 22, textAlign: "center" },
    button: { backgroundColor: theme.brand, borderRadius: 12, minHeight: 48, justifyContent: "center", paddingHorizontal: 28 },
    buttonText: { color: "#fff", fontFamily: theme.font.semibold },
    back: { padding: 12 },
  });
