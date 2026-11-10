/**
 * Tập trung ảnh từng loài thú nuôi và ngoại hình 2–3 sao theo mã loài đã lưu; số sao độc lập với phẩm chất.
 */

import type { ImageSourcePropType } from "react-native";

/** Keep bundled pet art together; keys are persisted species IDs, not file names. */
export const PET_IMAGES = {
  caterpillar: require("./caterpillar/caterpillar.png"),
  ladybug: require("./ladybug/ladybug.png"),
  "hunter-bee": require("./hunter-bee/hunter-bee.png"),
  "moon-moth": require("./moon-moth/moon-moth.png"),
  mantis: require("./mantis/mantis.png"),
} as const satisfies Record<string, ImageSourcePropType>;

/** Evolution is separate from rarity: every species has three physical forms. */
export const PET_EVOLUTION_IMAGES = {
  caterpillar: {
    2: require("./caterpillar/caterpillar-2-star.png"),
    3: require("./caterpillar/caterpillar-3-star.png"),
  },
  ladybug: {
    2: require("./ladybug/ladybug-2-star.png"),
    3: require("./ladybug/ladybug-3-star.png"),
  },
  "hunter-bee": {
    2: require("./hunter-bee/hunter-bee-2-star.png"),
    3: require("./hunter-bee/hunter-bee-3-star.png"),
  },
  "moon-moth": {
    2: require("./moon-moth/moon-moth-2-star.png"),
    3: require("./moon-moth/moon-moth-3-star.png"),
  },
  mantis: {
    2: require("./mantis/mantis-2-star.png"),
    3: require("./mantis/mantis-3-star.png"),
  },
} as const satisfies Record<keyof typeof PET_IMAGES, Record<2 | 3, ImageSourcePropType>>;
