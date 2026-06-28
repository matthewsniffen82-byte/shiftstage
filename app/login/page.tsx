import Link from "next/link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function LoginChoicePage() {
  return (
    <main className="login-choice-shell">
      <nav className="top-nav" aria-label="Primary">
        <Link className="brand" href="/">
          Mydancr
        </Link>
        <Link className="back-link" href="/">
          Back to site
        </Link>
      </nav>

      <section className="choice-wrap" aria-labelledby="loginChoiceTitle">
        <div className="choice-copy">
          <span className="eyebrow">Login / Join</span>
          <h1 id="loginChoiceTitle">Choose your account.</h1>
          <p>Pick the side of Dancr you use. You can sign in or create an account on the next screen.</p>
        </div>

        <div className="choice-grid">
          <Link className="choice-card customer-card" href="/account?role=customer">
            <span>Customer</span>
            <strong>Plan your night</strong>
            <small>Save dancers, follow venues, get notifications, and track who is working.</small>
          </Link>

          <Link className="choice-card dancer-card-choice" href="/dashboard/dancer">
            <span>Dancer</span>
            <strong>Manage your profile</strong>
            <small>Set up your public profile, manage shifts, photos, analytics, and billing.</small>
          </Link>
        </div>
      </section>

      <style>{`
        body {
          margin: 0;
          background: #050507;
          color: #fff;
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }

        .login-choice-shell {
          min-height: 100vh;
          padding: 22px clamp(16px, 4vw, 56px) 56px;
          background:
            radial-gradient(circle at 82% 4%, rgba(124, 58, 237, .28), transparent 25rem),
            radial-gradient(circle at 16% 18%, rgba(34, 199, 255, .14), transparent 22rem),
            linear-gradient(180deg, #080810 0%, #050507 68%);
        }

        .top-nav {
          max-width: 1080px;
          margin: 0 auto clamp(38px, 8vw, 84px);
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
        }

        .brand,
        .back-link,
        .choice-card {
          color: inherit;
          text-decoration: none;
        }

        .brand {
          font-weight: 950;
          font-size: 24px;
          letter-spacing: -.04em;
          text-shadow: 0 0 16px rgba(255,255,255,.24);
        }

        .brand::first-letter {
          text-transform: lowercase;
        }

        .back-link {
          min-height: 42px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 0 16px;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,.12);
          background: rgba(255,255,255,.045);
          font-weight: 850;
          color: rgba(255,255,255,.86);
        }

        .choice-wrap {
          max-width: 1080px;
          margin: 0 auto;
          display: grid;
          gap: clamp(24px, 5vw, 46px);
        }

        .choice-copy {
          max-width: 760px;
          display: grid;
          gap: 16px;
        }

        .eyebrow {
          color: #94e5ff;
          text-transform: uppercase;
          letter-spacing: .18em;
          font-size: 12px;
          font-weight: 950;
        }

        h1 {
          margin: 0;
          font-size: clamp(46px, 8vw, 92px);
          line-height: .9;
          letter-spacing: -.03em;
        }

        p {
          margin: 0;
          max-width: 56ch;
          color: rgba(247, 242, 255, .72);
          font-size: clamp(17px, 2.2vw, 21px);
          line-height: 1.55;
          font-weight: 650;
        }

        .choice-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: clamp(14px, 3vw, 24px);
        }

        .choice-card {
          min-height: 220px;
          padding: clamp(22px, 4vw, 34px);
          display: grid;
          align-content: end;
          gap: 12px;
          border-radius: 18px;
          border: 1px solid rgba(124, 58, 237, .42);
          background:
            radial-gradient(circle at 86% 10%, rgba(124, 58, 237, .34), transparent 14rem),
            linear-gradient(180deg, rgba(18, 17, 26, .96), rgba(7, 7, 11, .98));
          box-shadow:
            0 24px 70px rgba(0,0,0,.42),
            0 0 26px rgba(124, 58, 237, .16),
            inset 0 0 0 1px rgba(255,255,255,.026);
          transition: transform .18s ease, border-color .18s ease, box-shadow .18s ease;
        }

        .choice-card:hover,
        .choice-card:focus-visible {
          transform: translateY(-3px);
          border-color: rgba(168, 85, 247, .78);
          box-shadow:
            0 28px 82px rgba(0,0,0,.48),
            0 0 34px rgba(124, 58, 237, .34),
            inset 0 0 0 1px rgba(255,255,255,.04);
          outline: none;
        }

        .choice-card span {
          width: fit-content;
          min-height: 30px;
          display: inline-flex;
          align-items: center;
          padding: 0 12px;
          border-radius: 999px;
          color: #94e5ff;
          background: rgba(34, 199, 255, .12);
          border: 1px solid rgba(34, 199, 255, .28);
          font-size: 12px;
          font-weight: 950;
          letter-spacing: .08em;
          text-transform: uppercase;
        }

        .choice-card strong {
          font-size: clamp(28px, 4vw, 44px);
          line-height: .96;
          letter-spacing: -.03em;
        }

        .choice-card small {
          max-width: 38ch;
          color: rgba(247, 242, 255, .68);
          font-size: 15px;
          line-height: 1.45;
          font-weight: 700;
        }

        .dancer-card-choice {
          border-color: rgba(236, 72, 153, .34);
          background:
            radial-gradient(circle at 84% 10%, rgba(236, 72, 153, .20), transparent 14rem),
            radial-gradient(circle at 12% 88%, rgba(124, 58, 237, .28), transparent 16rem),
            linear-gradient(180deg, rgba(18, 17, 26, .96), rgba(7, 7, 11, .98));
        }

        @media (max-width: 720px) {
          .choice-grid {
            grid-template-columns: 1fr;
          }

          .choice-card {
            min-height: 178px;
          }
        }
      `}</style>
    </main>
  );
}
