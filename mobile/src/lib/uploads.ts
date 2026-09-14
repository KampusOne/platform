import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { Platform } from "react-native";
import { api } from "./api";
export type UploadedFile = {
  id: string;
  url: string;
  kind: string;
  private: boolean;
};
export async function pickAndUpload(
  kind:
    | "avatar"
    | "cover"
    | "product"
    | "post"
    | "resource"
    | "kyc"
    | "support",
): Promise<UploadedFile | null> {
  let uri: string, name: string, type: string;
  if (["resource", "kyc", "support"].includes(kind)) {
    const result = await DocumentPicker.getDocumentAsync({
      type: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
      copyToCacheDirectory: true,
    });
    if (result.canceled) return null;
    const file = result.assets[0]!;
    if ((file.size ?? 0) > 10 * 1024 * 1024)
      throw new Error("Choose a file smaller than 10 MB.");
    uri = file.uri;
    name = file.name;
    type = file.mimeType ?? "application/pdf";
  } else {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: kind === "avatar" || kind === "cover",
      aspect: kind === "avatar" ? [1, 1] : [3, 1],
      quality: 0.85,
    });
    if (result.canceled) return null;
    const image = result.assets[0]!;
    const context = ImageManipulator.manipulate(image.uri);
    if (image.width > 1600) context.resize({ width: 1600 });
    const rendered = await context.renderAsync();
    const prepared = await rendered.saveAsync({
      format: SaveFormat.JPEG,
      compress: 0.82,
    });
    uri = prepared.uri;
    name = `${kind}.jpg`;
    type = "image/jpeg";
  }
  const form = new FormData();
  form.append("kind", kind);
  if (Platform.OS === "web")
    form.append("file", await (await fetch(uri)).blob(), name);
  else form.append("file", { uri, name, type } as unknown as Blob);
  return api<UploadedFile>("/v1/media", { method: "POST", body: form });
}
