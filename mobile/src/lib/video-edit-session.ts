export type EditablePostVideo = {
  uri: string;
  name: string;
  type: string;
  durationMs: number;
};

export type VideoEditRequest = { id: number; video: EditablePostVideo };

let current: VideoEditRequest | null = null;
let complete: ((video: EditablePostVideo | null) => void) | null = null;
let fail: ((error: Error) => void) | null = null;
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
  return new Promise((resolve, reject) => {
    complete = resolve;
    fail = reject;
    current = { id: ++sequence, video };
    emit();
  });
}

function clearVideoEdit(id: number) {
  if (current?.id !== id) return null;
  const handlers = { resolve: complete, reject: fail };
  current = null;
  complete = null;
  fail = null;
  emit();
  return handlers;
}

export function finishVideoEdit(
  id: number,
  video: EditablePostVideo | null,
) {
  clearVideoEdit(id)?.resolve?.(video);
}

export function failVideoEdit(id: number, error: unknown) {
  clearVideoEdit(id)?.reject?.(
    error instanceof Error
      ? error
      : new Error("The video editor could not finish. Try again."),
  );
}
