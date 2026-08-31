'use client';
import { useState } from 'react';
import { Check, Download, Share2 } from 'lucide-react';
import { spoilerFreeShare } from '@/lib/scoring';
import { downloadBlob } from '@/lib/download';
import type { DailyView } from '@/lib/types';
import { ActionButton, ErrorBox } from './product-ui';
export function ShareResult({ daily }: { daily: DailyView }) {
  const [copied, setCopied] = useState(false),
    [downloading, setDownloading] = useState(false),
    [error, setError] = useState<unknown>(null);
  const results = daily.slots
    .filter((s) => s.status === 'complete')
    .map((s) => ({
      score: s.score ?? 0,
      accuracy: s.accuracy ?? 0,
      stage: s.stage,
    }));
  const text = spoilerFreeShare(daily.date, results);
  async function share() {
    try {
      if (navigator.share)
        await navigator.share({ title: 'FindNewGame', text });
      else {
        await navigator.clipboard.writeText(text);
        setCopied(true);
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError(e);
    }
  }
  async function download() {
    if (downloading) return;
    setDownloading(true);
    setError(null);
    const canvas = document.createElement('canvas');
    try {
      await document.fonts.ready;
      canvas.width = 1200;
      canvas.height = 630;
      const c = canvas.getContext('2d');
      if (!c)
        throw new Error(
          'Your browser could not create a share card. You can still share the text.',
        );
      c.fillStyle = '#0d1727';
      c.fillRect(0, 0, 1200, 630);
      c.fillStyle = '#89b7ef';
      c.font = '600 32px Onest, sans-serif';
      c.fillText('FindNewGame.', 72, 90);
      c.fillStyle = '#f1f6ff';
      c.font = '600 54px Onest, sans-serif';
      c.fillText('Today, curiosity won.', 72, 179);
      c.font = '24px Onest, sans-serif';
      c.fillStyle = '#91a2ba';
      c.fillText(daily.date + ' · Your daily three', 72, 222);
      for (let row = 0; row < results.length; row++) {
        for (let col = 0; col < 6; col++) {
          c.fillStyle =
            col < results[row].stage - 1
              ? '#51617a'
              : col === results[row].stage - 1
                ? results[row].accuracy >= 70
                  ? '#91d3b5'
                  : '#b8a8ee'
                : '#1b2b44';
          c.beginPath();
          c.roundRect(72 + col * 66, 273 + row * 70, 50, 50, 10);
          c.fill();
        }
      }
      c.fillStyle = '#f1f6ff';
      c.font = '650 92px Onest, sans-serif';
      c.fillText(daily.totalScore.toLocaleString('en-US'), 665, 365);
      c.font = '26px Onest, sans-serif';
      c.fillStyle = '#91a2ba';
      c.fillText('points · no spoilers', 665, 415);
      c.font = '23px Onest, sans-serif';
      c.fillText('Three unknown games. One new discovery.', 72, 558);
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (value) =>
            value
              ? resolve(value)
              : reject(
                  new Error('The share card could not be saved. Please retry.'),
                ),
          'image/png',
        );
      });
      await downloadBlob(blob, `FindNewGame-${daily.date}.png`);
    } catch (e) {
      setError(e);
    } finally {
      canvas.width = 0;
      canvas.height = 0;
      setDownloading(false);
    }
  }
  return (
    <div className="share-area">
      <pre className="share-preview" aria-label="Spoiler-free share text">
        {text}
      </pre>
      <div className="inline-actions">
        <ActionButton onClick={share}>
          {copied ? <Check size={16} /> : <Share2 size={16} />}{' '}
          {copied ? 'Copied!' : 'Share without spoilers'}
        </ActionButton>
        <ActionButton secondary busy={downloading} onClick={download}>
          <Download size={16} /> Download card
        </ActionButton>
      </div>
      {error ? <ErrorBox error={error} /> : null}
    </div>
  );
}
