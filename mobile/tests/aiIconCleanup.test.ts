/** Kiểm tra giao diện trợ lý không còn biểu tượng trang trí Gemini nhưng vẫn giữ đồng ý xử lý và thao tác nhận diện. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("AI presenters do not add decorative Gemini-style sparkle icons", () => {
  for (const path of [
    "../src/app/add-plant.tsx",
    "../src/app/plant-detail.tsx",
    "../src/app/plant-chat.tsx",
    "../src/components/AiProgress.tsx",
    "../src/screens/rewards/PackCards.tsx",
  ]) {
    assert.doesNotMatch(source(path), /sparkles(?:-outline)?|auto[-_]awesome|✨/i, path);
  }
});

test("removing decoration retains AI consent, demo disclosure and the identify action", () => {
  const add = source("../src/app/add-plant.tsx");
  const chat = source("../src/app/plant-chat.tsx");
  assert.match(add, /testID="identify-new-plant"/);
  assert.match(add, /onPress=\{\(\) => void identify\(\)\}/);
  assert.match(add, /Ảnh được gửi đến Gemini/);
  assert.match(chat, /Trợ lý không tự đọc toàn bộ thư viện ảnh/);
  assert.match(add, /Hướng dẫn mẫu dưới đây chưa dựa trên phân tích ảnh/);
  assert.doesNotMatch(source("../src/app/plant-detail.tsx"), /analysis\.analysis\.summary/);
});
