/** Trình bày hiệu ứng mở thẻ thú nuôi, hào quang phẩm chất và chuyển giữa các phần thưởng. */

import { useI18n } from "@/i18n";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useId, useRef, useState } from "react";
import { Animated, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View, type ScrollViewInstance } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, Ellipse, Path, RadialGradient, Stop } from "react-native-svg";
import { FoodArtwork } from "@/components/FoodArtwork";
import { JourneyButton } from "@/components/journeyUI";
import { useControlFocus } from "@/hooks/useControlFocus";
import { useApp } from "@/store/AppStore";
import { COLORS, INTERACTION, LAYOUT, RADIUS, RARITY, SPACING, TYPE } from "@/theme";
import type { Beast, DailyPetPack } from "@/types/app";
import { FoodRewardCard, PetRewardCard, SealedPack } from "./PackCards";
import { usePackReveal } from "./usePackReveal";

export function PackReveal({ pack, pet }: { pack: DailyPetPack; pet: Beast }) {
  const { t } = useI18n();
  const { state } = useApp();
  const focus = useControlFocus();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reveal = usePackReveal(pack);
  const haloId = `reward-halo-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [page, setPage] = useState(0);
  const pageRef = useRef(page);
  useEffect(() => { pageRef.current = page; }, [page]);
  const pager = useRef<ScrollViewInstance>(null);
  // Compact reward framing leaves room for the aura; scaled text scrolls inside.
  const availableHeight = Math.max(144, height - insets.top - insets.bottom - SPACING.hero * 2 - (reveal.error ? SPACING.hero + SPACING.xl : 0));
  const cardHeight = Math.min(360, availableHeight);
  const cardWidth = width > height
    ? Math.min(264, width - SPACING.hero)
    : Math.max(136, Math.min(248, width - SPACING.hero, cardHeight * 0.72));
  const artSize = Math.min(cardWidth - SPACING.xl, cardHeight * 0.48);
  const bonusFood = pack.bonusFoodItemId
    ? state.inventory.items.find((item) => item.id === pack.bonusFoodItemId)
    : undefined;
  const showFront = reveal.revealed && reveal.durable;
  const glow = showFront ? RARITY[pack.rarity].glow : COLORS.rewardSilver;
  const goToPage = (next: number) => {
    if (!showFront || !bonusFood || reveal.busy) return;
    setPage(next);
    pager.current?.scrollTo({ x: next * cardWidth, animated: !reveal.noMotion });
  };
  const scrollPage = (offset: number) => setPage(Math.max(0, Math.min(1, Math.round(offset / cardWidth))));
  useEffect(() => {
    pager.current?.scrollTo({ x: pageRef.current * cardWidth, animated: false });
    // Preserve the selected reward after rotation without fighting swipe momentum.
  }, [cardWidth]);
  return (
    <View style={styles.overlayContent} pointerEvents="box-none">
      <View style={{ width: cardWidth, height: cardHeight }} pointerEvents="box-none">
        <Animated.View
          testID="reward-halo"
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.halo, {
            opacity: reveal.pulse.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1] }),
            transform: [{ scale: reveal.pulse.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1.04] }) }],
          }]}
        >
          <Svg width="100%" height="100%" viewBox="0 0 400 560" preserveAspectRatio="none">
            <Defs>
              <RadialGradient id={haloId} cx="50%" cy="50%" rx="50%" ry="50%">
                <Stop offset="0" stopColor={glow} stopOpacity="0.9" />
                <Stop offset="0.42" stopColor={glow} stopOpacity="0.85" />
                <Stop offset="0.64" stopColor={glow} stopOpacity="0.65" />
                <Stop offset="0.8" stopColor={glow} stopOpacity="0.28" />
                <Stop offset="0.94" stopColor={glow} stopOpacity="0.06" />
                <Stop offset="1" stopColor={glow} stopOpacity="0" />
              </RadialGradient>
            </Defs>
            <Ellipse cx="200" cy="280" rx="200" ry="280" fill={`url(#${haloId})`} />
            {[-42, 42, 138, 222].map((rotation) => <Path key={rotation} d="M194 280 L188 30 Q200 0 212 30 L206 280 Z" fill={glow} opacity="0.1" transform={`rotate(${rotation} 200 280)`} />)}
          </Svg>
        </Animated.View>
        <Animated.View style={{ flex: 1, zIndex: 1, opacity: reveal.arrival.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 1, 1] }), transform: [
          { translateY: reveal.arrival.interpolate({ inputRange: [0, 1], outputRange: [height * 0.46, 0] }) },
          { rotateZ: reveal.arrival.interpolate({ inputRange: [0, 1], outputRange: ["-330deg", "0deg"] }) },
          { scale: reveal.arrival.interpolate({ inputRange: [0, 1], outputRange: [0.12, 1] }) },
        ] }}>
          <Animated.View style={{ flex: 1, transform: [
            { perspective: 1000 },
            { rotateZ: reveal.spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "1080deg"] }) },
            { rotateY: reveal.spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "720deg"] }) },
            { scale: reveal.spin.interpolate({ inputRange: [0, 1], outputRange: [1, 0.16] }) },
          ] }}>
            <Animated.View style={{ flex: 1, transform: [{ scale: reveal.expansion }] }}>
              {showFront && bonusFood && !reveal.busy && page === 0 ? (
                <Pressable
                  {...focus.props("bonus-peek")}
                  testID="bonus-card-peek"
                  accessibilityRole="button"
                  accessibilityLabel={t("Xem quà đi kèm: {name}", { name: t(bonusFood.name) })}
                  onPress={() => goToPage(1)}
                  style={[styles.peek, { height: cardHeight * 0.9 }, focus.style("bonus-peek", true)]}
                >
                  <FoodArtwork itemId={bonusFood.id} size={LAYOUT.thumbnail} />
                </Pressable>
              ) : null}
              {showFront ? (
                <ScrollView
                  ref={pager}
                  testID="reward-pager"
                  horizontal
                  pagingEnabled
                  scrollEnabled={Boolean(bonusFood) && !reveal.busy}
                  showsHorizontalScrollIndicator={false}
                  directionalLockEnabled
                  bounces={false}
                  onMomentumScrollEnd={(event) => scrollPage(event.nativeEvent.contentOffset.x)}
                  onScrollEndDrag={(event) => scrollPage(event.nativeEvent.contentOffset.x)}
                  style={{ width: cardWidth, height: cardHeight }}
                >
                  <View style={{ width: cardWidth, height: cardHeight }} accessibilityElementsHidden={page !== 0} importantForAccessibility={page !== 0 ? "no-hide-descendants" : "auto"}>
                    <PetRewardCard pack={pack} pet={pet} artSize={artSize} />
                  </View>
                  {bonusFood ? <View style={{ width: cardWidth, height: cardHeight }} accessibilityElementsHidden={page !== 1} importantForAccessibility={page !== 1 ? "no-hide-descendants" : "auto"}>
                    <FoodRewardCard item={bonusFood} artSize={artSize} />
                  </View> : null}
                </ScrollView>
              ) : (
                <Pressable
                  {...focus.props("earned-card")}
                  testID="open-earned-pack"
                  accessibilityRole="button"
                  accessibilityLabel={t("Mở thẻ thú nuôi")}
                  accessibilityHint={t("Chạm để khám phá người bạn mới.")}
                  accessibilityState={{ disabled: !reveal.durable || reveal.busy, busy: reveal.busy }}
                  disabled={!reveal.durable || reveal.busy}
                  onPress={() => void reveal.open()}
                  style={({ pressed }) => [styles.openCard, pressed && { opacity: INTERACTION.primaryPressedOpacity }, focus.style("earned-card", true)]}
                >
                  <SealedPack artSize={artSize * 0.62} caption={t(!reveal.durable ? "Đang lưu thẻ…" : reveal.busy ? "Đang mở thẻ…" : reveal.error ? "Chạm để thử lại" : "Mở thẻ")} />
                </Pressable>
              )}
            </Animated.View>
          </Animated.View>
        </Animated.View>
      </View>
      {reveal.error ? <View style={[styles.errorPanel, { maxWidth: width - SPACING.xl }]}>
        <Text accessibilityRole="alert" style={styles.errorText}>{t(reveal.error)}</Text>
        {!reveal.durable ? <JourneyButton title={t("Thử lưu lại")} size="sm" loading={reveal.busy} onPress={() => void reveal.saveAgain()} /> : null}
      </View> : null}
      {showFront && bonusFood ? (
        <View testID="reward-page-controls" style={styles.pageControls}>
          <Pressable {...focus.props("previous-reward")} accessibilityRole="button" accessibilityLabel={t("Xem thẻ thú nuôi")} accessibilityState={{ disabled: page === 0 || reveal.busy }} disabled={page === 0 || reveal.busy} onPress={() => goToPage(0)} style={[styles.pageButton, page === 0 && styles.inactiveButton, focus.style("previous-reward", true)]}>
            <Ionicons name="chevron-back" color={COLORS.white} size={LAYOUT.smallIcon} />
          </Pressable>
          <View style={styles.dots} accessible accessibilityLabel={t(page === 0 ? "Thẻ thú nuôi, phần thưởng 1 trên 2" : "Quà đi kèm, phần thưởng 2 trên 2")} accessibilityLiveRegion="polite">
            {[0, 1].map((index) => <View key={index} style={[styles.dot, index === page && styles.activeDot]} />)}
          </View>
          <Pressable {...focus.props("next-reward")} accessibilityRole="button" accessibilityLabel={t("Xem quà đi kèm")} accessibilityState={{ disabled: page === 1 || reveal.busy }} disabled={page === 1 || reveal.busy} onPress={() => goToPage(1)} style={[styles.pageButton, page === 1 && styles.inactiveButton, focus.style("next-reward", true)]}>
            <Ionicons name="chevron-forward" color={COLORS.white} size={LAYOUT.smallIcon} />
          </Pressable>
        </View>
      ) : null}
      <Animated.View pointerEvents="none" style={[styles.hint, { opacity: reveal.pulse.interpolate({ inputRange: [0, 1], outputRange: [0.72, 1] }) }]}>
        <Text style={styles.hintText}>{t("Chạm ra ngoài thẻ để đóng")}</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlayContent: { alignItems: "center", justifyContent: "center", gap: SPACING.md },
  openCard: { flex: 1, borderRadius: RADIUS.lg },
  halo: { position: "absolute", inset: -SPACING.hero, zIndex: 0 },
  peek: { position: "absolute", top: SPACING.md, right: -SPACING.md, width: "100%", backgroundColor: COLORS.sunTint, borderColor: COLORS.sunshine, borderWidth: 2, borderRadius: RADIUS.lg, transform: [{ rotate: "6deg" }], alignItems: "flex-end", justifyContent: "flex-start", padding: SPACING.sm },
  errorPanel: { borderRadius: RADIUS.md, padding: SPACING.compact, gap: SPACING.sm, backgroundColor: COLORS.surface },
  errorText: { ...TYPE.subhead, color: COLORS.danger, textAlign: "center" },
  pageControls: { flexDirection: "row", alignItems: "center", gap: SPACING.sm },
  pageButton: { width: LAYOUT.touch, height: LAYOUT.touch, alignItems: "center", justifyContent: "center", borderRadius: RADIUS.pill },
  inactiveButton: { opacity: INTERACTION.disabledOpacity },
  dots: { flexDirection: "row", gap: SPACING.sm, alignItems: "center" },
  dot: { width: SPACING.xs, height: SPACING.xs, borderRadius: RADIUS.pill, backgroundColor: COLORS.rewardSilver },
  activeDot: { width: SPACING.sm, height: SPACING.sm, backgroundColor: COLORS.white },
  hint: { paddingHorizontal: SPACING.page, paddingBottom: SPACING.sm },
  hintText: { ...TYPE.caption, color: COLORS.rewardSilverTint, textAlign: "center" },
});
