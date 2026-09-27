import { Component, type ErrorInfo, type ReactNode, useEffect } from "react";
import { Platform, SafeAreaView, StyleSheet } from "react-native";
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
    this.setState({ failed: false, refreshing: false }, () => {
      if (router.canGoBack()) {
        router.back();
        return;
      }
      router.replace("/");
    });
  };

  render() {
    if (!this.state.failed) return this.props.children;
    return <SilentRecovery recover={this.recover} refreshing={this.state.refreshing} />;
  }
}

function SilentRecovery({
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
    if (refreshing) return;
    const timer = setTimeout(recover, 0);
    return () => clearTimeout(timer);
  }, [markHomeReady, recover, refreshing]);

  return (
    <SafeAreaView
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.safe}
    />
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    safe: {
      backgroundColor: theme.canvas,
      flex: 1,
    },
  });
