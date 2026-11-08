// Fourier series: building periodic waves out of sines.

import { Plot, COLORS, alpha } from '../../lib/plot.js';
import { addHeading, addSlider, addSelect, addCheckbox, addReadout, addButtons, addSteps } from '../../lib/controls.js';
import { format } from '../../lib/numeric.js';

const PI = Math.PI;
// Colour names (not values) so they follow the light/dark theme
const HARMONIC_COLORS = ['orange', 'green', 'purple', 'red', 'yellow', 'cyan'];

// Every wave here is odd, so its Fourier series has only sine terms: f(x) = Σ bₖ sin(kx).
const WAVES = {
  square: {
    label: 'Square wave',
    f: (x) => Math.sign(Math.sin(x)),
    coefficient: (k) => (k % 2 === 1 ? 4 / (PI * k) : 0),
    tex: String.raw`\frac{4}{\pi}\sum_{k \text{ odd}} \frac{\sin kx}{k}`,
  },
  sawtooth: {
    label: 'Sawtooth wave',
    f: (x) => wrapToPi(x),
    coefficient: (k) => (2 * (k % 2 === 1 ? 1 : -1)) / k,
    tex: String.raw`2\sum_{k=1}^{\infty} \frac{(-1)^{k+1}}{k}\sin kx`,
  },
  triangle: {
    label: 'Triangle wave',
    f: (x) => (2 / PI) * Math.asin(Math.sin(x)),
    coefficient: (k) => (k % 2 === 1 ? ((8 / (PI * PI)) * (k % 4 === 1 ? 1 : -1)) / (k * k) : 0),
    tex: String.raw`\frac{8}{\pi^2}\sum_{k \text{ odd}} \frac{(-1)^{(k-1)/2}}{k^2}\sin kx`,
  },
};

export default {
  id: 'fourier-series',
  title: 'Fourier Series',
  category: 'Analysis',
  level: 'Undergraduate',
  summary: 'Build a square wave out of smooth sine waves, and meet the overshoot that never goes away.',

  explanation: String.raw`
## The idea
Any reasonable periodic function can be written as a sum of sines and cosines at whole-number multiples of a base frequency:

$$f(x) = \frac{a_0}{2} + \sum_{k=1}^{\infty} \big(a_k \cos kx + b_k \sin kx\big),$$

$$a_k = \frac{1}{\pi}\int_{-\pi}^{\pi} f(x)\cos kx\,dx, \qquad b_k = \frac{1}{\pi}\int_{-\pi}^{\pi} f(x)\sin kx\,dx.$$

Each coefficient measures how much of frequency $k$ the function contains. The formulas work because sines and cosines are **orthogonal**: $\int_{-\pi}^{\pi} \sin(jx)\sin(kx)\,dx = 0$ when $j \neq k$. Each integral picks out exactly one frequency.

**Example.** The square wave contains only odd harmonics: $\;f(x) = \frac{4}{\pi}\left(\sin x + \frac{\sin 3x}{3} + \frac{\sin 5x}{5} + \cdots\right)$.

## Things to try
- Press **Play** to add harmonics one at a time and watch the blue sum sharpen.
- Turn on **Show individual harmonics** to see the sine waves being added.
- The bottom chart is the **spectrum**: the size of each $b_k$. The triangle wave's coefficients shrink like $\frac{1}{k^2}$, so it converges much faster than the square wave ($\frac{1}{k}$). Smoother functions have faster-decaying spectra.
- **Gibbs phenomenon**: near the jump in the square wave the sum overshoots by about 9% of the jump. Adding terms makes the overshoot narrower but never smaller. The "peak value" readout settles near $1.179$ instead of $1$. Meanwhile the mean squared error still goes to $0$.

## Where it's used
Audio compression (MP3), image compression (JPEG uses a cousin, the discrete cosine transform), solving the heat and wave equations, signal filtering, and spectral methods in scientific computing.
`,

  mount({ plotArea, controls, lesson }) {
    const state = { wave: 'square', n: 5, showHarmonics: false };
    let timerId = null;

    const plot = new Plot(plotArea, { xMin: -2 * PI - 0.3, xMax: 2 * PI + 0.3, yMin: -2.2, yMax: 2.2 }, { height: 360 });
    const spectrum = new Plot(plotArea, { xMin: -1, xMax: 21, yMin: -0.15, yMax: 2.2 }, { height: 150 });
    const caption = document.createElement('p');
    caption.className = 'plot-caption';
    caption.textContent = 'Spectrum: the size |bₖ| of each harmonic k';
    plotArea.append(caption);
    const formulaReadout = addReadout(plotArea, 'Series', { wide: true });

    // ---- Controls ------------------------------------------------------------
    addHeading(controls, 'Target wave');
    const waveSelect = addSelect(controls, {
      options: Object.entries(WAVES).map(([value, w]) => ({ value, label: w.label })),
      value: state.wave,
      onChange: (wave) => {
        state.wave = wave;
        update();
      },
    });

    addHeading(controls, 'Partial sum');
    const nSlider = addSlider(controls, {
      label: 'Highest harmonic n',
      min: 1,
      max: 60,
      value: state.n,
      onInput: (v) => {
        stopPlaying();
        state.n = v;
        update();
      },
    });
    const harmonicsToggle = addCheckbox(controls, {
      label: 'Show individual harmonics (first 6)',
      onChange: (checked) => {
        state.showHarmonics = checked;
        update();
      },
    });
    addButtons(controls, [{ label: 'Play: add harmonics', icon: 'play', primary: true, onClick: play }]);

    addHeading(controls, 'Results');
    const termsReadout = addReadout(controls, 'Non-zero terms');
    const peakReadout = addReadout(controls, 'Peak value of sum');
    const errorReadout = addReadout(controls, 'Mean squared error');

    // ---- Drawing -------------------------------------------------------------------
    plot.onDraw = (p) => {
      const wave = WAVES[state.wave];
      p.grid({ xStep: PI / 2, yStep: 0.5, xFormat: formatPi });

      if (state.showHarmonics) {
        activeHarmonics(wave, state.n)
          .slice(0, 6)
          .forEach(({ k, b }, i) => {
            p.curve((x) => b * Math.sin(k * x), { color: COLORS[HARMONIC_COLORS[i]], width: 1.25 });
          });
      }

      p.curve(wave.f, { color: alpha(COLORS.text, 0.5), width: 1.5, dash: [5, 4] });
      p.curve((x) => partialSum(wave, state.n, x), { color: COLORS.blue, width: 3 });
    };

    spectrum.onDraw = (p) => {
      const wave = WAVES[state.wave];
      p.grid({ yStep: 0.5 });
      for (let k = 1; k <= Math.floor(p.bounds.xMax); k++) {
        const height = Math.abs(wave.coefficient(k));
        if (height < 1e-12) continue;
        const included = k <= state.n;
        p.path([[k - 0.3, 0], [k - 0.3, height], [k + 0.3, height], [k + 0.3, 0]], {
          fill: included ? COLORS.blue : alpha(COLORS.muted, 0.25),
          color: null,
          closed: true,
        });
      }
    };

    function update() {
      const wave = WAVES[state.wave];
      spectrum.view.xMax = Math.max(20, state.n) + 1;

      termsReadout.text(String(activeHarmonics(wave, state.n).length));
      peakReadout.text(format(peakValue(wave, state.n), 4));
      errorReadout.text(format(meanSquaredError(wave, state.n), 5));
      formulaReadout.math(`\\displaystyle f(x) = ${wave.tex}`);

      plot.render();
      spectrum.render();
    }

    function play() {
      stopPlaying();
      state.n = 1;
      nSlider.value = 1;
      update();
      timerId = setInterval(() => {
        state.n += 1;
        nSlider.value = state.n;
        update();
        if (state.n >= 40) stopPlaying();
      }, 300);
    }

    function stopPlaying() {
      clearInterval(timerId);
    }

    // ---- The lesson, step by step ----------------------------------------------------
    function scene({ wave = 'square', n = 1, showHarmonics = false, animate = false }) {
      stopPlaying();
      Object.assign(state, { wave, n, showHarmonics });
      waveSelect.value = wave;
      nSlider.value = n;
      harmonicsToggle.checked = showHarmonics;
      update();
      if (animate) play();
    }

    const tour = addSteps(lesson, [
      {
        title: 'Can smooth waves make a square?',
        text: String.raw`The dashed shape is a square wave. It sits at $1$, jumps down to $-1$, then jumps back up, over and over. Sine waves are smooth and round, so it's surprising that adding enough of them can build this shape. Here's the first one.`,
        focus: 'Compare the blue sine wave with the dashed square wave.',
        enter: () => scene({ n: 1 }),
      },
      {
        title: 'Pick the right height',
        text: String.raw`The best single sine for the job is $b_1 \sin x$ with
$$b_1 = \frac{4}{\pi} \approx 1.27$$
That's a bit taller than the square wave. It overshoots in the middle of each flat part and falls short near the jumps, and the two kinds of error balance out.`,
        focus: 'The Peak value in the Results card is 1.27.',
        enter: () => scene({ n: 1 }),
      },
      {
        title: 'Add a faster wave',
        text: String.raw`Now add $\frac{4}{3\pi}\sin 3x$, a wave three times as fast and a third as tall. It pulls the sum down where the first wave was too high, and lifts it where it was too low:
$$S_3(x) = \frac{4}{\pi}\left(\sin x + \frac{\sin 3x}{3}\right)$$`,
        focus: 'The thin coloured curves are the separate waves. Blue is their sum.',
        enter: () => scene({ n: 3, showHarmonics: true }),
      },
      {
        title: 'Keep the pattern going',
        text: String.raw`Next come $\frac{\sin 5x}{5}$ and $\frac{\sin 7x}{7}$. Each wave is faster and smaller than the one before, and each one fixes a finer wobble. The even ones, $\sin 2x$ and $\sin 4x$, never appear for this shape.`,
        focus: 'Count the bumps on the thin curves: 1, 3, 5 and 7 per cycle.',
        enter: () => scene({ n: 7, showHarmonics: true }),
      },
      {
        title: 'Where the sizes come from',
        text: String.raw`Each size has a formula. Multiply the square wave by $\sin kx$ and average over one cycle:
$$b_k = \frac{1}{\pi}\int_{-\pi}^{\pi} f(x)\sin(kx)\,dx$$
For the square wave this gives $\frac{4}{\pi k}$ when $k$ is odd and $0$ when $k$ is even. The bars in the lower chart are these sizes.`,
        focus: 'The bars shrink like 1/k, and every even k is missing.',
        enter: () => scene({ n: 7, showHarmonics: false }),
      },
      {
        title: 'Add many more waves',
        text: String.raw`With dozens of waves the sum hugs the square wave very closely, and the average error keeps falling toward zero. Shapes with jumps need many waves, because their sizes only shrink like $\frac{1}{k}$.`,
        focus: 'Watch the Mean squared error drop as n grows.',
        enter: () => scene({ n: 1, animate: true }),
      },
      {
        title: 'The bump that never goes away',
        text: String.raw`Look right next to each jump. The sum overshoots by about 9% of the jump size, however many waves you add. The overshoot gets thinner but stays just as tall. It's called the **Gibbs phenomenon**, and it's the ringing you sometimes see around sharp edges in compressed images.`,
        focus: 'The Peak value stays near 1.18 instead of settling at 1.',
        enter: () => scene({ n: 60 }),
      },
      {
        title: 'Smoother shapes need fewer waves',
        text: String.raw`Switch to the triangle wave. It has corners but no jumps, so its sizes shrink like $\frac{1}{k^2}$, which is much faster. Five waves already look almost perfect. Music compression, noise filters and heat flow problems all use this same idea.`,
        focus: 'Try the sawtooth and triangle waves and compare how fast the error drops.',
        enter: () => scene({ wave: 'triangle', n: 5 }),
      },
    ]);

    update();
    tour.go(0);

    return () => {
      stopPlaying();
      plot.destroy();
      spectrum.destroy();
    };
  },
};

// ---- Math helpers ----------------------------------------------------------------

function activeHarmonics(wave, n) {
  const list = [];
  for (let k = 1; k <= n; k++) {
    const b = wave.coefficient(k);
    if (Math.abs(b) > 1e-12) list.push({ k, b });
  }
  return list;
}

function partialSum(wave, n, x) {
  let sum = 0;
  for (let k = 1; k <= n; k++) sum += wave.coefficient(k) * Math.sin(k * x);
  return sum;
}

/** Largest value of the partial sum over one period (sampled). */
function peakValue(wave, n) {
  let peak = -Infinity;
  for (let i = 0; i <= 4000; i++) {
    const x = -PI + (2 * PI * i) / 4000;
    peak = Math.max(peak, partialSum(wave, n, x));
  }
  return peak;
}

/** (1/2π) ∫ (f − Sₙ)² over one period, by the midpoint rule. */
function meanSquaredError(wave, n) {
  const samples = 2000;
  let total = 0;
  for (let i = 0; i < samples; i++) {
    const x = -PI + (2 * PI * (i + 0.5)) / samples;
    total += (wave.f(x) - partialSum(wave, n, x)) ** 2;
  }
  return total / samples;
}

/** Map x into (−π, π]. */
function wrapToPi(x) {
  const period = 2 * PI;
  return ((((x + PI) % period) + period) % period) - PI;
}

/** Label multiples of π/2: π/2, π, 3π/2, 2π, ... */
function formatPi(value) {
  const halves = Math.round(value / (PI / 2));
  if (halves === 0) return '0';
  const sign = halves < 0 ? '−' : '';
  const h = Math.abs(halves);
  if (h % 2 === 0) return `${sign}${h / 2 === 1 ? '' : h / 2}π`;
  return `${sign}${h === 1 ? '' : h}π/2`;
}
