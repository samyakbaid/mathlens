// Small animation helper.
//
//   const stop = animate(1200, (t) => { state.t = t; update(); });
//   stop();   // cancel early (e.g. in a topic's cleanup function)
//
// t goes from 0 to 1, eased so motion starts and ends gently.

export const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const linear = (t) => t;

/**
 * @param {number} duration - milliseconds
 * @param {(t: number) => void} onFrame - called every frame with eased progress 0..1
 * @param {{easing?: (t: number) => number, onDone?: () => void}} options
 * @returns {() => void} cancel
 */
export function animate(duration, onFrame, { easing = easeInOut, onDone } = {}) {
  let id = null;
  let cancelled = false;
  const start = performance.now();
  const tick = (now) => {
    if (cancelled) return;
    const raw = Math.min(1, (now - start) / duration);
    onFrame(easing(raw));
    if (raw < 1) id = requestAnimationFrame(tick);
    else onDone?.();
  };
  id = requestAnimationFrame(tick);
  return () => {
    cancelled = true;
    cancelAnimationFrame(id);
  };
}

/** Keeps at most one animation running: starting a new one cancels the previous one. */
export function createAnimator() {
  let cancel = null;
  return {
    run(duration, onFrame, options) {
      cancel?.();
      cancel = animate(duration, onFrame, options);
      return cancel;
    },
    stop() {
      cancel?.();
      cancel = null;
    },
  };
}
