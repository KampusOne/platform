import { Text, View } from "react-native";
import { useAppearance } from "@/src/lib/appearance";

/** Report actual uploaded bytes. AI parsing has no measurable percentage and
 * intentionally uses an indeterminate indicator instead of a fake progress bar. */
export type ImportStage = "selecting" | "uploading" | "reading" | "saving";
export function ImportProgress({ stage, uploadFraction, subject = "document" }: {
  stage: ImportStage;
  uploadFraction?: number;
  subject?: string;
}) {
  const { theme } = useAppearance();
  const descriptions: Record<ImportStage, [string, string]> = {
    selecting: ["Choosing your file", "Select a photo, PDF or text document from this device."],
    uploading: ["Uploading securely", "Keep KampusOne open while your file transfers."],
    reading: ["Reading your " + subject, "Extracting and checking the information. This can take longer on an unstable connection."],
    saving: ["Saving your changes", "We are confirming your reviewed information with the server."],
  };
  const [title, detail] = descriptions[stage];
  const percent = typeof uploadFraction === "number" && Number.isFinite(uploadFraction)
    ? Math.max(0, Math.min(100, Math.round(uploadFraction * 100)))
    : null;
  const determinate = stage === "uploading" && percent !== null;
  return (
    <View accessibilityLiveRegion="polite" accessibilityLabel={title}
      style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 16,
        backgroundColor: theme.surface, padding: 16, gap: 9, marginVertical: 12 }}>
      <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
        {!determinate ? <View accessible={false} style={{ width: 24, height: 4,
          borderRadius: 2, backgroundColor: theme.brand }} /> : null}
        <Text style={{ flex: 1, color: theme.text, fontFamily: theme.font.semibold, fontSize: 15 }}>
          {title}{determinate ? ` · ${percent}%` : ""}
        </Text>
      </View>
      {determinate ? (
        <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: percent ?? 0 }}
          style={{ height: 6, borderRadius: 3, backgroundColor: theme.surfaceMuted, overflow: "hidden" }}>
          <View style={{ width: `${percent ?? 0}%` as `${number}%`, height: 6,
            borderRadius: 3, backgroundColor: theme.brand }} />
        </View>
      ) : null}
      <Text style={{ color: theme.textMuted, fontFamily: theme.font.body, fontSize: 12, lineHeight: 18 }}>
        {detail}
      </Text>
    </View>
  );
}
