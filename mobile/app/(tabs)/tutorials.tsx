import { SafeAreaView } from "react-native-safe-area-context";

import { FeatureState } from "@/src/components/feature-state";
import { theme } from "@/src/theme";

export default function TutorialsScreen() {
  return (
    <SafeAreaView style={{ backgroundColor: theme.canvas, flex: 1 }} edges={["top"]}>
      <FeatureState
        icon="school-outline"
        eyebrow="TUTORIALS · PLANNED"
        title="Help that matches your course."
        description="Verified tutorial listings will connect students to relevant academic support without turning trust into a popularity contest."
        next="Course catalogue, provider verification, and reporting workflows"
      />
    </SafeAreaView>
  );
}
