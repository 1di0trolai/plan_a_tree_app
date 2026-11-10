/** Hiển thị hộp quà đăng nhập nổi có thể kéo và tự bám cạnh màn hình, kèm số quà đang chờ nhận. */

import { useI18n } from "@/i18n";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Animated, PanResponder, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useControlFocus } from "@/hooks/useControlFocus";
import { COLORS, INTERACTION, LAYOUT, MOTION, RADIUS, SHADOWS, SPACING, TYPE } from "@/theme";
import { nearestGiftDock, pointForGiftDock, type GiftDock } from "./giftDock";
import { ShakingGift } from "./ShakingGift";
import { useRewardMotion } from "./useRewardMotion";

export function FloatingDailyGift({ dock, count, onDock, onOpen, motionEnabled = true }: {
  dock: GiftDock | null; count: number; onDock: (value: GiftDock) => void; onOpen: () => void; motionEnabled?: boolean;
}) {
  const { t } = useI18n();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const focus = useControlFocus();
  const animate = useRewardMotion(motionEnabled);
  const size = LAYOUT.thumbnail;
  const bounds = useMemo(() => ({
    left: insets.left + SPACING.sm,
    right: Math.max(insets.left + SPACING.sm, width - insets.right - size - SPACING.sm),
    top: insets.top + SPACING.sm,
    bottom: Math.max(insets.top + SPACING.sm, height - insets.bottom - LAYOUT.control - SPACING.lg - size - SPACING.sm),
  }), [height, insets.bottom, insets.left, insets.right, insets.top, size, width]);
  const target = useMemo(() => pointForGiftDock(dock, bounds), [dock, bounds]);
  const [position] = useState(() => new Animated.ValueXY(target));
  const current = useRef(target);
  const origin = useRef(target);
  const suppressPressUntil = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [focused, setFocused] = useState(false);
  useEffect(() => { current.current = target; position.setValue(target); }, [position, target]);
  const settle = useCallback((x: number, y: number) => {
    const next = nearestGiftDock({ x, y }, bounds);
    current.current = next.point;
    if (animate) Animated.spring(position, { toValue: next.point, damping: 24, stiffness: 240, mass: 1, useNativeDriver: false }).start();
    else position.setValue(next.point);
    onDock(next.dock);
    setDragging(false);
    suppressPressUntil.current = Date.now() + MOTION.base;
  }, [animate, bounds, onDock, position]);
  const beginDrag = useCallback(() => { position.stopAnimation(); origin.current = current.current; setDragging(true); }, [position]);
  const drag = useCallback((_event: unknown, gesture: { dx: number; dy: number }) => {
    const next = { x: Math.max(bounds.left, Math.min(bounds.right, origin.current.x + gesture.dx)), y: Math.max(bounds.top, Math.min(bounds.bottom, origin.current.y + gesture.dy)) };
    current.current = next; position.setValue(next);
  }, [bounds, position]);
  const release = useCallback((_event: unknown, gesture: { dx: number; dy: number }) => settle(origin.current.x + gesture.dx, origin.current.y + gesture.dy), [settle]);
  const terminate = useCallback(() => settle(current.current.x, current.current.y), [settle]);
  // PanResponder stores these callbacks; it does not invoke them during construction.
  // eslint-disable-next-line react-hooks/refs
  const responder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => Math.hypot(gesture.dx, gesture.dy) >= SPACING.sm,
    onPanResponderGrant: beginDrag,
    onPanResponderMove: drag,
    onPanResponderRelease: release,
    onPanResponderTerminate: terminate,
    onPanResponderTerminationRequest: () => false,
  }), [beginDrag, drag, release, terminate]);
  const moveTo = (edge: GiftDock["edge"]) => onDock({ edge, ratio: 0.5 });
  const showMoveMenu = () => Alert.alert(t("Vị trí hộp quà"), t("Chọn cạnh màn hình"), [
    { text: t("Trái"), onPress: () => moveTo("left") }, { text: t("Phải"), onPress: () => moveTo("right") },
    { text: t("Trên / dưới"), onPress: () => Alert.alert(t("Vị trí hộp quà"), "", [{ text: t("Trên"), onPress: () => moveTo("top") }, { text: t("Dưới"), onPress: () => moveTo("bottom") }, { text: t("Hủy"), style: "cancel" }]) },
  ]);
  return (
    <Animated.View {...responder.panHandlers} style={[styles.floating, { transform: position.getTranslateTransform() }]}>
      <Pressable
        {...focus.props("daily-gift-entry")}
        testID="daily-gift-entry"
        accessibilityRole="button"
        accessibilityLabel={t("Quà ghé vườn, {count} hộp có thể nhận", { count })}
        accessibilityHint={t("Chạm để xem quà. Có thể kéo hộp quà hoặc dùng thao tác di chuyển.")}
        accessibilityActions={[
          { name: "moveLeft", label: t("Đưa quà về cạnh trái") }, { name: "moveRight", label: t("Đưa quà về cạnh phải") },
          { name: "moveTop", label: t("Đưa quà lên cạnh trên") }, { name: "moveBottom", label: t("Đưa quà xuống cạnh dưới") },
        ]}
        onAccessibilityAction={(event) => {
          const edge = { moveLeft: "left", moveRight: "right", moveTop: "top", moveBottom: "bottom" }[event.nativeEvent.actionName] as GiftDock["edge"] | undefined;
          if (edge) moveTo(edge);
        }}
        onFocus={() => { focus.props("daily-gift-entry").onFocus(); setFocused(true); }}
        onBlur={() => { focus.props("daily-gift-entry").onBlur(); setFocused(false); }}
        onPress={() => { if (Date.now() >= suppressPressUntil.current) onOpen(); }}
        onLongPress={showMoveMenu}
        style={({ pressed }) => [styles.entry, pressed && { opacity: INTERACTION.primaryPressedOpacity }, focus.style("daily-gift-entry")]}
      >
        <ShakingGift size={LAYOUT.touch} eligible={count > 0 && !dragging && !focused} motionEnabled={motionEnabled} />
        <View style={styles.badge}><Text style={styles.badgeText}>{count}</Text></View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  floating: { position: "absolute", top: 0, left: 0, zIndex: 10 },
  entry: { width: LAYOUT.thumbnail, height: LAYOUT.thumbnail, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderCurve: "continuous", borderWidth: 1, borderColor: COLORS.sunshine, ...SHADOWS.floating },
  badge: { position: "absolute", right: 0, top: 0, minWidth: SPACING.lg, minHeight: SPACING.lg, alignItems: "center", justifyContent: "center", paddingHorizontal: SPACING.xs, borderRadius: RADIUS.pill, backgroundColor: COLORS.primaryDark },
  badgeText: { ...TYPE.caption, fontWeight: "700", color: COLORS.onPrimary },
});
