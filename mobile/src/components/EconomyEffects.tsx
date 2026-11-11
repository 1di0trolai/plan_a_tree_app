/** Điều phối quà đăng nhập, hộp quà nổi và cập nhật thư khi phiên người dùng hoạt động. */

import { useI18n } from "@/i18n";
import { router, usePathname } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppState, Pressable, StyleSheet, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { localDateKey } from "@/data/seed";
import { DailyLoginGift } from "@/screens/rewards/DailyLoginGift";
import { FloatingDailyGift } from "@/screens/rewards/FloatingDailyGift";
import { buildDailyLoginGift, showDailyGiftOnRoute } from "@/screens/rewards/dailyLoginGiftModel";
import { millisecondsUntilNextGardenDay } from "@/services/gardenReminderPlan";
import { useApp } from "@/store/AppStore";
import { COLORS, LAYOUT, RADIUS, SHADOWS, SPACING, TYPE } from "@/theme";
import type { LoginRewardClaim } from "@/types/app";

type RewardSession = { ready: boolean; loggedIn: boolean; identity: string; userId?: string };
type VisitRequest = { session: RewardSession; date: string; promise: Promise<unknown>;
  failed?: boolean; retryable?: boolean; readyToRetry?: boolean };
type RewardAttempt = { session: RewardSession; giftId: string } & (
  | { kind: "pending" }
  | { kind: "reward"; claim: LoginRewardClaim }
  | { kind: "error"; message: string; retryable: boolean }
);

/** Visits bank one fixed gift, never credit food. The user must tap a box;
 * SQLite durability, not cosmetic animation completion, confirms receipt. */
export function EconomyEffects() {
  const { t } = useI18n();
  const { ready, state, claimLoginReward, syncLoginVisit, updateSetting, pendingRewardAction,
    retryRewardAction, pendingPetTransaction, pendingFoodPurchase } = useApp();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { loggedIn, identity, userId } = state.auth;
  const session = useMemo(() => ({ ready, loggedIn, identity, userId }), [ready, loggedIn, identity, userId]);
  const liveSession = useRef<RewardSession | null>(session);
  const [clock, refreshClock] = useState(0);
  const date = localDateKey();
  const foreground = AppState.currentState === "active";
  const [opened, setOpened] = useState<RewardSession | null>(null);
  const [attempt, setAttempt] = useState<RewardAttempt | null>(null);
  const pending = useRef<RewardSession | null>(null);
  const synced = useRef<VisitRequest | null>(null);
  const visitRetry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visitFailures = useRef(0);
  const recordedToday = state.economy.loginVisits.some((visit) => visit.date === date);
  const [syncError, setSyncError] = useState<{ session: RewardSession; message: string } | null>(null);
  const [mailNotice, setMailNotice] = useState<{ session: RewardSession; id: string } | null>(null);
  const knownMail = useRef<{ session: RewardSession; ids: Set<string> } | null>(null);

  useEffect(() => {
    liveSession.current = session;
    visitFailures.current = 0;
    return () => {
      if (liveSession.current === session) liveSession.current = null;
      if (visitRetry.current !== null) { clearTimeout(visitRetry.current); visitRetry.current = null; }
      if (synced.current?.session === session && synced.current.failed) synced.current.readyToRetry = true;
    };
  }, [session]);
  useEffect(() => {
    if (!ready || !loggedIn) return;
    const subscription = AppState.addEventListener("change", () => refreshClock((value) => value + 1));
    let dayTimer: ReturnType<typeof setTimeout>;
    const armNextDay = () => {
      dayTimer = setTimeout(() => { refreshClock((value) => value + 1); armNextDay(); }, millisecondsUntilNextGardenDay());
    };
    armNextDay();
    return () => { subscription.remove(); clearTimeout(dayTimer); };
  }, [ready, loggedIn, identity]);

  useEffect(() => {
    const previous = synced.current?.session === session && synced.current.date === date ? synced.current : null;
    if (!ready || !loggedIn || !foreground || pendingPetTransaction || pendingFoodPurchase
      || (pendingRewardAction && !(previous?.failed && previous.retryable))
      || (previous && !previous.readyToRetry) || (recordedToday && !previous?.failed)) return;
    // An attempted visit is not a recorded visit. Retry a temporary initialization
    // failure, or finish the same durable receipt after a failed SQLite write.
    // No new random roll or absent calendar day is introduced by a retry.
    const request: VisitRequest = { session, date, promise: Promise.resolve().then(async () => {
      if (pendingRewardAction) {
        const recovered = await retryRewardAction();
        if (!recovered.ok || liveSession.current !== session) return recovered;
      }
      return syncLoginVisit();
    }) };
    synced.current = request;
    const failed = (message: string, retryable: boolean) => {
      if (liveSession.current !== session || synced.current !== request) return;
      request.failed = true; request.retryable = retryable;
      setSyncError({ session, message });
      const delays = [3_000, 10_000, 30_000];
      const delay = delays[Math.min(visitFailures.current++, delays.length - 1)];
      if (visitRetry.current !== null) clearTimeout(visitRetry.current);
      visitRetry.current = setTimeout(() => {
        visitRetry.current = null;
        if (liveSession.current !== session || synced.current !== request) return;
        request.readyToRetry = true;
        refreshClock((value) => value + 1);
      }, delay);
    };
    request.promise.then((value) => {
      if (liveSession.current !== session || synced.current !== request) return;
      const result = value as Awaited<ReturnType<typeof syncLoginVisit>>;
      if (!result.ok) { failed(result.message, result.retryable === true); return; }
      if (synced.current === request) synced.current = null;
      visitFailures.current = 0;
      setSyncError(null);
    }).catch(() => {
      failed("Chưa lưu được lượt ghé vườn. Chạm hộp quà để thử lại.", false);
    });
  }, [ready, loggedIn, foreground, session, date, clock, recordedToday, syncLoginVisit, retryRewardAction, pendingPetTransaction, pendingFoodPurchase, pendingRewardAction]);

  useEffect(() => {
    if (knownMail.current?.session !== session) { knownMail.current = { session, ids: new Set(state.mailbox.map((mail) => mail.id)) }; return; }
    if (pendingRewardAction) return;
    const incoming = state.mailbox.find((mail) => !knownMail.current!.ids.has(mail.id));
    knownMail.current.ids = new Set(state.mailbox.map((mail) => mail.id));
    if (incoming) Promise.resolve().then(() => { if (liveSession.current === session) setMailNotice({ session, id: incoming.id }); });
  }, [state.mailbox, session, pendingRewardAction]);
  useEffect(() => {
    if (!mailNotice) return;
    const timer = setTimeout(() => setMailNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [mailNotice]);

  const currentAttempt = attempt?.session === session ? attempt : null;
  const gift = buildDailyLoginGift(state.economy.loginVisits, date, currentAttempt?.kind === "error" && currentAttempt.retryable ? currentAttempt.giftId : undefined);
  const available = gift.days.filter((day) => day.status === "available").length;
  const error = syncError?.session === session ? syncError : null;
  const hasEntry = available > 0 || currentAttempt?.kind === "pending" || Boolean(error) || pendingRewardAction;

  const retry = async () => {
    if (pending.current === session) return;
    pending.current = session;
    try {
      const result = await retryRewardAction();
      if (liveSession.current !== session) return;
      if (!result.ok) { setSyncError({ session, message: result.message }); return; }
      setSyncError(null);
      if (currentAttempt?.kind === "error") {
        const claim = state.economy.loginClaims.find((entry) =>
          state.economy.loginVisits.some((gift) => gift.id === currentAttempt.giftId && gift.date === entry.date));
        if (claim) setAttempt({ session, giftId: currentAttempt.giftId, kind: "reward", claim });
        else setAttempt(null);
      }
      synced.current = null;
      refreshClock((value) => value + 1);
    } finally { if (pending.current === session) pending.current = null; }
  };

  const claim = async (giftId: string) => {
    if (!ready || !loggedIn || !foreground || pending.current === session || pendingRewardAction) return;
    pending.current = session;
    setAttempt({ session, giftId, kind: "pending" });
    try {
      const result = await claimLoginReward(giftId);
      if (liveSession.current !== session) return;
      setAttempt(!result.ok
        ? { session, giftId, kind: "error", message: result.message, retryable: result.retryable !== false }
        : { session, giftId, kind: "reward", claim: result.result.claim });
    } catch {
      if (liveSession.current === session) setAttempt({ session, giftId, kind: "error", message: "Chưa lưu được quà.", retryable: true });
    } finally { if (pending.current === session) pending.current = null; }
  };

  if (!ready || !loggedIn || !foreground || !showDailyGiftOnRoute(pathname)) return null;
  return (
    <>
      {hasEntry && opened !== session ? <FloatingDailyGift
        dock={state.settings.giftDock}
        count={available}
        motionEnabled={!state.settings.lightAR}
        onDock={(dock) => updateSetting("giftDock", dock)}
        onOpen={() => {
          setOpened(session);
          if (error) { synced.current = null; refreshClock((value) => value + 1); }
        }}
      /> : null}
      <DailyLoginGift
        gift={gift}
        items={state.inventory.items}
        visible={opened === session}
        pending={Boolean(pendingRewardAction) || currentAttempt?.kind === "pending"}
        pendingGiftId={currentAttempt?.kind === "pending" ? currentAttempt.giftId : null}
        received={currentAttempt?.kind === "reward" ? currentAttempt.claim : null}
        error={currentAttempt?.kind === "error" ? { ...currentAttempt } : error ? { ...error, retryable: true } : null}
        motionEnabled={!state.settings.lightAR}
        onClose={() => { setOpened(null); if (currentAttempt?.kind === "reward") setAttempt(null); }}
        onClaim={(giftId) => { void claim(giftId); }}
        onRetry={() => { void retry(); }}
      />
      {pendingRewardAction && opened !== session ? <Pressable testID="reward-save-recovery"
        accessibilityRole="button" accessibilityLabel={t("Thử lưu lại quà đang chờ")}
        onPress={() => { void retry(); }}
        style={[styles.mailNotice, { bottom: insets.bottom + LAYOUT.control + SPACING.lg }]}
      ><Text style={styles.noticeText}>{t("Quà đang chờ lưu · Thử lại")}</Text></Pressable> : null}
      {mailNotice?.session === session && opened !== session ? <Pressable
        testID="mailbox-new-mail-toast"
        accessibilityRole="button"
        accessibilityLabel={t("Có thư mới trong hòm thư. Chạm để xem.")}
        onPress={() => { setMailNotice(null); router.push("/mailbox"); }}
        style={[styles.mailNotice, { bottom: insets.bottom + LAYOUT.control + SPACING.lg }]}
      ><Text accessibilityLiveRegion="polite" style={styles.noticeText}>{t("Có quà mới trong hòm thư")}</Text></Pressable> : null}
    </>
  );
}

const styles = StyleSheet.create({
  mailNotice: { position: "absolute", left: SPACING.md, right: SPACING.md, minHeight: LAYOUT.touch, alignItems: "center", justifyContent: "center", padding: SPACING.compact, borderRadius: RADIUS.md, backgroundColor: COLORS.primaryDark, ...SHADOWS.floating },
  noticeText: { ...TYPE.label, textAlign: "center", color: COLORS.onPrimary },
});
