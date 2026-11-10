/** Hiển thị các chấm chỉ vị trí cây và điều khiển chuyển cây trong khu vườn. */

import { t, useI18n } from "@/i18n";
import { useMemo } from "react";
import { Animated, Pressable, StyleSheet, View } from "react-native";
import { useControlFocus } from "@/hooks/useControlFocus";
import { COLORS, INTERACTION, LAYOUT, RADIUS, SPACING } from "@/theme";

// The middle marker represents the current plant; the sides are its neighbors,
// rather than a fixed three-page limit. These are local indicator geometry.
const DOT_SIZE = SPACING.compact / 2;
const DOT_STEP = SPACING.md;
const STRIP_WIDTH = LAYOUT.touch * 2;

export function GardenDots({
  offset,
  pageWidth,
  index,
  count,
  reduceMotion,
  onPrevious,
  onNext,
}: {
  offset: Animated.Value;
  pageWidth: number;
  index: number;
  count: number;
  reduceMotion: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  useI18n();
  const focus = useControlFocus();
  const previous = index > 0;
  const next = index < count - 1;
  const markers = useMemo(() => {
    const page = Animated.divide(offset, Math.max(1, pageWidth));
    return [0, 1, 2].map((slot) => {
      // Recycle only after a marker has faded beyond the clipped strip. This
      // keeps exactly three markers moving continuously with the user's swipe.
      const phase = Animated.modulo(
        Animated.add(Animated.multiply(page, -1), slot + 0.5),
        3,
      );
      const relative = phase.interpolate({
        inputRange: [0, 1.5, 3],
        outputRange: [-1.5, 0, 1.5],
      });
      const position = Animated.add(page, relative);
      const available = position.interpolate({
        inputRange: count > 1 ? [-1, 0, count - 1, count] : [-1, 0, 1],
        outputRange: count > 1 ? [0.2, 1, 1, 0.2] : [0.2, 1, 0.2],
        extrapolate: "clamp",
      });
      return {
        opacity: Animated.multiply(
          available,
          relative.interpolate({
            inputRange: [-1.5, -1, 0, 1, 1.5],
            outputRange: [0, 0.6, 1, 0.6, 0],
          }),
        ),
        transform: [
          { translateX: Animated.multiply(relative, DOT_STEP) },
          {
            scale: relative.interpolate({
              inputRange: [-1.5, -1, 0, 1, 1.5],
              outputRange: [0.75, 1, 1.5, 1, 0.75],
            }),
          },
        ],
      };
    });
  }, [count, offset, pageWidth]);

  return (
    <View style={styles.container} testID="garden-dots">
      <View style={styles.strip}>
        <View
          pointerEvents="none"
          style={styles.markers}
          accessible={false}
          importantForAccessibility="no-hide-descendants"
        >
          {markers.map((animation, slot) => (
            <Animated.View
              key={slot}
              style={[
                styles.dot,
                reduceMotion
                  ? {
                      opacity:
                        slot === 1
                          ? 1
                          : (slot === 0 ? previous : next)
                            ? 0.6
                            : 0.12,
                      transform: [
                        { translateX: (slot - 1) * DOT_STEP },
                        { scale: slot === 1 ? 1.5 : 1 },
                      ],
                    }
                  : animation,
              ]}
            />
          ))}
        </View>
        <Pressable
          {...focus.props("previous")}
          accessibilityRole="button"
          accessibilityLabel={t("Cây trước")}
          accessibilityState={{ disabled: !previous }}
          disabled={!previous}
          onPress={onPrevious}
          style={({ pressed }) => [
            styles.target,
            styles.previous,
            pressed && styles.pressed,
            focus.style("previous"),
          ]}
          testID="garden-previous-plant"
        />
        <View
          accessible
          accessibilityLabel={t("Cây {index} trong {count} cây", { index: index + 1, count })}
          accessibilityLiveRegion="polite"
          pointerEvents="none"
          style={styles.current}
        />
        <Pressable
          {...focus.props("next")}
          accessibilityRole="button"
          accessibilityLabel={t("Cây tiếp theo")}
          accessibilityState={{ disabled: !next }}
          disabled={!next}
          onPress={onNext}
          style={({ pressed }) => [
            styles.target,
            styles.next,
            pressed && styles.pressed,
            focus.style("next"),
          ]}
          testID="garden-next-plant"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
  },
  strip: {
    width: STRIP_WIDTH,
    height: LAYOUT.touch,
  },
  markers: {
    ...StyleSheet.absoluteFill,
    overflow: "hidden",
    // Keep dot glyphs above the pressed surface without intercepting touches.
    zIndex: 1,
  },
  dot: {
    position: "absolute",
    left: (STRIP_WIDTH - DOT_SIZE) / 2,
    top: (LAYOUT.touch - DOT_SIZE) / 2,
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.primaryDark,
  },
  target: {
    position: "absolute",
    width: LAYOUT.touch,
    height: LAYOUT.touch,
    borderRadius: RADIUS.pill,
  },
  previous: { left: 0 },
  next: { right: 0 },
  current: {
    position: "absolute",
    left: STRIP_WIDTH / 2 - SPACING.xs,
    width: SPACING.sm,
    height: LAYOUT.touch,
  },
  pressed: {
    backgroundColor: COLORS.pressed,
    opacity: INTERACTION.pressedOpacity,
  },
});
