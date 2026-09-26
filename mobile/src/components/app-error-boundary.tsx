import { Component, type ErrorInfo, type ReactNode, useEffect } from "react";
import { Platform, Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";
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
  { failed: boolean; recovering: boolean }
> {
  state = { failed: false, recovering: false };

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
      this.setState({ recovering: true });
    }
  }

  private recover = () => {
    this.setState({ failed: false }, () => router.replace("/"));
  };

  render() {
    if (!this.state.failed) return this.props.children;
    return <ErrorFallback recover={this.recover} recovering={this.state.recovering} />;
  }
}

function ErrorFallback({ recover, recovering }: { recover: () => void; recovering: boolean }) {
  const { styles } = useThemeStyles(createStyles);
  const { markHomeReady } = useStartup();
  useEffect(markHomeReady, [markHomeReady]);
  if (recovering) return <SafeAreaView style={styles.safe}><Text style={styles.body}>Refreshing KampusOne…</Text></SafeAreaView>;
  return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.card}>
          <Text style={styles.eyebrow}>KAMPUSONE</Text>
          <Text style={styles.title}>This screen hit a problem</Text>
          <Text style={styles.body}>
            Your session is still safe. Go back home and try the screen again.
          </Text>
          <Pressable accessibilityRole="button" onPress={recover} style={styles.button}>
            <Text style={styles.buttonText}>Return home</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
}

const createStyles = (theme: Theme) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.canvas, justifyContent: "center", padding: 22 },
  card: { borderRadius: 24, backgroundColor: theme.surface, padding: 24, borderWidth: 1, borderColor: theme.border },
  eyebrow: { color: theme.accentText, fontWeight: "800", fontSize: 10, letterSpacing: 1.2 },
  title: { color: theme.text, fontWeight: "800", fontSize: 24, marginTop: 8 },
  body: { color: theme.textMuted, fontSize: 14, lineHeight: 21, marginTop: 8 },
  button: { alignSelf: "flex-start", backgroundColor: theme.deepBrand, borderRadius: 14, minHeight: 46, justifyContent: "center", paddingHorizontal: 18, marginTop: 20 },
  buttonText: { color: "#FFFFFF", fontWeight: "700" },
});
