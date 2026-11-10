/** Hiển thị hộp thoại bán thú đã chọn hoặc bán nhanh theo độ hiếm, kèm giá trị hoàn trả trước xác nhận. */

import { useI18n } from "@/i18n";
import { getLocaleTag } from "@/i18n/core";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { CurrencyArtwork } from "@/components/CurrencyArtwork";
import { PetArtwork } from "@/components/PetArtwork";
import { JourneyButton } from "@/components/journeyUI";
import { useControlFocus } from "@/hooks/useControlFocus";
import { getQuickSalePetIds, quoteSale } from "@/store/petCollection";
import type { PetTransactionInput } from "@/store/petActions";
import { COLORS, INTERACTION, LAYOUT, RADIUS, SPACING, TYPE } from "@/theme";
import type { AppState, PetRarity, PetView } from "@/types/app";
import { FoodRefund, PetDialog } from "./PetActionPopup";
import { PetStarsRow, PetTransactionRecovery, type PetFeedback, type Refund } from "./PetProgressionPanel";

const RARITIES: PetRarity[] = ["Thường", "Không phổ biến", "Hiếm", "Sử thi", "Huyền thoại"];

export function PetSalePopup({ mode, petIds, pets, state, rarities, busy, blocked, pending, feedback, onRarities, onClose, onRetry, onSell }: {
  mode: "selected" | "quick"; petIds: string[]; pets: PetView[]; state: AppState; rarities: PetRarity[];
  busy: boolean; blocked: boolean; pending: PetTransactionInput | null; feedback: PetFeedback | null;
  onRarities: (values: PetRarity[]) => void; onClose: () => void; onRetry: () => void;
  onSell: (ids: string[], refund: Refund) => void;
}) {
  const { t } = useI18n();
  const focus = useControlFocus();
  const ids = mode === "quick" ? getQuickSalePetIds(pets, rarities) : petIds;
  const chosen = pets.filter((pet) => ids.includes(pet.id));
  const speciesCounts = new Map<string, number>();
  const selectedCounts = new Map<string, number>();
  for (const pet of pets) speciesCounts.set(pet.speciesId, (speciesCounts.get(pet.speciesId) ?? 0) + 1);
  for (const pet of chosen) selectedCounts.set(pet.speciesId, (selectedCounts.get(pet.speciesId) ?? 0) + 1);
  const includesLast = [...selectedCounts].some(([species, count]) => count >= (speciesCounts.get(species) ?? 0));
  let quote: Refund = { gold: 0, foods: {} };
  let error = "";
  try { if (ids.length) quote = quoteSale({ inventory: { ...state.inventory, pets } }, ids); }
  catch (reason) { error = reason instanceof Error ? reason.message : "Thú nuôi đã thay đổi. Hãy chọn lại."; }
  if (includesLast) error = "Không thể bán thú nuôi cuối cùng của một loài.";
  const valid = ids.length > 0 && !error;
  return <PetDialog title={mode === "quick" ? t("Bán nhanh") : t("Bán {count} thú nuôi", { count: chosen.length })} busy={busy} onClose={onClose} footer={<>
    {!pending && feedback && !feedback.ok ? <Text accessibilityRole="alert" style={styles.error}>{t(feedback.message)}</Text> : null}
    <PetTransactionRecovery pending={pending} busy={busy} onRetry={onRetry} />
    {!pending ? mode === "quick" ? <Pressable {...focus.props("confirm-quick-sale")} testID="sell-pet-copy" accessibilityRole="button" accessibilityLabel={[t("Bán {count} thú nuôi, nhận {gold} vàng", { count: chosen.length, gold: quote.gold }), ...Object.entries(quote.foods).filter(([, quantity]) => quantity > 0).map(([id, quantity]) => t("hoàn {count} {name}", { count: quantity, name: t(state.inventory.items.find((item) => item.id === id)?.name ?? id) }))].join(", ")} accessibilityState={{ disabled: blocked || !valid, busy }} disabled={blocked || !valid} onPress={() => { if (valid) onSell([...ids], quote); }} style={({ pressed }) => [styles.quickConfirm, (blocked || !valid) && styles.disabled, pressed && styles.pressed, focus.style("confirm-quick-sale")]}><View testID="quick-sale-button-content" style={styles.quickContent}><Text style={styles.confirmLabel}>{busy ? t("Đang bán…") : t("Bán {count} thú nuôi", { count: chosen.length })}</Text><View testID="quick-sale-button-amount" accessible={false} style={styles.quickAmount}><CurrencyArtwork currency="gold" /><Text style={styles.confirmLabel}>{quote.gold.toLocaleString(getLocaleTag())}</Text></View></View></Pressable> : <JourneyButton testID="sell-pet-copy" title={t("Bán")} variant="destructive" size="sm" loading={busy} disabled={blocked || !valid} onPress={() => { if (valid) onSell([...ids], quote); }} /> : null}
  </>}>
    {mode === "quick" ? <View testID="quick-sale-rarities" style={styles.filters}>{RARITIES.map((rarity) => {
      const checked = rarities.includes(rarity);
      return <Pressable key={rarity} {...focus.props(`quick-${rarity}`)} testID={`quick-sale-${rarity}`} accessibilityRole="checkbox" accessibilityLabel={t("Bán nhanh thú nuôi {rarity}", { rarity: t(rarity) })} accessibilityState={{ checked, disabled: blocked }} disabled={blocked} onPress={() => onRarities(checked ? rarities.filter((value) => value !== rarity) : [...rarities, rarity])} style={({ pressed }) => [styles.filter, checked && styles.checked, blocked && styles.disabled, pressed && styles.pressed, focus.style(`quick-${rarity}`)]}><Ionicons name={checked ? "checkbox" : "square-outline"} color={COLORS.primary} size={LAYOUT.smallIcon} /><Text style={styles.label}>{t(rarity)}</Text></Pressable>;
    })}</View> : null}
    {mode === "selected" && chosen.length ? <View testID="sale-selected-pets" style={styles.pets}>{chosen.map((pet) => <View key={pet.id} testID={`sale-pet-${pet.id}`} accessible accessibilityLabel={t("{name}, {stars} sao, cấp {level}", { name: t(pet.name), stars: pet.stars, level: pet.level })} style={styles.pet}><View style={styles.petTop}><Text testID={`sale-pet-level-${pet.id}`} style={styles.levelBadge}>{pet.level}</Text></View><PetArtwork petId={pet.speciesId} stars={pet.stars} size={LAYOUT.touch} /><PetStarsRow stars={pet.stars} small /></View>)}</View> : !chosen.length ? <Text style={styles.caption}>{t("Chưa có thú nuôi phù hợp.")}</Text> : null}
    {error ? <Text testID="pet-sale-invalid" accessibilityRole="alert" style={styles.error}>{t(error)}</Text> : null}
    {mode === "selected" && chosen.length ? <View testID="pet-sale-summary" style={styles.refund}>
      <View testID="pet-sale-total" accessible accessibilityLabel={t("Nhận {count} vàng", { count: quote.gold })} style={styles.gold}><CurrencyArtwork currency="gold" /><Text style={styles.label}>{quote.gold.toLocaleString(getLocaleTag())}</Text></View>
      <FoodRefund foods={quote.foods} items={state.inventory.items} />
    </View> : null}
  </PetDialog>;
}

const styles = StyleSheet.create({
  filters: { flexDirection: "row", flexWrap: "wrap", gap: SPACING.sm }, filter: { flexDirection: "row", alignItems: "center", gap: SPACING.sm, minHeight: LAYOUT.touch, paddingHorizontal: SPACING.sm, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: COLORS.border }, checked: { backgroundColor: COLORS.sage, borderColor: COLORS.primary },
  label: { ...TYPE.label }, caption: { ...TYPE.caption }, error: { ...TYPE.subhead, color: COLORS.danger },
  quickConfirm: { alignSelf: "stretch", minHeight: LAYOUT.control, paddingVertical: SPACING.compact, paddingHorizontal: SPACING.sm, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.danger, borderRadius: RADIUS.md, borderCurve: "continuous" }, quickContent: { alignSelf: "stretch", flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: SPACING.sm }, quickAmount: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: SPACING.xs }, confirmLabel: { ...TYPE.label, includeFontPadding: false, textAlign: "center", color: COLORS.onPrimary },
  pets: { flexDirection: "row", flexWrap: "wrap", gap: SPACING.sm }, pet: { alignItems: "center", minWidth: LAYOUT.touch, padding: SPACING.xs, gap: SPACING.xs, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.sm }, petTop: { alignSelf: "stretch", alignItems: "flex-end" }, levelBadge: { ...TYPE.caption, color: COLORS.text, textAlign: "right" },
  refund: { gap: SPACING.sm, borderTopWidth: StyleSheet.hairlineWidth, borderColor: COLORS.border, paddingTop: SPACING.compact }, gold: { flexDirection: "row", alignItems: "center", gap: SPACING.xs }, pressed: { opacity: INTERACTION.primaryPressedOpacity }, disabled: { opacity: INTERACTION.disabledOpacity },
});
