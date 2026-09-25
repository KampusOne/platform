export type EditablePostVideo = {
  uri: string;
  name: string;
  type: string;
  durationMs: number;
};

export type VideoEditRequest = { id: number; video: EditablePostVideo };

let current: VideoEditRequest | null = null;
let complete: ((video: EditablePostVideo | null) => void) | null = null;
let sequence = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

export const getVideoEdit = () => current;
export const getServerVideoEdit = () => null;

export function subscribeVideoEdit(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function requestVideoEdit(
  video: EditablePostVideo,
): Promise<EditablePostVideo | null> {
  if (current)
    return Promise.reject(new Error("Finish editing the current video first."));
  if (!listeners.size)
    return Promise.reject(
      new Error("The video editor is not ready. Reopen this screen and try again."),
    );
  return new Promise((resolve) => {
    complete = resolve;
    current = { id: ++sequence, video };
    emit();
  });
}

export function finishVideoEdit(
  id: number,
  video: EditablePostVideo | null,
) {
  if (current?.id !== id) return;
  const resolve = complete;
  current = null;
  complete = null;
  emit();
  resolve?.(video);
}
