import Link from 'next/link';
import { ArrowRight, Eye, Heart, Layers, ShieldCheck } from 'lucide-react';
export const metadata = {
  title: 'How FindNewGame works',
  description:
    'Three indie games a day, six possible clues, and a new way to discover what you love.',
};
export default function AboutPage() {
  return (
    <main className="container app-main">
      <div className="page-heading">
        <div>
          <p className="eyebrow">A DAILY DOSE OF GAME CURIOSITY</p>
          <h1>
            Know the feeling.
            <br />
            Then learn the name.
          </h1>
          <p className="page-description">
            Three indie games picked around your taste. A few clues. A chance to
            surprise yourself.
          </p>
        </div>
      </div>
      <div className="explanation-grid">
        <section className="surface settings-card">
          <Eye className="accent-icon" />
          <h2>1. Trust your first impression</h2>
          <p>
            Start with title-free artwork. Choose the genre, core gameplay, and
            mood you think it communicates, using real Steam tags.
          </p>
        </section>
        <section className="surface settings-card">
          <Layers className="accent-icon" />
          <h2>2. Follow your curiosity</h2>
          <p>
            Ask for a screenshot, a gallery, a five-second trailer, a
            fifteen-second trailer, or a short description. You can request a
            clue without guessing.
          </p>
        </section>
        <section className="surface settings-card">
          <Heart className="accent-icon" />
          <h2>3. Meet your next favorite</h2>
          <p>
            Lock your guess to reveal the game. Save it, follow it, or visit
            Steam. Finish all three daily games to keep your streak going.
          </p>
        </section>
      </div>
      <article className="surface settings-card prose reading-column">
        <h2>A good guess is about understanding.</h2>
        <p>
          Genre contributes 50% of your match, gameplay 35%, and mood 15%.
          Specific tags carry more weight than broad labels. Extra guesses can
          lower your match, so choose what you actually see.
        </p>
        <p>
          The maximum score falls as you uncover clues: 1,000 → 800 → 650 → 500
          → 350 → 150. Your final score is that stage’s maximum multiplied by
          your weighted match. You never need a perfect score to complete your
          Daily.
        </p>
        <h2>Personal, with room for surprise.</h2>
        <p>
          Your explicit taste profile sets the direction. Saving, following,
          visiting Steam, and saying “I’d play this” or “Not for me” can refine
          it. Guess accuracy never rewrites your taste.
        </p>
        <p>
          Safe, Balanced, and Curious adjust how far we explore beyond your
          closest matches. Eligible games are sampled at random, with a gentle
          boost for games that have had fewer independent views. Paying never
          changes this selection.
        </p>
        <p>
          Daily sets reset at midnight in your selected time zone and stay fixed
          across reloads. You will not ordinarily see the same game again. A
          clearly marked retest is only possible after changed materials and at
          least fourteen days.
        </p>
        <h2>Useful to the people making games.</h2>
        <p>
          Each clue shows developers what their store presentation communicates.
          Aggregate reports separate versions and experiments, and hide small
          samples. The score measures intended perception, not whether a game is
          good.
        </p>
        <h2>Clear boundaries.</h2>
        <p>
          Sponsored cards are labeled and sit below the quiz. A campaign cannot
          advertise its own game or studio inside that game’s round. No paid
          organic boosts, paid reviews, or rewards for particular answers.
        </p>
        <div className="notice info">
          <ShieldCheck size={20} />
          <p>
            The current sample catalog demonstrates the flow using public Steam
            materials. Its target answers are illustrative, not verified
            developer feedback. Sample sessions never count as live calibration
            data.
          </p>
        </div>
        <div className="form-actions">
          <Link prefetch={false} className="button-primary" href="/today">
            Find today’s games <ArrowRight size={17} />
          </Link>
          <Link
            prefetch={false}
            className="button-secondary"
            href="/play?demo=1"
          >
            Try the sample Daily
          </Link>
        </div>
      </article>
    </main>
  );
}
