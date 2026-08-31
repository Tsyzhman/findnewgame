/* oxlint-disable next/no-img-element -- Artwork uses the size-bounded authenticated asset endpoint or an approved Steam CDN; a generic image optimizer would lose the session and clue access checks. Dimensions and loading behavior are controlled by the presentation. */
import Link from 'next/link';
import {
  ArrowRight,
  Check,
  Compass,
  Eye,
  Layers3,
  MousePointer2,
  Sparkles,
} from 'lucide-react';
import { HomeSwitch } from '@/components/daily-hub';

export default function Home() {
  return (
    <HomeSwitch>
      <main className="container home-page">
        <section className="home-hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow">
              <span className="live-dot" /> A LITTLE RITUAL. A NEW DISCOVERY.
            </p>
            <h1 id="hero-title">
              Your next
              <br />
              favorite game.
              <br />
              <span>A mystery for now.</span>
            </h1>
            <p className="lead">
              Three unknown indie games. Six clues.
              <br className="desktop-break" /> Can you figure them out before
              the reveal?
            </p>
            <div className="hero-actions">
              <Link
                prefetch={false}
                className="button-primary"
                href="/play?demo=1"
              >
                Play a demo <ArrowRight size={19} />
              </Link>
              <Link
                prefetch={false}
                className="button-secondary"
                href="/onboarding"
              >
                Find my taste <Compass size={18} />
              </Link>
            </div>
            <p className="quiet-note">
              <Check size={15} /> Always free · no downloads · about 5 minutes
            </p>
          </div>
          <div className="preview-scene">
            <div className="preview-topline">
              <span>
                <Sparkles size={15} /> FIRST IMPRESSIONS
              </span>
              <span>01 / 03</span>
            </div>
            <div className="preview-art">
              <img
                src="https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1562430/library_hero.jpg"
                alt="A mysterious seascape: sample game artwork"
                fetchPriority="high"
              />
              <span className="art-label">
                <Eye size={14} /> Just the artwork, for now
              </span>
              <div className="art-caption">
                <span>UNKNOWN GAME NO. 01</span>
                <strong>What do you see beneath the surface?</strong>
              </div>
            </div>
            <div className="preview-question">
              <span>What’s your first guess?</span>
              <span className="max-score">up to 1,000 points</span>
            </div>
            <div className="preview-tags">
              <span>Adventure</span>
              <span>Fishing</span>
              <span>Atmospheric</span>
              <span className="tag-more">+ your guess</span>
            </div>
            <div className="preview-bottom">
              <div className="clue-dots">
                <i className="active" />
                <i />
                <i />
                <i />
                <i />
                <i />
              </div>
              <span>
                Every clue tells a little more <ArrowRight size={15} />
              </span>
            </div>
            <div className="scene-note">
              <div className="note-icon">
                <Compass size={20} />
              </div>
              <div>
                <strong>Your taste sets the possibilities.</strong>
                <span>Chance picks your three.</span>
              </div>
            </div>
          </div>
        </section>
        <section className="daily-teaser" aria-labelledby="daily-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">YOUR DAILY DISCOVERY</p>
              <h2 id="daily-title">Less scrolling. More discovering.</h2>
            </div>
            <Link prefetch={false} className="text-link" href="/play?demo=1">
              Meet your first mystery <ArrowRight size={17} />
            </Link>
          </div>
          <div className="ritual-grid">
            <article className="ritual-card">
              <span className="ritual-number">01</span>
              <Eye size={25} />
              <h3>Take a closer look</h3>
              <p>
                Start with the artwork. Guess the genre, gameplay, and mood
                using real Steam tags.
              </p>
            </article>
            <article className="ritual-card">
              <span className="ritual-number">02</span>
              <Layers3 size={25} />
              <h3>Follow the clues</h3>
              <p>
                A screenshot, a gallery, a trailer. The sooner it clicks, the
                more points you earn.
              </p>
            </article>
            <article className="ritual-card">
              <span className="ritual-number">03</span>
              <MousePointer2 size={25} />
              <h3>Find your kind of game</h3>
              <p>
                Meet the game behind the mystery. Save your discovery or take a
                look on Steam.
              </p>
            </article>
          </div>
        </section>
        <section className="developer-callout">
          <div className="dev-callout-icon">
            <Layers3 size={28} />
          </div>
          <div>
            <p className="eyebrow">ON THE OTHER SIDE OF THE ARTWORK</p>
            <h2>Making a game? See it through fresh eyes.</h2>
            <p>
              Every round helps you understand which store assets tell your
              game’s story.
            </p>
          </div>
          <Link prefetch={false} href="/developer" className="button-secondary">
            For developers <ArrowRight size={17} />
          </Link>
        </section>
        <p className="catalog-note">
          Private prototype · sample catalog from public Steam materials · not
          affiliated with Valve
        </p>
      </main>
    </HomeSwitch>
  );
}
