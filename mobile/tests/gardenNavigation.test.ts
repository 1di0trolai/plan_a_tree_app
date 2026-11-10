/** Kiểm thử chuyển cây, chấm chỉ vị trí và phản hồi tạm thời theo danh sách cây đang hiển thị. */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createInitialState } from "../src/data/seed";
import { scheduleGardenNoticeDismiss } from "../src/screens/garden/gardenFeedback";
import {
  gardenPlantAtOffset,
  getGardenNavigation,
} from "../src/screens/garden/gardenNavigation";
import {
  archivePlantJourney,
  createPlantJourney,
  restorePlantJourney,
  visibleGardenPlants,
} from "../src/store/journeyActions";
import type { AppState } from "../src/types/app";

const plants = [{ id: "first" }, { id: "middle" }, { id: "last" }];

test("garden navigation exposes next at start, both in middle, previous at end", () => {
  assert.deepEqual(getGardenNavigation(plants, "first"), {
    index: 0,
    current: "first",
    previous: null,
    next: "middle",
  });
  assert.deepEqual(getGardenNavigation(plants, "middle"), {
    index: 1,
    current: "middle",
    previous: "first",
    next: "last",
  });
  assert.deepEqual(getGardenNavigation(plants, "last"), {
    index: 2,
    current: "last",
    previous: "middle",
    next: null,
  });
});

test("one plant and an empty garden expose no previous/next controls", () => {
  assert.deepEqual(getGardenNavigation(plants.slice(0, 1), "first"), {
    index: 0,
    current: "first",
    previous: null,
    next: null,
  });
  assert.deepEqual(getGardenNavigation([], "missing"), {
    index: 0,
    current: null,
    previous: null,
    next: null,
  });
});

test("a missing or archived selection falls back to the first visible plant", () => {
  assert.deepEqual(
    getGardenNavigation(plants, "archived"),
    getGardenNavigation(plants, "first"),
  );
  assert.deepEqual(
    getGardenNavigation(plants),
    getGardenNavigation(plants, "first"),
  );
});

test("swipe positions select by visible plant ID and clamp native overscroll", () => {
  assert.equal(gardenPlantAtOffset(plants, 0, 390), "first");
  assert.equal(gardenPlantAtOffset(plants, 390, 390), "middle");
  assert.equal(gardenPlantAtOffset(plants, 780, 390), "last");
  assert.equal(gardenPlantAtOffset(plants, -120, 390), "first");
  assert.equal(gardenPlantAtOffset(plants, 1500, 390), "last");
  assert.equal(gardenPlantAtOffset(plants, Number.NaN, 390), null);
  assert.equal(gardenPlantAtOffset(plants, 100, 0), null);
  assert.equal(
    gardenPlantAtOffset(plants, 100, Number.POSITIVE_INFINITY),
    null,
  );
  assert.equal(gardenPlantAtOffset([], 0, 390), null);
});

test("add, archive, and restore keep arrow endpoints tied to visible identities", () => {
  const now = new Date("2026-10-28T03:00:00Z");
  function add(state: AppState, name: string) {
    return createPlantJourney(
      state,
      {
        name,
        species: "Khế",
        mode: "demo",
        journey: {
          crop: "other",
          phase: "planning",
          method: "seed",
          startedAt: "2026-10-28",
          location: "",
          light: "",
          notes: "",
        },
      },
      now,
    ).state;
  }
  let state = add(add(add(createInitialState(), "Một"), "Hai"), "Ba");
  const [first, middle, last] = state.plants;
  assert.equal(
    getGardenNavigation(visibleGardenPlants(state), state.activePlantId).next,
    null,
  );
  state = archivePlantJourney(state, middle.id, now).state;
  assert.deepEqual(getGardenNavigation(visibleGardenPlants(state), last.id), {
    index: 1,
    current: last.id,
    previous: first.id,
    next: null,
  });
  assert.equal(
    gardenPlantAtOffset(visibleGardenPlants(state), 390, 390),
    last.id,
  );
  state = restorePlantJourney(state, middle.id, now).state;
  assert.deepEqual(
    getGardenNavigation(visibleGardenPlants(state), state.activePlantId),
    { index: 1, current: middle.id, previous: first.id, next: last.id },
  );
  state = archivePlantJourney(state, middle.id, now).state;
  assert.deepEqual(
    getGardenNavigation(visibleGardenPlants(state), state.activePlantId),
    { index: 0, current: first.id, previous: null, next: last.id },
  );
  state = add(state, "Bốn");
  assert.equal(
    getGardenNavigation(visibleGardenPlants(state), state.activePlantId).next,
    null,
  );
  assert.equal(
    getGardenNavigation(visibleGardenPlants(state), state.activePlantId)
      .previous,
    last.id,
  );
});

test("success toast dismisses at three seconds, not before", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let dismissed = 0;
  scheduleGardenNoticeDismiss(() => dismissed++);
  context.mock.timers.tick(2999);
  assert.equal(dismissed, 0);
  context.mock.timers.tick(1);
  assert.equal(dismissed, 1);
});

test("toast cleanup prevents late dismissal after blur/unmount or replacement", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const dismissals: string[] = [];
  const record = (message: string) => dismissals.push(message);
  const cancelFirst = scheduleGardenNoticeDismiss(() =>
    record("first"),
  );
  context.mock.timers.tick(2000);
  cancelFirst();
  const cancelSecond = scheduleGardenNoticeDismiss(() =>
    record("second"),
  );
  context.mock.timers.tick(1000);
  assert.deepEqual(dismissals, []);
  context.mock.timers.tick(2000);
  assert.deepEqual(dismissals, ["second"]);
  cancelSecond();
  const cancelBlurred = scheduleGardenNoticeDismiss(() =>
    record("blurred"),
  );
  cancelBlurred();
  context.mock.timers.tick(4000);
  assert.deepEqual(dismissals, ["second"]);
});
