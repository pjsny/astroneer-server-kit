import { useState, useEffect, startTransition } from 'react';

/** Increments a frame counter at the given interval (ms). */
export function useFrame(interval = 100, active = true): number {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      // Avoid "Cannot update Header while rendering Setup" (React 19 + Ink) when a tick
      // aligns with another component’s render.
      startTransition(() => setFrame(f => f + 1));
    }, interval);
    return () => clearInterval(id);
  }, [active, interval]);
  return frame;
}
