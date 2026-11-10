/** Kiểm thử phân biệt gián đoạn hệ thống ngắn với lần ứng dụng thực sự chuyển sang nền. */

import assert from "node:assert/strict";
import test from "node:test";

import {
  advanceMusicLifecycle,
  type MusicLifecycle,
} from "../src/utils/musicLifecycle";

const initial: MusicLifecycle = {
  foreground: true,
  backgrounded: false,
  entry: 0,
};

test("a temporary system sheet pauses and resumes the same music visit", () => {
  const inactive = advanceMusicLifecycle(initial, "inactive");
  assert.equal(inactive.foreground, false);
  assert.deepEqual(advanceMusicLifecycle(inactive, "active"), initial);
});

test("a real trip to background starts exactly one new visit, including iOS inactive transitions", () => {
  let state = initial;
  for (const event of [
    "inactive",
    "background",
    "inactive",
    "active",
    "active",
  ]) {
    state = advanceMusicLifecycle(state, event);
  }
  assert.deepEqual(state, { foreground: true, backgrounded: false, entry: 1 });
  for (const event of ["background", "background", "active"])
    state = advanceMusicLifecycle(state, event);
  assert.equal(state.entry, 2);
});
