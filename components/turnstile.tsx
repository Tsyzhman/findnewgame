'use client';
import { useEffect, useRef, useState } from 'react';
import { ActionButton } from './product-ui';
type TurnstileApi = {
  render: (element: HTMLElement, options: Record<string, unknown>) => string;
  remove: (id: string) => void;
};
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}
let loading: Promise<void> | undefined;
function load() {
  return (loading ??= new Promise<void>((resolve, reject) => {
    if (window.turnstile) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src =
      'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    const cleanup = () => {
      window.clearTimeout(timeout);
      script.onload = null;
      script.onerror = null;
      script.remove();
    };
    const fail = () => {
      cleanup();
      loading = undefined;
      reject(new Error('Security check could not load.'));
    };
    const timeout = window.setTimeout(fail, 15000);
    script.onload = () => {
      cleanup();
      if (window.turnstile) resolve();
      else fail();
    };
    script.onerror = fail;
    document.head.appendChild(script);
  }));
}
export function SecurityCheck({
  siteKey,
  onToken,
}: {
  siteKey: string | null;
  onToken: (token: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null),
    callback = useRef(onToken);
  const [error, setError] = useState(false),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    callback.current = onToken;
  }, [onToken]);
  useEffect(() => {
    if (!siteKey) return;
    let cancelled = false,
      widget: string | undefined;
    load()
      .then(() => {
        if (!cancelled && ref.current)
          widget = window.turnstile!.render(ref.current, {
            sitekey: siteKey,
            theme: 'auto',
            language: 'en',
            callback: (token: string) => {
              if (!cancelled) {
                callback.current(token);
                setError(false);
              }
            },
            'expired-callback': () => {
              if (!cancelled) callback.current('');
            },
            'error-callback': () => {
              if (!cancelled) {
                callback.current('');
                setError(true);
              }
            },
          });
      })
      .catch(() => {
        if (!cancelled) {
          callback.current('');
          setError(true);
        }
      });
    return () => {
      cancelled = true;
      if (widget) window.turnstile?.remove(widget);
    };
  }, [siteKey, retry]);
  return siteKey ? (
    <div className="security-check">
      <div ref={ref} aria-label="Security check" />
      {error && (
        <div role="alert">
          <p>
            The security check could not load. Check your connection or content
            blocker, then retry.
          </p>
          <ActionButton
            secondary
            onClick={() => {
              callback.current('');
              setError(false);
              setRetry(retry + 1);
            }}
          >
            Retry security check
          </ActionButton>
        </div>
      )}
    </div>
  ) : null;
}
