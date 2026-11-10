/** Chuyển kết quả nhận diện thành bản nháp hồ sơ cây và chọn nhóm hướng dẫn khởi đầu theo tên loài, không giới hạn những loài được phép thêm. */

import type { CropKind, PlantPhase } from "../types/app";

// The small crop enum selects a starter guide; it is NOT a species whitelist.
export function starterCrop(species: string): CropKind {
  const name = species
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  if (/\b(xoai|mango|mangifera)\b/.test(name)) return "mango";
  if (/\b(ca chua|tomato|lycopersicum)\b/.test(name)) return "tomato";
  if (/\b(ot|chili|chilli|capsicum)\b/.test(name)) return "chili";
  return "other";
}

export function identifiedPlantDraft(result: {
  crop: CropKind;
  label: string;
  species: string;
  phase: PlantPhase;
}) {
  return {
    crop: result.crop,
    name: `${result.label.trim()} của tôi`,
    species: result.species.trim() || result.label.trim(),
    phase: result.phase,
    method:
      result.phase === "planning" || result.phase === "germinating"
        ? ("seed" as const)
        : ("seedling" as const),
  };
}
