import { useEffect, useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { Text } from "react-native";
import { ToolButton, ToolPage } from "@/src/components/toolkit";
import { ScreenSkeleton } from "@/src/components/skeleton";
import { LearningResourceDetails, type LearningResource } from "@/src/components/learning-resource-details";
import { api } from "@/src/lib/api";
import { useAuth } from "@/src/auth/auth-context";
import { useAppearance } from "@/src/lib/appearance";
import { validSharedId } from "@/src/lib/shared-links";

export default function LearningPreview() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { user } = useAuth();
  const { theme } = useAppearance();
  const scope = `${user?.id}:${user?.universityId}:${id}`;
  const [result, setResult] = useState<{ scope: string; resource: LearningResource } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setResult(null);
    setError("");
    if (!validSharedId(id)) {
      setError("This resource link is not valid.");
      setLoading(false);
      return () => controller.abort();
    }
    void api<{ resource: LearningResource }>(`/v1/student/tutorial-resources/${id}`, {
      cache: "no-store", signal: controller.signal,
    }).then(({ resource }) => {
      if (!controller.signal.aborted) setResult({ scope, resource });
    }).catch((e: unknown) => {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "This resource could not load.");
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [id, scope, retry]);

  if (result?.scope === scope && !loading && !error) {
    return <LearningResourceDetails key={scope} resource={result.resource} />;
  }
  return <ToolPage title="Resource details">
    {error && !loading ? <>
      <Text accessibilityRole="alert" style={{ color: theme.text, fontFamily: theme.font.body }}>{error}</Text>
      <ToolButton label="Retry" onPress={() => setRetry(n => n + 1)} />
    </> : <ScreenSkeleton />}
  </ToolPage>;
}
