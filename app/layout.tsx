import Link from 'next/link';
import type { Metadata } from 'next';
import { env } from 'cloudflare:workers';
import { Onest } from 'next/font/google';
import { SiteHeader } from '@/components/site-header';
import { AppProvider } from '@/components/app-provider';
import './globals.css';

const onest = Onest({
  variable: '--font-onest',
  subsets: ['latin'],
  display: 'swap',
});
export function generateMetadata(): Metadata {
  let origin: URL | undefined;
  try {
    const candidate = new URL(env.SITE_URL || 'http://localhost:3000');
    if (
      candidate.protocol === 'https:' ||
      (import.meta.env.DEV && candidate.hostname === 'localhost')
    )
      origin = new URL(candidate.origin);
  } catch {
    /* A relative preview is used until the operator configures SITE_URL. */
  }
  return {
    metadataBase: origin,
    title: {
      default: 'FindNewGame — three games, one new discovery',
      template: '%s · FindNewGame',
    },
    description:
      'Three unknown indie games a day. Guess the genre, gameplay, and mood from clues, and discover your next favorite game.',
    openGraph: {
      title: 'FindNewGame',
      description: 'Three unknown games. Six clues. One new discovery.',
      locale: 'en_US',
      type: 'website',
      images: [
        {
          url: origin ? new URL('/og.png', origin).href : '/og.png',
          width: 1729,
          height: 910,
          alt: 'FindNewGame — Three unknown games. One new discovery.',
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: 'FindNewGame',
      description: 'Get to know the game before you know its name.',
      images: [origin ? new URL('/og.png', origin).href : '/og.png'],
    },
    icons: { icon: '/favicon.svg' },
  };
}
const themeScript = `(function(){try{var t=localStorage.getItem('fng-theme')||'system';var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light';document.documentElement.classList.toggle('dark',d)}catch(e){}})()`;
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className={onest.variable}>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <AppProvider>
          <SiteHeader />
          <div id="main-content">{children}</div>
          <footer className="site-footer container">
            <Link prefetch={false} className="brand footer-brand" href="/">
              FindNewGame<span className="brand-dot">.</span>
            </Link>
            <span>Discover a game. Help its maker.</span>
            <nav aria-label="Footer navigation">
              <Link prefetch={false} href="/about">
                How it works
              </Link>
              <Link prefetch={false} href="/privacy">
                Privacy
              </Link>
              <Link prefetch={false} href="/support">
                Support the project
              </Link>
            </nav>
          </footer>
        </AppProvider>
      </body>
    </html>
  );
}
