/** Kiểm thử sắp xếp, nhóm ngày và phân trang nhật ký chăm sóc cùng ảnh mà không thay đổi dữ liệu gốc. */

import assert from "node:assert/strict";
import test from "node:test";
import { buildPlantJournal, groupJournalDays, historyDate, historyPage, sortedPlantPhotos } from "../src/screens/plant-detail/history";
import { createGardenFixture } from "./fixtures/gardenFixture";

test("journal contains factual care only in descending Vietnam calendar order", () => {
  const state = createGardenFixture();
  const analysis = { ...state.plantAnalyses[0], date: "2026-10-29", time: "08:00", mode: "gemini" as const };
  const before = JSON.stringify(state.plantAnalyses);
  const records = buildPlantJournal(analysis.plantId, [
    { id: "evening", plantId: analysis.plantId, kind: "other", note: "Lau lá", createdAt: "2026-10-29T12:00:00Z" },
    { id: "midnight", plantId: analysis.plantId, kind: "water", note: "Tưới", createdAt: "2026-10-28T17:30:00Z" },
    { id: "other-plant", plantId: "different-plant", kind: "prune", note: "Không thuộc cây này", createdAt: "2026-10-30T12:00:00Z" },
  ]);
  assert.deepEqual(records.map((record) => [record.kind, record.date, record.time]), [
    ["care", "2026-10-29", "19:00"], ["care", "2026-10-29", "00:30"],
  ]);
  assert.equal(groupJournalDays(records).length, 1);
  assert.equal(records.every((record) => record.kind === "care"), true);
  assert.equal(JSON.stringify(state.plantAnalyses), before, "Analysis remains stored for the assistant, not the factual diary");
});

test("journal date groups stay newest first and preserve every entry", () => {
  const state = createGardenFixture();
  const records = buildPlantJournal(state.plants[0].id, [
    { id: "a", plantId: state.plants[0].id, kind: "observe", note: "a", createdAt: "2026-10-27T02:00:00Z" },
    { id: "b", plantId: state.plants[0].id, kind: "other", note: "b", createdAt: "2026-10-28T02:00:00Z" },
  ]);
  assert.deepEqual(groupJournalDays(records).map((group) => group.date), ["2026-10-28", "2026-10-27"]);
  assert.equal(groupJournalDays(records).flatMap((group) => group.records).length, 2);
});

test("photo ordering is chronological, plant-scoped, and never mutates the store array", () => {
  const state = createGardenFixture();
  const photo = state.plantPhotos[0];
  const records = [
    { ...photo, id: "older", date: "2026-10-28", time: "14:00" },
    { ...photo, id: "newer", date: "2026-10-29", time: "07:00" },
    { ...photo, id: "latest", date: "2026-10-29", time: "08:00" },
    { ...photo, id: "different", plantId: "other", date: "2026-10-30", time: "08:00" },
  ];
  assert.deepEqual(sortedPlantPhotos(photo.plantId, records).map((entry) => entry.id), ["latest", "newer", "older"]);
  assert.equal(records[0].id, "older");
});

test("bounded pages expose entries beyond the old twenty-record limit without duplicates", () => {
  const records = Array.from({ length: 105 }, (_, index) => index);
  const all = Array.from({ length: 18 }, (_, page) => historyPage(records, page, 6).records).flat();
  assert.deepEqual(all, records);
  const last = historyPage(records, 999, 6);
  assert.equal(last.page, 17);
  assert.equal(last.start, 103);
  assert.equal(last.end, 105);
  assert.deepEqual(historyPage([], -5, 6).records, []);
});

test("legacy malformed dates stay readable and sort after valid records", () => {
  const state = createGardenFixture();
  const records = buildPlantJournal(state.plants[0].id, [
    { id: "unknown", plantId: state.plants[0].id, kind: "other", note: "Ghi chú cũ", createdAt: "invalid" },
    { id: "valid", plantId: state.plants[0].id, kind: "other", note: "Ghi chú", createdAt: "2026-10-29T02:00:00Z" },
  ]);
  assert.equal(records[1].id, "care:unknown");
  assert.equal(historyDate(records[1].date), "Chưa rõ ngày");
  assert.equal(historyDate("2026-10-29"), "29/10/2026");
});
