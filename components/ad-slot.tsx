/* oxlint-disable next/no-img-element -- Artwork uses the size-bounded authenticated asset endpoint or an approved Steam CDN; a generic image optimizer would lose the session and clue access checks. Dimensions and loading behavior are controlled by the presentation. */
'use client';
import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight } from 'lucide-react';
import { api } from '@/lib/api';
type Ad = {
  offerId: string;
  campaignId: string;
  title: string;
  description: string;
  image: string;
  destination: string;
  isTest: boolean;
};
export function AdSlot({
  roundId,
  enabled,
}: {
  roundId: string;
  enabled: boolean;
}) {
  const query = useQuery({
    queryKey: ['ad', roundId],
    queryFn: () => api<{ ad: Ad | null }>('ads/next', { body: { roundId } }),
    enabled,
    staleTime: Infinity,
    retry: false,
  });
  return query.data?.ad ? <ViewableAd ad={query.data.ad} /> : null;
}
function ViewableAd({ ad }: { ad: Ad }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let timer: ReturnType<typeof setTimeout> | undefined,
      ratio = 0,
      started = 0,
      submitted = false,
      disposed = false;
    const clear = () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
      started = 0;
    };
    const evaluate = () => {
      if (submitted || disposed) return;
      if (document.visibilityState !== 'visible' || ratio < 0.5) {
        clear();
        return;
      }
      if (timer) return;
      started = performance.now();
      timer = setTimeout(async () => {
        timer = undefined;
        if (document.visibilityState !== 'visible' || ratio < 0.5 || disposed)
          return;
        submitted = true;
        try {
          await api('ads/impression', {
            body: {
              offerId: ad.offerId,
              visibleMs: Math.floor(performance.now() - started),
              ratio,
            },
          });
        } catch {
          /* Never retry a billable event in a tight loop. */
        }
      }, 1100);
    };
    const observer = new IntersectionObserver(
      (entries) => {
        ratio = entries[0].intersectionRatio;
        evaluate();
      },
      { threshold: [0, 0.5, 1] },
    );
    observer.observe(element);
    document.addEventListener('visibilitychange', evaluate);
    return () => {
      disposed = true;
      observer.disconnect();
      clear();
      document.removeEventListener('visibilitychange', evaluate);
    };
  }, [ad.offerId]);
  return (
    <aside className="ad-slot" ref={ref} aria-label="Sponsored placement">
      <div className="sponsored-label">
        Sponsored{ad.isTest ? ' · Local test' : ''}
      </div>
      <img src={ad.image} alt={`${ad.title} advertisement`} loading="lazy" />
      <div>
        <h3>{ad.title}</h3>
        <p>{ad.description}</p>
      </div>
      <a
        href={ad.destination}
        target="_blank"
        rel="sponsored noopener noreferrer"
        className="button-secondary"
        onClick={() => {
          void api('ads/click', { body: { offerId: ad.offerId } }).catch(
            () => {},
          );
        }}
      >
        Learn more <ArrowUpRight size={16} />
      </a>
      <span className="ad-principle">
        Separate from your daily discoveries.
      </span>
    </aside>
  );
}
