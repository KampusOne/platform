import { Component, type ErrorInfo, type ReactNode } from "react";
import { Platform, Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";

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
    if (this.state.recovering) {
      return (
        <SafeAreaView style={styles.safe}>
          <View style={styles.recovery}>
            <Text style={styles.recoveryText}>Refreshing KampusOne…</Text>
          </View>
        </SafeAreaView>
      );
    }
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.card}>
          <Text style={styles.eyebrow}>KAMPUSONE</Text>
          <Text style={styles.title}>This screen hit a problem</Text>
          <Text style={styles.body}>
            Your session is still safe. Go back home and try the screen again.
          </Text>
          <Pressable accessibilityRole="button" onPress={this.recover} style={styles.button}>
            <Text style={styles.buttonText}>Return home</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#FBF7F2", justifyContent: "center", padding: 22 },
  recovery: { alignItems: "center", flex: 1, justifyContent: "center" },
  recoveryText: { color: "#665A51", fontSize: 14, fontWeight: "600" },
  card: { borderRadius: 24, backgroundColor: "#FFFFFF", padding: 24, borderWidth: 1, borderColor: "#E7D7C8" },
  eyebrow: { color: "#8F3C29", fontWeight: "800", fontSize: 10, letterSpacing: 1.2 },
  title: { color: "#29231F", fontWeight: "800", fontSize: 24, marginTop: 8 },
  body: { color: "#665A51", fontSize: 14, lineHeight: 21, marginTop: 8 },
  button: { alignSelf: "flex-start", backgroundColor: "#8F3C29", borderRadius: 14, minHeight: 46, justifyContent: "center", paddingHorizontal: 18, marginTop: 20 },
  buttonText: { color: "#FFFFFF", fontWeight: "700" },
});
