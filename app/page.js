import './globals.css';

export default function Home() {
  return (
    <div className="wrap">
      <header className="top">
        <h1>Job Hub</h1>
        <span className="sub">Northern Colorado</span>
      </header>

      <p style={{ maxWidth: 620, color: 'var(--color-neutral-600)' }}>
        Placeholder for the public half of the site — bio, experience, and
        resume downloads. This is the URL you put on applications; it costs
        nothing extra and makes the project double as a credibility asset.
      </p>

      <p><a href="/hub">→ Job hub</a></p>
    </div>
  );
}
