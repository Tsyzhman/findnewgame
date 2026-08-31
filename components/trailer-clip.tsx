'use client';
import { useEffect, useRef, useState } from 'react';
import { Pause, Play, RefreshCw, Video, Volume2, VolumeX } from 'lucide-react';
import { ActionButton } from './product-ui';

type Player = {
  getCurrentTime(): number;
  pauseVideo(): void;
  playVideo(): void;
  loadVideoById(options: {
    videoId: string;
    startSeconds: number;
    endSeconds: number;
  }): void;
  destroy(): void;
  getIframe(): HTMLIFrameElement;
  mute(): void;
  unMute(): void;
};
type YouTube = {
  Player: new (
    element: HTMLElement,
    options: {
      host: string;
      width: string;
      height: string;
      videoId: string;
      playerVars: Record<string, string | number>;
      events: {
        onReady(event: { target: Player }): void;
        onStateChange(event: { target: Player; data: number }): void;
        onError(): void;
        onAutoplayBlocked(): void;
      };
    },
  ) => Player;
};
declare global {
  interface Window {
    YT?: YouTube;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YouTube> | undefined;
function loadYouTube() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  apiPromise ??= new Promise<YouTube>((resolve, reject) => {
    const script = document.createElement('script');
    const previous = window.onYouTubeIframeAPIReady;
    const cleanup = () => {
      window.clearTimeout(timeout);
      script.onerror = null;
      if (window.onYouTubeIframeAPIReady === ready)
        window.onYouTubeIframeAPIReady = previous;
      script.remove();
    };
    const ready = () => {
      cleanup();
      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error('YouTube player is unavailable.'));
      previous?.();
    };
    const fail = () => {
      cleanup();
      reject(new Error('YouTube did not load.'));
    };
    const timeout = window.setTimeout(fail, 15000);
    window.onYouTubeIframeAPIReady = ready;
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = fail;
    document.head.appendChild(script);
  }).catch((error) => {
    apiPromise = undefined;
    throw error;
  });
  return apiPromise;
}

// Mounted only after explicit consent. Every player, timer, and iframe is
// released when the player changes clue, leaves the page, or replays the clip.
export function TrailerClip({
  youtubeId,
  seconds,
}: {
  youtubeId: string;
  seconds: 5 | 15;
}) {
  const host = useRef<HTMLDivElement>(null),
    player = useRef<Player | null>(null);
  const [state, setState] = useState<
    'loading' | 'playing' | 'blocked' | 'finished' | 'error'
  >('loading');
  const [muted, setMuted] = useState(false);
  useEffect(() => {
    let cancelled = false,
      completed = false,
      timer = 0;
    const release = () => {
      window.clearTimeout(readyTimeout);
      window.clearInterval(timer);
      const current = player.current;
      player.current = null;
      current?.destroy();
    };
    const fail = () => {
      if (cancelled || completed) return;
      completed = true;
      release();
      setState('error');
    };
    const readyTimeout = window.setTimeout(fail, 20000);
    const finish = () => {
      if (cancelled || completed) return;
      completed = true;
      release();
      setState('finished');
    };
    const onVisibility = () => {
      if (document.hidden) player.current?.pauseVideo();
    };
    document.addEventListener('visibilitychange', onVisibility);
    void loadYouTube()
      .then((api) => {
        if (cancelled || completed || !host.current) return;
        const mount = document.createElement('div');
        host.current.appendChild(mount);
        player.current = new api.Player(mount, {
          host: 'https://www.youtube-nocookie.com',
          width: '100%',
          height: '100%',
          videoId: youtubeId,
          playerVars: {
            controls: 0,
            disablekb: 1,
            rel: 0,
            playsinline: 1,
            fs: 0,
            start: 0,
            end: seconds,
            hl: 'en',
            cc_lang_pref: 'en',
            cc_load_policy: 1,
            origin: window.location.origin,
          },
          events: {
            onReady: ({ target }) => {
              window.clearTimeout(readyTimeout);
              if (cancelled || completed) return;
              target.getIframe().title = `Mystery trailer, first ${seconds} seconds`;
              target.getIframe().referrerPolicy =
                'strict-origin-when-cross-origin';
              target.loadVideoById({
                videoId: youtubeId,
                startSeconds: 0,
                endSeconds: seconds,
              });
              setState('blocked');
            },
            onStateChange: ({ target, data }) => {
              if (cancelled || completed) return;
              window.clearInterval(timer);
              if (data === 1) {
                setState('playing');
                timer = window.setInterval(() => {
                  if (target.getCurrentTime() >= seconds) finish();
                }, 100);
              } else if (data === 0) finish();
              else if (data === 2) setState('blocked');
            },
            onError: fail,
            onAutoplayBlocked: () => {
              if (!cancelled && !completed) setState('blocked');
            },
          },
        });
      })
      .catch(fail);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      release();
    };
  }, [youtubeId, seconds]);
  return (
    <div className="trailer-clip">
      <div
        ref={host}
        className="trailer-player"
        aria-label={`Mystery trailer, first ${seconds} seconds`}
      />
      {(state === 'playing' || state === 'blocked') && (
        <div className="trailer-controls">
          <ActionButton
            secondary
            onClick={() =>
              state === 'playing'
                ? player.current?.pauseVideo()
                : player.current?.playVideo()
            }
          >
            {state === 'playing' ? <Pause size={16} /> : <Play size={16} />}
            {state === 'playing' ? 'Pause clip' : 'Play clip'}
          </ActionButton>
          <ActionButton
            secondary
            onClick={() => {
              if (muted) player.current?.unMute();
              else player.current?.mute();
              setMuted(!muted);
            }}
            aria-label={muted ? 'Unmute trailer' : 'Mute trailer'}
          >
            {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </ActionButton>
          <span>{seconds} seconds max</span>
        </div>
      )}
      {(state === 'loading' || state === 'error' || state === 'finished') && (
        <div className="trailer-state" aria-live="polite">
          {state === 'loading' ? (
            <>
              <Video size={30} />
              <p>Loading your {seconds}-second clue…</p>
            </>
          ) : state === 'error' ? (
            <>
              <Video size={30} />
              <p>YouTube could not play this clip.</p>
              <span>
                Replay the segment to retry, or continue to the next clue.
              </span>
            </>
          ) : (
            <>
              <RefreshCw size={30} />
              <p>That’s your first {seconds} seconds.</p>
              <span>
                Replay the segment, make your guess, or ask for another clue.
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
