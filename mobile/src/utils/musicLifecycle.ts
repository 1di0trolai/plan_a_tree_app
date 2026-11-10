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
  play(): void;
  pause(): void;
}

/** One foreground/route session, with at most two retries after native interruption. */
export function startMusicPlaybackSession({
  player,
  configure,
  activate,
  onError,
}: {
  player: MusicPlayer;
  configure: () => Promise<void>;
  activate: () => Promise<void>;
  onError: () => void;
}) {
  let current = true;
  let starting = false;
  let attempts = 0;
  let reported = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clearRetry = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const recover = () => {
    if (!current || starting || timer !== undefined || player.playing || player.isBuffering)
      return;
    if (attempts >= 3) {
      if (!reported) {
        reported = true;
        onError();
      }
      return;
    }
    // Camera teardown and iOS audio-session deactivation may finish AFTER the
    // route changes. Verify actual native playback instead of trusting play().
    timer = setTimeout(() => {
      timer = undefined;
      if (current && !player.playing && !player.isBuffering) void start();
    }, 750);
  };
  const start = async () => {
    if (!current || starting) return;
    starting = true;
    attempts += 1;
    try {
      await configure();
      if (!current) return;
      await activate();
      if (current) player.play();
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
    observe: () => {
      if (!current) return;
      if (player.playing || player.isBuffering) clearRetry();
      else recover();
    },
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
