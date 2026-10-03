"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
export function AgentFaceCapture({
  hasPortrait,
  disabled,
  onUpload,
}: {
  hasPortrait: boolean;
  disabled: boolean;
  onUpload: (file: File) => Promise<boolean>;
}) {
  const [mode, setMode] = useState<"closed" | "camera" | "preview">("closed"),
    [photo, setPhoto] = useState<File | null>(null),
    [preview, setPreview] = useState(""),
    [error, setError] = useState(""),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false);
  const video = useRef<HTMLVideoElement>(null),
    stream = useRef<MediaStream | null>(null),
    generation = useRef(0),
    lock = useRef(false),
    live = useRef(true);
  const stop = useCallback(() => {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  }, []);
  const invalidate = useCallback(() => {
    generation.current++;
    stop();
  }, [stop]);
  function startCamera() {
    setPhoto(null);
    setPreview("");
    setReady(false);
    setError("");
    setMode("camera");
  }
  function close() {
    if (lock.current) return;
    generation.current++;
    stop();
    setMode("closed");
    setReady(false);
    setPhoto(null);
    setPreview("");
  }
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      invalidate();
    };
  }, [invalidate]);
  useEffect(() => {
    if (preview) return () => URL.revokeObjectURL(preview);
  }, [preview]);
  useEffect(() => {
    if (mode !== "camera") return;
    const version = ++generation.current;
    async function openCamera() {
      if (!navigator.mediaDevices?.getUserMedia)
        throw new DOMException(
          "A supported camera and secure browser are required.",
          "NotSupportedError",
        );
      return navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 960 },
        },
        audio: false,
      });
    }
    void openCamera()
      .then(async (result) => {
        if (!live.current || version !== generation.current) {
          result.getTracks().forEach((track) => track.stop());
          return;
        }
        stream.current = result;
        if (video.current) {
          video.current.srcObject = result;
          try {
            await video.current.play();
          } catch {
            /* The on-loaded event still allows capture when playback starts. */
          }
        }
      })
      .catch((e: unknown) => {
        if (version !== generation.current || !live.current) return;
        setError(
          e instanceof DOMException && e.name === "NotSupportedError"
            ? "Camera access needs a secure browser and a supported camera. Open this application on a device with a camera, then try again."
            : e instanceof DOMException && e.name === "NotAllowedError"
              ? "Camera permission was denied. Allow camera access in your browser, then close and reopen the camera."
              : "We could not open your camera. Check that another app is not using it, then close and reopen the camera.",
        );
      });
    return () => {
      invalidate();
    };
  }, [mode, invalidate, stop]);
  useEffect(() => {
    if (mode !== "camera") return;
    const leave = () => {
      if (document.hidden) {
        generation.current++;
        stop();
        setReady(false);
        setError(
          "Camera paused while this page was away. Close and reopen it to continue.",
        );
      }
    };
    document.addEventListener("visibilitychange", leave);
    return () => document.removeEventListener("visibilitychange", leave);
  }, [mode, stop]);
  async function capture() {
    if (
      !ready ||
      lock.current ||
      !video.current?.videoWidth ||
      !video.current.videoHeight
    )
      return;
    const version = generation.current,
      element = video.current,
      canvas = document.createElement("canvas");
    canvas.width = element.videoWidth;
    canvas.height = element.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setError(
        "This browser could not capture a photo. Close and reopen the camera, or try a supported browser.",
      );
      return;
    }
    ctx.drawImage(element, 0, 0);
    lock.current = true;
    setBusy(true);
    try {
      const blob = await new Promise<Blob | null>((done) =>
        canvas.toBlob(done, "image/jpeg", 0.9),
      );
      if (!blob) throw new Error("The photo could not be captured. Try again.");
      if (version !== generation.current || !live.current) return;
      setPhoto(new File([blob], "agent-face.jpg", { type: "image/jpeg" }));
      setPreview(URL.createObjectURL(blob));
      stop();
      setMode("preview");
    } catch (e) {
      if (live.current)
        setError(e instanceof Error ? e.message : "Capture failed. Try again.");
    } finally {
      lock.current = false;
      if (live.current) setBusy(false);
    }
  }
  async function accept() {
    if (!photo || lock.current || disabled) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      if (await onUpload(photo)) {
        lock.current = false;
        close();
      } else
        setError("The photo was not saved. Retry to upload this same photo.");
    } catch {
      setError(
        "Your photo could not be uploaded. Keep this page open and retry.",
      );
    } finally {
      lock.current = false;
      if (live.current) setBusy(false);
    }
  }
  return (
    <section className="face-capture">
      <h3>Face photograph</h3>
      <p className="field-help">
        Use good light, remove face coverings and fit your face inside the
        guide. A reviewer checks this photo alongside your documents.
      </p>
      <div className="button-row">
        <button
          type="button"
          className="button button--secondary"
          disabled={disabled || busy}
          onClick={startCamera}
        >
          {hasPortrait ? "Retake face photo" : "Open camera"}
        </button>
        {hasPortrait && (
          <span className="status-badge" role="status">
            Portrait uploaded
          </span>
        )}
      </div>
      {mode !== "closed" && (
        <div className="face-capture-panel">
          <div className="face-frame">
            {mode === "camera" ? (
              <>
                <video
                  aria-label="Camera preview"
                  ref={video}
                  autoPlay
                  muted
                  playsInline
                  onLoadedData={() =>
                    setReady(
                      Boolean(
                        video.current?.videoWidth && stream.current?.active,
                      ),
                    )
                  }
                />
                <div className="face-oval" aria-hidden="true" />
              </>
            ) : preview ? (
              <Image
                src={preview}
                alt="Your captured portrait, ready to confirm or retake"
                unoptimized
                fill
                sizes="340px"
              />
            ) : null}
          </div>
          <p className="field-help">
            {mode === "preview"
              ? "Is this picture clear? Confirm it or retake before submitting."
              : ready
                ? "Look toward the camera. Capture when you are ready."
                : "Preparing your camera…"}
          </p>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="button-row">
            {mode === "camera" ? (
              <button
                type="button"
                className="button button--primary"
                disabled={!ready || busy || disabled}
                onClick={() => void capture()}
              >
                {busy ? "Capturing…" : "Take photo"}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="button button--secondary"
                  disabled={busy || disabled}
                  onClick={startCamera}
                >
                  Retake
                </button>
                <button
                  type="button"
                  className="button button--primary"
                  disabled={busy || disabled || !photo}
                  onClick={() => void accept()}
                >
                  {busy ? "Uploading privately…" : "Use this photo"}
                </button>
              </>
            )}
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={close}
            >
              Close camera
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
