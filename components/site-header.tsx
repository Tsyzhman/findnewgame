'use client';
import Link from 'next/link';
import { useState, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import { Compass, Menu, Moon, Sun, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useMe } from '@/lib/api';

function readDarkTheme() {
  return document.documentElement.dataset.theme === 'dark';
}
function subscribeTheme(notify: () => void) {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const sync = () => {
    let preference = 'system';
    try {
      preference = localStorage.getItem('fng-theme') || 'system';
    } catch {
      /* Storage is optional. */
    }
    const dark =
      preference === 'dark' || (preference === 'system' && media.matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.documentElement.classList.toggle('dark', dark);
    notify();
  };
  media.addEventListener('change', sync);
  window.addEventListener('storage', sync);
  window.addEventListener('fng-theme-change', notify);
  return () => {
    media.removeEventListener('change', sync);
    window.removeEventListener('storage', sync);
    window.removeEventListener('fng-theme-change', notify);
  };
}

export function SiteHeader() {
  const me = useMe();
  const pathname = usePathname();
  const dark = useSyncExternalStore(subscribeTheme, readDarkTheme, () => false);
  const [menu, setMenu] = useState(false);
  function toggleTheme() {
    const next = !dark;
    document.documentElement.dataset.theme = next ? 'dark' : 'light';
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem('fng-theme', next ? 'dark' : 'light');
    } catch {
      /* Device preferences are optional. */
    }
    window.dispatchEvent(new Event('fng-theme-change'));
  }
  const links = [
    ['/', 'Today'],
    ['/collection', 'My discoveries'],
    ['/about', 'How to play'],
    ['/developer', 'For developers'],
  ];
  return (
    <header className="site-header">
      <div className="container header-inner">
        <Link
          prefetch={false}
          className="brand"
          href="/"
          aria-label="FindNewGame — home"
        >
          <span className="brand-mark">
            <Compass size={23} strokeWidth={1.8} />
          </span>
          FindNewGame<span className="brand-dot">.</span>
        </Link>
        <nav
          className={`main-nav ${menu ? 'is-open' : ''}`}
          aria-label="Main navigation"
        >
          {links.map(([href, label]) => (
            <Link
              prefetch={false}
              key={href}
              href={href}
              aria-current={pathname === href ? 'page' : undefined}
              onClick={() => setMenu(false)}
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="header-actions">
          <Button
            className="icon-button"
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            {dark ? <Sun size={19} /> : <Moon size={19} />}
          </Button>
          <Link prefetch={false} className="header-login" href="/account">
            {me.data?.user ? 'Account' : 'Sign in'}{' '}
            <span aria-hidden="true">↗</span>
          </Link>
          <Button
            className="icon-button mobile-menu-button"
            variant="ghost"
            size="icon"
            onClick={() => setMenu(!menu)}
            aria-label="Toggle menu"
            aria-expanded={menu}
          >
            {menu ? <X /> : <Menu />}
          </Button>
        </div>
      </div>
    </header>
  );
}
