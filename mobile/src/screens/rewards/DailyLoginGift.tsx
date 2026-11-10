/** Hiển thị chu kỳ quà đăng nhập bảy ngày, trạng thái từng hộp quà và kết quả nhận thưởng. */

import { useI18n } from "@/i18n";
import Ionicons from "@expo/vector-icons/Ionicons";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FoodArtwork } from "@/components/FoodArtwork";
import { useControlFocus } from "@/hooks/useControlFocus";
import { COLORS, INTERACTION, LAYOUT, RADIUS, SHADOWS, SPACING, TYPE } from "@/theme";
import type { InventoryItem, LoginRewardClaim } from "@/types/app";
import type { DailyLoginGiftModel } from "./dailyLoginGiftModel";
import { ShakingGift } from "./ShakingGift";
import { FoodLoginReveal } from "./FoodLoginReveal";

interface Props {
  gift: DailyLoginGiftModel;
  items: InventoryItem[];
  visible: boolean;
  pending: boolean;
  pendingGiftId: string | null;
  received: LoginRewardClaim | null;
  error: { message: string; retryable: boolean; giftId?: string } | null;
  motionEnabled?: boolean;
  onClose: () => void;
  onClaim: (giftId: string) => void;
  onRetry: () => void;
}

export function DailyLoginGift({ gift, items, visible, pending, pendingGiftId, received, error, motionEnabled = true, onClose, onClaim, onRetry }: Props) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const focus = useControlFocus();
  const { width, fontScale } = useWindowDimensions();
  const compactColumns = width < 350 || fontScale >= 1.4;
  const food = received ? items.find((item) => item.id === received.itemId) : null;
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      {food ? <FoodLoginReveal key={`${received!.date}-${received!.itemId}`} item={food} motionEnabled={motionEnabled} onClose={onClose} /> : (
        <View style={[styles.scrim, { paddingTop: insets.top + SPACING.md, paddingBottom: insets.bottom + SPACING.md }]}>
          <Pressable testID="daily-gift-backdrop" accessibilityRole="button" accessibilityLabel={t("Đóng quà đăng nhập")} onPress={onClose} style={StyleSheet.absoluteFill} />
          <View testID="daily-gift-sheet" accessibilityViewIsModal onAccessibilityEscape={onClose} style={styles.sheet}>
            <View style={styles.heading}>
              <View style={styles.flex}>
                <Text accessibilityRole="header" style={TYPE.title}>{t("Quà ghé vườn")}</Text>
                <Text style={TYPE.subhead}>{t("Ngày {day} / 7", { day: gift.cycleDay })}</Text>
              </View>
              <Pressable {...focus.props("daily-gift-close")} accessibilityRole="button" accessibilityLabel={t("Đóng quà đăng nhập")} onPress={onClose} style={({ pressed }) => [styles.close, pressed && { backgroundColor: COLORS.pressed }, focus.style("daily-gift-close")]}>
                <Ionicons name="close" size={LAYOUT.icon} color={COLORS.textMuted} accessible={false} />
              </Pressable>
            </View>
            <ScrollView style={styles.scrollBody} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
              <View style={styles.days}>
                {gift.days.map((day) => {
                  const item = items.find((entry) => entry.id === day.itemId);
                  const claimed = day.status === "claimed";
                  const available = day.status === "available";
                  const loading = pending && pendingGiftId === day.giftId;
                  return (
                    <Pressable
                      {...focus.props(`day-${day.day}`)}
                      key={day.day}
                      testID={`daily-gift-day-${day.day}`}
                      accessibilityRole={available ? "button" : "text"}
                      accessibilityLabel={`${t("Ngày {day}", { day: day.day })}, ${claimed ? t("đã nhận {name}", { name: t(item?.name ?? "thức ăn") }) : t(available ? "có thể nhận, chạm hộp quà để mở" : "chưa mở")}${day.improved ? `, ${t("quà đặc biệt")}` : ""}`}
                      accessibilityState={{ disabled: !available || pending, busy: loading }}
                      disabled={!available || pending}
                      onPress={() => { if (available && day.giftId && !pending) onClaim(day.giftId); }}
                      style={({ pressed }) => [styles.day, { width: compactColumns ? "46%" : "30%" }, day.improved && styles.finalDay, available && styles.available, claimed && styles.claimed, pressed && { opacity: INTERACTION.primaryPressedOpacity }, focus.style(`day-${day.day}`)]}
                    >
                      <Text style={styles.dayLabel}>{t(day.improved ? "Ngày {day} · Đặc biệt" : "Ngày {day}", { day: day.day })}</Text>
                      <View style={styles.art}>
                        {loading ? <ActivityIndicator size="large" color={COLORS.primary} /> : claimed && day.itemId ? <FoodArtwork itemId={day.itemId} size={LAYOUT.thumbnail} /> : <ShakingGift size={LAYOUT.thumbnail} eligible={available && visible && !pending} motionEnabled={motionEnabled} />}
                      </View>
                      <View style={styles.status}>
                        {!available ? <Ionicons name={claimed ? "checkmark-circle" : "lock-closed-outline"} size={LAYOUT.badgeIcon} color={claimed ? COLORS.success : COLORS.textMuted} accessible={false} /> : null}
                        <Text style={[styles.statusText, available && styles.availableText]}>{t(loading ? "Đang mở…" : claimed ? "Đã nhận" : available ? "Có thể nhận" : "Chưa mở")}</Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
              {error ? <Text testID="daily-gift-error" accessibilityRole="alert" style={styles.error}>{t(error.message)}</Text> : null}
              {error?.retryable ? <Pressable {...focus.props("retry-gift")} testID="daily-gift-retry" accessibilityRole="button" accessibilityLabel={t("Thử lưu lại quà")} onPress={onRetry}
                style={({ pressed }) => [styles.close, { backgroundColor: COLORS.sage }, pressed && { opacity: INTERACTION.primaryPressedOpacity }, focus.style("retry-gift")]}
              ><Text style={TYPE.label}>{t("Thử lưu lại")}</Text></Pressable> : null}
            </ScrollView>
          </View>
        </View>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: SPACING.md, backgroundColor: COLORS.overlay },
  sheet: { width: "100%", maxWidth: LAYOUT.formMaxWidth, maxHeight: "100%", borderRadius: RADIUS.xl, borderCurve: "continuous", backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, ...SHADOWS.floating, overflow: "hidden" },
  heading: { flexDirection: "row", gap: SPACING.sm, alignItems: "center", padding: SPACING.md, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  flex: { flex: 1 },
  close: { minWidth: LAYOUT.touch, minHeight: LAYOUT.touch, alignItems: "center", justifyContent: "center", borderRadius: RADIUS.pill },
  content: { padding: SPACING.md, gap: SPACING.md },
  scrollBody: { flexGrow: 0, flexShrink: 1 },
  days: { flexDirection: "row", flexWrap: "wrap", gap: SPACING.sm, justifyContent: "space-between" },
  day: { flexGrow: 1, alignItems: "center", justifyContent: "center", gap: SPACING.sm, paddingHorizontal: SPACING.xs, paddingVertical: SPACING.compact, borderRadius: RADIUS.md, backgroundColor: COLORS.surfaceSoft, borderWidth: 1, borderColor: COLORS.border },
  art: { height: LAYOUT.thumbnail, justifyContent: "center", alignItems: "center" },
  available: { backgroundColor: COLORS.sage, borderColor: COLORS.primary, borderWidth: 2 },
  claimed: { backgroundColor: COLORS.surface },
  dayLabel: { ...TYPE.label, color: COLORS.text, textAlign: "center" },
  finalDay: { width: "100%", flexGrow: 1, backgroundColor: COLORS.ochreSoft },
  status: { flexDirection: "row", gap: SPACING.xs, alignItems: "center", justifyContent: "center", flexWrap: "wrap" },
  statusText: { ...TYPE.caption, textAlign: "center" },
  availableText: { color: COLORS.primaryDark, fontWeight: "700" },
  error: { ...TYPE.subhead, color: COLORS.danger },
});
