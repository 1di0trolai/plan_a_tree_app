/** Chuyển các liên kết săn thưởng cũ sang máy ảnh để tương thích với luồng kiểm tra chăm cây hiện tại. */

import { Redirect } from "expo-router";

// Compatibility for old links. Rewards now require checking the whole garden.
export default function LegacyHuntRedirect() {
  return <Redirect href="/(tabs)/camera" />;
}
