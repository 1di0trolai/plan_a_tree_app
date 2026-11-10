/** Kiểm thử tạo hồ sơ nháp từ nhận diện, giữ đúng loài cây và giai đoạn được đề xuất. */

import assert from "node:assert/strict";
import { test } from "node:test";
import { identifiedPlantDraft, starterCrop } from "../src/utils/plantDraft";

test("species outside the starter guides remain unrestricted, including khế", () => {
  for (const name of ["Khế", "Averrhoa carambola", "Ổi", "Hoa hồng", "Dâu tây"])
    assert.equal(starterCrop(name), "other");
  assert.equal(starterCrop("Xoài cát"), "mango");
  assert.equal(starterCrop("Cà chua bi"), "tomato");
  assert.equal(starterCrop("Ớt chỉ thiên"), "chili");
});

test("AI profile draft preserves the actual species and suggested growth phase", () => {
  const draft = identifiedPlantDraft({
    crop: "other",
    label: "Khế",
    species: "Averrhoa carambola",
    phase: "fruiting",
  });
  assert.deepEqual(draft, {
    crop: "other",
    name: "Khế của tôi",
    species: "Averrhoa carambola",
    phase: "fruiting",
    method: "seedling",
  });
  assert.equal(
    identifiedPlantDraft({
      crop: "other",
      label: "Khế",
      species: "",
      phase: "planning",
    }).species,
    "Khế",
  );
  assert.equal(
    identifiedPlantDraft({
      crop: "other",
      label: "Khế",
      species: "Khế",
      phase: "germinating",
    }).method,
    "seed",
  );
});
