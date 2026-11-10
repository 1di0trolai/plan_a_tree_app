/** Điều phối giao dịch thú nuôi và phục hồi thao tác chưa lưu; cung cấp giao diện cho ăn, tăng sao và hiển thị sao. */

import { useI18n } from "@/i18n";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { FoodArtwork } from "@/components/FoodArtwork";
import { JourneyButton } from "@/components/journeyUI";
import { useApp } from "@/store/AppStore";
import { buildQuickFeedPlan, type PetTransactionInput } from "@/store/petActions";
import { COLORS, LAYOUT, RADIUS, SPACING, TYPE } from "@/theme";
import type { PetStars, PetView } from "@/types/app";

export type PetFeedback = { ok: boolean; message: string };
type NewTransaction = PetTransactionInput extends infer T ? T extends PetTransactionInput ? Omit<T, "requestId"> : never : never;
export type Refund = { gold: number; foods: Record<string, number> };

/** Durable operations are coordinated above detail/popup lifetimes. */
export function usePetProgression() {
  const { t } = useI18n();
  const { state, ready, pendingPetTransaction, pendingFoodPurchase, pendingRewardAction, sellPetCopies, upgradePet, feedPet, quickFeedPet } = useApp();
  const session = useMemo(() => ({ ready, loggedIn: state.auth.loggedIn, identity: state.auth.identity }), [ready, state.auth.loggedIn, state.auth.identity]);
  const live = useRef(session);
  const mounted = useRef(true);
  const lock = useRef<{ session: object; requestId: string } | null>(null);
  const confirming = useRef<object | null>(null);
  const [attempt, setAttempt] = useState<{ session: object; busy: boolean; feedback: PetFeedback | null } | null>(null);
  useEffect(() => { live.current = session; }, [session]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const busy = attempt?.session === session && attempt.busy;
  const feedback = attempt?.session === session ? attempt.feedback : null;
  const pending = ready && state.auth.loggedIn ? pendingPetTransaction : null;
  const blocked = !ready || !state.auth.loggedIn || busy || Boolean(pending || pendingFoodPurchase || pendingRewardAction);
  const isLive = () => mounted.current && live.current === session && ready && state.auth.loggedIn;
  const run = async (input: PetTransactionInput, onSuccess?: () => void) => {
    if (!isLive() || lock.current?.session === session) return;
    lock.current = { session, requestId: input.requestId };
    setAttempt({ session, busy: true, feedback: null });
    try {
      const result = input.kind === "sell" ? await sellPetCopies(input) : input.kind === "upgrade" ? await upgradePet(input)
        : input.kind === "feed" ? await feedPet(input) : await quickFeedPet(input);
      if (!isLive() || result.message === "Phiên sử dụng đã thay đổi.") return;
      setAttempt({ session, busy: false, feedback: result });
      if (result.ok) onSuccess?.();
    } catch {
      if (isLive()) setAttempt({ session, busy: false, feedback: { ok: false, message: "Chưa lưu được thao tác. Hãy thử lại." } });
    } finally { if (lock.current?.requestId === input.requestId) lock.current = null; }
  };
  const requestId = () => `pet-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const confirm = (title: string, message: string, input: NewTransaction, onSuccess?: () => void) => {
    if (blocked || !isLive() || lock.current?.session === session || confirming.current === session) return;
    confirming.current = session;
    const dismiss = () => { if (confirming.current === session) confirming.current = null; };
    Alert.alert(title, message, [{ text: t("Để sau"), style: "cancel", onPress: dismiss }, { text: t("Xác nhận"), style: input.kind === "sell" ? "destructive" : "default", onPress: () => { dismiss(); if (isLive()) void run({ ...input, requestId: requestId() } as PetTransactionInput, onSuccess); } }], { cancelable: true, onDismiss: dismiss });
  };
  return {
    busy, blocked, feedback, pending,
    clearFeedback: () => { if (!busy) setAttempt(null); },
    retry: (onSuccess?: () => void) => { if (pending) void run(pending, onSuccess); },
    feed: (petId: string, itemId: string) => { if (!blocked && lock.current?.session !== session) void run({ kind: "feed", requestId: requestId(), petId, itemId }); },
    confirmQuickFeed: (pet: PetView) => {
      const plan = buildQuickFeedPlan(state, pet.id);
      if (plan.experienceGain <= 0) return;
      const foods = Object.entries(plan.foods).map(([id, quantity]) => `${t(state.inventory.items.find((entry) => entry.id === id)?.name ?? id)} ×${quantity}`).join(", ");
      confirm(t("Cho ăn nhanh?"), `${foods}. ${plan.reachesNextLevel ? t("Lên cấp {level}", { level: plan.levelAfter }) : t("Thêm {count} kinh nghiệm", { count: plan.experienceGain })}.`, { kind: "quick-feed", petId: pet.id });
    },
    confirmSell: (pet: PetView, petIds: string[], refund: Refund, onSuccess: () => void) => {
      if (blocked || !isLive() || !petIds.length || !Number.isSafeInteger(refund.gold)) return;
      void run({ kind: "sell", requestId: requestId(), petId: petIds.includes(pet.id) ? pet.id : petIds[0], petIds: [...petIds] }, onSuccess);
    },
    confirmUpgrade: (pet: PetView, materialPetIds: string[], onSuccess: () => void) => {
      if (blocked || !isLive() || pet.stars === 3) return;
      const targetStars = pet.stars === 1 ? 2 : 3;
      void run({ kind: "upgrade", requestId: requestId(), petId: pet.id, targetStars, materialPetIds: [...materialPetIds] }, onSuccess);
    },
  };
}

export function PetStarsRow({ stars, small = false }: { stars: PetStars; small?: boolean }) {
  const { t } = useI18n();
  return <View accessible accessibilityLabel={t("{count} sao", { count: stars })} style={styles.stars}>{Array.from({ length: stars }, (_, index) => <Ionicons key={index} name="star" size={small ? LAYOUT.badgeIcon : LAYOUT.smallIcon} color={COLORS.warning} />)}</View>;
}

export function PetTransactionRecovery({ pending, busy, onRetry }: { pending: PetTransactionInput | null; busy: boolean; onRetry: () => void }) {
  const { t } = useI18n();
  if (!pending) return null;
  return <View testID="pet-transaction-recovery" style={styles.recovery}><Text accessibilityLiveRegion="polite" style={styles.caption}>{t(busy ? "Đang lưu thao tác thú nuôi…" : "Chưa lưu xong. Thử lại không trừ thêm.")}</Text><JourneyButton testID="retry-pet-transaction" title={t("Thử lưu lại")} size="sm" secondary loading={busy} onPress={onRetry} /></View>;
}

export function PetProgressionPanel({ pet, blocked, onFeed, onQuickFeed, onUpgrade }: {
  pet: PetView; blocked: boolean; onFeed: (itemId: string) => void; onQuickFeed: () => void; onUpgrade: () => void;
}) {
  const { t } = useI18n();
  const { state } = useApp();
  const [feedOpen, setFeedOpen] = useState(false);
  const foods = state.inventory.items.filter((item) => item.category === "Thức ăn" && item.quantity > 0);
  const plan = feedOpen ? buildQuickFeedPlan(state, pet.id) : null;
  return <View testID="pet-progression-panel" style={styles.panel}>
    <View style={styles.actions}><JourneyButton testID="show-pet-feed" title={t("Cho ăn")} secondary size="sm" disabled={blocked} onPress={() => setFeedOpen(!feedOpen)} style={styles.action} /><JourneyButton testID="show-pet-upgrade" title={t("Tăng sao")} secondary size="sm" disabled={blocked} onPress={() => { setFeedOpen(false); onUpgrade(); }} style={styles.action} /></View>
    {feedOpen ? <View testID="pet-food-list" style={styles.foodList}>
      <JourneyButton testID="quick-feed-pet" title={t("Cho ăn nhanh")} size="sm" disabled={blocked || !plan || plan.experienceGain <= 0} onPress={onQuickFeed} />
      {plan && plan.experienceGain > 0 ? <Text style={styles.caption}>{plan.reachesNextLevel ? t("Đủ lên cấp {level}", { level: plan.levelAfter }) : t("Thêm {count} kinh nghiệm", { count: plan.experienceGain })}</Text> : <Text style={styles.caption}>{t("Chưa có thức ăn phù hợp.")}</Text>}
      {foods.map((food) => <View key={food.id} style={styles.foodRow}><FoodArtwork itemId={food.id} size={LAYOUT.touch} /><View style={styles.foodCopy}><Text style={styles.label}>{t(food.name)}</Text><Text style={styles.caption}>{t("+{xp} kinh nghiệm · Còn {count}", { xp: food.experienceGain, count: food.quantity })}</Text></View><JourneyButton testID={`feed-${food.id}`} title={t("Cho ăn")} secondary size="sm" disabled={blocked} onPress={() => onFeed(food.id)} /></View>)}
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  panel: { gap: SPACING.md, marginTop: SPACING.md }, actions: { flexDirection: "row", gap: SPACING.sm }, action: { flex: 1, paddingHorizontal: SPACING.sm },
  stars: { flexDirection: "row", justifyContent: "center", gap: SPACING.xs }, caption: { ...TYPE.subhead }, label: { ...TYPE.label },
  foodList: { gap: SPACING.sm }, foodRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: SPACING.sm, paddingVertical: SPACING.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: COLORS.border }, foodCopy: { flex: 1, minWidth: LAYOUT.thumbnail },
  recovery: { gap: SPACING.sm, padding: SPACING.compact, borderRadius: RADIUS.md, borderCurve: "continuous", backgroundColor: COLORS.sunTint, marginVertical: SPACING.sm },
});
