import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ToolButton, ToolField, ToolPage } from "@/src/components/toolkit";
import { ScreenSkeleton } from "@/src/components/skeleton";
import { ProfileAvatar } from "@/src/components/profile-avatar";
import { MediaImage } from "@/src/components/media-image";
import { useToast } from "@/src/components/toast";
import { useAppearance } from "@/src/lib/appearance";
import { api } from "@/src/lib/api";
import { validPostId } from "@/src/lib/feed-posts";
import {
  pickPhoto,
  uploadPreparedPhoto,
  type PreparedPhoto,
} from "@/src/lib/uploads";

type Profile = {
  agentType: "VENDOR" | "TUTOR" | "RIDER";
  displayName: string;
  biography: string;
  categories: string[];
  phone: string | null;
  whatsapp: string | null;
  pickupLocation: string | null;
  profileImageUrl: string | null;
  coverImageUrl: string | null;
  avatarMediaId: string | null;
  coverMediaId: string | null;
};
function phone(value: string) {
  const digits = value.replace(/[\s()-]/g, "");
  if (!digits) return null;
  if (/^0[789]\d{9}$/.test(digits)) return "+234" + digits.slice(1);
  if (/^234[789]\d{9}$/.test(digits)) return "+" + digits;
  if (/^\+234[789]\d{9}$/.test(digits)) return digits;
  throw new Error(
    "Use a Nigerian mobile number, such as 08012345678 or +2348012345678.",
  );
}
export default function BusinessProfileEdit() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { theme } = useAppearance();
  const toast = useToast();
  const [profile, setProfile] = useState<Profile>();
  const [categories, setCategories] = useState("");
  const [editable, setEditable] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const [photos, setPhotos] = useState<
    Partial<Record<"avatar" | "cover", PreparedPhoto>>
  >({});
  const activeId = useRef(id);
  activeId.current = id;
  useEffect(() => {
    let active = true;
    setProfile(undefined);
    setError("");
    setPhotos({});
    if (!validPostId(id)) {
      setError("This business profile link is not valid.");
      return;
    }
    void api<{ profile: Profile; editable: boolean }>(
      `/v1/agents/public-profile/${id}`,
    )
      .then((result) => {
        if (active) {
          setProfile(result.profile);
          setCategories(result.profile.categories.join(", "));
          setEditable(result.editable);
        }
      })
      .catch((e) => {
        if (active)
          setError(
            e instanceof Error
              ? e.message
              : "Your business profile could not load.",
          );
      });
    return () => {
      active = false;
    };
  }, [id, retry]);
  async function choose(kind: "avatar" | "cover") {
    if (busy) return;
    setBusy(true);
    try {
      const photo = await pickPhoto(kind);
      if (photo) setPhotos((current) => ({ ...current, [kind]: photo }));
    } catch (e) {
      toast(
        e instanceof Error ? e.message : "This photo could not open.",
        "error",
      );
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!profile || busy || !editable || !id) return;
    const requestId = id;
    setBusy(true);
    setError("");
    try {
      const parsedCategories = [
        ...new Set(
          categories
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
        ),
      ];
      if (profile.displayName.trim().length < 2)
        throw new Error("Enter a business name with at least two characters.");
      if (
        parsedCategories.length > 8 ||
        parsedCategories.some((value) => value.length < 2 || value.length > 50)
      )
        throw new Error(
          "Choose up to eight categories, with 2–50 characters each.",
        );
      const contacts = {
        phone: phone(profile.phone ?? ""),
        whatsapp: phone(profile.whatsapp ?? ""),
      };
      let avatarMediaId = profile.avatarMediaId,
        coverMediaId = profile.coverMediaId;
      // A public product image upload does not mutate the student's avatar or cover.
      if (photos.avatar) {
        avatarMediaId = (await uploadPreparedPhoto("product", photos.avatar))
          .id;
        setProfile((current) =>
          current ? { ...current, avatarMediaId } : current,
        );
      }
      if (photos.cover) {
        coverMediaId = (await uploadPreparedPhoto("product", photos.cover)).id;
        setProfile((current) =>
          current ? { ...current, coverMediaId } : current,
        );
      }
      await api(`/v1/agents/public-profile/${requestId}`, {
        method: "PUT",
        body: JSON.stringify({
          displayName: profile.displayName.trim(),
          biography: profile.biography.trim(),
          categories: parsedCategories,
          ...contacts,
          pickupLocation: profile.pickupLocation?.trim() || null,
          avatarMediaId,
          coverMediaId,
        }),
      });
      if (activeId.current !== requestId) return;
      toast("Business profile saved", "success");
      router.canGoBack()
        ? router.back()
        : router.replace({
            pathname: "/student-service",
            params: { id: requestId },
          });
    } catch (e) {
      if (activeId.current === requestId)
        setError(
          e instanceof Error
            ? e.message
            : "Your business profile could not be saved.",
        );
    } finally {
      if (activeId.current === requestId) setBusy(false);
    }
  }
  const text = {
    fontFamily: theme.font.body,
    color: theme.textMuted,
    fontSize: 13,
    lineHeight: 20,
  };
  const update = (
    field:
      "displayName" | "biography" | "phone" | "whatsapp" | "pickupLocation",
    value: string,
  ) =>
    setProfile((current) =>
      current ? { ...current, [field]: value } : current,
    );
  return (
    <ToolPage title="Business profile">
      {!profile ? (
        error ? (
          <>
            <Text accessibilityRole="alert" style={text}>
              {error}
            </Text>
            <ToolButton
              secondary
              label="Try again"
              onPress={() => setRetry((value) => value + 1)}
            />
          </>
        ) : (
          <ScreenSkeleton />
        )
      ) : (
        <>
          <Text style={{ ...text, marginBottom: 18 }}>
            This is what people see on your {profile.agentType.toLowerCase()}{" "}
            profile.
          </Text>
          {!editable ? (
            <Text
              accessibilityRole="alert"
              style={{ ...text, marginBottom: 18 }}
            >
              Your profile is available to view. Editing will open after the
              scheduled database update.
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Choose business cover photo"
            disabled={busy || !editable}
            onPress={() => void choose("cover")}
            style={{ marginBottom: 16 }}
          >
            {photos.cover?.uri || profile.coverImageUrl ? (
              <MediaImage
                uri={photos.cover?.uri ?? profile.coverImageUrl!}
                accessibilityLabel="Business cover preview"
                style={{ width: "100%", height: 140, borderRadius: 12 }}
                resizeMode="cover"
              />
            ) : (
              <View
                style={{
                  height: 140,
                  backgroundColor: theme.sand,
                  borderRadius: 12,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Ionicons
                  name="image-outline"
                  color={theme.deepBrand}
                  size={35}
                />
              </View>
            )}
            <Text style={{ ...text, color: theme.accentText, marginTop: 7 }}>
              Change cover photo
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Choose business profile photo"
            disabled={busy || !editable}
            onPress={() => void choose("avatar")}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 14,
              marginBottom: 24,
            }}
          >
            <ProfileAvatar
              name={profile.displayName}
              imageUrl={photos.avatar?.uri ?? profile.profileImageUrl}
              size={70}
            />
            <Text style={{ ...text, color: theme.accentText }}>
              Change business photo
            </Text>
          </Pressable>
          <ToolField
            label="Business name"
            value={profile.displayName}
            onChangeText={(value) => update("displayName", value)}
            maxLength={120}
            editable={editable && !busy}
          />
          <ToolField
            label="Business bio"
            value={profile.biography}
            onChangeText={(value) => update("biography", value)}
            multiline
            maxLength={2000}
            editable={editable && !busy}
            placeholder="Tell people what you offer"
          />
          <ToolField
            label="Categories"
            value={categories}
            onChangeText={setCategories}
            maxLength={408}
            editable={editable && !busy}
            placeholder="Restaurant, Food, Drinks"
          />
          <Text style={{ ...text, marginTop: -10, marginBottom: 20 }}>
            Separate up to eight categories with commas.
          </Text>
          <ToolField
            label="Public phone number (optional)"
            value={profile.phone ?? ""}
            onChangeText={(value) => update("phone", value)}
            keyboardType="phone-pad"
            maxLength={20}
            editable={editable && !busy}
            placeholder="08012345678"
          />
          <ToolField
            label="Public WhatsApp number (optional)"
            value={profile.whatsapp ?? ""}
            onChangeText={(value) => update("whatsapp", value)}
            keyboardType="phone-pad"
            maxLength={20}
            editable={editable && !busy}
            placeholder="08012345678"
          />
          <ToolField
            label="Public location (optional)"
            value={profile.pickupLocation ?? ""}
            onChangeText={(value) => update("pickupLocation", value)}
            maxLength={500}
            multiline
            editable={editable && !busy}
            placeholder="Where customers can find you"
          />
          <Text style={{ ...text, marginBottom: 16 }}>
            These contact details are public. Your verification documents stay
            private.
          </Text>
          {error ? (
            <Text
              accessibilityRole="alert"
              style={{ ...text, color: theme.error, marginBottom: 12 }}
            >
              {error}
            </Text>
          ) : null}
          <ToolButton
            label={busy ? "Saving…" : "Save business profile"}
            disabled={busy || !editable}
            onPress={() => void save()}
          />
        </>
      )}
    </ToolPage>
  );
}
