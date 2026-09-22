import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { Platform } from "react-native";
import { api } from "./api";
export type UploadedFile = { id: string; url: string; kind: string; private: boolean };
export type PhotoSource = "library" | "camera";
export async function pickAndUpload(
  kind: "avatar" | "cover" | "product" | "post" | "resource" | "kyc" | "support",
  source: PhotoSource = "library",
): Promise<UploadedFile | null> {
  let uri: string, name: string, type: string;
  if (["resource", "kyc", "support"].includes(kind)) {
    const result = await DocumentPicker.getDocumentAsync({ type: ["image/jpeg", "image/png", "image/webp", "application/pdf"], copyToCacheDirectory: true });
    if (result.canceled) return null;
    const file = result.assets[0]!;
    if ((file.size ?? 0) > 10 * 1024 * 1024) throw new Error("Choose a file smaller than 10 MB.");
    uri = file.uri; name = file.name; type = file.mimeType ?? "application/pdf";
  } else {
    // Web camera/file pickers must remain in the button's user-activation chain.
    if (source === "camera" && Platform.OS !== "web") {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) throw new Error("Camera permission is off. Allow camera access in your device settings, or choose a photo from your gallery.");
    }
    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ["images"], allowsEditing: kind === "avatar" || kind === "cover",
      aspect: kind === "avatar" ? [1, 1] : [3, 1], quality: 0.85,
    };
    const result = source === "camera" ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (result.canceled) return null;
    const image = result.assets[0]!;
    if ((image.fileSize ?? 0) > 15 * 1024 * 1024) throw new Error("Choose a photo smaller than 15 MB.");
    const context = ImageManipulator.manipulate(image.uri);
    if (Math.max(image.width, image.height) > 1600) context.resize(image.width >= image.height ? { width: 1600 } : { height: 1600 });
    const rendered = await context.renderAsync();
    const prepared = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.82 });
    uri = prepared.uri; name = `${kind}.jpg`; type = "image/jpeg";
  }
  const form = new FormData();
  form.append("kind", kind);
  if (Platform.OS === "web") form.append("file", await (await fetch(uri)).blob(), name);
  else form.append("file", { uri, name, type } as unknown as Blob);
  return api<UploadedFile>("/v1/media", { method: "POST", body: form });
}
