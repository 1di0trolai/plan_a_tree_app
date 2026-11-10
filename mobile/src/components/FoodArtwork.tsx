/** Hiển thị hình thức ăn theo mã vật phẩm, dùng hình dự phòng khi chưa có tài nguyên tương ứng. */

import { Image, View, type StyleProp, type ViewStyle } from "react-native";
import { FOOD_ARTWORK, StarSnackArtwork } from "../../assets/food";
import { LAYOUT } from "@/theme";

/** Decorative item art; the surrounding food label supplies its accessible name. */
export function FoodArtwork({ itemId, size = LAYOUT.thumbnail, style }: {
  itemId: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const source = FOOD_ARTWORK[itemId as keyof typeof FOOD_ARTWORK];
  return (
    <View accessible={false} style={[{ width: size, height: size }, style]}>
      {source ? (
        <Image source={source} resizeMode="contain" accessible={false} style={{ width: "100%", height: "100%" }} />
      ) : <StarSnackArtwork />}
    </View>
  );
}
