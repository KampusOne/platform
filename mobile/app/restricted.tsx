import { useEffect, useState } from "react";
import { Text } from "react-native";
import { router } from "expo-router";
import { ProductScreen, EmptyResult } from "@/src/components/product-ui";
import { ToolButton } from "@/src/components/toolkit";
import { useToast } from "@/src/components/toast";
import { useAuth } from "@/src/auth/auth-context";
import { useAppearance } from "@/src/lib/appearance";
import { api } from "@/src/lib/api";
import { serverDate } from "@/src/lib/server-date";
export default function Restricted() {
  const { signOut } = useAuth();
  const { theme } = useAppearance();
  const toast = useToast();
  const [r, setR] = useState<{
    kind: string;
    reason: string;
    ends_at: string | null;
  } | null>(null);
  const [checking, setChecking] = useState(false);
  const validUntil = serverDate(r?.ends_at);
  async function check() {
    if (checking) return;
    setChecking(true);
    try {
      const result = await api<{ restriction: typeof r }>(
        "/v1/account/restrictions",
      );
      if (!result.restriction) router.replace("/");
      else setR(result.restriction);
    } catch (e) {
      toast(
        e instanceof Error ? e.message : "Could not check account",
        "error",
      );
    } finally {
      setChecking(false);
    }
  }
  useEffect(() => {
    void check();
  }, []);
  return (
    <ProductScreen>
      <EmptyResult
        title={r?.kind === "BANNED" ? "Account banned" : "Account suspended"}
      />
      {r ? (
        <>
          <Text
            style={{
              fontFamily: theme.font.body,
              color: theme.text,
              lineHeight: 22,
              marginBottom: 16,
            }}
          >
            {r.reason}
          </Text>
          {validUntil ? (
            <Text style={{ color: theme.textMuted, marginBottom: 18 }}>
              Until {validUntil.toLocaleString()}
            </Text>
          ) : null}
        </>
      ) : null}
      <ToolButton
        label="Appeal decision"
        onPress={() =>
          router.push({ pathname: "/support", params: { category: "APPEAL" } })
        }
      />
      <ToolButton
        secondary
        label={checking ? "Checking account status…" : "Check account status"}
        onPress={() => void check()}
      />
      <ToolButton secondary label="Log out" onPress={() => void signOut()} />
    </ProductScreen>
  );
}
