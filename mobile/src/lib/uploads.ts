import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { Image, Platform } from "react-native";
import { api, clearApiCache } from "./api";
import { requestPhotoEdit } from "./photo-edit-session";
import { requestVideoEdit } from "./video-edit-session";
import { getPostVideoDurationMs } from "./post-video-processing";
import type { PhotoDimensions } from "./photo-crop";
export type UploadedFile = { id: string; url: string; kind: string; private: boolean };
export type PhotoSource = "library" | "camera";
export type PhotoKind = "avatar" | "cover" | "product" | "post";
export type UploadKind = PhotoKind | "resource" | "kyc" | "support";
export type PreparedPhoto = PhotoDimensions & { name: string; type: "image/jpeg" };

/** Pick and prepare locally. Cancelling a profile crop never sends an upload. */
export async function pickPhoto(kind: PhotoKind, source: PhotoSource = "library"): Promise<PreparedPhoto | null> {
  if (source === "camera" && Platform.OS !== "web") {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) throw new Error("Camera permission is off. Allow camera access in your device settings, or choose a photo from your gallery.");
  }
  // Native-only allowsEditing is deliberately OFF. Our editor works on web too
  // and does not force iOS covers into the native picker's square crop.
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], allowsEditing: false, quality: 1 };
  const result = source === "camera" ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled) return null;
  const image = result.assets[0];
  if (!image || !image.width || !image.height) throw new Error("This photo could not be read. Choose another image.");
  if ((image.fileSize ?? 0) > 15 * 1024 * 1024) throw new Error("Choose a photo smaller than 15 MB.");
  const context = ImageManipulator.manipulate(image.uri);
  let prepared: PhotoDimensions;
  try {
    const maxEdge = kind === "avatar" || kind === "cover" ? 1600 : 1280;
    if (Math.max(image.width, image.height) > maxEdge) context.resize(image.width >= image.height ? { width: maxEdge } : { height: maxEdge });
    const rendered = await context.renderAsync();
    try { prepared = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: kind === "avatar" || kind === "cover" ? 0.95 : 0.82 }); }
    finally { rendered.release(); }
  } finally { context.release(); }
  if (kind === "avatar" || kind === "cover" || kind === "post") {
    const edited = await requestPhotoEdit(kind, prepared);
    if (!edited) return null;
    prepared = edited;
  }
  return { ...prepared, name: `${kind}.jpg`, type: "image/jpeg" };
}

/** Check the actual served image, not just the upload's JSON success response. */
export function verifyPhoto(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const failure = () => reject(new Error("The photo was saved, but its preview could not load. Check your connection and reopen the profile or retry the preview."));
    const timer = setTimeout(failure, 20_000);
    Image.getSize(url, (width, height) => { clearTimeout(timer); if (width > 0 && height > 0) resolve(); else failure(); }, () => { clearTimeout(timer); failure(); });
  });
}
async function upload(kind: UploadKind, file: { uri: string; name: string; type: string }): Promise<UploadedFile> {
  const form = new FormData();
  form.append("kind", kind);
  if (Platform.OS === "web") {
    const response = await fetch(file.uri);
    if (!response.ok) throw new Error("The selected file could not be read. Choose it again.");
    const blob = await response.blob();
    if (!blob.size || blob.size > 10 * 1024 * 1024) throw new Error("Choose a file smaller than 10 MB.");
    form.append("file", blob, file.name);
  } else form.append("file", file as unknown as Blob);
  const result = await api<UploadedFile>("/v1/media", { method: "POST", body: form, signal: AbortSignal.timeout(60_000) });
  if (!result?.id || !result.url || result.kind !== kind) throw new Error("The upload returned an incomplete response. Refresh before trying again.");
  // A profile read may have started while the upload was running. Invalidate
  // again after the write, so an old cached profile cannot undo the new photo.
  clearApiCache();
  return result;
}
export async function uploadPreparedPhoto(kind: PhotoKind, photo: PreparedPhoto): Promise<UploadedFile> {
  return upload(kind, photo);
}
export async function pickAndUpload(kind: UploadKind, source: PhotoSource = "library"): Promise<UploadedFile | null> {
  if (kind === "resource" || kind === "kyc" || kind === "support") {
    const result = await DocumentPicker.getDocumentAsync({ type: ["image/jpeg", "image/png", "image/webp", "application/pdf"], copyToCacheDirectory: true });
    if (result.canceled) return null;
    const file = result.assets[0];
    if (!file) return null;
    if ((file.size ?? 0) > 10 * 1024 * 1024) throw new Error("Choose a file smaller than 10 MB.");
    return upload(kind, { uri: file.uri, name: file.name, type: file.mimeType ?? "application/pdf" });
  }
  const photo = await pickPhoto(kind, source);
  if (!photo) return null;
  const saved = await uploadPreparedPhoto(kind, photo);
  await verifyPhoto(saved.url);
  return saved;
}

export type StagedAttachment = { uri?: string | undefined; name: string; type: string; size?: number | undefined; mediaId?: string | undefined };
/** Selection is local. Nothing is uploaded until Send/Upload is explicitly tapped. */
export async function pickAttachment(): Promise<StagedAttachment | null> {
  const result=await DocumentPicker.getDocumentAsync({type:["image/jpeg","image/png","image/webp","application/pdf","text/plain"],copyToCacheDirectory:true,multiple:false});
  if(result.canceled) return null;
  const file=result.assets[0]; if(!file) return null;
  if((file.size ?? 0)>8*1024*1024) throw new Error("Choose a file smaller than 8 MB.");
  return {uri:file.uri,name:file.name,type:file.mimeType ?? (file.name.toLowerCase().endsWith('.txt')?'text/plain':'application/pdf'),size:file.size};
}
export async function uploadAttachment(file: StagedAttachment): Promise<StagedAttachment> {
  if(file.mediaId) return file;
  if(!file.uri) throw new Error("Please reattach this file. Your message is still here.");
  const saved=await upload("resource",{uri:file.uri,name:file.name,type:file.type});
  return {...file,mediaId:saved.id};
}

export type PostMedia = {
  uri: string;
  name: string;
  type: string;
  durationMs?: number | undefined;
  width?: number | undefined;
  height?: number | undefined;
};

export async function pickPostMedia(
  source: PhotoSource = "library",
): Promise<PostMedia | null> {
  if (source === "camera") {
    const photo = await pickPhoto("post", "camera");
    return photo
      ? {
          uri: photo.uri,
          name: photo.name,
          type: photo.type,
          width: photo.width,
          height: photo.height,
        }
      : null;
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images", "videos"],
    allowsEditing: false,
    quality: 1,
  });
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];

  if (asset.type === "video") {
    if ((asset.fileSize ?? 0) > 100 * 1024 * 1024)
      throw new Error(
        "Choose a source video smaller than 100 MB, then trim it before posting.",
      );
    const type =
      asset.mimeType ??
      (asset.uri.toLowerCase().endsWith(".mp4")
        ? "video/mp4"
        : "video/quicktime");
    const durationMs = await getPostVideoDurationMs(
      asset.uri,
      asset.duration ?? undefined,
    );
    const edited = await requestVideoEdit({
      uri: asset.uri,
      name: asset.fileName ?? "post-video",
      type,
      durationMs,
    });
    if (!edited) return null;
    return edited;
  }

  if (!asset.width || !asset.height)
    throw new Error("This photo could not be read. Choose another image.");
  if ((asset.fileSize ?? 0) > 15 * 1024 * 1024)
    throw new Error("Choose a photo smaller than 15 MB.");

  const context = ImageManipulator.manipulate(asset.uri);
  let prepared: PhotoDimensions;
  try {
    if (Math.max(asset.width, asset.height) > 1280)
      context.resize(
        asset.width >= asset.height ? { width: 1280 } : { height: 1280 },
      );
    const image = await context.renderAsync();
    try {
      prepared = await image.saveAsync({
        format: SaveFormat.JPEG,
        compress: 0.9,
      });
    } finally {
      image.release();
    }
  } finally {
    context.release();
  }

  const edited = await requestPhotoEdit("post", prepared);
  if (!edited) return null;
  return {
    uri: edited.uri,
    name: "post.jpg",
    type: "image/jpeg",
    width: edited.width,
    height: edited.height,
  };
}

export async function uploadPostMedia(
  file: PostMedia,
): Promise<UploadedFile> {
  return upload("post", file);
}
