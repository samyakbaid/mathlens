// The home page's moving picture: rotating circles (a Fourier series) drawing a square wave.
// Uses the theme colours, pauses when off screen, and stays still for prefers-reduced-motion.
//
//   const stop = startHeroArt(canvas);   // call stop() when leaving the page

import { COLORS, alpha, onThemeChange } from './theme.js';

const HARMONICS = [1, 3, 5, 7, 9];
const TRACE_LENGTH = 420;

export function startHeroArt(canvas) {
  const ctx = canvas.getContext('2d');
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  let width = 0;
  let height = 0;
  let theta = 0.6;
  let trace = [];
  let frame = null;
  let visible = true;
  let last = performance.now();

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    width = rect.width;
    height = rect.height;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    trace = [];
    // Pre-fill the trace so the wave is already there on the first frame
    for (let i = 0; i < TRACE_LENGTH; i++) step(1 / 60, false);
    draw();
  };

  function layout() {
    const wide = width > 860;
    const radius = Math.min(height * 0.17, wide ? 78 : 60);
    // Wide screens: circles start right of the text column; the wave fills the rest
    const cx = wide ? Math.max(width * 0.62, 640 + radius * 1.3) : width * 0.18;
    const cy = height * (wide ? 0.52 : 0.6);
    return { radius, cx, cy };
  }

  function tip({ radius, cx, cy }) {
    let x = cx;
    let y = cy;
    const centers = [];
    for (const k of HARMONICS) {
      const r = (radius * 4) / (Math.PI * k);
      centers.push({ x, y, r });
      x += r * Math.cos(k * theta);
      y -= r * Math.sin(k * theta);
    }
    return { x, y, centers };
  }

  function step(dt, render = true) {
    theta += dt * 0.9;
    const point = tip(layout());
    trace.unshift(point.y);
    if (trace.length > TRACE_LENGTH) trace.pop();
    if (render) draw();
  }

  function draw() {
    if (!width) return;
    const geometry = layout();
    const { radius, cx, cy } = geometry;
    const { x, y, centers } = tip(geometry);
    const waveStart = cx + radius * 2.7;
    const spacing = Math.max(1.2, (width - waveStart - 10) / TRACE_LENGTH);

    ctx.clearRect(0, 0, width, height);

    // Axis for the wave
    ctx.strokeStyle = alpha(COLORS.muted, 0.25);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(waveStart, cy);
    ctx.lineTo(width, cy);
    ctx.stroke();

    // The circles and their radii
    centers.forEach(({ x: ox, y: oy, r }, i) => {
      ctx.strokeStyle = alpha(COLORS.text, i === 0 ? 0.28 : 0.18);
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.arc(ox, oy, r, 0, Math.PI * 2);
      ctx.stroke();
    });
    ctx.strokeStyle = alpha(COLORS.text, 0.75);
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    centers.forEach(({ x: ox, y: oy }, i) => (i === 0 ? ctx.moveTo(ox, oy) : ctx.lineTo(ox, oy)));
    ctx.lineTo(x, y);
    ctx.stroke();

    // Link from the tip to the wave
    ctx.setLineDash([4, 5]);
    ctx.strokeStyle = alpha(COLORS.orange, 0.8);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(waveStart, trace[0] ?? y);
    ctx.stroke();
    ctx.setLineDash([]);

    // The wave being drawn
    ctx.strokeStyle = COLORS.blue;
    ctx.lineWidth = 2.6;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    trace.forEach((value, i) => {
      const px = waveStart + i * spacing;
      if (i === 0) ctx.moveTo(px, value);
      else ctx.lineTo(px, value);
    });
    ctx.stroke();

    ctx.fillStyle = COLORS.orange;
    ctx.beginPath();
    ctx.arc(x, y, 4.5, 0, Math.PI * 2);
    ctx.fill();

    // Caption, right-aligned so it always fits
    ctx.fillStyle = alpha(COLORS.text, 0.55);
    ctx.font = 'italic 16px Fraunces, Georgia, serif';
    ctx.textAlign = 'right';
    ctx.fillText('f(x) = (4/π) Σ sin(kx) / k,   k = 1, 3, 5, …', width - 28, height - 30);
    ctx.textAlign = 'left';
  }

  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (visible) step(dt);
    frame = requestAnimationFrame(loop);
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  const intersection = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
  });
  intersection.observe(canvas);
  const stopTheme = onThemeChange(draw);
  document.fonts?.ready.then(draw);

  if (!reduceMotion) frame = requestAnimationFrame(loop);

  return () => {
    cancelAnimationFrame(frame);
    resizeObserver.disconnect();
    intersection.disconnect();
    stopTheme();
  };
}
