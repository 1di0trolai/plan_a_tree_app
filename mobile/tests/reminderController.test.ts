/** Kiểm thử điều phối lịch nhắc chăm cây, thay đổi giờ, thu hồi quyền và hủy tác vụ đã bị thay thế. */

import assert from "node:assert/strict";
import test from "node:test";
import { createDailyReminderController, type DailyReminderPort } from "../src/services/reminderController";
import { createGardenFixture } from "./fixtures/gardenFixture";

const request = () => ({ enabled: true, time: "08:00", now: new Date("2026-10-29T00:00:00Z"), garden: createGardenFixture() });
function setup() {
  let granted = true;
  const reminders: { id: string; signature: string }[] = [];
  const calls: string[] = [];
  let scheduleGate: Promise<void> | null = null;
  const port: DailyReminderPort = {
    list: async () => reminders.map((entry) => ({ ...entry })),
    allowed: async () => { calls.push("permission-read"); return granted; },
    cancel: async (id) => { calls.push(`cancel:${id}`); const index = reminders.findIndex((entry) => entry.id === id); if (index >= 0) reminders.splice(index, 1); },
    schedule: async (entry) => {
      calls.push(`schedule:${entry.id}`);
      if (scheduleGate) await scheduleGate;
      reminders.push({ id: entry.id, signature: entry.signature });
    },
  };
  return { sync: createDailyReminderController(port), port, reminders, calls,
    deny: () => { granted = false; }, gate: (value: Promise<void>) => { scheduleGate = value; } };
}

test("resuming keeps identical schedules; completed care cancels only today's remaining reminders", async () => {
  const s = setup();
  const r = request();
  assert.deepEqual(await s.sync(r), { enabled: true });
  await s.sync(r);
  assert.equal(s.calls.filter((call) => call.startsWith("schedule:")).length, 42);
  assert.equal(s.reminders.length, 42);
  r.garden.plants = r.garden.plants.map((plant) => ({ ...plant, lastCheckIn: "2026-10-29" }));
  await s.sync(r);
  assert.equal(s.reminders.length, 36);
  assert.equal(s.calls.filter((call) => call.startsWith("cancel:")).length, 6);
  assert.ok(s.reminders.every((entry) => !entry.id.includes("2026-10-29")));
});

test("changing time migrates legacy and old dated reminders", async () => {
  const s = setup();
  s.reminders.push({ id: "old", signature: "old" });
  await s.sync({ ...request(), time: "18:30" });
  assert.equal(s.reminders.length, 14);
  assert.equal(s.reminders.some((entry) => entry.id === "old"), false);
});

test("permission revocation cancels reminders without requesting permission", async () => {
  const s = setup();
  s.reminders.push({ id: "old", signature: "old" });
  s.deny();
  assert.deepEqual(await s.sync(request()), { enabled: false, reason: "permission" });
  assert.deepEqual(s.reminders, []);
});

test("disable/logout cleanup skips OS permission reads", async () => {
  const s = setup();
  s.reminders.push({ id: "old", signature: "old" });
  assert.deepEqual(await s.sync({ enabled: false, time: "invalid ignored" }), { enabled: false });
  assert.deepEqual(s.calls, ["cancel:old"]);
});

test("a queued disable supersedes an enable before native work starts", async () => {
  const s = setup();
  const enable = s.sync(request());
  const disable = s.sync({ enabled: false, time: "08:00" });
  assert.deepEqual(await enable, { enabled: false, reason: "superseded" });
  await disable;
  assert.deepEqual(s.reminders, []);
  assert.deepEqual(s.calls, []);
});

test("a late native schedule is canceled after disable/reset without scheduling the rest of the plan", async () => {
  const s = setup();
  let release = () => {};
  s.gate(new Promise<void>((resolve) => { release = resolve; }));
  const enable = s.sync(request());
  for (let i = 0; i < 20 && !s.calls.some((call) => call.startsWith("schedule:")); i++) await Promise.resolve();
  assert.ok(s.calls.some((call) => call.startsWith("schedule:")));
  const disable = s.sync({ enabled: false, time: "08:00" });
  release();
  await Promise.all([enable, disable]);
  assert.deepEqual(s.reminders, []);
  assert.equal(s.calls.filter((call) => call.startsWith("schedule:")).length, 1);
});

test("invalid time leaves schedules untouched and cancellation failures remain retryable", async () => {
  const s = setup();
  s.reminders.push({ id: "old", signature: "old" });
  await assert.rejects(s.sync({ ...request(), time: "25:00" }), /HH:MM/);
  assert.equal(s.reminders.length, 1);
  const cancel = s.port.cancel;
  s.port.cancel = async () => { throw new Error("native cancel failed"); };
  await assert.rejects(s.sync({ enabled: false, time: "08:00" }), /native cancel failed/);
  assert.equal(s.reminders.length, 1);
  s.port.cancel = cancel;
  await s.sync({ enabled: false, time: "08:00" });
  assert.deepEqual(s.reminders, []);
});
