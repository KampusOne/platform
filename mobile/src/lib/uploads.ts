import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { Image, Platform } from "react-native";
import { api, ApiError, clearApiCache } from "./api";
import { requestPhotoEdit } from "./photo-edit-session";
import { requestVideoEdit } from "./video-edit-session";
import { getPostVideoDurationMs } from "./post-video-processing";
import type { PhotoDimensions } from "./photo-crop";
import { videoDimensions } from "./media-downloads";
export type UploadedFile = { id: string; url: string; kind: string; private: boolean };
export type PhotoSource = "library" | "camera";
export type PhotoKind = "avatar" | "cover" | "product" | "post";
export type UploadKind = PhotoKind | "map-capture" | "resource" | "kyc" | "support" | "notification-sound";
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
  const limit = kind === "notification-sound" ? 2 * 1024 * 1024 : kind === "post" && file.type.startsWith("video/") ? 50 * 1024 * 1024 : 10 * 1024 * 1024;
  let body: Blob | ArrayBuffer;
  if (Platform.OS === "web") {
    const response = await fetch(file.uri);
    if (!response.ok) throw new Error("The selected file could not be read. Choose it again.");
    body = await response.blob();
  } else {
    const { File } = await import("expo-file-system");
    const nativeFile = new File(file.uri);
    if (!nativeFile.exists) throw new Error("The selected file could not be read. Choose it again.");
    if(nativeFile.size>limit)throw new Error(`Choose a file smaller than ${limit / 1024 / 1024} MB.`);
    body = await nativeFile.arrayBuffer();
  }
  const byteCount=body instanceof ArrayBuffer?body.byteLength:body.size;
  if (!byteCount || byteCount > limit) throw new Error(`Choose a file smaller than ${limit / 1024 / 1024} MB.`);
  // Raw bytes avoid incompatible native/browser FormData implementations and
  // the extra multipart copy for videos. The server verifies the actual bytes.
  const timeoutMs = file.type.startsWith("video/") ? 180_000 : 60_000;
  let result: UploadedFile;
  try {
    result = await api<UploadedFile>(`/v1/media?kind=${encodeURIComponent(kind)}&name=${encodeURIComponent(file.name)}`, {
      method: "POST", body, headers: { "Content-Type": file.type }, timeoutMs,
    });
  } catch (caught) {
    // Production can temporarily lag the mobile client while guarded Worker
    // migrations are awaiting approval. The previous Worker only understands
    // multipart uploads and throws this generic 500 before reading any bytes.
    if (!(caught instanceof ApiError && caught.status === 500 && caught.code === "INTERNAL_ERROR" && caught.message === "The service could not complete this request.")) throw caught;
    const form = new FormData();
    form.append("kind", kind);
    if(Platform.OS==="web")form.append("file",body as Blob,file.name);
    else form.append("file",{uri:file.uri,name:file.name,type:file.type} as unknown as Blob);
    result = await api<UploadedFile>("/v1/media", { method: "POST", body: form, timeoutMs });
  }
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
  if(kind==="map-capture")throw new Error("Open Campus capture to submit camera and GPS evidence.");
  if (kind === "notification-sound") {
    const result = await DocumentPicker.getDocumentAsync({ type: ["audio/mpeg", "audio/wav"], copyToCacheDirectory: true, multiple: false });
    if (result.canceled) return null;
    const file = result.assets[0];
    if (!file) return null;
    if ((file.size ?? 0) > 2 * 1024 * 1024) throw new Error("Choose an MP3 or WAV sound smaller than 2 MB.");
    const type = file.mimeType === "audio/wav" || file.name.toLowerCase().endsWith(".wav") ? "audio/wav" : "audio/mpeg";
    return upload(kind, { uri: file.uri, name: file.name, type });
  }
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
  const inferred=({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', txt: 'text/plain', pdf: 'application/pdf' }[file.name.toLowerCase().split('.').pop() ?? '']);
  const type=file.mimeType && !['application/octet-stream','binary/octet-stream'].includes(file.mimeType) ? file.mimeType : inferred ?? 'application/octet-stream';
  return {uri:file.uri,name:file.name,type,size:file.size};
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
  original?: PhotoDimensions | undefined;
};

async function preparePostImageAsset(
  asset: ImagePicker.ImagePickerAsset,
  editImmediately: boolean,
): Promise<PostMedia | null> {
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

  const output = editImmediately
    ? await requestPhotoEdit("post", prepared)
    : prepared;
  if (!output) return null;
  return {
    uri: output.uri,
    name: "post.jpg",
    type: "image/jpeg",
    width: output.width,
    height: output.height,
    original: prepared,
  };
}

async function preparePostVideoAsset(
  asset: ImagePicker.ImagePickerAsset,
): Promise<PostMedia | null> {
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
  return requestVideoEdit({
    uri: asset.uri,
    name: asset.fileName ?? "post-video",
    type,
    durationMs,
    ...await videoDimensions(asset.uri, {
      width: asset.width,
      height: asset.height,
    }),
  });
}

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
  return asset.type === "video"
    ? preparePostVideoAsset(asset)
    : preparePostImageAsset(asset, true);
}

/**
 * Pick an ordered group for a post. X-style multi-media posts are image-only;
 * video remains a single attachment so the current trim/transcode path stays
 * deterministic on mid-range Android devices.
 */
export async function pickPostMediaBatch(limit = 5): Promise<PostMedia[]> {
  const selectionLimit = Math.max(1, Math.min(5, Math.trunc(limit)));
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images", "videos"],
    allowsEditing: false,
    allowsMultipleSelection: true,
    selectionLimit,
    quality: 1,
  });
  if (result.canceled) return [];

  const assets = result.assets.slice(0, selectionLimit);
  if (!assets.length) return [];
  const videos = assets.filter((asset) => asset.type === "video");
  if (videos.length) {
    if (assets.length !== 1)
      throw new Error(
        "Choose one video by itself. Multiple attachments can contain up to 5 images.",
      );
    const video = await preparePostVideoAsset(videos[0]!);
    return video ? [video] : [];
  }

  const prepared: PostMedia[] = [];
  for (const asset of assets) {
    const image = await preparePostImageAsset(asset, false);
    if (image) prepared.push(image);
  }
  return prepared;
}

export async function editPostMedia(
  file: PostMedia,
): Promise<PostMedia | null> {
  if (file.type.startsWith("video/")) {
    const durationMs =
      file.durationMs ?? (await getPostVideoDurationMs(file.uri));
    return requestVideoEdit({
      uri: file.uri,
      name: file.name,
      type: file.type,
      durationMs,
      ...await videoDimensions(file.uri, file),
    });
  }

  if (!file.width || !file.height)
    throw new Error("This photo can no longer be edited. Replace it and try again.");
  const original = file.original ?? { uri: file.uri, width: file.width, height: file.height };
  const edited = await requestPhotoEdit("post", original);
  if (!edited) return null;
  return {
    ...file,
    original,
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

export async function uploadCapturedMapPhoto(file:{uri:string;name:string;type:string}){return upload("map-capture",file);}
