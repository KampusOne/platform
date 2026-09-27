export const defaultNotificationPreferences = {
  likes: true,
  commentLikes: true,
  comments: true,
  replies: true,
  reposts: true,
  quotes: true,
  follows: true,
  messages: true,
  profilePosts: true,
  classReminders: true,
  announcements: true,
  campusUpdates: true,
  pushAnnouncements: true,
  pushCampusUpdates: true,
};

export type NotificationPreferences = typeof defaultNotificationPreferences;

export const notificationCategories = [
  "likes",
  "commentLikes",
  "comments",
  "replies",
  "reposts",
  "quotes",
  "follows",
  "messages",
  "profilePosts",
  "classReminders",
  "announcements",
  "campusUpdates",
  "security",
] as const;

export type NotificationCategory = (typeof notificationCategories)[number];
export type NotificationChannels = Record<
  NotificationCategory,
  { in_app_enabled: boolean; push_enabled: boolean }
>;

export function notificationPreferences(value: unknown): NotificationPreferences {
  const source =
    value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return Object.fromEntries(
    Object.entries(defaultNotificationPreferences).map(([key, fallback]) => [
      key,
      typeof source[key] === "boolean" ? source[key] : fallback,
    ]),
  ) as NotificationPreferences;
}

export function notificationChannels(
  value: unknown,
  legacy?: unknown,
): NotificationChannels {
  const source =
    value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const prefs = notificationPreferences(legacy);
  return Object.fromEntries(
    notificationCategories.map((category) => {
      const row =
        source[category] && typeof source[category] === "object"
          ? (source[category] as Record<string, unknown>)
          : {};
      return [
        category,
        {
          in_app_enabled:
            category === "security" ||
            (typeof row.in_app_enabled === "boolean"
              ? row.in_app_enabled
              : prefs[category as keyof NotificationPreferences] !== false),
          push_enabled:
            category === "security" ||
            (typeof row.push_enabled === "boolean"
              ? row.push_enabled
              : category === "announcements"
                ? prefs.pushAnnouncements
                : category === "campusUpdates"
                  ? prefs.pushCampusUpdates
                  : category === "classReminders"),
        },
      ];
    }),
  ) as NotificationChannels;
}
