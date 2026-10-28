import { useEffect, useRef, useState } from 'react';
import { subscribeBusy } from '../api/busy.js';
import Spinner from './ui/Spinner.jsx';

// Shown while something is being saved, edited, paid, cancelled or the day
// closed: the blue dots in the middle of the screen with what is happening.
// It stays at least MIN_MS so a quick save is still seen, not a flicker.
const MIN_MS = 750;

export default function BusyOverlay() {
  const [state, setState] = useState({ visible: false, label: 'Saving…' });
  const shownAt = useRef(0);
  const hideTimer = useRef(null);

  useEffect(
    () =>
      subscribeBusy((count, label) => {
        clearTimeout(hideTimer.current);
        if (count > 0) {
          if (!shownAt.current) shownAt.current = Date.now();
          setState({ visible: true, label });
        } else if (shownAt.current) {
          const wait = Math.max(0, MIN_MS - (Date.now() - shownAt.current));
          hideTimer.current = setTimeout(() => {
            shownAt.current = 0;
            setState((s) => ({ ...s, visible: false }));
          }, wait);
        }
      }),
    []
  );

  if (!state.visible) return null;
  return (
    <div className="busy-fade fixed inset-0 z-[90] flex items-center justify-center bg-white/45 backdrop-blur-[3px] no-print" role="status" aria-live="polite">
      <div className="flex min-w-[13rem] flex-col items-center gap-3 rounded-3xl border border-neutral-200/80 bg-white px-10 py-7 shadow-xl">
        <Spinner className="h-16 w-16" />
        <p className="text-sm font-semibold text-neutral-700">{state.label}</p>
      </div>
    </div>
  );
}
