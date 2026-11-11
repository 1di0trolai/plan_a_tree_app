/** Áp dụng các tùy chỉnh nhạc nền và thông báo, quản lý phát nhạc theo trạng thái ứng dụng. */

import {
  setAudioModeAsync,
  setIsAudioActiveAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
} from "expo-audio";
import { usePathname } from "expo-router";
import { useCallback, useEffect, useReducer, useRef } from "react";
import { AppState } from "react-native";

import {
  installReminderPresentationHandler,
  syncDailyReminder,
} from "../services/preferences";
import { BACKGROUND_MUSIC_SOURCE } from "../data/backgroundMusic";
import { setPreferenceError } from "../services/preferenceStatus";
import { usePreferenceStatus } from "../hooks/usePreferenceStatus";
import { useApp } from "../store/AppStore";
import { shouldPlayBackgroundMusic } from "../utils/profilePreferences";
import { advanceMusicLifecycle, startMusicPlaybackSession } from "../utils/musicLifecycle";
import { millisecondsUntilNextGardenDay } from "../services/gardenReminderPlan";
import { useI18n } from "../i18n";

/** One mounted coordinator; no permissions are requested automatically. */
export function PreferenceEffects() {
  const { locale } = useI18n();
  const { state, ready, updateSetting } = useApp();
  const pathname = usePathname();
  const { effectsSuspended } = usePreferenceStatus();
  const [visit, updateVisit] = useReducer(advanceMusicLifecycle, {
    foreground: AppState.currentState === "active",
    backgrounded: false,
    entry: 0,
  });
  const { loggedIn } = state.auth;
  const { notifications, notificationConsent, reminderTime } = state.settings;

  useEffect(() => installReminderPresentationHandler(), []);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", updateVisit);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!ready) return;
    let current = true;
    const enabled = loggedIn && notifications && notificationConsent && !effectsSuspended;
    const refresh = async () => {
      try {
        const result = await syncDailyReminder({
          enabled,
          time: reminderTime,
          garden: { plants: state.plants, dailyRounds: state.dailyRounds },
          now: new Date(),
        });
        if (!current || result.reason === "superseded") return;
        if (enabled && result.reason === "permission") {
          setPreferenceError(
            "reminder",
            "Thông báo đang bị tắt trong cài đặt thiết bị. Cho phép thông báo rồi bật lại nhắc thăm vườn.",
          );
          try {
            updateSetting("notifications", false);
          } catch {
            /* A concurrent data reset owns the replacement state. */
          }
        } else if (enabled && result.enabled) {
          setPreferenceError("reminder", null);
        }
      } catch {
        if (!current) return;
        setPreferenceError(
          "reminder",
          "Chưa cập nhật được nhắc thăm vườn. Hãy thử lại; nếu đã tắt nhắc, bạn có thể tắt thông báo PAT trong cài đặt thiết bị.",
        );
        if (notifications) {
          try {
            updateSetting("notifications", false);
          } catch {
            /* A concurrent reset owns state. */
          }
        }
      }
    };
    void refresh();
    // Recheck OS permission when returning from Settings, without showing a prompt.
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") void refresh();
    });
    // Refresh at Vietnam midnight while mounted. Closed apps already have a
    // finite seven-day plan; returning to the foreground replenishes it.
    let dayTimer: ReturnType<typeof setTimeout>;
    const armNextDay = () => {
      dayTimer = setTimeout(() => {
        void refresh();
        armNextDay();
      }, millisecondsUntilNextGardenDay());
    };
    armNextDay();
    return () => {
      current = false;
      subscription.remove();
      clearTimeout(dayTimer);
    };
  }, [
    locale,
    ready,
    loggedIn,
    notifications,
    notificationConsent,
    reminderTime,
    effectsSuspended,
    state.plants,
    state.dailyRounds,
    updateSetting,
  ]);

  const musicAvailable =
    ready &&
    !effectsSuspended &&
    loggedIn &&
    state.settings.musicConsent;
  const playing = shouldPlayBackgroundMusic(
    state.settings,
    loggedIn,
    visit.foreground,
    pathname,
  );
  const failMusic = useCallback((message: string) => {
    setPreferenceError("music", message);
  }, []);
  // Keep one player through tab changes, camera pauses and temporary system sheets.
  // Muting only pauses the loaded player; avoid native teardown/reload racing
  // the next switch on slower Android devices.
  // A new foreground visit starts at 0; logout/reset still release the player.
  return musicAvailable ? (
    <MusicPlayback key={visit.entry} playing={playing} route={pathname} onError={failMusic} />
  ) : null;
}

function MusicPlayback({
  playing,
  route,
  onError,
}: {
  playing: boolean;
  route: string;
  onError: (message: string) => void;
}) {
  const player = useAudioPlayer(null, {
    updateInterval: 1000,
  });
  const status = useAudioPlayerStatus(player);
  const session = useRef<ReturnType<typeof startMusicPlaybackSession> | null>(null);

  // eslint-disable-next-line react-hooks/immutability -- Expo AudioPlayer exposes imperative native setters, not React state.
  useEffect(() => {
    try {
      // AudioPlayer properties are documented native setters, not React state.
      /* eslint-disable react-hooks/immutability */
      player.loop = true;
      player.volume = 0.3;
      /* eslint-enable react-hooks/immutability */
      if (!playing) {
        player.pause();
        return;
      }
      setPreferenceError("music", null);
      // Native camera/system sheets can change the global audio session while
      // this component stays mounted. Reapply it on resume AND route changes.
      const next = startMusicPlaybackSession({
        player,
        configure: () => setAudioModeAsync({
          allowsRecording: false,
          shouldPlayInBackground: false,
          // The user has explicitly enabled music. SDK 58 also applies this
          // flag to Android's ringer mode: false blocks media in silent/vibrate
          // and repeatedly looks like a broken player to our recovery logic.
          playsInSilentMode: true,
          interruptionMode: "doNotMix",
        }),
        activate: () => setIsAudioActiveAsync(true),
        prepare: () => player.replace(BACKGROUND_MUSIC_SOURCE),
        onError: (reason) => onError(reason === "load"
          ? "Chưa tải được nhạc nền. Hãy thử bật nhạc lại."
          : "Chưa phát được nhạc nền. Hãy thử bật nhạc lại."),
      });
      session.current = next;
      return () => {
        session.current = null;
        next.stop();
      };
    } catch {
      onError("Thiết bị chưa phát được nhạc nền. Hãy thử bật nhạc lại.");
    }
  }, [playing, route, player, onError]);

  useEffect(() => {
    session.current?.observe(Boolean(status.error));
    if (status.playing) setPreferenceError("music", null);
  }, [status.playing, status.isLoaded, status.isBuffering, status.error]);

  return null;
}
