import './globals.css';

export default function Home() {
  return (
    <div className="wrap">
      <header className="top">
        <h1>Nick Graziano</h1>
        <span className="sub">People operations · Northern Colorado</span>
      </header>

      <p style={{ maxWidth: 620, color: 'var(--muted)' }}>
        Placeholder for the public half of the site — bio, experience, and
        resume downloads. This is the URL you put on applications; it costs
        nothing extra and makes the project double as a credibility asset.
      </p>

      <p><a href="/hub">→ Job hub</a></p>
    </div>
  );
}
