/** Hiển thị cửa hàng thức ăn, nhập số lượng mua và thực hiện giao dịch bằng vàng. */

import { useI18n } from "@/i18n";
import { getLocaleTag } from "@/i18n/core";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo, ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text,
  TextInput, useWindowDimensions, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { FoodArtwork } from "@/components/FoodArtwork";
import { CurrencyArtwork } from "@/components/CurrencyArtwork";
import { JourneyButton, JourneyHeader, ui } from "@/components/journeyUI";
import { MAX_PURCHASE_QUANTITY, SHOP_CATALOG } from "@/data/economy";
import { useControlFocus } from "@/hooks/useControlFocus";
import { useApp } from "@/store/AppStore";
import type { FoodPurchaseInput } from "@/store/economyActions";
import { COLORS, GRADIENTS, INPUT, INTERACTION, LAYOUT, RADIUS, SHADOWS, SPACING, TYPE } from "@/theme";
import { createId } from "@/utils/id";

export default function ShopScreen() {
  const { t } = useI18n();
  const { state, purchaseFood, pendingFoodPurchase, pendingRewardAction } = useApp();
  const focus = useControlFocus();
  const { width, fontScale } = useWindowDimensions();
  const singleColumn = width < 360 || fontScale >= 1.3;
  const [selectedId, setSelectedId] = useState<string | null>(pendingFoodPurchase?.itemId ?? null);
  const [quantityText, setQuantityText] = useState(String(pendingFoodPurchase?.quantity ?? 1));
  const quantity = Number(quantityText);
  const setQuantity = (value: number | ((previous: number) => number)) =>
    setQuantityText(String(typeof value === "function" ? value(Number.isSafeInteger(quantity) ? quantity : 1) : value));
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(pendingFoodPurchase ? "Đơn mua đang chờ lưu. Tiếp tục để hoàn tất." : "");
  const [needsRetry, setNeedsRetry] = useState(Boolean(pendingFoodPurchase));
  const [toast, setToast] = useState("");
  const [reducedMotion, setReducedMotion] = useState(true);
  const pending = useRef<FoodPurchaseInput | null>(pendingFoodPurchase);
  const locked = useRef(false);
  const mounted = useRef(true);
  const selected = state.inventory.items.find((item) => item.id === selectedId);
  const offer = SHOP_CATALOG.find((entry) => entry.itemId === selectedId);
  const validQuantity = /^\d+$/.test(quantityText) && Number.isSafeInteger(quantity)
    && quantity >= 1 && quantity <= MAX_PURCHASE_QUANTITY
    && Number.isSafeInteger((selected?.quantity ?? 0) + quantity);
  const total = validQuantity ? (offer?.goldPrice ?? 0) * quantity : 0;
  // The provider permits only one pending intent and has already debited it.
  // Read its reactive state here; the local ref only protects event handlers.
  const alreadyApplied = Boolean(pendingFoodPurchase);
  const remaining = state.economy.gold - (alreadyApplied ? 0 : total);
  const insufficient = remaining < 0;

  useEffect(() => {
    mounted.current = true;
    AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (mounted.current) setReducedMotion(value);
    }).catch(() => { /* Keep motion off if system preference is unavailable. */ });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReducedMotion);
    return () => { mounted.current = false; subscription.remove(); };
  }, []);
  useEffect(() => {
    if (pendingFoodPurchase && !pending.current) {
      pending.current = pendingFoodPurchase;
      setSelectedId(pendingFoodPurchase.itemId);
      setQuantityText(String(pendingFoodPurchase.quantity));
      setNeedsRetry(true);
      setError("Đơn mua đang chờ lưu. Tiếp tục để hoàn tất.");
    }
  }, [pendingFoodPurchase]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  const open = (itemId: string) => {
    if (locked.current || pending.current) return;
    setSelectedId(itemId);
    setQuantity(1);
    setError("");
    setNeedsRetry(false);
    setToast("");
    setVisible(true);
  };
  const close = () => {
    if (!locked.current) setVisible(false);
  };
  const buy = async () => {
    if (locked.current || !selected || !offer || pendingRewardAction || (!validQuantity && !pending.current) || (insufficient && !pending.current)) return;
    const input = pending.current ?? { requestId: createId("purchase"), itemId: selected.id, quantity };
    pending.current = input;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await purchaseFood(input);
      if (!mounted.current) return;
      if (result.ok) {
        pending.current = null;
        setNeedsRetry(false);
        setVisible(false);
        setToast(result.message);
      } else {
        if (!result.retryable) pending.current = null;
        setNeedsRetry(Boolean(result.retryable));
        setError(result.message);
      }
    } catch {
      // The intent may already be applied in memory: retry its ID, never buy twice.
      if (mounted.current) {
        setNeedsRetry(true);
        setError("Chưa lưu được đơn mua. Thử lại để lưu, không trừ vàng thêm.");
      }
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  return (
    <SafeAreaView style={ui.safe}>
      <JourneyHeader title={t("Tiệm Lá")} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.summary}>
          <Text style={styles.sectionTitle}>{t("Thức ăn cho thú nuôi")}</Text>
          <View style={styles.balance} accessibilityLabel={t("Số dư {count} vàng", { count: state.economy.gold.toLocaleString(getLocaleTag()) })} accessible>
            <CurrencyArtwork currency="gold" />
            <Text style={styles.balanceText}>{t("{count} vàng", { count: state.economy.gold.toLocaleString(getLocaleTag()) })}</Text>
          </View>
        </View>
        {needsRetry && !visible ? <View style={styles.recovery}>
          <Text accessibilityRole="alert" style={styles.error}>{t(error)}</Text>
          <JourneyButton title={t("Tiếp tục lưu đơn mua")} size="sm" secondary onPress={() => setVisible(true)} />
        </View> : null}
        <View style={styles.grid}>
          {SHOP_CATALOG.map((entry) => {
            const item = state.inventory.items.find((record) => record.id === entry.itemId);
            if (!item) return null;
            return <Pressable
              {...focus.props(entry.itemId)} key={entry.itemId}
              accessibilityRole="button"
              accessibilityLabel={t("{name}, thêm {xp} kinh nghiệm, {gold} vàng", { name: t(item.name), xp: entry.experienceGain, gold: entry.goldPrice })}
              accessibilityHint={t("Chọn số lượng trước khi mua")}
              accessibilityState={{ disabled: busy || needsRetry }} disabled={busy || needsRetry}
              onPress={() => open(entry.itemId)}
              style={({ pressed }) => [styles.card, singleColumn ? styles.fullCard : styles.halfCard, pressed && styles.pressed, (busy || needsRetry) && styles.disabled, focus.style(entry.itemId)]}
            >
              <View style={styles.art}><FoodArtwork itemId={item.id} size={LAYOUT.artwork} /></View>
              <View style={styles.cardCopy}>
                <Text style={styles.foodName}>{t(item.name)}</Text>
                <Text style={styles.exp}>{t("+{count} kinh nghiệm", { count: entry.experienceGain })}</Text>
                <View style={styles.price}>
                  <CurrencyArtwork currency="gold" />
                  <Text style={styles.priceText}>{t("{count} vàng", { count: entry.goldPrice })}</Text>
                </View>
              </View>
            </Pressable>;
          })}
        </View>
      </ScrollView>
      {toast ? <View pointerEvents="none" style={styles.toast}>
        <Ionicons name="checkmark-circle" size={LAYOUT.smallIcon} color={COLORS.primary} accessible={false} />
        <Text accessibilityLiveRegion="polite" style={styles.toastText}>{t(toast)}</Text>
      </View> : null}
      <Modal visible={visible} transparent animationType={reducedMotion || state.settings.lightAR ? "none" : "fade"} onRequestClose={close}>
        <View style={styles.scrim}>
          <View style={styles.sheet} accessibilityViewIsModal>
            <SafeAreaView style={styles.sheetSafe} edges={["bottom"]}>
              <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetContent} automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled">
                <View style={styles.sheetHeader}>
                  <Text style={styles.sheetTitle}>{selected ? t(selected.name) : ""}</Text>
                  <Pressable {...focus.props("close-shop")} accessibilityRole="button" accessibilityLabel={t("Đóng chọn số lượng")}
                    disabled={busy} accessibilityState={{ disabled: busy }} onPress={close}
                    style={({ pressed }) => [styles.iconButton, pressed && styles.pressed, busy && styles.disabled, focus.style("close-shop")] }>
                    <Ionicons name="close" size={LAYOUT.icon} color={COLORS.text} accessible={false} />
                  </Pressable>
                </View>
                <View style={styles.purchaseArt}><FoodArtwork itemId={selectedId ?? ""} size={LAYOUT.artwork} /></View>
                <Text style={styles.purchaseExp}>{t("+{count} kinh nghiệm / phần", { count: offer?.experienceGain ?? 0 })}</Text>
                <View style={styles.quantityRow}>
                  <Text style={styles.label}>{t("Số lượng")}</Text>
                  <View style={styles.stepper}>
                    <Pressable {...focus.props("less")} accessibilityRole="button" accessibilityLabel={t("Giảm số lượng")}
                      accessibilityState={{ disabled: busy || needsRetry || quantity <= 1 }} disabled={busy || needsRetry || quantity <= 1}
                      onPress={() => setQuantity((value) => Math.max(1, value - 1))}
                      style={({ pressed }) => [styles.iconButton, styles.stepperButton, pressed && styles.pressed, (busy || needsRetry || quantity <= 1) && styles.disabled, focus.style("less")] }>
                      <Ionicons name="remove" size={LAYOUT.smallIcon} color={COLORS.primaryDark} accessible={false} />
                    </Pressable>
                    <TextInput {...focus.props("quantity")}
                      accessibilityLabel={t("Số lượng muốn mua")} accessibilityHint={t("Nhập từ 1 đến {count}", { count: MAX_PURCHASE_QUANTITY })}
                      value={quantityText} onChangeText={setQuantityText}
                      underlineColorAndroid={COLORS.transparent}
                      editable={!busy && !needsRetry} inputMode="numeric" keyboardType="number-pad"
                      selectTextOnFocus maxLength={16} returnKeyType="done" autoCorrect={false}
                      style={[styles.quantity, focus.style("quantity")]}
                    />
                    <Pressable {...focus.props("more")} accessibilityRole="button" accessibilityLabel={t("Tăng số lượng")}
                      accessibilityState={{ disabled: busy || needsRetry || quantity >= MAX_PURCHASE_QUANTITY }} disabled={busy || needsRetry || quantity >= MAX_PURCHASE_QUANTITY}
                      onPress={() => setQuantity((value) => Math.min(MAX_PURCHASE_QUANTITY, value + 1))}
                      style={({ pressed }) => [styles.iconButton, styles.stepperButton, pressed && styles.pressed, (busy || needsRetry || quantity >= MAX_PURCHASE_QUANTITY) && styles.disabled, focus.style("more")] }>
                      <Ionicons name="add" size={LAYOUT.smallIcon} color={COLORS.primaryDark} accessible={false} />
                    </Pressable>
                  </View>
                </View>
                {!validQuantity ? <Text accessibilityRole="alert" style={styles.error}>{t("Nhập số nguyên từ 1 đến {count}.", { count: MAX_PURCHASE_QUANTITY })}</Text> : null}
                {pendingRewardAction ? <Text accessibilityRole="alert" style={styles.error}>{t("Hãy hoàn tất lưu quà đang chờ.")}</Text> : null}
                <View style={styles.receiptRow}><Text style={styles.receiptLabel}>{t("Tổng")}</Text><Text style={styles.receiptValue}>{t("{count} vàng", { count: total.toLocaleString(getLocaleTag()) })}</Text></View>
                {!needsRetry ? <View style={styles.receiptRow}>
                  <Text style={styles.receiptLabel}>{t(insufficient ? "Còn thiếu" : "Sau khi mua")}</Text>
                  <Text style={[styles.receiptValue, insufficient && styles.error]}>{t("{count} vàng", { count: Math.abs(remaining).toLocaleString(getLocaleTag()) })}</Text>
                </View> : null}
                {error ? <Text accessibilityRole="alert" style={styles.error}>{t(error)}</Text> : null}
                <Pressable {...focus.props("buy")} accessibilityRole="button"
                  accessibilityLabel={needsRetry ? t("Thử lưu lại đơn mua") : t("Mua với {count} vàng", { count: total.toLocaleString(getLocaleTag()) })}
                  accessibilityState={{ disabled: busy || pendingRewardAction || !validQuantity || (insufficient && !needsRetry), busy }} disabled={busy || pendingRewardAction || !validQuantity || (insufficient && !needsRetry)}
                  onPress={buy}
                  style={({ pressed }) => [styles.buy, GRADIENTS.action, pressed && styles.primaryPressed, (busy || pendingRewardAction || !validQuantity || (insufficient && !needsRetry)) && styles.disabled, focus.style("buy")] }>
                  {busy ? <ActivityIndicator color={COLORS.onAction} /> : <Ionicons name={needsRetry ? "refresh" : "bag-handle-outline"} size={LAYOUT.smallIcon} color={COLORS.onAction} accessible={false} />}
                  <Text style={styles.buyText}>{busy ? t("Đang lưu…") : needsRetry ? t("Thử lưu lại") : t("Mua — {count} vàng", { count: total.toLocaleString(getLocaleTag()) })}</Text>
                </Pressable>
              </ScrollView>
            </SafeAreaView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { ...ui.content, paddingTop: SPACING.sm },
  summary: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: SPACING.compact, marginBottom: SPACING.lg },
  sectionTitle: TYPE.headline,
  balance: { flexDirection: "row", alignItems: "center", gap: SPACING.sm, backgroundColor: COLORS.ochreSoft, paddingHorizontal: SPACING.compact, paddingVertical: SPACING.sm, borderRadius: RADIUS.pill, flexShrink: 1 },
  balanceText: { ...TYPE.label, color: COLORS.warning, fontVariant: ["tabular-nums"], flexShrink: 1 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: SPACING.compact },
  card: { ...SHADOWS.card, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderCurve: "continuous", overflow: "hidden" },
  halfCard: { flexBasis: "46%", flexGrow: 1 },
  fullCard: { width: "100%" },
  art: { ...GRADIENTS.garden, backgroundColor: COLORS.surfaceSoft, padding: SPACING.md, alignItems: "center" },
  cardCopy: { padding: SPACING.compact, gap: SPACING.xs },
  foodName: TYPE.label,
  exp: TYPE.subhead,
  price: { flexDirection: "row", alignItems: "center", gap: SPACING.sm, paddingTop: SPACING.sm },
  priceText: { ...TYPE.label, color: COLORS.warning, flexShrink: 1 },
  pressed: { backgroundColor: COLORS.pressed },
  primaryPressed: { opacity: INTERACTION.primaryPressedOpacity },
  disabled: { opacity: INTERACTION.disabledOpacity },
  recovery: { paddingBottom: SPACING.md, gap: SPACING.sm },
  scrim: { flex: 1, backgroundColor: COLORS.overlay, justifyContent: "flex-end" },
  sheet: { width: "100%", maxWidth: LAYOUT.contentMaxWidth, alignSelf: "center", maxHeight: "90%", backgroundColor: COLORS.background, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl, borderCurve: "continuous" },
  sheetSafe: { flexShrink: 1, minHeight: 0 },
  sheetScroll: { flexShrink: 1, minHeight: 0 },
  sheetContent: { padding: SPACING.page, gap: SPACING.compact },
  sheetHeader: { flexDirection: "row", alignItems: "center", gap: SPACING.sm },
  sheetTitle: { ...TYPE.title, flex: 1 },
  iconButton: { minWidth: LAYOUT.touch, minHeight: LAYOUT.touch, alignItems: "center", justifyContent: "center", borderRadius: RADIUS.md, borderCurve: "continuous" },
  purchaseArt: { alignItems: "center", paddingTop: SPACING.sm },
  purchaseExp: { ...TYPE.subhead, textAlign: "center" },
  quantityRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: SPACING.compact, marginVertical: SPACING.sm },
  label: TYPE.label,
  stepper: { flexDirection: "row", alignItems: "center", gap: SPACING.sm, maxWidth: "100%" },
  stepperButton: { backgroundColor: COLORS.surfaceAlt },
  quantity: { ...INPUT.compact, fontSize: TYPE.headline.fontSize, fontWeight: TYPE.headline.fontWeight, width: LAYOUT.touch * 1.5, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.sm, borderCurve: "continuous", fontVariant: ["tabular-nums"] },
  receiptRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: SPACING.sm },
  receiptLabel: TYPE.subhead,
  receiptValue: { ...TYPE.label, fontVariant: ["tabular-nums"] },
  error: { ...TYPE.subhead, color: COLORS.danger },
  buy: { minHeight: LAYOUT.control, padding: SPACING.md, borderRadius: RADIUS.md, borderCurve: "continuous", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: SPACING.sm, backgroundColor: COLORS.actionSurface },
  buyText: { ...TYPE.label, color: COLORS.onAction, textAlign: "center", flexShrink: 1 },
  toast: { ...SHADOWS.floating, position: "absolute", left: SPACING.page, right: SPACING.page, bottom: SPACING.xl, maxWidth: LAYOUT.contentMaxWidth, alignSelf: "center", flexDirection: "row", alignItems: "center", gap: SPACING.sm, padding: SPACING.md, borderRadius: RADIUS.md, borderCurve: "continuous", backgroundColor: COLORS.surfaceAlt },
  toastText: { ...TYPE.subhead, color: COLORS.primaryDark, flex: 1 },
});
