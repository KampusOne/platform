import { Component, type ErrorInfo, type ReactNode } from "react";
import { Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";

export class AppErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("kampusone.ui.crash", {
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack,
    });
  }

  private recover = () => {
    this.setState({ failed: false }, () => router.replace("/"));
  };

  render() {
    if (!this.state.failed) return this.props.children;
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
  card: { borderRadius: 24, backgroundColor: "#FFFFFF", padding: 24, borderWidth: 1, borderColor: "#E7D7C8" },
  eyebrow: { color: "#8F3C29", fontWeight: "800", fontSize: 10, letterSpacing: 1.2 },
  title: { color: "#29231F", fontWeight: "800", fontSize: 24, marginTop: 8 },
  body: { color: "#665A51", fontSize: 14, lineHeight: 21, marginTop: 8 },
  button: { alignSelf: "flex-start", backgroundColor: "#8F3C29", borderRadius: 14, minHeight: 46, justifyContent: "center", paddingHorizontal: 18, marginTop: 20 },
  buttonText: { color: "#FFFFFF", fontWeight: "700" },
});
