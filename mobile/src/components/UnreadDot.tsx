/** Vẽ dấu chấm báo thư chưa đọc để gắn vào các nút điều hướng và hòm thư. */

import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { COLORS, RADIUS, SPACING } from "@/theme";

/** Decorative status; the containing control announces whether mail is unread. */
export function UnreadDot({ style }: { style?: StyleProp<ViewStyle> }) {
  return (
    <View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[styles.dot, style]}
    />
  );
}

const styles = StyleSheet.create({
  dot: {
    position: "absolute",
    top: -SPACING.xs,
    right: -SPACING.xs,
    width: SPACING.compact,
    height: SPACING.compact,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.danger,
    // A 2dp surface ring keeps the 8dp red center distinct from the icon below.
    borderWidth: 2,
    borderColor: COLORS.surface,
  },
});
