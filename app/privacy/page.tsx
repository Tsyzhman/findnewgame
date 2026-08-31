import Link from 'next/link';
export const metadata = {
  title: 'Privacy & data',
  description:
    'How FindNewGame uses your profile, quiz answers, preferences, and optional payment data.',
};
export default function PrivacyPage() {
  return (
    <main className="container app-main">
      <div className="page-heading">
        <div>
          <p className="eyebrow">PLAIN-LANGUAGE DATA GUIDE</p>
          <h1>
            Your discoveries.
            <br />
            Your privacy.
          </h1>
          <p className="page-description">
            This beta guide describes the app’s current behavior. It is not a
            claim of legal certification.
          </p>
        </div>
      </div>
      <article className="surface settings-card prose reading-column">
        <h2>What the app stores</h2>
        <p>
          Signing in creates a FindNewGame account using the identity and email
          supplied by ChatGPT. The app stores your display name, time zone,
          explicit taste preferences, daily assignments, guesses, saved and
          followed games, and optional feedback.
        </p>
        <p>
          The app also stores your last authenticated activity, the start of
          your live-beta retention cohort, and whether you returned on day
          seven. A studio has one latest dashboard-visit timestamp. These
          measurements support aggregate product checks without recording a
          browsing history. They are included in your account export.
        </p>
        <p>
          A Daily also keeps a compact record of its discovery policy and tag
          affinity at assignment time. If contextual exploration is enabled, it
          learns only from your own recent eligible ratings and saved, followed,
          or opened games. Missing feedback and quiz accuracy are not dislikes
          or rewards. Completed-round decision records are included in your
          export and removed with your account; there is no shared model
          containing other players’ histories.
        </p>
        <p>
          Anonymous demos use a random, HttpOnly session cookie. Demo accounts
          expire after 24 hours and are removed by maintenance. Your light or
          dark theme is a device preference stored in your browser.
        </p>
        <h2>What developers can see</h2>
        <p>
          Developers see aggregate calibration metrics for their own games.
          Reports require at least 20 eligible independent participants before
          answers are shown, and each audience segment has the same minimum.
          Owners, team members, demos, and repeat exposures are excluded from
          first-impression metrics.
        </p>
        <p>
          Your email, account identifier, and individual answer history are
          never included in developer reports. Sample sizes below the reporting
          threshold may be shown as counts without answers.
        </p>
        <h2>External content and payments</h2>
        <p>
          Steam supplies public store information. Quiz images are served
          through the app; revealed game artwork can load from Steam. YouTube
          trailers load only after you press the explicit play control, using
          YouTube’s privacy-enhanced embed domain. These services process
          requests under their own policies.
        </p>
        <p>
          Optional payments use the configured provider’s hosted checkout.
          FindNewGame does not collect card details. It retains invoice status,
          amount, currency, provider reference, and a hash of each verified
          webhook for reconciliation. Native Lava donation links do not
          automatically provide a donation confirmation to this app.
        </p>
        <h2>Security and retention</h2>
        <p>
          Short-lived, hashed rate-limit keys help prevent abuse. Payment
          notifications are verified on the server. Cloudflare may process
          connection metadata to deliver and secure the site; Turnstile is used
          only when configured.
        </p>
        <p>
          Profile and game history remain until you delete your account. Expired
          demo sessions, ad offers, and rate-limit entries are cleared by
          maintenance. The app uses a short-lived in-memory interface cache, not
          persistent browser storage for your account data.
        </p>
        <h2>Your controls</h2>
        <p>
          In your account, you can export your data, change your preferences, or
          permanently remove your profile and personal quiz history. Deleting a
          developer account withdraws its games and pauses campaigns. Required
          payment records remain without the account link. Signing in again
          creates a new profile.
        </p>
        <p>
          Before a public commercial launch, the operator must publish its legal
          identity, a monitored privacy contact, payment terms, and the
          applicable retention policy. These are not configured in this private
          beta.
        </p>
        <Link prefetch={false} className="button-primary" href="/account">
          Manage my account
        </Link>
      </article>
    </main>
  );
}
