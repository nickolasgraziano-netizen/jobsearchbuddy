'use client';

import { useFormStatus } from 'react-dom';

export default function RefreshButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-secondary" disabled={pending} style={{ height: 32, fontSize: 13, padding: '0 14px' }}>
      {pending ? 'Refreshing… (~60–90s)' : 'Refresh now'}
    </button>
  );
}
