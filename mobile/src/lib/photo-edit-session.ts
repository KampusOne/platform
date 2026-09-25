import type { PhotoDimensions } from "./photo-crop";

export type PhotoEditKind = "avatar" | "cover" | "post";
export type PhotoEditRequest = {
  id: number;
  kind: PhotoEditKind;
  image: PhotoDimensions;
};

let current: PhotoEditRequest | null = null;
let complete: ((photo: PhotoDimensions | null) => void) | null = null;
let sequence = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

export const getPhotoEdit = () => current;
export const getServerPhotoEdit = () => null;

export function subscribePhotoEdit(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function requestPhotoEdit(
  kind: PhotoEditKind,
  image: PhotoDimensions,
): Promise<PhotoDimensions | null> {
  if (current)
    return Promise.reject(new Error("Finish editing the current photo first."));
  if (!listeners.size)
    return Promise.reject(
      new Error("The photo editor is not ready. Reopen this screen and try again."),
    );
  return new Promise((resolve) => {
    complete = resolve;
    current = { id: ++sequence, kind, image };
    emit();
  });
}

export function finishPhotoEdit(
  id: number,
  photo: PhotoDimensions | null,
) {
  if (current?.id !== id) return;
  const resolve = complete;
  current = null;
  complete = null;
  emit();
  resolve?.(photo);
}
