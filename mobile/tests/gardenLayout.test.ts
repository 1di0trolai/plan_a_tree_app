/** Kiểm thử bố cục khu vườn theo kích thước màn hình, vùng an toàn và cỡ chữ hỗ trợ tiếp cận. */

import assert from "node:assert/strict";
import { test } from "node:test";
import { gardenViewportBudget } from "../src/screens/garden/gardenLayout";

const metrics = {
  metadataHeight: 54,
  // Includes today's progress and the persistent primary care/start action.
  progressHeight: 118,
  indicatorHeight: 48,
  cardGap: 8,
  bottomPadding: 8,
  minimumImageHeight: 144,
  maximumImageHeight: 480,
};

for (const phone of [
  { width: 375, height: 812, safeTop: 47, tabBar: 98 },
  { width: 375, height: 667, safeTop: 20, tabBar: 64 },
  { width: 320, height: 568, safeTop: 20, tabBar: 64 },
]) {
  test(`garden primary content fits ${phone.width} × ${phone.height} with safe areas and tabs`, () => {
    // Production measures this area via ScrollView.onLayout, after the header.
    const viewportHeight = phone.height - phone.safeTop - phone.tabBar - 101;
    const result = gardenViewportBudget({
      ...metrics,
      viewportHeight,
      imageWidth: phone.width - 40,
    });
    assert.ok(result.imageHeight >= metrics.minimumImageHeight);
    assert.ok(result.imageHeight <= phone.width - 40);
    assert.ok(result.contentHeight <= viewportHeight);
    assert.equal(result.needsScroll, false);
  });
}

test("garden reserves the actual height of a wrapped plant name and pet reward", () => {
  const result = gardenViewportBudget({
    ...metrics,
    viewportHeight: 482,
    imageWidth: 335,
    metadataHeight: 90,
    progressHeight: 114,
  });
  assert.equal(result.imageHeight, 214);
  assert.equal(result.contentHeight, 482);
  assert.equal(result.needsScroll, false);
});

test("large accessibility text and short landscapes retain a usable image and scroll", () => {
  for (const viewportHeight of [175, 280]) {
    const result = gardenViewportBudget({
      ...metrics,
      viewportHeight,
      imageWidth: 280,
      metadataHeight: 140,
      progressHeight: 132,
    });
    assert.equal(result.imageHeight, metrics.minimumImageHeight);
    assert.equal(result.needsScroll, true);
    assert.ok(result.contentHeight > viewportHeight);
  }
});
