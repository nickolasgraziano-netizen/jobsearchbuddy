'use client';

import { createContext, useContext, useState, useTransition } from 'react';
import { dismissJobs } from './actions.js';

const SelectModeContext = createContext(null);

/** Wraps a page's job-list content so a checkbox anywhere inside can join a
    shared bulk-dismiss selection, regardless of which section it's in. */
export function SelectModeProvider({ children }) {
  const [active, setActive] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [isPending, startTransition] = useTransition();

  function toggle() {
    setActive(a => !a);
    setSelected(new Set());
  }

  function toggleId(id) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function dismissSelected() {
    if (!selected.size) return;
    const n = selected.size;
    if (!window.confirm(`Dismiss ${n} job${n === 1 ? '' : 's'} as "Not for me"?`)) return;
    const ids = [...selected];
    startTransition(async () => {
      await dismissJobs(ids);
      setSelected(new Set());
      setActive(false);
    });
  }

  return (
    <SelectModeContext.Provider value={{ active, selected, toggle, toggleId, dismissSelected, isPending }}>
      {children}
    </SelectModeContext.Provider>
  );
}

function useSelectMode() {
  return useContext(SelectModeContext);
}

export function SelectModeToggle() {
  const ctx = useSelectMode();
  if (!ctx) return null;
  return (
    <button type="button" className="btn btn-secondary" onClick={ctx.toggle} style={{ height: 32, fontSize: 13, padding: '0 14px' }}>
      {ctx.active ? 'Cancel select' : 'Select'}
    </button>
  );
}

/** Floating bar - only appears once at least one job is checked. */
export function SelectModeBar() {
  const ctx = useSelectMode();
  if (!ctx || !ctx.active || ctx.selected.size === 0) return null;
  return (
    <div className="select-bar">
      <span>{ctx.selected.size} selected</span>
      <button type="button" className="btn-ghost mute" onClick={ctx.dismissSelected} disabled={ctx.isPending}>
        {ctx.isPending ? 'Dismissing…' : `Not for me (${ctx.selected.size})`}
      </button>
    </div>
  );
}

/** Renders nothing outside a SelectModeProvider, or while select mode is off. */
export function SelectCheckbox({ jobId }) {
  const ctx = useSelectMode();
  if (!ctx || !ctx.active) return null;
  return (
    <input
      type="checkbox"
      className="select-check"
      checked={ctx.selected.has(jobId)}
      onChange={() => ctx.toggleId(jobId)}
      aria-label="Select this job for bulk dismiss"
    />
  );
}
