/**
 * Vẽ hộp quà SVG dùng chung cho biểu tượng quà nổi và lịch quà đăng nhập bảy ngày.
 */

import Svg, { Circle, Ellipse, Path } from "react-native-svg";
import { COLORS, LAYOUT } from "@/theme";

/** Editable vector reward box; shared by the floating entry and seven-day gift. */
export function GiftBoxArtwork({ size = LAYOUT.thumbnail }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 120 120" accessible={false}>
      <Ellipse cx="61" cy="110" rx="39" ry="5" fill={COLORS.sageDeep} />
      <Path d="M24 53 62 65 98 52v44L62 109 24 97Z" fill={COLORS.actionSurface} stroke={COLORS.primaryDark} strokeWidth="2" strokeLinejoin="round" />
      <Path d="m62 65 36-13v44l-36 13Z" fill={COLORS.botanical} />
      <Path d="m43 59 12 4v44l-12-4Z" fill={COLORS.sunshine} />
      <Path d="m76 60 10-4v44l-10 4Z" fill={COLORS.sunshine} />
      <Path d="m18 40 40-14 46 14-41 16Z" fill={COLORS.actionEnd} stroke={COLORS.primaryDark} strokeWidth="2" strokeLinejoin="round" />
      <Path d="m18 40 45 16v15L18 56Z" fill={COLORS.actionSurface} stroke={COLORS.primaryDark} strokeWidth="2" strokeLinejoin="round" />
      <Path d="m63 56 41-16v15L63 71Z" fill={COLORS.botanical} stroke={COLORS.primaryDark} strokeWidth="2" strokeLinejoin="round" />
      <Path d="m40 32 45 15 1 15-11 4V51L28 36Z" fill={COLORS.sunshine} />
      <Path d="m78 32-43 15v15l12 4V51l43-15Z" fill={COLORS.sunshine} />
      <Path d="M61 31C36 35 31 15 42 12c10-3 18 11 19 19Z" fill={COLORS.sunshine} stroke={COLORS.warning} strokeWidth="2" />
      <Path d="M61 31c25 4 30-16 19-19-10-3-18 11-19 19Z" fill={COLORS.sunshine} stroke={COLORS.warning} strokeWidth="2" />
      <Circle cx="61" cy="30" r="7" fill={COLORS.sunshine} stroke={COLORS.warning} strokeWidth="2" />
      <Path d="m103 12 2 6 6 2-6 2-2 6-2-6-6-2 6-2ZM17 24l1.5 4.5L23 30l-4.5 1.5L17 36l-1.5-4.5L11 30l4.5-1.5Z" fill={COLORS.sunshine} />
      <Circle cx="102" cy="84" r="3" fill={COLORS.sunshine} />
      <Path d="m28 73 8 3" stroke={COLORS.onPrimary} strokeWidth="3" strokeLinecap="round" />
    </Svg>
  );
}
