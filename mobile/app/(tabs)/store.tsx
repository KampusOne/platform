import { SafeAreaView } from "react-native-safe-area-context";

import { FeatureState } from "@/src/components/feature-state";
import { theme } from "@/src/theme";

export default function StoreScreen() {
  return (
    <SafeAreaView style={{ backgroundColor: theme.canvas, flex: 1 }} edges={["top"]}>
      <FeatureState
        icon="bag-handle-outline"
        eyebrow="STORE · HARD-GATED"
        title="Trust first. Transactions later."
        description="Campus services and commerce will stay off until identity, moderation, dispute handling, ledger, and provider controls are proven."
        next="Verified services, safety operations, and financial-control review"
      />
    </SafeAreaView>
  );
}
