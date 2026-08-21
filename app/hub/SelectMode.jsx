'use client';

import { createContext, useContext, useState, useTransition, useRef } from 'react';
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

  // Long-press entry point (LongPressTarget below) - always adds rather than
  // toggling, so pressing the same card again while already in select mode
  // can't accidentally deselect it.
  function selectViaLongPress(id) {
    setActive(true);
    setSelected(prev => new Set(prev).add(id));
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
    <SelectModeContext.Provider value={{ active, selected, toggle, toggleId, selectViaLongPress, dismissSelected, isPending }}>
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

const LONG_PRESS_MS = 500;
const MOVE_TOLERANCE_PX = 10;

/** Wraps a job card so pressing and holding it (touch only - mouse/desktop
    is untouched, since these are touch-only events) enters select mode with
    that card already checked. Cancels on scroll/drag (finger moves past
    MOVE_TOLERANCE_PX) so it doesn't fire on every scroll gesture that
    happens to start on a card, and suppresses the phone's native
    text-selection/callout menu and the synthetic click that would otherwise
    follow the long-press and open the job link underneath. */
export function LongPressTarget({ jobId, className, children }) {
  const ctx = useSelectMode();
  const timerRef = useRef(null);
  const startRef = useRef({ x: 0, y: 0 });
  const firedRef = useRef(false);
  const touchingRef = useRef(false);

  function clearTimer() {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  }

  function onTouchStart(e) {
    touchingRef.current = true;
    if (!ctx || ctx.active) return; // already in select mode - the checkbox handles taps
    firedRef.current = false;
    const t = e.touches[0];
    startRef.current = { x: t.clientX, y: t.clientY };
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      firedRef.current = true;
      ctx.selectViaLongPress(jobId);
      if (navigator.vibrate) navigator.vibrate(15);
    }, LONG_PRESS_MS);
  }

  function onTouchMove(e) {
    if (!timerRef.current) return;
    const t = e.touches[0];
    if (Math.abs(t.clientX - startRef.current.x) > MOVE_TOLERANCE_PX ||
        Math.abs(t.clientY - startRef.current.y) > MOVE_TOLERANCE_PX) {
      clearTimer();
    }
  }

  function onTouchEnd(e) {
    touchingRef.current = false;
    clearTimer();
    if (firedRef.current) {
      e.preventDefault(); // swallow the click the browser would otherwise fire on release
      firedRef.current = false;
    }
  }

  function onContextMenu(e) {
    if (touchingRef.current) e.preventDefault(); // suppress iOS/Android's own long-press menu
  }

  // Once select mode is on, the whole card becomes a select target - tapping
  // the title link or an action button toggles select instead of opening the
  // job or submitting that button's form, the same way Gmail/Photos-style
  // multi-select works. The checkbox already toggles itself via its own
  // onChange, so bail out here for clicks that landed on it to avoid
  // toggling twice (once from the checkbox, once from this handler).
  function onClick(e) {
    if (!ctx || !ctx.active) return;
    if (e.target.closest('.select-check')) return;
    e.preventDefault();
    ctx.toggleId(jobId);
  }

  return (
    <div
      className={ctx?.active ? `${className} select-active` : className}
      onClick={onClick}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
      onContextMenu={onContextMenu}
    >
      {children}
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
