import test from "node:test";
import assert from "node:assert/strict";
import { pickFullyVisibleVideo } from "../mobile/src/lib/feed-video-playback.ts";

test("feed video activates only when the whole video is inside the usable viewport", () => {
  assert.equal(
    pickFullyVisibleVideo([{ id: "full", y: 100, height: 300 }], 80, 700),
    "full",
  );
  assert.equal(
    pickFullyVisibleVideo([{ id: "top-partial", y: 79, height: 300 }], 80, 700, 0),
    null,
  );
  assert.equal(
    pickFullyVisibleVideo([{ id: "bottom-partial", y: 500, height: 201 }], 80, 700, 0),
    null,
  );
});

test("partial videos never win over a fully visible video", () => {
  assert.equal(
    pickFullyVisibleVideo(
      [
        { id: "above", y: -40, height: 260 },
        { id: "visible", y: 240, height: 260 },
        { id: "below", y: 620, height: 260 },
      ],
      40,
      680,
      0,
    ),
    "visible",
  );
});

test("when two videos fully fit, only the one closest to viewport center is active", () => {
  assert.equal(
    pickFullyVisibleVideo(
      [
        { id: "upper", y: 80, height: 160 },
        { id: "center", y: 300, height: 160 },
      ],
      40,
      700,
      0,
    ),
    "center",
  );
});

test("invalid or empty measurements cannot autoplay a video", () => {
  assert.equal(pickFullyVisibleVideo([], 40, 700), null);
  assert.equal(pickFullyVisibleVideo([{ id: "zero", y: 100, height: 0 }], 40, 700), null);
  assert.equal(pickFullyVisibleVideo([{ id: "bad", y: Number.NaN, height: 100 }], 40, 700), null);
});
