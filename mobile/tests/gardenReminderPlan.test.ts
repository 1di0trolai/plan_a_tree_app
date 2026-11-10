/** Kiểm thử kế hoạch nhắc chăm cây theo giờ Việt Nam, lượt chăm còn thiếu và giới hạn lịch thông báo. */

import assert from "node:assert/strict";
import test from "node:test";
import { buildGardenReminderPlan, hasPendingGardenCare, millisecondsUntilNextGardenDay } from "../src/services/gardenReminderPlan";
import { createGardenFixture } from "./fixtures/gardenFixture";

const now = new Date("2026-10-29T00:00:00Z"); // 07:00 Vietnam

test("reminders repeat every three hours within Vietnam daytime and stay under the native pending cap", () => {
  const garden = createGardenFixture();
  const plan = buildGardenReminderPlan(garden, "08:00", now);
  assert.equal(plan.length, 42);
  const today = plan.filter((entry) => entry.date === "2026-10-29");
  assert.deepEqual(today.map((entry) => new Date(entry.at + 7 * 3600000).toISOString().slice(11, 16)), ["08:00", "11:00", "14:00", "17:00", "20:00", "23:00"]);
  assert.equal(new Set(plan.map((entry) => entry.id)).size, plan.length);
  assert.equal(new Set(today.map((entry) => entry.body)).size, 6);
  assert.match(today.at(-1)!.body, /nửa đêm/);
  assert.equal(millisecondsUntilNextGardenDay(new Date("2026-10-29T16:59:59Z")), 1050);
});

test("finishing a frozen round stops today's reminders even when another plant was added later", () => {
  const garden = createGardenFixture();
  const first = garden.plants[0];
  garden.dailyRounds = [{ id: "round", date: "2026-10-29", plantIds: [first.id], inspectedPlantIds: [first.id], createdAt: now.toISOString(), completedAt: null, packId: null }];
  assert.equal(hasPendingGardenCare(garden, now), false);
  const plan = buildGardenReminderPlan(garden, "08:00", now);
  assert.equal(plan.length, 36);
  assert.ok(plan.every((entry) => entry.date !== "2026-10-29"));
  // Tomorrow is a new roster; completion today must not silence future days.
  assert.equal(hasPendingGardenCare(garden, new Date("2026-10-30T00:00:00Z")), true);
});

test("partially inspected frozen rosters remain pending and legacy checks can finish without a round", () => {
  const garden = createGardenFixture();
  garden.dailyRounds = [{ id: "round", date: "2026-10-29", plantIds: garden.plants.map((entry) => entry.id), inspectedPlantIds: [], createdAt: now.toISOString(), completedAt: null, packId: null }];
  assert.equal(hasPendingGardenCare(garden, now), true);
  garden.dailyRounds = [];
  garden.plants = garden.plants.map((plant) => ({ ...plant, lastCheckIn: "2026-10-29" }));
  assert.equal(hasPendingGardenCare(garden, now), false);
});

test("empty, archived-only and planning-only gardens never schedule reminders", () => {
  const garden = createGardenFixture();
  assert.deepEqual(buildGardenReminderPlan({ plants: [], dailyRounds: [] }, "08:00", now), []);
  garden.plants = garden.plants.map((plant) => ({ ...plant, archived: true }));
  assert.deepEqual(buildGardenReminderPlan(garden, "08:00", now), []);
  garden.plants = garden.plants.map((plant) => ({ ...plant, archived: false, journey: { ...plant.journey, phase: "planning" } }));
  assert.deepEqual(buildGardenReminderPlan(garden, "08:00", now), []);
});

test("past slots are omitted, custom starts stay three hours apart, and old overnight settings are clamped", () => {
  const garden = createGardenFixture();
  const afterNightfall = new Date("2026-10-29T13:00:00Z"); // 20:00
  const plan = buildGardenReminderPlan(garden, "18:35", afterNightfall);
  assert.equal(plan.filter((entry) => entry.date === "2026-10-29").length, 1);
  assert.equal(plan[0].at, Date.parse("2026-10-29T21:35:00+07:00"));
  assert.equal(buildGardenReminderPlan(garden, "00:00", now)[0].at, Date.parse("2026-10-29T08:00:00+07:00"));
  assert.throws(() => buildGardenReminderPlan(garden, "24:00", now), /HH:MM/);
});
