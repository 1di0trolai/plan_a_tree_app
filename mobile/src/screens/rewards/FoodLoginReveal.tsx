/** Hiển thị hiệu ứng mở thẻ thức ăn nhận từ quà đăng nhập với hào quang theo phẩm chất. */

import { useI18n } from "@/i18n";
import { useEffect, useId, useRef, useState } from "react";
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, Ellipse, RadialGradient, Stop } from "react-native-svg";
import { BrandArtwork } from "@/components/BrandArtwork";
import { FoodArtwork } from "@/components/FoodArtwork";
import { useControlFocus } from "@/hooks/useControlFocus";
import { COLORS, INTERACTION, LAYOUT, MOTION, RADIUS, RARITY, SPACING, TYPE } from "@/theme";
import type { InventoryItem } from "@/types/app";
import { useRewardMotion } from "./useRewardMotion";

const rarityKey = { "Thường": "Common", "Không phổ biến": "Uncommon", "Hiếm": "Rare", "Sử thi": "Epic", "Huyền thoại": "Legendary" } as const;

/** This is only a presentation of an already-saved claim. Opening, closing,
 * interrupted animation and repeated taps cannot reroll or re-credit food. */
export function FoodLoginReveal({ item, onClose, motionEnabled = true }: { item: InventoryItem; onClose: () => void; motionEnabled?: boolean }) {
  const { t } = useI18n();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const focus = useControlFocus();
  const animate = useRewardMotion(motionEnabled);
  const [opened, setOpened] = useState(false);
  const [arrival] = useState(() => new Animated.Value(0));
  const [turn] = useState(() => new Animated.Value(0));
  const opening = useRef(false);
  const finite = useRef<Animated.CompositeAnimation | null>(null);
  const id = `food-halo-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const tint = RARITY[rarityKey[item.rarity]];
  // A compact card leaves a generous visible halo on small/landscape phones.
  const cardHeight = Math.min(LAYOUT.artwork * 3, Math.max(LAYOUT.thumbnail * 2, height - insets.top - insets.bottom - SPACING.hero * 2));
  const cardWidth = Math.min(LAYOUT.authLogo + SPACING.hero, width - SPACING.hero, cardHeight * 0.72);
  useEffect(() => {
    if (animate) Animated.timing(arrival, { toValue: 1, duration: MOTION.cardArrival, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    else arrival.setValue(1);
    return () => arrival.stopAnimation();
  }, [animate, arrival]);
  useEffect(() => {
    if (!animate && opening.current) { finite.current?.stop(); turn.setValue(1); }
    return () => finite.current?.stop();
  }, [animate, turn]);
  const open = () => {
    if (opening.current) return;
    opening.current = true;
    setOpened(true);
    if (!animate) { turn.setValue(1); return; }
    finite.current = Animated.timing(turn, { toValue: 1, duration: MOTION.cardCharge, easing: Easing.inOut(Easing.cubic), useNativeDriver: true });
    finite.current.start();
  };
  return (
    <View testID="food-login-reveal" accessibilityViewIsModal onAccessibilityEscape={onClose} style={[styles.overlay, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <Pressable testID="food-reveal-backdrop" accessibilityRole="button" accessibilityLabel={t("Đóng thẻ quà đăng nhập")} onPress={onClose} style={StyleSheet.absoluteFill} />
      <View style={{ width: cardWidth, height: cardHeight }} pointerEvents="box-none">
        <View pointerEvents="none" accessible={false} style={styles.halo}>
          <Svg width="100%" height="100%" viewBox="0 0 400 560" preserveAspectRatio="none"><Defs><RadialGradient id={id}><Stop offset="0" stopColor={opened ? tint.glow : COLORS.rewardSilver} stopOpacity="0.9" /><Stop offset="0.6" stopColor={opened ? tint.glow : COLORS.rewardSilver} stopOpacity="0.8" /><Stop offset="1" stopColor={opened ? tint.glow : COLORS.rewardSilver} stopOpacity="0" /></RadialGradient></Defs><Ellipse cx="200" cy="280" rx="200" ry="280" fill={`url(#${id})`} /></Svg>
        </View>
        <Animated.View style={[styles.frame, { opacity: arrival, transform: [
          { rotate: arrival.interpolate({ inputRange: [0, 1], outputRange: ["-300deg", "0deg"] }) },
          { scale: arrival.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] }) },
        ] }]}>
          <Animated.View style={{ flex: 1, transform: [
            { rotateY: turn.interpolate({ inputRange: [0, 0.5, 1], outputRange: ["0deg", "720deg", "1080deg"] }) },
            { scale: turn.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 0.2, 1] }) },
          ] }}>
            {opened ? <View testID="food-login-card-front" style={[styles.card, { borderColor: tint.glow }]}>
              <ScrollView contentContainerStyle={styles.front} showsVerticalScrollIndicator>
                <Text style={[TYPE.label, { color: tint.color }]}>{t(item.rarity)}</Text>
                <View style={[styles.art, { backgroundColor: tint.background }]}><FoodArtwork itemId={item.id} size={Math.min(cardWidth - SPACING.xl, cardHeight * 0.45)} /></View>
                <Text style={styles.name}>{t(item.name)}</Text><Text style={TYPE.headline}>×1</Text>
                <Text style={styles.saved}>{t("Đã cất vào kho")}</Text>
              </ScrollView>
            </View> : <Pressable {...focus.props("open-food")} testID="open-food-login-card" accessibilityRole="button" accessibilityLabel={t("Mở thẻ thức ăn đăng nhập")} onPress={open} style={({ pressed }) => [styles.card, styles.sealed, pressed && { opacity: INTERACTION.primaryPressedOpacity }, focus.style("open-food", true)]}>
              <ScrollView contentContainerStyle={styles.sealedContent} showsVerticalScrollIndicator={false}><Text style={styles.sealedText}>{t("QUÀ GHÉ VƯỜN")}</Text><View style={styles.seal}><BrandArtwork size={Math.min(cardWidth * 0.45, LAYOUT.artwork)} /></View><Text style={styles.sealedText}>{t("Chạm để mở thẻ")}</Text></ScrollView>
            </Pressable>}
          </Animated.View>
        </Animated.View>
      </View>
      <Text pointerEvents="none" style={styles.hint}>{t("Chạm ra ngoài thẻ để đóng")}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, alignItems: "center", justifyContent: "center", gap: SPACING.lg, backgroundColor: COLORS.rewardBackdrop },
  frame: { flex: 1 },
  halo: { position: "absolute", inset: -SPACING.hero },
  card: { flex: 1, borderWidth: 3, borderColor: COLORS.rewardSilver, borderRadius: RADIUS.lg, borderCurve: "continuous", backgroundColor: COLORS.surface, overflow: "hidden" },
  sealed: { backgroundColor: COLORS.primaryDark, padding: SPACING.md },
  sealedContent: { flexGrow: 1, justifyContent: "space-evenly", alignItems: "center", gap: SPACING.md },
  sealedText: { ...TYPE.label, color: COLORS.rewardSilverTint, textAlign: "center" },
  seal: { borderRadius: RADIUS.pill, padding: SPACING.sm, backgroundColor: COLORS.surface },
  front: { flexGrow: 1, alignItems: "center", gap: SPACING.sm, padding: SPACING.md },
  art: { width: "100%", flexGrow: 1, minHeight: LAYOUT.touch, alignItems: "center", justifyContent: "center", borderRadius: RADIUS.md },
  name: { ...TYPE.headline, textAlign: "center" },
  saved: { ...TYPE.caption, textAlign: "center" },
  hint: { ...TYPE.caption, paddingHorizontal: SPACING.md, color: COLORS.rewardSilverTint, textAlign: "center" },
});
