/** Hiển thị logo hoặc biểu tượng PAT từ tài nguyên dùng chung với kích thước được chỉ định. */

import { Image, type ImageStyle, type StyleProp } from "react-native";

const symbol = require("../../assets/logo/pat-symbol.png");
const logo = require("../../assets/logo/pat-logo.png");

/** Decorative PAT artwork; the surrounding heading/button supplies its accessible name. */
export function BrandArtwork({
  size,
  variant = "symbol",
  style,
}: {
  size: number;
  variant?: "symbol" | "logo";
  style?: StyleProp<ImageStyle>;
}) {
  return (
    <Image
      source={variant === "logo" ? logo : symbol}
      style={[{ width: size, height: size }, style]}
      resizeMode="contain"
      accessible={false}
    />
  );
}
