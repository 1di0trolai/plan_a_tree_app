/** Tính chiều cao ảnh và vùng nội dung khu vườn theo màn hình, giữ đủ chỗ cho chữ, nút và vùng an toàn. */
export function gardenViewportBudget({
  viewportHeight,
  imageWidth,
  metadataHeight,
  progressHeight,
  indicatorHeight,
  cardGap,
  bottomPadding,
  minimumImageHeight,
  maximumImageHeight,
}: {
  viewportHeight: number;
  imageWidth: number;
  metadataHeight: number;
  progressHeight: number;
  indicatorHeight: number;
  cardGap: number;
  bottomPadding: number;
  minimumImageHeight: number;
  maximumImageHeight: number;
}) {
  const reservedHeight =
    metadataHeight + progressHeight + indicatorHeight + cardGap + bottomPadding;
  const imageHeight = Math.max(
    minimumImageHeight,
    Math.min(imageWidth, maximumImageHeight, viewportHeight - reservedHeight),
  );
  const contentHeight = imageHeight + reservedHeight;
  return {
    imageHeight,
    contentHeight,
    needsScroll: contentHeight > viewportHeight,
  };
}
