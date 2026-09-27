import { Component, type ErrorInfo, type ReactNode, useEffect } from "react";
import { Platform, SafeAreaView, StyleSheet, Text } from "react-native";
import { router, usePathname } from "expo-router";
import { useThemeStyles, type Theme } from "@/src/lib/appearance";
import { useStartup } from "@/src/lib/startup";

const REFRESH_RECOVERY_KEY = "kampusone.refresh-recovery";
const REFRESH_RECOVERY_WINDOW_MS = 60_000;
const NAVIGATION_RECOVERY_DELAY_MS = 800;

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

type BoundaryProps = {
  children: ReactNode;
  resetKey: string;
};

type BoundaryState = {
  failed: boolean;
  recovering: boolean;
};

class AppErrorBoundaryCore extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false, recovering: false };
  private recoveryTimer: ReturnType<typeof setTimeout> | null = null;

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidUpdate(previous: BoundaryProps) {
    if (previous.resetKey !== this.props.resetKey && this.state.failed) {
      if (this.recoveryTimer) {
        clearTimeout(this.recoveryTimer);
        this.recoveryTimer = null;
      }
      this.setState({ failed: false, recovering: false });
    }
  }

  componentWillUnmount() {
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("kampusone.ui.crash", {
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack,
    });

    if (tryRefreshRecovery()) {
      this.setState({ recovering: true });
      return;
    }

    // Never trap the user on a global error page. Leave the broken route and
    // let the resetKey change remount the normal screen tree.
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)");

    this.recoveryTimer = setTimeout(() => {
      // If the navigation stack did not move for any reason, force a safe
      // authenticated landing route instead of leaving a dead-end screen.
      if (this.state.failed) router.replace("/(tabs)");
    }, NAVIGATION_RECOVERY_DELAY_MS);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return <RecoveryFallback recovering={this.state.recovering} />;
  }
}

export function AppErrorBoundary({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <AppErrorBoundaryCore resetKey={pathname}>
      {children}
    </AppErrorBoundaryCore>
  );
}

function RecoveryFallback({ recovering }: { recovering: boolean }) {
  const { styles } = useThemeStyles(createStyles);
  const { markHomeReady } = useStartup();

  useEffect(markHomeReady, [markHomeReady]);

  return (
    <SafeAreaView
      accessibilityLabel={recovering ? "Refreshing KampusOne" : "Returning to previous screen"}
      style={styles.safe}
    >
      {recovering ? <Text style={styles.body}>Refreshing KampusOne…</Text> : null}
    </SafeAreaView>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    safe: {
      flex: 1,
      backgroundColor: theme.canvas,
      justifyContent: "center",
      padding: 22,
    },
    body: {
      color: theme.textMuted,
      fontSize: 14,
      lineHeight: 21,
      textAlign: "center",
    },
  });
