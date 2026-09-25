import type { EditablePostVideo } from "./video-edit-session";
import type { VideoTrimRange } from "./video-trim-range";

type CaptureVideoElement = HTMLVideoElement & {
  captureStream?: () => MediaStream;
  mozCaptureStream?: () => MediaStream;
};

function waitFor(
  target: HTMLMediaElement,
  event: "loadedmetadata" | "seeked",
  timeoutMs = 15_000,
) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("The video editor timed out while reading this file."));
    }, timeoutMs);
    const done = () => {
      cleanup();
      resolve();
    };
    const failed = () => {
      cleanup();
      reject(new Error("This video could not be read. Choose another video."));
    };
    const cleanup = () => {
      clearTimeout(timer);
      target.removeEventListener(event, done);
      target.removeEventListener("error", failed);
    };
    target.addEventListener(event, done, { once: true });
    target.addEventListener("error", failed, { once: true });
  });
}

async function loadedVideo(uri: string) {
  const video = document.createElement("video") as CaptureVideoElement;
  video.preload = "metadata";
  video.playsInline = true;
  video.src = uri;
  if (video.readyState < 1) await waitFor(video, "loadedmetadata");
  return video;
}

export async function getPostVideoDurationMs(
  uri: string,
  reportedDurationMs?: number,
) {
  if (reportedDurationMs && reportedDurationMs > 0) return reportedDurationMs;
  const video = await loadedVideo(uri);
  const durationMs = video.duration * 1000;
  video.removeAttribute("src");
  video.load();
  if (!Number.isFinite(durationMs) || durationMs <= 0)
    throw new Error("The video duration could not be read. Choose another video.");
  return durationMs;
}

function recorderMime() {
  if (typeof MediaRecorder === "undefined") return "";
  for (const mime of [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ])
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  return "";
}

export async function trimPostVideo(
  source: EditablePostVideo,
  range: VideoTrimRange,
): Promise<EditablePostVideo> {
  const fullRange =
    range.startMs <= 40 &&
    Math.abs(range.endMs - source.durationMs) <= 80 &&
    source.type === "video/mp4";
  if (fullRange) return source;
  const mimeType = recorderMime();
  if (!mimeType)
    throw new Error(
      "This browser cannot prepare a trimmed video. Use the KampusOne mobile app or a current Chrome/Edge browser.",
    );

  const video = await loadedVideo(source.uri);
  const startSeconds = range.startMs / 1000;
  const endSeconds = range.endMs / 1000;
  const capture = video.captureStream ?? video.mozCaptureStream;
  if (!capture) {
    video.removeAttribute("src");
    video.load();
    throw new Error(
      "This browser cannot prepare a trimmed video. Use the KampusOne mobile app or a current Chrome/Edge browser.",
    );
  }

  if (Math.abs(video.currentTime - startSeconds) > 0.03) {
    video.currentTime = startSeconds;
    await waitFor(video, "seeked");
  }
  video.volume = 0;
  const stream = capture.call(video);
  const recorder = new MediaRecorder(stream, { mimeType });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data);
  };
  const stopped = new Promise<void>((resolve, reject) => {
    recorder.onstop = () => resolve();
    recorder.onerror = () =>
      reject(new Error("The browser could not finish preparing this clip."));
  });

  recorder.start(200);
  try {
    await new Promise<void>((resolve, reject) => {
      const maximumWait = Math.max(5_000, range.endMs - range.startMs + 5_000);
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("The browser took too long to prepare this video."));
      }, maximumWait);
      const cleanup = () => {
        clearTimeout(timer);
        video.removeEventListener("timeupdate", check);
        video.removeEventListener("ended", finish);
        video.removeEventListener("error", fail);
      };
      const finish = () => {
        cleanup();
        resolve();
      };
      const check = () => {
        if (video.currentTime >= endSeconds - 0.03) finish();
      };
      const fail = () => {
        cleanup();
        reject(new Error("The selected video stopped playing while it was being prepared."));
      };
      video.addEventListener("timeupdate", check);
      video.addEventListener("ended", finish, { once: true });
      video.addEventListener("error", fail, { once: true });
      void video.play().catch((error) => {
        cleanup();
        reject(
          error instanceof Error
            ? error
            : new Error("The browser blocked video processing. Tap Save video again."),
        );
      });
    });
  } finally {
    video.pause();
    if (recorder.state !== "inactive") recorder.stop();
  }
  await stopped;
  stream.getTracks().forEach((track) => track.stop());
  video.removeAttribute("src");
  video.load();

  const blob = new Blob(chunks, { type: recorder.mimeType || mimeType });
  if (!blob.size)
    throw new Error("The trimmed video was empty. Try a slightly longer selection.");
  if (blob.size > 10 * 1024 * 1024)
    throw new Error("The trimmed video is still larger than 10 MB. Choose a shorter section.");
  return {
    uri: URL.createObjectURL(blob),
    name: "post-trimmed.webm",
    type: "video/webm",
    durationMs: range.endMs - range.startMs,
  };
}
