/** Hiển thị kho thú nuôi và vật phẩm; điều phối chọn thú, cho ăn, tăng sao và bán thú. */

import { useI18n } from "@/i18n";
import { getLocaleTag } from "@/i18n/core";
import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState, type ComponentRef } from "react";
import { AccessibilityInfo, BackHandler, FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CurrencyArtwork } from "@/components/CurrencyArtwork";
import { FoodArtwork } from "@/components/FoodArtwork";
import { PetArtwork } from "@/components/PetArtwork";
import { JourneyButton } from "@/components/journeyUI";
import { experienceForNextLevel } from "@/data/seed";
import { PET_CAPACITY } from "@/data/petProgression";
import { useControlFocus } from "@/hooks/useControlFocus";
import { PetActionPopup } from "@/screens/inventory/PetActionPopup";
import { PetSalePopup } from "@/screens/inventory/PetSalePopup";
import { PetProgressionPanel, PetStarsRow, PetTransactionRecovery, usePetProgression } from "@/screens/inventory/PetProgressionPanel";
import { useApp } from "@/store/AppStore";
import { getPetViews } from "@/store/petCollection";
import { COLORS, GRADIENTS, INTERACTION, LAYOUT, RADIUS, RARITY, SHADOWS, SPACING, TYPE } from "@/theme";
import type { InventoryItem, PetView } from "@/types/app";

type Tab = "pets" | "items";
type Selection = { kind: "pets"; id: string; snapshot: PetView } | { kind: "items"; id: string } | null;
type Action = { kind: "upgrade"; pet: PetView; pets: PetView[] } | { kind: "sell" | "quick-sell"; ids: string[]; pets: PetView[] } | null;
type Card = { id: string; name: string; rarity: string; pet?: PetView; item?: InventoryItem };

export function rarityPalette(rarity: string) {
  return rarity === "Huyền thoại" ? RARITY.Legendary : rarity === "Sử thi" ? RARITY.Epic
    : rarity === "Hiếm" ? RARITY.Rare : rarity === "Không phổ biến" ? RARITY.Uncommon : RARITY.Common;
}

export function rarityColor(rarity: string) {
  return rarityPalette(rarity).color;
}

/** Six across when 48dp targets fit; larger type receives a wider tile rather than clipped labels. */
export function inventoryPetColumns(width: number, fontScale: number) {
  const available = Math.min(LAYOUT.contentMaxWidth, width) - SPACING.page * 2;
  const minimum = fontScale >= 1.6 ? LAYOUT.thumbnail : LAYOUT.touch;
  return Math.max(1, Math.min(6, Math.floor((available + SPACING.sm) / (minimum + SPACING.sm))));
}

export default function InventoryScreen() {
  const { t } = useI18n();
  const { state, updateSetting } = useApp();
  const focus = useControlFocus();
  const { width, fontScale } = useWindowDimensions();
  const progression = usePetProgression();
  const [tab, setTab] = useState<Tab>("pets");
  const [selected, setSelected] = useState<Selection>(null);
  const [action, setAction] = useState<Action>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [saleIds, setSaleIds] = useState<string[]>([]);
  const [reducedMotion, setReducedMotion] = useState(true);
  const detailTitle = useRef<ComponentRef<typeof Text>>(null);
  const inventoryTitle = useRef<ComponentRef<typeof Text>>(null);
  const hadPopup = useRef(false);
  const routeFocused = useRef(true);
  useFocusEffect(useCallback(() => {
    routeFocused.current = true;
    return () => {
      routeFocused.current = false;
      hadPopup.current = false;
      setSelectionMode(false);
      setSaleIds([]);
      setAction(null);
      setSelected(null);
      // Only presentation state is cleared. Durable transaction recovery lives in the store.
    };
  }, []));
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => { if (active) setReducedMotion(enabled); }).catch(() => {});
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReducedMotion);
    return () => { active = false; subscription.remove(); };
  }, []);
  useEffect(() => {
    const restore = hadPopup.current && !action;
    hadPopup.current = Boolean(action);
    if (!restore || !routeFocused.current) return;
    const frame = requestAnimationFrame(() => { const target = selected ? detailTitle.current : inventoryTitle.current; if (target) AccessibilityInfo.sendAccessibilityEvent(target, "focus"); });
    return () => cancelAnimationFrame(frame);
  }, [action, selected]);
  useFocusEffect(useCallback(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!selectionMode) return false;
      setSelectionMode(false); setSaleIds([]); return true;
    });
    return () => { subscription.remove(); };
  }, [selectionMode]));
  const pets = getPetViews(state.inventory.pets);
  const stocked = state.inventory.items.filter((item) => item.quantity > 0);
  const pet = selected?.kind === "pets" ? pets.find((entry) => entry.id === selected.id) ?? selected.snapshot : undefined;
  const item = selected?.kind === "items" ? state.inventory.items.find((entry) => entry.id === selected.id) : undefined;
  const columns = tab === "pets" ? inventoryPetColumns(width, fontScale) : fontScale >= 1.6 ? 1 : 2;
  const tileWidth = (Math.min(width, LAYOUT.contentMaxWidth) - SPACING.page * 2 - SPACING.sm * (columns - 1)) / columns;
  const cards: Card[] = tab === "pets" ? pets.map((entry) => ({ id: entry.id, name: entry.name, rarity: entry.rarity, pet: entry }))
    : stocked.map((entry) => ({ id: entry.id, name: entry.name, rarity: entry.rarity, item: entry }));
  const visibleSaleIds = saleIds.filter((id) => pets.some((entry) => entry.id === id));
  const close = () => { if (progression.busy) return; if (action) setAction(null); else setSelected(null); };
  const visitShop = () => { if (progression.busy) return; setSelected(null); setSelectionMode(false); setSaleIds([]); router.push("/shop"); };
  const needed = pet ? experienceForNextLevel(pet.level) : 1;
  const finishSale = () => { setAction(null); setSaleIds([]); setSelectionMode(false); setSelected(null); };
  const retry = () => progression.retry(() => { if (action?.kind === "sell" || action?.kind === "quick-sell") finishSale(); else { setAction(null); if (selected?.kind === "pets" && !pets.some((entry) => entry.id === selected.id)) setSelected(null); } });
  const toggleSale = (id: string) => { if (!progression.blocked) setSaleIds((ids) => ids.includes(id) ? ids.filter((entry) => entry !== id) : [...ids, id]); };
  const beginSelection = (id?: string) => { if (progression.blocked) return; progression.clearFeedback(); setSelectionMode(true); if (id) setSaleIds((ids) => ids.includes(id) ? ids : [...ids, id]); };
  return <SafeAreaView style={styles.safe} edges={["top"]}>
    <FlatList key={`${tab}-${columns}`} data={cards} keyExtractor={(entry) => entry.id} numColumns={columns} columnWrapperStyle={columns > 1 ? tab === "pets" ? styles.petGridRow : styles.gridRow : undefined} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}
      ListHeaderComponent={<>
        <View style={styles.headerRow}><Text ref={inventoryTitle} accessible accessibilityRole="header" style={styles.title}>{t("Kho đồ")}</Text><Pressable {...focus.props("shop")} accessibilityRole="button" accessibilityLabel={t("Cửa hàng")} onPress={visitShop} style={({ pressed }) => [styles.shopLink, pressed && styles.pressed, focus.style("shop")]}><Ionicons name="storefront-outline" size={LAYOUT.smallIcon} color={COLORS.primaryDark} /><Text style={styles.link}>{t("Cửa hàng")}</Text></Pressable></View>
        <View style={styles.balance}><CurrencyArtwork currency="gold" /><Text style={styles.subtitle}>{t("{count} vàng", { count: state.economy.gold.toLocaleString(getLocaleTag()) })}</Text></View>
        <PetTransactionRecovery pending={progression.pending} busy={progression.busy} onRetry={retry} />
        {!selected && !action && progression.feedback && !progression.feedback.ok && !progression.pending ? <Text accessibilityRole="alert" style={styles.error}>{t(progression.feedback.message)}</Text> : null}
        <View style={styles.tabs} accessibilityRole="tablist">{([{ key: "pets", title: "Thú nuôi", count: `${pets.length}/${PET_CAPACITY}` }, { key: "items", title: "Vật phẩm", count: String(stocked.length) }] as const).map((option) => <Pressable key={option.key} {...focus.props(`tab-${option.key}`)} accessibilityRole="tab" accessibilityState={{ selected: tab === option.key }} onPress={() => { setTab(option.key); setSelectionMode(false); setSaleIds([]); }} style={({ pressed }) => [styles.tab, tab === option.key && styles.activeTab, pressed && styles.pressed, focus.style(`tab-${option.key}`)]}><Text style={styles.link}>{t(option.title)} · {option.count}</Text></Pressable>)}</View>
        {tab === "pets" && pets.length ? <View style={styles.selectionRow}><Text testID="pet-selection-count" accessibilityLiveRegion="polite" style={styles.subtitle}>{selectionMode ? t("Đã chọn {count}", { count: visibleSaleIds.length }) : t("Thú nuôi của bạn")}</Text><JourneyButton testID="inventory-select-pets" title={t(selectionMode ? "Hủy" : "Chọn")} secondary size="sm" disabled={progression.blocked} onPress={() => { if (selectionMode) { setSelectionMode(false); setSaleIds([]); } else beginSelection(); }} /></View> : null}
      </>}
      ListEmptyComponent={<View style={styles.empty}><Ionicons name={tab === "pets" ? "paw-outline" : "cube-outline"} size={LAYOUT.largeIcon} color={COLORS.primary} /><Text style={styles.detailName}>{t(tab === "pets" ? "Chưa có thú nuôi" : "Chưa có vật phẩm")}</Text><Text style={styles.subtitle}>{t(tab === "pets" ? "Thăm đủ cây trong ngày để nhận thẻ thú nuôi." : "Thức ăn đã nhận sẽ nằm ở đây.")}</Text></View>}
      renderItem={({ item: entry }) => {
        const checked = visibleSaleIds.includes(entry.id);
        const palette = rarityPalette(entry.rarity);
        return <Pressable {...focus.props(`card-${entry.id}`)} testID={`inventory-card-${entry.id}`} accessibilityRole={entry.pet && selectionMode ? "checkbox" : "button"} accessibilityLabel={entry.pet ? t("{name}, {rarity}, {stars} sao, cấp {level}", { name: t(entry.name), rarity: t(entry.rarity), stars: entry.pet.stars, level: entry.pet.level }) : t("{name}, {rarity}, còn {count}", { name: t(entry.name), rarity: t(entry.rarity), count: entry.item?.quantity ?? 0 })} accessibilityHint={entry.pet && !selectionMode ? t("Bấm xem chi tiết, giữ để chọn bán") : undefined} accessibilityState={entry.pet && selectionMode ? { checked, disabled: progression.blocked } : undefined} onLongPress={entry.pet ? () => beginSelection(entry.id) : undefined} onPress={() => { if (entry.pet && selectionMode) { toggleSale(entry.id); return; } progression.clearFeedback(); setAction(null); setSelected(entry.pet ? { kind: "pets", id: entry.id, snapshot: entry.pet } : { kind: "items", id: entry.id }); }} style={({ pressed }) => [entry.pet ? [styles.petTile, { width: tileWidth, borderColor: palette.accent, backgroundColor: palette.background }, checked && styles.checkedTile] : [styles.card, columns === 1 && styles.fullCard], pressed && styles.pressed, focus.style(`card-${entry.id}`)]}>
          {entry.pet ? <>
            <View style={styles.tileTop}><View style={styles.tileCheckbox}>{selectionMode ? <Ionicons name={checked ? "checkbox" : "square-outline"} size={LAYOUT.badgeIcon} color={COLORS.primary} /> : null}</View><Text testID={`pet-level-${entry.id}`} style={styles.levelBadge}>{entry.pet.level}</Text></View>
            <PetArtwork petId={entry.pet.speciesId} stars={entry.pet.stars} size={Math.min(LAYOUT.touch, tileWidth - SPACING.xs * 2)} />
            <View testID={`pet-stars-${entry.id}`} accessible={false} style={styles.tileStars}>{Array.from({ length: entry.pet.stars }, (_, index) => <Ionicons key={index} name="star" size={TYPE.caption.fontSize} color={COLORS.warning} />)}</View>
          </> : <><View testID={`food-rarity-stripe-${entry.id}`} style={[styles.rarityStripe, { backgroundColor: palette.accent }]} /><View testID={`food-rarity-art-${entry.id}`} style={[styles.cardArt, { backgroundColor: palette.background }]}><FoodArtwork itemId={entry.id} size={SPACING.xxl * 2} /></View><View style={styles.cardCopy}><Text style={styles.link}>{t(entry.name)}</Text><View style={[styles.rarityBadge, { backgroundColor: palette.background }]}><Text style={[styles.subtitle, { color: palette.color }]}>{t(entry.rarity)}</Text></View><Text style={styles.subtitle}>{t("Còn {count}", { count: entry.item?.quantity ?? 0 })}</Text></View></>}
        </Pressable>;
      }}
    />
    {tab === "pets" ? <View testID="inventory-sale-toolbar" style={styles.saleToolbar}><JourneyButton testID="inventory-quick-sale" title={t("Bán nhanh")} secondary size="sm" disabled={progression.blocked} onPress={() => { progression.clearFeedback(); setAction({ kind: "quick-sell", ids: [], pets }); }} />{selectionMode && visibleSaleIds.length ? <JourneyButton testID="inventory-bulk-sale" title={t("Bán ({count})", { count: visibleSaleIds.length })} variant="destructive" size="sm" disabled={progression.blocked} onPress={() => { progression.clearFeedback(); setAction({ kind: "sell", ids: [...visibleSaleIds], pets }); }} /> : null}</View> : null}
    <Modal presentationStyle={selected ? "pageSheet" : "overFullScreen"} transparent={!selected} allowSwipeDismissal={!progression.busy && !action} visible={Boolean(selected || action)} animationType={state.settings.lightAR || reducedMotion ? "none" : "slide"} onRequestClose={close}>
      <View style={[styles.modalRoot, !selected && styles.transparent]}>
        {selected ? <SafeAreaView style={styles.sheet} edges={["top", "bottom"]} pointerEvents={action ? "none" : "auto"} accessibilityElementsHidden={Boolean(action)} importantForAccessibility={action ? "no-hide-descendants" : "auto"}>
          <View style={styles.sheetHeader}><Text ref={detailTitle} accessible accessibilityRole="header" style={styles.sheetTitle}>{t(pet ? "Thú nuôi của bạn" : "Vật phẩm")}</Text><Pressable {...focus.props("close-detail")} accessibilityRole="button" accessibilityLabel={t("Đóng chi tiết")} disabled={progression.busy} onPress={close} style={({ pressed }) => [styles.close, progression.busy && styles.disabled, pressed && styles.pressed, focus.style("close-detail")]}><Ionicons name="close" size={LAYOUT.icon} color={COLORS.textMuted} /></Pressable></View>
          <ScrollView contentContainerStyle={styles.sheetContent} showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled">
            <PetTransactionRecovery pending={progression.pending} busy={progression.busy} onRetry={retry} />
            {progression.feedback && !progression.feedback.ok && !progression.pending ? <Text accessibilityRole="alert" style={styles.error}>{t(progression.feedback.message)}</Text> : null}
            {pet ? <>
              <View style={styles.detailArt}><PetArtwork petId={pet.speciesId} stars={pet.stars} size={LAYOUT.artwork} /></View>
              <Text style={styles.detailName}>{t(pet.name)}</Text><PetStarsRow stars={pet.stars} /><Text style={styles.detailMeta}>{t("{rarity} · Cấp {level}", { rarity: t(pet.rarity), level: pet.level })}</Text>
              <View style={styles.experience}><Text style={styles.subtitle}>{t("Kinh nghiệm")}</Text><Text style={styles.link}>{pet.experience}/{needed}</Text></View>
              <View style={styles.track}><View style={[styles.fill, { width: `${Math.min(100, pet.experience / needed * 100)}%` }]} /></View>
              <PetProgressionPanel key={pet.id} pet={pet} blocked={progression.blocked} onFeed={(id) => progression.feed(pet.id, id)} onQuickFeed={() => progression.confirmQuickFeed(pet)} onUpgrade={() => { progression.clearFeedback(); setAction({ kind: "upgrade", pet, pets }); }} />
            </> : null}
            {item ? <><View style={styles.detailArt}><FoodArtwork itemId={item.id} size={LAYOUT.artwork} /></View><Text style={styles.detailName}>{t(item.name)}</Text><Text style={[styles.detailMeta, { color: rarityColor(item.rarity) }]}>{t(item.rarity)}</Text><Text style={styles.detailMeta}>{t("{category} · Còn {count}", { category: t(item.category), count: item.quantity })}</Text><Text style={styles.description}>{t(item.description)}</Text>{item.category === "Thức ăn" ? <Text style={styles.link}>{t("+{count} kinh nghiệm", { count: item.experienceGain })}</Text> : null}</> : null}
          </ScrollView>
        </SafeAreaView> : null}
        {action?.kind === "upgrade" ? <PetActionPopup key={`upgrade-${action.pet.id}`} pet={action.pet} pets={action.pets} state={state} busy={progression.busy} blocked={progression.blocked} pending={progression.pending} feedback={progression.feedback} onRetry={retry} onClose={close} onUpgrade={(ids) => progression.confirmUpgrade(action.pet, ids, () => setAction(null))} /> : action ? <PetSalePopup key={action.kind} mode={action.kind === "quick-sell" ? "quick" : "selected"} petIds={action.ids} pets={action.pets} state={state} rarities={state.settings.quickSaleRarities} onRarities={(values) => updateSetting("quickSaleRarities", values)} busy={progression.busy} blocked={progression.blocked} pending={progression.pending} feedback={progression.feedback} onRetry={retry} onClose={close} onSell={(ids, quote) => { const anchor = action.pets.find((entry) => entry.id === ids[0]); if (anchor) progression.confirmSell(anchor, ids, quote, finishSale); }} /> : null}
      </View>
    </Modal>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background, ...GRADIENTS.ambient }, content: { padding: SPACING.page, paddingBottom: SPACING.lg, width: "100%", maxWidth: LAYOUT.contentMaxWidth, alignSelf: "center" },
  headerRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: SPACING.sm }, title: { ...TYPE.largeTitle },
  shopLink: { minHeight: LAYOUT.touch, flexDirection: "row", alignItems: "center", gap: SPACING.sm, paddingHorizontal: SPACING.compact, borderRadius: RADIUS.pill, backgroundColor: COLORS.sage }, link: { ...TYPE.label, color: COLORS.primaryDark }, subtitle: { ...TYPE.subhead },
  balance: { flexDirection: "row", alignItems: "center", gap: SPACING.xs, marginVertical: SPACING.sm }, tabs: { flexDirection: "row", padding: SPACING.xs, backgroundColor: COLORS.surfaceAlt, borderRadius: RADIUS.md, marginVertical: SPACING.md },
  tab: { flex: 1, minHeight: LAYOUT.touch, alignItems: "center", justifyContent: "center", borderRadius: RADIUS.sm }, activeTab: { backgroundColor: COLORS.surface }, gridRow: { gap: SPACING.compact }, petGridRow: { gap: SPACING.sm },
  selectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: SPACING.sm, marginBottom: SPACING.sm },
  petTile: { minHeight: LAYOUT.touch, alignItems: "center", paddingVertical: SPACING.xs, marginBottom: SPACING.sm, borderWidth: 1, borderRadius: RADIUS.sm, borderCurve: "continuous", backgroundColor: COLORS.surface, overflow: "hidden" }, checkedTile: { borderWidth: 2 }, tileTop: { alignSelf: "stretch", flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: SPACING.xs }, tileCheckbox: { minWidth: LAYOUT.badgeIcon }, levelBadge: { ...TYPE.caption, color: COLORS.text, textAlign: "right", flexShrink: 1 }, tileStars: { flexDirection: "row", alignItems: "center", gap: SPACING.xs },
  saleToolbar: { flexDirection: "row", flexWrap: "wrap", gap: SPACING.sm, justifyContent: "space-between", paddingHorizontal: SPACING.page, paddingVertical: SPACING.sm, backgroundColor: COLORS.background, borderTopWidth: StyleSheet.hairlineWidth, borderColor: COLORS.border },
  card: { ...SHADOWS.card, flex: 1, maxWidth: "49%", borderRadius: RADIUS.lg, borderCurve: "continuous", overflow: "hidden", backgroundColor: COLORS.surface, marginBottom: SPACING.md }, fullCard: { maxWidth: "100%" }, cardArt: { alignItems: "center", justifyContent: "center", minHeight: SPACING.hero * 2 }, cardCopy: { padding: SPACING.compact, gap: SPACING.xs }, rarityStripe: { height: SPACING.xs }, rarityBadge: { alignSelf: "flex-start", borderRadius: RADIUS.xs, paddingHorizontal: SPACING.xs },
  empty: { alignItems: "center", gap: SPACING.md, paddingVertical: SPACING.xl }, modalRoot: { flex: 1, backgroundColor: COLORS.background }, transparent: { backgroundColor: COLORS.transparent }, sheet: { flex: 1, backgroundColor: COLORS.background, ...GRADIENTS.ambient },
  sheetHeader: { flexDirection: "row", alignItems: "center", paddingHorizontal: SPACING.page, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: COLORS.border }, sheetTitle: { ...TYPE.headline, flex: 1 }, close: { width: LAYOUT.touch, minHeight: LAYOUT.touch, alignItems: "center", justifyContent: "center", borderRadius: RADIUS.pill },
  sheetContent: { padding: SPACING.page, paddingBottom: SPACING.xl, gap: SPACING.sm, width: "100%", maxWidth: LAYOUT.contentMaxWidth, alignSelf: "center" }, detailArt: { ...GRADIENTS.garden, alignItems: "center", justifyContent: "center", paddingVertical: SPACING.md, borderRadius: RADIUS.lg, borderCurve: "continuous" },
  detailName: { ...TYPE.title, textAlign: "center", color: COLORS.primaryDark }, detailMeta: { ...TYPE.subhead, textAlign: "center" }, experience: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: SPACING.sm, marginTop: SPACING.sm }, track: { height: SPACING.sm, backgroundColor: COLORS.surfaceAlt, borderRadius: RADIUS.pill, overflow: "hidden" }, fill: { height: "100%", backgroundColor: COLORS.primary, borderRadius: RADIUS.pill },
  description: { ...TYPE.body, marginVertical: SPACING.md }, error: { ...TYPE.subhead, color: COLORS.danger }, disabled: { opacity: INTERACTION.disabledOpacity }, pressed: { opacity: INTERACTION.primaryPressedOpacity },
});
