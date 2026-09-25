import { isValidFile, trim } from "react-native-video-trim";
import type { EditablePostVideo } from "./video-edit-session";
import type { VideoTrimRange } from "./video-trim-range";

function fileUri(path: string) {
  return path.startsWith("file://") ? path : path.startsWith("/") ? `file://${path}` : path;
}

export async function getPostVideoDurationMs(
  uri: string,
  reportedDurationMs?: number,
) {
  const info = await isValidFile(uri);
  if (!info.isValid || info.fileType !== "video")
    throw new Error("This video could not be read. Choose another video.");
  if (Number.isFinite(info.duration) && info.duration > 0) return info.duration;
  if (reportedDurationMs && reportedDurationMs > 0) return reportedDurationMs;
  throw new Error("The video duration could not be read. Choose another video.");
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
  const result = await trim(source.uri, {
    startTime: Math.round(range.startMs),
    endTime: Math.round(range.endMs),
    enablePreciseTrimming: true,
    outputExt: "mp4",
    removeAudio: false,
    saveToPhoto: false,
  });
  if (!result.success || !result.outputPath)
    throw new Error("The video could not be trimmed. Try again.");
  return {
    uri: fileUri(result.outputPath),
    name: "post-trimmed.mp4",
    type: "video/mp4",
    durationMs: result.duration > 0 ? result.duration : range.endMs - range.startMs,
  };
}
