export default function Logo({ size = 28 }) {
  return (
    <span className="logo-mark" aria-hidden="true">
      <svg width={size} height={size} viewBox="0 0 28 28" fill="none">
        <rect x="9" y="2" width="16" height="16" rx="4" style={{ fill: 'var(--track-corp)' }} />
        <rect
          x="2"
          y="9"
          width="16"
          height="16"
          rx="4"
          style={{ fill: 'var(--track-ai)', opacity: 0.88 }}
        />
      </svg>
    </span>
  );
}
