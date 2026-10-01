import * as Clipboard from "expo-clipboard";
import { Platform, Share } from "react-native";
import { approvedSharedUrl, sharedLink, type ShareKind } from "./shared-links";
export type SharedContent = {
  url: string;
  title: string;
  message?: string | undefined;
};
export type ShareOutcome = "shared" | "copied" | "cancelled" | "manual";
type Handler = (content: SharedContent) => Promise<ShareOutcome>;
let handler: Handler | null = null;
export function registerShareSheet(next: Handler) {
  handler = next;
  return () => {
    if (handler === next) handler = null;
  };
}
export async function copySharedLink(url: string) {
  if (!approvedSharedUrl(url)) throw new Error("This link is not supported.");
  return Clipboard.setStringAsync(url);
}
export async function systemShare(
  content: SharedContent,
): Promise<ShareOutcome> {
  const text = [content.message || content.title, content.url]
    .filter(Boolean)
    .join("\n");
  if (Platform.OS === "web") {
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({
          title: content.title,
          text: content.message || content.title,
          url: content.url,
        });
        return "shared";
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") return "cancelled";
        throw e;
      }
    }
    try {
      return (await copySharedLink(content.url)) ? "copied" : "manual";
    } catch {
      return "manual";
    }
  }
  const result = await Share.share(
    Platform.OS === "ios"
      ? {
          url: content.url,
          message: content.message || content.title,
          title: content.title,
        }
      : { message: text, title: content.title },
  );
  return result.action === Share.dismissedAction ? "cancelled" : "shared";
}
export async function shareContent(
  content: SharedContent,
): Promise<ShareOutcome> {
  if (
    !approvedSharedUrl(content.url) ||
    !content.title.trim() ||
    content.title.length > 250 ||
    (content.message?.length ?? 0) > 4300
  )
    throw new Error("This content could not be shared. Try a shorter excerpt.");
  return handler ? handler(content) : systemShare(content);
}
export function shareItem(
  kind: ShareKind,
  id: string,
  title: string,
  message?: string,
) {
  return shareContent({
    url: sharedLink(kind, id),
    title: title.slice(0, 250),
    message,
  });
}
