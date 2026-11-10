/**
 * Vẽ hình bánh sao SVG dự phòng cho mã thức ăn cũ hoặc chưa có ảnh; vật phẩm thông thường dùng PNG đã đóng gói.
 */

import Svg, { Circle, Ellipse, Path } from "react-native-svg";
import { COLORS } from "@/theme";

/** Fallback for unknown or legacy food IDs; regular items use bundled PNGs. */
export function StarSnackArtwork() {
  return (
    <Svg width="100%" height="100%" viewBox="0 0 100 100" accessible={false}>
      <Ellipse cx="50" cy="88" rx="32" ry="6" fill={COLORS.sageDeep} />
      <Path d="M50 12L62 35L88 40L69 59L73 85L50 73L27 85L31 59L12 40L38 35Z" fill={COLORS.soil} />
      <Path d="M50 8L62 31L88 36L69 55L73 81L50 69L27 81L31 55L12 36L38 31Z" fill={COLORS.sunshine} />
      <Path d="M50 27L56 39L70 42L60 52L62 66L50 59L38 66L40 52L30 42L44 39Z" fill={COLORS.ochreSoft} />
      <Circle cx="44" cy="45" r="2" fill={COLORS.soil} />
      <Circle cx="58" cy="47" r="2" fill={COLORS.soil} />
      <Circle cx="50" cy="58" r="2" fill={COLORS.soil} />
    </Svg>
  );
}
