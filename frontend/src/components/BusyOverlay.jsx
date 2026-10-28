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
    <div className="busy-fade fixed inset-0 z-[90] flex items-center justify-center bg-neutral-950/10 backdrop-blur-[4px] no-print" role="status" aria-live="polite">
      <div className="busy-pop flex min-w-[14rem] flex-col items-center gap-4 rounded-[28px] bg-white/80 px-10 py-8 shadow-[0_24px_60px_-20px_rgba(11,62,168,0.35)] ring-1 ring-white/70 backdrop-blur-xl">
        <Spinner className="h-14 w-14" />
        <p className="text-sm font-semibold tracking-tight text-neutral-800">{state.label}</p>
      </div>
    </div>
  );
}
