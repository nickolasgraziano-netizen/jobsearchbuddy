'use client';

import { useState, useEffect } from 'react';

export default function ThemeToggle() {
  // Guess light initially so the button never pops in/out; layout.js's
  // inline script already set the real attribute on <html> before this
  // ever rendered, and the effect below just syncs the label to match.
  const [theme, setTheme] = useState('light');

  useEffect(() => {
    setTheme(document.documentElement.getAttribute('data-theme') || 'light');
  }, []);

  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    setTheme(next);
  }

  return (
    <button type="button" onClick={toggle} className="btn btn-secondary" aria-label="Toggle dark mode" style={{ height: 32, fontSize: 13, padding: '0 14px' }}>
      {theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
    </button>
  );
}
