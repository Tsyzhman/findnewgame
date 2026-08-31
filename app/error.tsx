'use client';
import Link from 'next/link';
import { useEffect } from 'react';
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Page render failed', error.digest ?? 'unavailable');
  }, [error]);
  return (
    <main className="container app-main">
      <div className="empty-state surface" role="alert">
        <h1>This discovery hit a snag.</h1>
        <p>
          Your saved progress is still on the server. Try loading the page
          again.
        </p>
        <button className="button-primary" onClick={reset}>
          Try again
        </button>
        <Link prefetch={false} className="text-link" href="/">
          Back to home
        </Link>
      </div>
    </main>
  );
}
