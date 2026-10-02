import { Component, type ErrorInfo, type ReactNode } from "react";
import { Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";
import { router, usePathname } from "expo-router";
import { useThemeStyles, type Theme } from "@/src/lib/appearance";

type BoundaryProps = {
  children: ReactNode;
  resetKey: string;
};

type BoundaryState = {
  failed: boolean;
};

class RouteErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("kampusone.ui.crash", {
      route: this.props.resetKey,
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack,
    });
  }

  componentDidUpdate(previous: BoundaryProps) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }

  private retry = () => {
    this.setState({ failed: false });
  };

  private goHome = () => {
    router.replace("/(tabs)");
  };

  render() {
    if (!this.state.failed) return this.props.children;
    return <RouteErrorRecovery onHome={this.goHome} onRetry={this.retry} />;
  }
}

/**
 * Keep render failures isolated to the route that caused them.
 * Recovery must never call router.back(): doing that from a global boundary
 * mutates the same history that Android/Expo Router is already unwinding and
 * can turn one render exception into repeated failures on unrelated screens.
 */
export function AppErrorBoundary({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <RouteErrorBoundary resetKey={pathname}>
      {children}
    </RouteErrorBoundary>
  );
}

function RouteErrorRecovery({
  onHome,
  onRetry,
}: {
  onHome: () => void;
  onRetry: () => void;
}) {
  const { styles } = useThemeStyles(createStyles);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.recovery}>
        <Text accessibilityRole="header" style={styles.title}>
          We couldn’t open this screen
        </Text>
        <Text style={styles.message}>
          Retry this screen, or return home without changing your back history.
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={onRetry}
          style={styles.primary}
        >
          <Text style={styles.primaryText}>Retry</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={onHome}
          style={styles.secondary}
        >
          <Text style={styles.secondaryText}>Go home</Text>
        </Pressable>
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
    recovery: {
      alignItems: "center",
      flex: 1,
      justifyContent: "center",
      paddingHorizontal: 28,
    },
    title: {
      color: theme.text,
      fontFamily: theme.font.bold,
      fontSize: 20,
      textAlign: "center",
    },
    message: {
      color: theme.textMuted,
      fontFamily: theme.font.body,
      fontSize: 14,
      lineHeight: 21,
      marginTop: 8,
      maxWidth: 360,
      textAlign: "center",
    },
    primary: {
      alignItems: "center",
      backgroundColor: theme.deepBrand,
      borderRadius: 14,
      justifyContent: "center",
      marginTop: 20,
      minHeight: 50,
      minWidth: 150,
      paddingHorizontal: 24,
    },
    primaryText: {
      color: "#FFFFFF",
      fontFamily: theme.font.semibold,
      fontSize: 14,
    },
    secondary: {
      alignItems: "center",
      justifyContent: "center",
      marginTop: 8,
      minHeight: 44,
      paddingHorizontal: 20,
    },
    secondaryText: {
      color: theme.accentText,
      fontFamily: theme.font.semibold,
      fontSize: 13,
    },
  });
