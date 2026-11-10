/** Hiển thị hình vàng hoặc kim cương từ bộ tài nguyên tiền tệ dùng chung. */

import { Image, type ImageStyle, type StyleProp } from "react-native";
import { CURRENCY_ARTWORK, type Currency } from "../../assets/money";
import { LAYOUT } from "@/theme";

/** Decorative beside a visible currency amount; never replaces its text label. */
export function CurrencyArtwork({ currency, size = LAYOUT.smallIcon, style }: {
  currency: Currency;
  size?: number;
  style?: StyleProp<ImageStyle>;
}) {
  return <Image source={CURRENCY_ARTWORK[currency]} resizeMode="contain" accessible={false}
    style={[{ width: size, height: size }, style]} />;
}
