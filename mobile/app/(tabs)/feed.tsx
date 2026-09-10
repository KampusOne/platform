import { SafeAreaView } from "react-native-safe-area-context";

import { FeatureState } from "@/src/components/feature-state";
import { theme } from "@/src/theme";

export default function FeedScreen() {
  return (
    <SafeAreaView style={{ backgroundColor: theme.canvas, flex: 1 }} edges={["top"]}>
      <FeatureState
        icon="newspaper-outline"
        eyebrow="FEED · GATED"
        title="Community comes after utility."
        description="The feed will be a separate, intentional place for verified campus updates and student connection—not the home screen and not an engagement trap."
        next="Identity, moderation, reporting, and academic-core readiness"
      />
    </SafeAreaView>
  );
}
