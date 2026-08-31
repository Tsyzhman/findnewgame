import Link from 'next/link';
export default function NotFound() {
  return (
    <main className="container app-main">
      <div className="empty-state surface">
        <p className="eyebrow">404 · A DIFFERENT KIND OF MYSTERY</p>
        <h1>This page wandered off.</h1>
        <p>There are still three games waiting to be discovered.</p>
        <Link prefetch={false} className="button-primary" href="/">
          Back to FindNewGame
        </Link>
      </div>
    </main>
  );
}
