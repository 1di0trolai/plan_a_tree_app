/** Tính vị trí cây đang xem và cây liền kề trong danh sách hiển thị, tách khỏi vị trí lưu trữ. */

type GardenPlantIdentity = { id: string };

/** Visible garden positions are not storage positions: archived plants stay in storage. */
export function getGardenNavigation(
  plants: readonly GardenPlantIdentity[],
  activePlantId?: string | null,
) {
  const index = Math.max(
    0,
    plants.findIndex((plant) => plant.id === activePlantId),
  );
  return {
    index,
    current: plants[index]?.id ?? null,
    previous: plants[index - 1]?.id ?? null,
    next: plants[index + 1]?.id ?? null,
  };
}

/** Clamp native overscroll and ignore invalid measurements rather than selecting a wrong plant. */
export function gardenPlantAtOffset(
  plants: readonly GardenPlantIdentity[],
  offset: number,
  pageWidth: number,
) {
  if (
    !plants.length ||
    !Number.isFinite(offset) ||
    !Number.isFinite(pageWidth) ||
    pageWidth <= 0
  )
    return null;
  const index = Math.max(
    0,
    Math.min(plants.length - 1, Math.round(offset / pageWidth)),
  );
  return plants[index].id;
}
