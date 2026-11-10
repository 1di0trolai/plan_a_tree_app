/** Hiển thị hộp thoại tăng sao, chọn thú làm nguyên liệu và số tài nguyên cần dùng hoặc được hoàn. */

import { useI18n } from "@/i18n";
import { getLocaleTag } from "@/i18n/core";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useRef, useState, type ComponentRef, type ReactNode } from "react";
import { AccessibilityInfo, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { CurrencyArtwork } from "@/components/CurrencyArtwork";
import { FoodArtwork } from "@/components/FoodArtwork";
import { PetArtwork } from "@/components/PetArtwork";
import { JourneyButton } from "@/components/journeyUI";
import { PET_STAR_UPGRADES, PET_UPGRADE_FOOD_IDS } from "@/data/petProgression";
import { useControlFocus } from "@/hooks/useControlFocus";
import { getEligibleUpgradeMaterials, quoteMaterialRefund } from "@/store/petCollection";
import type { PetTransactionInput } from "@/store/petActions";
import { COLORS, INTERACTION, LAYOUT, RADIUS, SPACING, TYPE } from "@/theme";
import type { AppState, InventoryItem, PetView } from "@/types/app";
import { PetStarsRow, PetTransactionRecovery, type PetFeedback } from "./PetProgressionPanel";

/** Shared native-modal content: one bounded scroll body and an always-reachable action. */
export function PetDialog({ title, busy, onClose, footer, children }: {
  title: string; busy: boolean; onClose: () => void; footer: ReactNode; children: ReactNode;
}) {
  const { t } = useI18n();
  const focus = useControlFocus();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const titleRef = useRef<ComponentRef<typeof Text>>(null);
  const focused = useRef(false);
  const close = () => { if (!busy) onClose(); };
  return <SafeAreaView testID="pet-action-overlay" style={styles.overlay} edges={["top", "bottom"]}>
    <Pressable testID="pet-action-backdrop" accessibilityRole="button" accessibilityLabel={t("Đóng thao tác thú nuôi")} disabled={busy} onPress={close} style={styles.backdrop} />
    <View testID="pet-action-dialog" accessibilityViewIsModal onAccessibilityEscape={close} style={[styles.dialog, { width: Math.min(LAYOUT.formMaxWidth, width - SPACING.page * 2), maxHeight: Math.max(LAYOUT.artwork, height - insets.top - insets.bottom - SPACING.xl) }]}>
      <View style={styles.header}><Text ref={titleRef} accessible accessibilityRole="header" onLayout={() => { if (titleRef.current && !focused.current) { focused.current = true; AccessibilityInfo.sendAccessibilityEvent(titleRef.current, "focus"); } }} style={styles.title}>{title}</Text><Pressable {...focus.props("close-pet-action")} accessibilityRole="button" accessibilityLabel={t("Đóng thao tác")} disabled={busy} accessibilityState={{ disabled: busy }} onPress={close} style={({ pressed }) => [styles.iconButton, busy && styles.disabled, pressed && styles.pressed, focus.style("close-pet-action")]}><Ionicons name="close" size={LAYOUT.icon} color={COLORS.textMuted} /></Pressable></View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.body} automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator>{children}</ScrollView>
      <View style={styles.footer}>{footer}</View>
    </View>
  </SafeAreaView>;
}

export function PetActionPopup({ pet, pets, state, busy, blocked, pending, feedback, onClose, onRetry, onUpgrade }: {
  pet: PetView; pets: PetView[]; state: AppState; busy: boolean; blocked: boolean;
  pending: PetTransactionInput | null; feedback: PetFeedback | null; onClose: () => void; onRetry: () => void;
  onUpgrade: (ids: string[]) => void;
}) {
  const { t } = useI18n();
  const focus = useControlFocus();
  // Snapshot pets are supplied by the opener, so retries retain the exact original material IDs.
  const eligibleIds = new Set(getEligibleUpgradeMaterials(pets, pet.id).map((entry) => entry.id));
  const candidates = pets.filter((entry) => eligibleIds.has(entry.id));
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const next = pet.stars === 1 ? 2 : 3;
  const cost = PET_STAR_UPGRADES[next];
  const materialRefund = quoteMaterialRefund(candidates.filter((entry) => selectedIds.includes(entry.id))).foods;
  const missing = [
    ...(pet.level < cost.minLevel ? [`cấp ${cost.minLevel}`] : []),
    ...(state.economy.gold < cost.gold ? ["vàng"] : []),
    ...(PET_UPGRADE_FOOD_IDS.some((id) => (state.inventory.items.find((item) => item.id === id)?.quantity ?? 0) < cost.foodQuantity) ? ["thức ăn"] : []),
  ];
  const valid = pet.stars < 3 && !missing.length && selectedIds.length === cost.copies;
  const missingSupplies = missing.filter((entry) => !entry.startsWith("cấp "));
  return <PetDialog title={t("Tăng sao")} busy={busy} onClose={onClose} footer={<>
    {!pending && feedback && !feedback.ok ? <Text accessibilityRole="alert" style={[styles.caption, styles.error]}>{t(feedback.message)}</Text> : null}
    <PetTransactionRecovery pending={pending} busy={busy} onRetry={onRetry} />
    {!pending && pet.stars < 3 ? <JourneyButton testID="upgrade-pet" title={t("Tăng lên {count} sao", { count: next })} size="sm" loading={busy} disabled={blocked || !valid} onPress={() => onUpgrade([...selectedIds])} /> : null}
  </>}>
    <View style={styles.identity}><PetArtwork petId={pet.speciesId} stars={pet.stars} size={LAYOUT.touch} /><View style={styles.identityCopy}><Text style={styles.label}>{t(pet.name)}</Text><View style={styles.identityMeta}><PetStarsRow stars={pet.stars} small /><Text style={styles.caption}>{t("Cấp {level}", { level: pet.level })}</Text></View></View></View>
    {pet.stars < 3 ? <>
      <View style={styles.requirements}>
        <View testID="pet-upgrade-level" accessible accessibilityLabel={t("Cấp hiện tại {level}, yêu cầu {required}", { level: pet.level, required: cost.minLevel })} style={styles.requirement}><Ionicons name="trending-up" size={LAYOUT.smallIcon} color={COLORS.primary} /><Text style={[styles.caption, pet.level < cost.minLevel && styles.error]}>{pet.level}/{cost.minLevel}</Text></View>
        <View testID="pet-upgrade-gold" accessible accessibilityLabel={t("Có {count} vàng, cần {required}", { count: state.economy.gold, required: cost.gold })} style={styles.requirement}><CurrencyArtwork currency="gold" /><Text style={[styles.caption, state.economy.gold < cost.gold && styles.error]}>{state.economy.gold.toLocaleString(getLocaleTag())}/{cost.gold}</Text></View>
      </View>
      <View style={styles.foodGrid}>{PET_UPGRADE_FOOD_IDS.map((id) => {
        const item = state.inventory.items.find((entry) => entry.id === id);
        return <View key={id} accessible accessibilityLabel={t("{name}, có {count}, cần {required}", { name: t(item?.name ?? id), count: item?.quantity ?? 0, required: cost.foodQuantity })} style={styles.foodCell}><FoodArtwork itemId={id} size={LAYOUT.largeIcon} /><Text style={[styles.caption, (item?.quantity ?? 0) < cost.foodQuantity && styles.error]}>{item?.quantity ?? 0}/{cost.foodQuantity}</Text></View>;
      })}</View>
      <Text style={styles.label}>{t("Chọn {count} thú nuôi nguyên liệu", { count: cost.copies })}</Text>
      <View testID="pet-material-grid" style={styles.petGrid}>{candidates.map((entry, index) => {
        const checked = selectedIds.includes(entry.id);
        const disabled = blocked || (!checked && selectedIds.length >= cost.copies);
        return <Pressable key={entry.id} {...focus.props(`choose-${entry.id}`)} testID={`choose-pet-${entry.id}`} accessibilityRole="checkbox" accessibilityLabel={t("Thú nuôi {index}, {name}, {stars} sao, cấp {level}", { index: index + 1, name: t(entry.name), stars: entry.stars, level: entry.level })} accessibilityState={{ checked, disabled }} disabled={disabled} onPress={() => { if (!blocked) setSelectedIds((ids) => ids.includes(entry.id) ? ids.filter((id) => id !== entry.id) : ids.length < cost.copies ? [...ids, entry.id] : ids); }} style={({ pressed }) => [styles.petOption, checked && styles.selected, disabled && !checked && styles.disabled, pressed && styles.pressed, focus.style(`choose-${entry.id}`)]}><View style={styles.choiceTop}><Ionicons name={checked ? "checkbox" : "square-outline"} size={LAYOUT.smallIcon} color={COLORS.primary} /><Text testID={`material-pet-level-${entry.id}`} style={styles.levelBadge}>{entry.level}</Text></View><PetArtwork petId={entry.speciesId} stars={entry.stars} size={LAYOUT.touch} /><PetStarsRow stars={entry.stars} small /></Pressable>;
      })}</View>
      {!candidates.length ? <Text style={styles.caption}>{t("Chưa có thú nuôi nguyên liệu.")}</Text> : null}
      {Object.keys(materialRefund).length ? <View style={styles.refundSection}><Text style={styles.label}>{t("Hoàn thức ăn")}</Text><FoodRefund foods={materialRefund} items={state.inventory.items} /></View> : null}
      {missingSupplies.length && !pending ? <Text testID="pet-upgrade-missing" style={[styles.caption, styles.error]}>{t("Thiếu {items}.", { items: missingSupplies.map((value) => t(value)).join(", ") })}</Text> : null}
    </> : <Text testID="pet-max-stars" style={styles.label}>{t("Đã đạt tối đa 3 sao")}</Text>}
  </PetDialog>;
}

export function FoodRefund({ foods, items }: { foods: Record<string, number>; items: InventoryItem[] }) {
  const { t } = useI18n();
  const entries = Object.entries(foods).filter(([, quantity]) => quantity > 0);
  return entries.length ? <View testID="pet-food-refund" style={styles.refunds}>{entries.map(([id, quantity]) => <View key={id} accessible accessibilityLabel={t("{name}, hoàn {count}", { name: t(items.find((item) => item.id === id)?.name ?? id), count: quantity })} style={styles.refundRow}><FoodArtwork itemId={id} size={LAYOUT.largeIcon} /><Text style={styles.caption}>×{quantity}</Text></View>)}</View> : null;
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFill, justifyContent: "center", alignItems: "center", padding: SPACING.page }, backdrop: { ...StyleSheet.absoluteFill, backgroundColor: COLORS.overlay },
  dialog: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderCurve: "continuous", overflow: "hidden" }, header: { flexDirection: "row", alignItems: "center", paddingHorizontal: SPACING.md, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: COLORS.border, flexShrink: 0 },
  title: { ...TYPE.headline, flex: 1 }, label: { ...TYPE.label }, caption: { ...TYPE.subhead }, error: { color: COLORS.danger },
  scroll: { flexShrink: 1 }, body: { gap: SPACING.compact, padding: SPACING.md }, footer: { padding: SPACING.md, gap: SPACING.sm, borderTopWidth: StyleSheet.hairlineWidth, borderColor: COLORS.border, flexShrink: 0 },
  identity: { flexDirection: "row", alignItems: "center", gap: SPACING.sm }, identityCopy: { flex: 1 }, identityMeta: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: SPACING.sm }, iconButton: { width: LAYOUT.touch, minHeight: LAYOUT.touch, alignItems: "center", justifyContent: "center", borderRadius: RADIUS.sm },
  requirements: { flexDirection: "row", flexWrap: "wrap", gap: SPACING.md }, requirement: { flexDirection: "row", alignItems: "center", gap: SPACING.xs },
  foodGrid: { flexDirection: "row", flexWrap: "wrap", gap: SPACING.sm }, foodCell: { width: "30%", minWidth: LAYOUT.touch, alignItems: "center", gap: SPACING.xs },
  petGrid: { flexDirection: "row", flexWrap: "wrap", gap: SPACING.sm }, petOption: { width: "30%", minWidth: LAYOUT.touch, minHeight: LAYOUT.touch, padding: SPACING.xs, alignItems: "center", gap: SPACING.xs, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md, borderCurve: "continuous" }, selected: { backgroundColor: COLORS.sage, borderColor: COLORS.primary }, choiceTop: { alignSelf: "stretch", flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, levelBadge: { ...TYPE.caption, color: COLORS.text, textAlign: "right" },
  refundSection: { gap: SPACING.xs }, refunds: { flexDirection: "row", flexWrap: "wrap", gap: SPACING.compact }, refundRow: { flexDirection: "row", alignItems: "center", gap: SPACING.xs }, pressed: { opacity: INTERACTION.primaryPressedOpacity }, disabled: { opacity: INTERACTION.disabledOpacity },
});
