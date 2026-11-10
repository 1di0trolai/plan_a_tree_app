/** Ghép hình nhân vật người làm vườn theo trang phục và chạy hiệu ứng chớp mắt, vẫy tay khi được phép. */

import { useEffect, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  AppState,
  Easing,
  StyleSheet,
  View,
} from "react-native";
import {
  GardenerArmArtwork,
  GardenerBodyArtwork,
  GardenerEyesArtwork,
  GardenerGroundArtwork,
  OUTFITS,
} from "../../../assets/skins/gardener";

import { MOTION } from "@/theme";
import type { GardenerOutfit } from "@/types/app";

export { OUTFITS };

// Original PAT vector art. Coordinates are an illustration's 240×280 viewBox,
// not layout spacing. Separate eyes/arm layers provide actual blink/wave motion.
export function GardenerAvatar({
  outfit = "leaf",
  animated = false,
  size = 240,
}: {
  outfit?: GardenerOutfit;
  animated?: boolean;
  size?: number;
}) {
  const [reduceMotion, setReduceMotion] = useState(true);
  const [foreground, setForeground] = useState(
    AppState.currentState === "active",
  );
  const [bob] = useState(() => new Animated.Value(0));
  const [blink] = useState(() => new Animated.Value(1));
  const [wave] = useState(() => new Animated.Value(0));
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (active) setReduceMotion(value);
      })
      .catch(() => {});
    const motion = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion,
    );
    const app = AppState.addEventListener("change", (value) =>
      setForeground(value === "active"),
    );
    return () => {
      active = false;
      motion.remove();
      app.remove();
    };
  }, []);
  useEffect(() => {
    bob.setValue(0);
    blink.setValue(1);
    wave.setValue(0);
    if (!animated || reduceMotion || !foreground) return;
    const timing = (value: Animated.Value, toValue: number, duration: number) =>
      Animated.timing(value, {
        toValue,
        duration,
        easing: Easing.inOut(Easing.sin),
        useNativeDriver: true,
        isInteraction: false,
      });
    const animation = Animated.parallel([
      Animated.loop(
        Animated.sequence([
          timing(bob, -3, MOTION.idle),
          timing(bob, 0, MOTION.idle),
        ]),
      ),
      Animated.loop(
        Animated.sequence([
          Animated.delay(MOTION.blinkPause),
          timing(blink, 0.1, MOTION.fast),
          timing(blink, 1, MOTION.fast),
        ]),
      ),
      Animated.loop(
        Animated.sequence([
          Animated.delay(MOTION.idle),
          timing(wave, 1, MOTION.slow),
          timing(wave, -0.3, MOTION.slow),
          timing(wave, 1, MOTION.slow),
          timing(wave, 0, MOTION.slow),
        ]),
      ),
    ]);
    animation.start();
    return () => {
      animation.stop();
      bob.setValue(0);
      blink.setValue(1);
      wave.setValue(0);
    };
  }, [animated, blink, bob, foreground, reduceMotion, wave]);
  const scale = size / 240;
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Người chăm vườn chibi, trang phục ${OUTFITS.find((item) => item.id === outfit)?.name}`}
      style={{ width: size, height: (size * 280) / 240 }}
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[
          styles.canvas,
          {
            transform: [{ scale }],
            left: (size - 240) / 2,
            top: ((size * 280) / 240 - 280) / 2,
          },
        ]}
      >
        <GardenerGroundArtwork />
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { transform: [{ translateY: bob }] },
          ]}
        >
          <GardenerBodyArtwork outfit={outfit} />
          <Animated.View
            style={[styles.eyes, { transform: [{ scaleY: blink }] }]}
          >
            <GardenerEyesArtwork />
          </Animated.View>
          <Animated.View
            style={[
              styles.arm,
              {
                transform: [
                  {
                    rotate: wave.interpolate({
                      inputRange: [-1, 1],
                      outputRange: ["-12deg", "12deg"],
                    }),
                  },
                ],
              },
            ]}
          >
            <GardenerArmArtwork outfit={outfit} />
          </Animated.View>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: { position: "absolute", width: 240, height: 280 },
  eyes: { position: "absolute", top: 96, left: 87, width: 68, height: 32 },
  arm: { position: "absolute", left: 158, top: 120, width: 59, height: 88 },
});
