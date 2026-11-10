/** Quản lý trạng thái và chuyển động mở thẻ, bảo đảm phần thưởng được lưu trước khi hiển thị kết quả. */

import { useI18n } from "@/i18n";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, AppState, Easing } from "react-native";
import { useApp } from "@/store/AppStore";
import { MOTION } from "@/theme";
import type { DailyPetPack } from "@/types/app";

/** Cosmetic phases never grant rewards; the store and durable write do that once. */
export function usePackReveal(pack: DailyPetPack) {
  const { t } = useI18n();
  const { state, openDailyPack, persistNow } = useApp();
  const [revealed, setRevealed] = useState(Boolean(pack.revealedAt));
  const [durable, setDurable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reducedMotion, setReducedMotion] = useState(true);
  const [motionReady, setMotionReady] = useState(false);
  const [active, setActive] = useState(AppState.currentState === "active");
  const mounted = useRef(true);
  const focused = useRef(true);
  const activeRef = useRef(AppState.currentState === "active");
  const committed = useRef(Boolean(pack.revealedAt));
  const locked = useRef(false);
  const motionEpoch = useRef(0);
  const arrived = useRef(Boolean(pack.revealedAt));
  const finite = useRef<Animated.CompositeAnimation | null>(null);
  const pulseAnimation = useRef<Animated.CompositeAnimation | null>(null);
  const [arrival] = useState(() => new Animated.Value(pack.revealedAt ? 1 : 0));
  const [spin] = useState(() => new Animated.Value(0));
  const [expansion] = useState(() => new Animated.Value(1));
  const [pulse] = useState(() => new Animated.Value(1));
  const noMotion = reducedMotion || state.settings.lightAR;
  const noMotionRef = useRef(noMotion);
  useEffect(() => { noMotionRef.current = noMotion; }, [noMotion]);

  const settle = useCallback(() => {
    // Invalidate first: stop() invokes completion callbacks with finished:false.
    motionEpoch.current += 1;
    finite.current?.stop();
    pulseAnimation.current?.stop();
    [arrival, spin, expansion, pulse].forEach((value) => value.stopAnimation());
    arrival.setValue(1);
    spin.setValue(0);
    expansion.setValue(1);
    pulse.setValue(1);
    if (mounted.current && committed.current) {
      setRevealed(true);
      setBusy(false);
      locked.current = false;
    }
  }, [arrival, spin, expansion, pulse]);

  useFocusEffect(useCallback(() => {
    focused.current = true;
    setActive(activeRef.current);
    return () => {
      focused.current = false;
      setActive(false);
      settle();
    };
  }, [settle]));

  useEffect(() => {
    mounted.current = true;
    let preferenceEvent = false;
    const setPreference = (value: boolean) => {
      if (!mounted.current) return;
      setReducedMotion(value);
      setMotionReady(true);
    };
    AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (!preferenceEvent) setPreference(value);
    }).catch(() => setPreference(true));
    const accessibility = AccessibilityInfo.addEventListener("reduceMotionChanged", (value) => {
      preferenceEvent = true;
      setPreference(value);
    });
    const app = AppState.addEventListener("change", (value) => {
      activeRef.current = value === "active";
      setActive(value === "active" && focused.current);
      if (value !== "active") settle();
    });
    persistNow().then(() => {
      if (mounted.current) setDurable(true);
    }).catch(() => {
      if (mounted.current) setError("Chưa lưu được gói thẻ. Thử lưu lại trước khi mở.");
    });
    return () => {
      mounted.current = false;
      accessibility.remove();
      app.remove();
      settle();
    };
  }, [persistNow, settle]);

  useEffect(() => {
    if (!motionReady) return;
    if (noMotion || !active) {
      settle();
      return;
    }
    if (!arrived.current) {
      arrived.current = true;
      finite.current = Animated.timing(arrival, { toValue: 1, duration: MOTION.cardArrival, easing: Easing.out(Easing.cubic), useNativeDriver: true });
      finite.current.start();
    }
    pulseAnimation.current = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 0, duration: MOTION.rewardPulse, easing: Easing.inOut(Easing.sin), isInteraction: false, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1, duration: MOTION.rewardPulse, easing: Easing.inOut(Easing.sin), isInteraction: false, useNativeDriver: true }),
    ]));
    pulseAnimation.current.start();
    return () => { pulseAnimation.current?.stop(); };
  }, [motionReady, noMotion, active, arrival, pulse, settle]);

  const saveAgain = async () => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      await persistNow();
      if (mounted.current) setDurable(true);
    } catch {
      if (mounted.current) setError("Chưa lưu được. Kiểm tra dung lượng thiết bị rồi thử lại.");
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const open = async () => {
    if (locked.current || !durable || revealed) return;
    locked.current = true;
    setBusy(true);
    setError("");
    // Finish the arrival independently of the durable reveal write.
    motionEpoch.current += 1;
    finite.current?.stop();
    arrival.setValue(1);
    try {
      if (!openDailyPack(pack.id)) throw new Error("missing-pack");
      await persistNow();
      committed.current = true;
      if (!mounted.current) return;
      if (noMotionRef.current || !activeRef.current || !focused.current) {
        settle();
        return;
      }
      const epoch = ++motionEpoch.current;
      finite.current = Animated.timing(spin, { toValue: 1, duration: MOTION.cardCharge, easing: Easing.in(Easing.cubic), useNativeDriver: true });
      finite.current.start(({ finished }) => {
        if (!mounted.current || epoch !== motionEpoch.current) return;
        if (!finished) { settle(); return; }
        setRevealed(true);
        spin.setValue(0);
        expansion.setValue(0.16);
        finite.current = Animated.spring(expansion, { toValue: 1, speed: 15, bounciness: 7, useNativeDriver: true });
        finite.current.start(() => {
          if (!mounted.current || epoch !== motionEpoch.current) return;
          expansion.setValue(1);
          locked.current = false;
          setBusy(false);
        });
      });
    } catch (cause) {
      if (mounted.current) {
        setError(cause instanceof Error && cause.name === "PetCapacityError" ? cause.message
          : "Chưa lưu được kết quả. Chạm thẻ để thử lại; quà vẫn giữ nguyên.");
        setBusy(false);
        locked.current = false;
      }
    }
  };

  return { revealed, durable, busy, error: t(error), noMotion, arrival, spin, expansion, pulse, open, saveAgain };
}
