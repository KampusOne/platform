import { Component, useEffect, type ErrorInfo, type ReactNode } from "react";
import { Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";
import { router, usePathname, type ErrorBoundaryProps } from "expo-router";
import { useThemeStyles, type Theme } from "@/src/lib/appearance";
import { recordActivityEvent } from '@/src/lib/activity-events';
import { renderFailureFingerprint } from '@/src/lib/render-diagnostics';
import { useAuth } from '@/src/auth/auth-context';

function reportRenderFailure(error: Error, pathname: string, feature = 'screen_render', componentStack = '') {
  try {
    const first = pathname.split('/').filter(Boolean)[0] ?? 'today';
    const screen = /^[a-z][a-z-]{0,59}$/.test(first) ? first : 'unknown';
    const errorCode = renderFailureFingerprint(error, componentStack);
    recordActivityEvent('feature_failed', { screen, feature, errorCode });
    // Keep production logs actionable without exposing a prompt, account name,
    // private media URL or file name embedded in an exception or stack path.
    console.error('kampusone.ui.crash', { screen, feature, errorCode });
  } catch { /* Recovery must remain usable even if reporting fails. */ }
}

/** Expo Router invokes this inside each screen, preserving the navigator. */
export function ScreenErrorRecovery({ error, retry }: ErrorBoundaryProps) {
  const pathname = usePathname();
  const { state } = useAuth();
  useEffect(() => reportRenderFailure(error, pathname), [error, pathname]);
  return <RouteErrorRecovery onRetry={() => { void retry(); }} onHome={() => router.replace(state === 'authenticated' ? '/(tabs)' : '/(auth)/sign-in')} />;
}

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
    reportRenderFailure(error, this.props.resetKey, 'navigation_render', info.componentStack ?? '');
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
    this.setState({ failed: false }, () => requestAnimationFrame(() => {
      try { router.replace("/(tabs)"); }
      catch (error) { reportRenderFailure(error instanceof Error ? error : new Error('Recovery unavailable'), this.props.resetKey, 'navigation_recovery'); }
    }));
  };

  render() {
    if (!this.state.failed) return this.props.children;
    return <RouteErrorRecovery onHome={this.goHome} onRetry={this.retry} />;
  }
}

/**
 * Last-resort protection for the navigator. Normal screen failures use the
 * inherited Expo Router screen boundary, which keeps the stack mounted.
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
          Try again, or return home to continue using KampusOne.
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

type FeatureProps = {children: ReactNode; feature: string; resetKey: string};
class FeatureBoundary extends Component<FeatureProps, {failed: boolean; dismissed: boolean}> {
  state = {failed: false, dismissed: false};
  static getDerivedStateFromError() { return {failed: true}; }
  componentDidCatch(error: Error, info: ErrorInfo) { reportRenderFailure(error, this.props.resetKey, this.props.feature, info.componentStack ?? ''); }
  componentDidUpdate(previous: FeatureProps) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({failed: false, dismissed: false});
  }
  render() {
    if (!this.state.failed) return this.props.children;
    if (this.state.dismissed) return null;
    return <FeatureRecovery onClose={() => this.setState({dismissed: true})} onRetry={() => this.setState({failed: false})} />;
  }
}
function FeatureRecovery({onClose,onRetry}: {onClose: () => void; onRetry: () => void}) {
  const {theme} = useThemeStyles(createStyles);
  return <View accessibilityRole="alert" style={{position:'absolute',bottom:110,left:20,right:20,padding:18,borderRadius:16,borderWidth:1,borderColor:theme.border,backgroundColor:theme.surface,zIndex:10000}}>
    <Text style={{color:theme.text,fontFamily:theme.font.semibold}}>This tool couldn’t open</Text>
    <Text style={{color:theme.textMuted,fontFamily:theme.font.body,marginTop:6}}>You can keep using the app.</Text>
    <View style={{flexDirection:'row',gap:24,marginTop:12}}>
      <Pressable accessibilityRole="button" onPress={onRetry} style={{minHeight:44,justifyContent:'center'}}><Text style={{color:theme.deepBrand,fontFamily:theme.font.semibold}}>Try again</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={onClose} style={{minHeight:44,justifyContent:'center'}}><Text style={{color:theme.textMuted,fontFamily:theme.font.semibold}}>Close</Text></Pressable>
    </View>
  </View>;
}
export function AppFeatureBoundary({children,feature}: {children:ReactNode;feature:string}) {
  const pathname = usePathname();
  return <FeatureBoundary feature={feature} resetKey={pathname}>{children}</FeatureBoundary>;
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
