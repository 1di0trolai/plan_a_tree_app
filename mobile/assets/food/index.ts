/**
 * Ánh xạ mã thức ăn cố định tới ảnh PNG dùng chung cho cửa hàng và kho; xuất hình bánh sao dự phòng.
 */

import type { ImageSourcePropType } from "react-native";

/** Bundled food illustrations, shared by the shop and inventory. */
export const FOOD_IMAGES = {
  berry: require("./berry-bites.png"),
  cake: require("./honey-cake.png"),
  milk: require("./forest-milk.png"),
  rice: require("./rice-bowl.png"),
  ramen: require("./ramen-bowl.png"),
  star: require("./star-snack.png"),
} as const satisfies Record<string, ImageSourcePropType>;

/** Existing inventory IDs remain unchanged when their illustration changes. */
export const FOOD_ARTWORK = {
  "berry-bites": FOOD_IMAGES.berry,
  "honey-cookie": FOOD_IMAGES.cake,
  "forest-milk": FOOD_IMAGES.milk,
  "rice-bowl": FOOD_IMAGES.rice,
  "ramen-bowl": FOOD_IMAGES.ramen,
  "star-snack": FOOD_IMAGES.star,
} as const satisfies Record<string, ImageSourcePropType>;

export { StarSnackArtwork } from "./star-snack";
