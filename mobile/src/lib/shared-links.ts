import { APP_ORIGIN } from "./app-links";
export const shareKinds = [
  "post",
  "profile",
  "business",
  "product",
  "tutorial",
  "material",
] as const;
export type ShareKind = (typeof shareKinds)[number];
const configured =
  process.env.EXPO_PUBLIC_SHARE_ORIGIN || "https://links.kampusone.app";
const origin = new URL(configured);
if (
  origin.protocol !== "https:" ||
  !["links.kampusone.app", "kampusone.app"].includes(origin.hostname) ||
  origin.username ||
  origin.password ||
  origin.port ||
  origin.pathname !== "/" ||
  origin.search ||
  origin.hash
)
  throw new Error("Configure a verified KampusOne share origin.");
export const SHARE_ORIGIN = origin.origin;
export function validSharedId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}
export function sharedLink(kind: ShareKind, id: string) {
  if (!shareKinds.includes(kind) || !validSharedId(id))
    throw new Error("This content link is not valid.");
  return `${SHARE_ORIGIN}/s/${kind}/${id}`;
}
export function sharedDestination(
  kind: unknown,
  id: unknown,
): {
  pathname:
    | "/post"
    | "/student-profile"
    | "/student-service"
    | "/(tabs)/store"
    | "/(tabs)/tutorials"
    | "/learning-preview";
  params: Record<string, string>;
} | null {
  if (!validSharedId(id)) return null;
  if (kind === "post") return { pathname: "/post", params: { id } };
  if (kind === "profile")
    return { pathname: "/student-profile", params: { id } };
  if (kind === "business")
    return { pathname: "/student-service", params: { id } };
  if (kind === "product")
    return { pathname: "/(tabs)/store", params: { product: id } };
  if (kind === "tutorial")
    return { pathname: "/(tabs)/tutorials", params: { listing: id } };
  if (kind === "material")
    return { pathname: "/learning-preview", params: { id } };
  return null;
}
export function approvedSharedUrl(value: string) {
  try {
    const url = new URL(value);
    if (
      url.username ||
      url.password ||
      url.port ||
      url.hash ||
      url.protocol !== "https:" ||
      ![APP_ORIGIN, SHARE_ORIGIN].includes(url.origin)
    )
      return false;
    if (url.pathname === "/" && !url.search) return true;
    const match = /^\/s\/([^/]+)\/([^/]+)$/.exec(url.pathname);
    return !!match && !url.search && !!sharedDestination(match[1], match[2]);
  } catch {
    return false;
  }
}
