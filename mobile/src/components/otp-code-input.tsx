import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { useEffect, useRef, useState } from "react";
import {
  AppState,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useThemeStyles, type Theme } from "@/src/lib/appearance";
import { theme } from "@/src/theme";

const DEEP_TERRACOTTA = "#A8462E";
const CODE_LENGTH = 6;

function normalizeCode(value: string) {
  return value.replace(/\D/g, "").slice(0, CODE_LENGTH);
}

function codeFromClipboard(value: string) {
  const exact = value.match(/(?:^|\D)(\d{6})(?:\D|$)/)?.[1];
  return exact ?? normalizeCode(value);
}

export function OtpCodeInput({
  value,
  onChangeText,
  label = "6-digit code",
  autoFocus = false,
  disabled = false,
  error = false,
}: {
  value: string;
  onChangeText: (value: string) => void;
  label?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  error?: boolean;
}) {
  const { theme, styles } = useThemeStyles(createStyles);
  const inputRef = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);
  const [clipboardHasCode, setClipboardHasCode] = useState(false);
  const code = normalizeCode(value);
  const activeIndex = Math.min(code.length, CODE_LENGTH - 1);

  useEffect(() => {
    if (Platform.OS === "web") return;

    let active = true;
    async function inspectClipboard() {
      try {
        if (Platform.OS === "android") {
          const content = await Clipboard.getStringAsync();
          if (active) {
            setClipboardHasCode(
              codeFromClipboard(content).length === CODE_LENGTH,
            );
          }
          return;
        }
        const hasText = await Clipboard.hasStringAsync();
        if (active) setClipboardHasCode(hasText);
      } catch {
        if (active) setClipboardHasCode(false);
      }
    }

    void inspectClipboard();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void inspectClipboard();
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  function update(next: string) {
    onChangeText(normalizeCode(next));
  }

  async function pasteCode() {
    try {
      const content = await Clipboard.getStringAsync();
      const pasted = codeFromClipboard(content);
      if (pasted.length === CODE_LENGTH) {
        onChangeText(pasted);
        inputRef.current?.focus();
        return;
      }
      setClipboardHasCode(false);
    } catch {
      setClipboardHasCode(false);
    }
    inputRef.current?.focus();
  }

  return (
    <View style={styles.group}>
      <View style={styles.inputWrap}>
        <View pointerEvents="none" style={styles.boxRow}>
          {Array.from({ length: CODE_LENGTH }, (_, index) => {
            const digit = code[index] ?? "";
            const isActive =
              focused &&
              !disabled &&
              (index === activeIndex ||
                (code.length === CODE_LENGTH && index === CODE_LENGTH - 1));
            return (
              <View
                key={index}
                style={[
                  styles.box,
                  isActive && styles.boxFocused,
                  error && styles.boxError,
                  disabled && styles.boxDisabled,
                ]}
              >
                <Text style={styles.digit}>{digit}</Text>
              </View>
            );
          })}
        </View>
        <TextInput
          ref={inputRef}
          accessibilityHint="Type or paste the full six-digit code."
          accessibilityLabel={label}
          accessibilityState={{ disabled }}
          autoComplete="one-time-code"
          autoFocus={autoFocus}
          caretHidden
          editable={!disabled}
          inputMode="numeric"
          keyboardType="number-pad"
          maxLength={CODE_LENGTH}
          onBlur={() => setFocused(false)}
          onChangeText={update}
          onFocus={() => setFocused(true)}
          selectionColor="transparent"
          style={styles.hiddenInput}
          textContentType="oneTimeCode"
          value={code}
        />
      </View>

      {clipboardHasCode ? (
        <Pressable
          accessibilityLabel="Paste code from clipboard"
          accessibilityRole="button"
          disabled={disabled}
          onPress={() => void pasteCode()}
          style={({ pressed }) => [
            styles.pasteButton,
            pressed && styles.pasteButtonPressed,
            disabled && styles.pasteButtonDisabled,
          ]}
        >
          <Ionicons color={DEEP_TERRACOTTA} name="clipboard-outline" size={17} />
          <Text style={styles.pasteText}>Paste code</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    group: {
      marginBottom: 18,
    },
    inputWrap: {
      position: "relative",
    },
    boxRow: {
      flexDirection: "row",
      gap: 8,
      justifyContent: "space-between",
    },
    box: {
      alignItems: "center",
      backgroundColor: "rgba(255,253,252,0.82)",
      borderColor: theme.border,
      borderRadius: 14,
      borderWidth: 1.25,
      flex: 1,
      height: 60,
      justifyContent: "center",
      maxWidth: 68,
    },
    boxFocused: {
      borderColor: DEEP_TERRACOTTA,
      borderWidth: 2,
    },
    boxError: {
      backgroundColor: "#FFF8F5",
      borderColor: theme.error,
    },
    boxDisabled: {
      opacity: 0.58,
    },
    digit: {
      color: theme.text,
      fontFamily: theme.font.semibold,
      fontSize: 22,
      lineHeight: 27,
    },
    hiddenInput: {
      bottom: 0,
      color: "transparent",
      left: 0,
      position: "absolute",
      right: 0,
      top: 0,
      opacity: 0.02,
      padding: 0,
    },
    pasteButton: {
      alignItems: "center",
      alignSelf: "flex-start",
      flexDirection: "row",
      gap: 6,
      minHeight: 42,
      paddingRight: 8,
      paddingTop: 8,
    },
    pasteButtonPressed: {
      opacity: 0.58,
    },
    pasteButtonDisabled: {
      opacity: 0.4,
    },
    pasteText: {
      color: DEEP_TERRACOTTA,
      fontFamily: theme.font.semibold,
      fontSize: 13,
    },
  });

const styles = createStyles(theme);
