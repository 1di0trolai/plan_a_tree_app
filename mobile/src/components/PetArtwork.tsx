/** Hiển thị hình thú nuôi theo loài và cấp sao, kèm phương án dự phòng khi thiếu hình. */

import {
  Image,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { LAYOUT } from "@/theme";
import { PET_EVOLUTION_IMAGES, PET_IMAGES } from "../../assets/pets";

export function PetArtwork({
  petId,
  stars = 1,
  size = LAYOUT.artwork,
  style,
}: {
  petId: string;
  stars?: 1 | 2 | 3;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const species = petId as keyof typeof PET_IMAGES;
  const source = (stars === 2 || stars === 3)
    ? PET_EVOLUTION_IMAGES[species]?.[stars] ?? PET_IMAGES[species]
    : PET_IMAGES[species];
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          alignItems: "center",
          justifyContent: "center",
        },
        style,
      ]}
    >
      {source ? (
        <Image
          source={source}
          style={{ width: "100%", height: "100%" }}
          resizeMode="contain"
          accessible={false}
        />
      ) : (
        // Fallback artwork scales with its square canvas, not the text ramp.
        <Text style={{ fontSize: size * 0.58 }}>🌿</Text>
      )}
    </View>
  );
}
