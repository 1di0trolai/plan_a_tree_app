/** Hiển thị hình hộp quà với hiệu ứng lắc khi đủ điều kiện nhận và chế độ chuyển động cho phép. */

import { useEffect, useState } from "react";
import { Animated, Easing } from "react-native";
import { MOTION } from "@/theme";
import { GiftBoxArtwork } from "../../../assets/rewards/gift-box";
import { useRewardMotion } from "./useRewardMotion";

export function ShakingGift({ size, eligible, motionEnabled = true }: { size: number; eligible: boolean; motionEnabled?: boolean }) {
  const animate = useRewardMotion(eligible && motionEnabled);
  const [shake] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (!animate) { shake.setValue(0); return; }
    const beat = (toValue: number) => Animated.timing(shake, { toValue, duration: MOTION.fast, easing: Easing.inOut(Easing.sin), useNativeDriver: true, isInteraction: false });
    const animation = Animated.loop(Animated.sequence([
      Animated.delay(MOTION.blinkPause), beat(-1), beat(1), beat(-0.6), beat(0.6), beat(0),
    ]));
    animation.start();
    return () => { animation.stop(); shake.setValue(0); };
  }, [animate, shake]);
  return <Animated.View accessible={false} style={{ transform: [{ rotate: shake.interpolate({ inputRange: [-1, 1], outputRange: ["-7deg", "7deg"] }) }] }}><GiftBoxArtwork size={size} /></Animated.View>;
}
