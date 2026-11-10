/**
 * Ánh xạ loại tiền vàng và kim cương tới ảnh đóng gói, đồng thời khai báo kiểu dữ liệu tiền tệ.
 */

import type { ImageSourcePropType } from "react-native";

export const CURRENCY_ARTWORK = {
  gold: require("./gold-coin.png"),
  diamond: require("./diamond.png"),
} as const satisfies Record<string, ImageSourcePropType>;

export type Currency = keyof typeof CURRENCY_ARTWORK;
