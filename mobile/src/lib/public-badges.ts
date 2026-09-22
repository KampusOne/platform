export function hasPublicBadge(profile: { public_badge_verified?: boolean | null; verification_status?: string | null } | null | undefined): boolean {
  return typeof profile?.public_badge_verified === "boolean" ? profile.public_badge_verified : profile?.verification_status === "VERIFIED";
}
