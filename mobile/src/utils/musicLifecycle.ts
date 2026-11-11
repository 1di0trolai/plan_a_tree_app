/** Theo dõi vòng đời ứng dụng và phiên phát nhạc; phục hồi có giới hạn khi tác vụ hệ thống ngắt âm thanh, đồng thời dừng sạch khi rời phiên. */

export interface MusicLifecycle {
  foreground: boolean;
  backgrounded: boolean;
  entry: number;
}

/** System sheets may report inactive; only a real trip to background starts a new visit. */
export function advanceMusicLifecycle(
  state: MusicLifecycle,
  next: string,
): MusicLifecycle {
  if (next === "background")
    return { ...state, foreground: false, backgrounded: true };
  if (next === "active") {
    return {
      foreground: true,
      backgrounded: false,
      entry: state.entry + (state.backgrounded ? 1 : 0),
    };
  }
  return { ...state, foreground: false };
}

interface MusicPlayer {
  readonly playing: boolean;
  readonly isBuffering: boolean;
  readonly isLoaded?: boolean;
  play(): void;
  pause(): void;
}

/** One cancellable session; configure audio before loading and retry a failed native load at most twice. */
export function startMusicPlaybackSession({
  player,
  configure,
  activate,
  prepare,
  onError,
}: {
  player: MusicPlayer;
  configure: () => Promise<void>;
  activate: () => Promise<void>;
  prepare?: () => void;
  onError: (reason: "load" | "play") => void;
}) {
  let current = true;
  let starting = false;
  let attempts = 0;
  let reported = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timerDelay: number | undefined;
  const loaded = () => player.isLoaded !== false;
  const clearRetry = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    timerDelay = undefined;
  };
  const recover = (failed = false) => {
    if (!current || starting || reported) return;
    if (!failed && loaded() && !player.isBuffering && player.playing) {
      clearRetry();
      return;
    }
    // Loading is asynchronous. Do not call it broken just because play() has
    // queued playback; also do not wait forever on a failed/stuck native source.
    const loading = !loaded() || player.isBuffering;
    const delay = loading && !failed ? 15000 : 750;
    if (timer !== undefined && timerDelay === delay) return;
    clearRetry();
    timerDelay = delay;
    timer = setTimeout(() => {
      timer = undefined;
      timerDelay = undefined;
      if (!current || (loaded() && !player.isBuffering && player.playing)) return;
      if (attempts >= 3) {
        if (!reported) {
          reported = true;
          onError(loaded() ? "play" : "load");
        }
      } else {
        void start(failed || !loaded() || player.isBuffering);
      }
    }, delay);
  };
  const start = async (reload = false) => {
    if (!current || starting) return;
    starting = true;
    attempts += 1;
    try {
      await configure();
      if (!current) return;
      await activate();
      if (!current) return;
      if (reload || !loaded()) prepare?.();
      // Expo queues play() while the source buffers. Waiting for isLoaded before
      // configuring the session created a dead end after a mute/reload failure.
      player.play();
    } catch {
      // A transient audio-session error must NOT persist the user's switch off.
      // Recovery below reports only after the bounded attempts are exhausted.
    } finally {
      starting = false;
      if (current) recover();
    }
  };
  void start();
  return {
    observe: (failed = false) => recover(failed),
    stop: () => {
      current = false;
      clearRetry();
      try {
        player.pause();
      } catch {
        /* useAudioPlayer may already have released the native player. */
      }
    },
  };
}
