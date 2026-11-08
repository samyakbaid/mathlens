// The Central Limit Theorem: averages of random samples look normal.

import { Plot, COLORS, alpha } from '../../lib/plot.js';
import { addHeading, addSlider, addSelect, addReadout, addButtons, addNote, addSteps, setButtonLabel } from '../../lib/controls.js';
import { randomNormal, format } from '../../lib/numeric.js';

const BIN_COUNT = 60;

// Each distribution: how to draw one sample, its true mean and variance, and the x-range to show.
const DISTRIBUTIONS = {
  exponential: {
    label: 'Exponential (skewed)',
    range: [0, 6],
    mean: 1,
    variance: 1,
    sample: () => -Math.log(1 - Math.random()),
  },
  uniform: {
    label: 'Uniform on [0, 1]',
    range: [0, 1],
    mean: 0.5,
    variance: 1 / 12,
    sample: () => Math.random(),
  },
  bimodal: {
    label: 'Two bumps (bimodal)',
    range: [0, 5],
    mean: 2.5,
    variance: 0.4 ** 2 + 1.5 ** 2, // within-bump variance + spread of the bump centers
    sample: () => (Math.random() < 0.5 ? 1 : 4) + 0.4 * randomNormal(),
  },
  die: {
    label: 'Rolling a fair die',
    range: [0.5, 6.5],
    mean: 3.5,
    variance: 35 / 12,
    sample: () => 1 + Math.floor(Math.random() * 6),
  },
};

export default {
  id: 'central-limit-theorem',
  title: 'Central Limit Theorem',
  category: 'Probability & Statistics',
  level: 'Undergraduate',
  summary: 'Average a few random draws again and again, and watch a bell curve appear from any starting shape.',

  explanation: String.raw`
## The idea
Take $n$ independent samples $X_1, \dots, X_n$ from **any** distribution with mean $\mu$ and finite variance $\sigma^2$, and average them:

$$\bar{X}_n = \frac{X_1 + \cdots + X_n}{n}.$$

The average is itself random. The **Central Limit Theorem** says that for large $n$ its distribution is approximately normal, whatever the original distribution looked like:

$$\bar{X}_n \approx \mathcal{N}\!\left(\mu,\ \frac{\sigma^2}{n}\right), \qquad\text{precisely}\qquad \frac{\bar{X}_n - \mu}{\sigma / \sqrt{n}} \xrightarrow{d} \mathcal{N}(0, 1).$$

Two separate facts are hiding here. The **spread shrinks** like $\sigma / \sqrt{n}$, which is true for any $n$. The **shape becomes a bell curve**, which is the CLT itself.

**Example.** A fair die has $\mu = 3.5$ and $\sigma^2 = 35/12 \approx 2.92$. The average of $n = 30$ rolls is approximately normal with standard deviation $\sqrt{2.92/30} \approx 0.31$, so about 95% of such averages land in $3.5 \pm 0.62$.

## Things to try
- Start with the skewed **exponential** distribution and $n = 1$: the histogram of "means" is just the original shape. Raise $n$ to 5, then 30. The skew melts away.
- Compare the measured **std of means** with the theoretical $\sigma/\sqrt{n}$.
- The **bimodal** distribution has no hump in the middle at all, yet averages of it pile up right there.

## Where it's used
Confidence intervals and $p$-values, A/B testing, quality control charts, Monte Carlo error bars, and the reason measurement noise is so often modeled as Gaussian.
`,

  mount({ plotArea, controls, lesson }) {
    const state = {
      dist: 'exponential',
      n: 1,
      counts: new Array(BIN_COUNT).fill(0),
      total: 0,
      sum: 0,
      sumOfSquares: 0,
      lastSample: [],
      running: false,
    };
    let populationCounts = histogramOf(DISTRIBUTIONS[state.dist]);
    let animationId = null;

    const population = new Plot(plotArea, { xMin: 0, xMax: 6, yMin: 0, yMax: 1 }, { height: 150 });
    const caption1 = document.createElement('p');
    caption1.className = 'plot-caption';
    caption1.textContent = 'Population: the distribution we sample from (yellow dots = the latest sample)';
    plotArea.append(caption1);

    const means = new Plot(plotArea, { xMin: 0, xMax: 6, yMin: 0, yMax: 1 }, { height: 320 });
    const caption2 = document.createElement('p');
    caption2.className = 'plot-caption';
    caption2.textContent = 'Histogram of sample means, with the normal curve the CLT predicts (orange)';
    plotArea.append(caption2);

    // ---- Controls ------------------------------------------------------------------
    addHeading(controls, 'Population');
    const distributionSelect = addSelect(controls, {
      options: Object.entries(DISTRIBUTIONS).map(([value, d]) => ({ value, label: d.label })),
      value: state.dist,
      onChange: (value) => {
        state.dist = value;
        populationCounts = histogramOf(DISTRIBUTIONS[value]);
        reset();
      },
    });

    addHeading(controls, 'Sampling');
    const nSlider = addSlider(controls, {
      label: 'Sample size n',
      min: 1,
      max: 50,
      value: state.n,
      onInput: (v) => {
        state.n = v;
        reset();
      },
    });
    const [runButton] = addButtons(controls, [
      { label: 'Run', icon: 'play', primary: true, onClick: toggleRunning },
      { label: '+1 mean', onClick: () => drawMeans(1) },
      { label: '+1000', onClick: () => drawMeans(1000) },
      { label: 'Reset', onClick: reset },
    ]);

    addHeading(controls, 'Results');
    const countReadout = addReadout(controls, 'Means drawn');
    const meanReadout = addReadout(controls, 'Mean of means (μ)');
    const stdReadout = addReadout(controls, 'Std of means');
    const theoryReadout = addReadout(controls, 'Theory σ/√n');
    addNote(controls, 'Each "mean" averages n fresh samples from the population.');

    // ---- Drawing ---------------------------------------------------------------------
    population.onDraw = (p) => {
      const dist = DISTRIBUTIONS[state.dist];
      p.grid({ yStep: niceY(p.bounds.yMax) });
      drawHistogram(p, populationCounts.density, dist.range, alpha(COLORS.muted, 0.45));
      state.lastSample.forEach((x) => p.point(x, p.bounds.yMax * 0.08, { color: COLORS.yellow, radius: 3.5 }));
      if (state.lastSample.length) {
        const average = state.lastSample.reduce((s, x) => s + x, 0) / state.lastSample.length;
        p.verticalLine(average, { color: COLORS.yellow, width: 2 });
      }
    };

    means.onDraw = (p) => {
      const dist = DISTRIBUTIONS[state.dist];
      const density = densityOf(state.counts, state.total, dist.range);
      p.grid({ yStep: niceY(p.bounds.yMax) });
      drawHistogram(p, density, dist.range, alpha(COLORS.blue, 0.75));
      const sd = Math.sqrt(dist.variance / state.n);
      p.curve((x) => normalPdf(x, dist.mean, sd), { color: COLORS.orange, width: 2.5 });
      p.verticalLine(dist.mean, { color: COLORS.orange, width: 1, dash: [4, 4] });
    };

    function update() {
      const dist = DISTRIBUTIONS[state.dist];
      const [lo, hi] = dist.range;
      const sd = Math.sqrt(dist.variance / state.n);

      // Fit the axes: a little room on the left for the y labels, and y up to the tallest bar or curve
      const xMin = lo - (hi - lo) * 0.07;
      const peakMeans = Math.max(normalPdf(dist.mean, dist.mean, sd), ...densityOf(state.counts, state.total, dist.range));
      means.view = { xMin, xMax: hi, yMin: 0, yMax: peakMeans * 1.15 };
      population.view = { xMin, xMax: hi, yMin: 0, yMax: Math.max(...populationCounts.density) * 1.15 };

      const mean = state.total ? state.sum / state.total : NaN;
      const variance = state.total > 1 ? (state.sumOfSquares - state.total * mean * mean) / (state.total - 1) : NaN;
      countReadout.text(String(state.total));
      meanReadout.text(`${format(mean, 3)}  (${format(dist.mean, 3)})`);
      stdReadout.text(format(Math.sqrt(Math.max(0, variance)), 4));
      theoryReadout.text(format(sd, 4));

      population.render();
      means.render();
    }

    /** Draw `count` sample means, each the average of n samples. */
    function drawMeans(count) {
      const dist = DISTRIBUTIONS[state.dist];
      for (let i = 0; i < count; i++) {
        const sample = Array.from({ length: state.n }, dist.sample);
        const mean = sample.reduce((s, x) => s + x, 0) / state.n;
        const bin = binIndex(mean, dist.range);
        if (bin !== -1) state.counts[bin] += 1;
        state.total += 1;
        state.sum += mean;
        state.sumOfSquares += mean * mean;
        state.lastSample = sample;
      }
      update();
    }

    function toggleRunning() {
      state.running = !state.running;
      setButtonLabel(runButton, state.running ? 'Pause' : 'Run', state.running ? 'pause' : 'play');
      if (state.running) {
        const step = () => {
          drawMeans(15);
          if (state.running) animationId = requestAnimationFrame(step);
        };
        animationId = requestAnimationFrame(step);
      } else {
        cancelAnimationFrame(animationId);
      }
    }

    function reset() {
      Object.assign(state, { counts: new Array(BIN_COUNT).fill(0), total: 0, sum: 0, sumOfSquares: 0, lastSample: [] });
      update();
    }

    // ---- The lesson, step by step ----------------------------------------------------
    function scene({ dist = 'exponential', n = 1, draws = 0 }) {
      if (state.running) toggleRunning();
      state.dist = dist;
      distributionSelect.value = dist;
      populationCounts = histogramOf(DISTRIBUTIONS[dist]);
      state.n = n;
      nSlider.value = n;
      reset();
      if (draws) drawMeans(draws);
    }

    const tour = addSteps(lesson, [
      {
        title: 'A lopsided population',
        text: String.raw`The grey chart at the top is our population: waiting times that are usually short and once in a while very long. It's lopsided, with a long tail to the right. We'll draw values from it at random and record them in the chart below.`,
        focus: 'In the top chart, most values are small and a few are big.',
        enter: () => scene({ n: 1, draws: 0 }),
      },
      {
        title: 'Record one draw at a time',
        text: String.raw`With $n = 1$ we draw one value and record it. After many draws, the bottom chart has the same lopsided shape as the population, because each record is just a single value.`,
        focus: 'The bottom chart copies the shape of the top one.',
        enter: () => scene({ n: 1, draws: 1500 }),
      },
      {
        title: 'Now average five draws',
        text: String.raw`This time draw 5 values and record their average:
$$\bar X_5 = \frac{X_1 + X_2 + X_3 + X_4 + X_5}{5}$$
A big value usually gets averaged with smaller ones, so very large averages are rare. The bottom chart becomes narrower and more even.`,
        focus: 'The yellow dots on top are one sample of 5. The yellow line is its average.',
        enter: () => scene({ n: 5, draws: 3000 }),
      },
      {
        title: 'Average thirty draws',
        text: String.raw`With $n = 30$ the bottom chart turns into a bell shape. The orange curve is the bell the theorem predicts, and the bars sit right on it.

Quick check: did the center of the bell move? (No. It stays at the population's mean, 1.)`,
        focus: 'Compare the blue bars with the orange curve.',
        enter: () => scene({ n: 30, draws: 5000 }),
      },
      {
        title: 'The rule behind it',
        text: String.raw`This is the **Central Limit Theorem**. Take independent draws from a population with mean $\mu$ and standard deviation $\sigma$. For large $n$, the average follows a bell curve:
$$\bar X_n \approx \mathcal{N}\!\left(\mu,\ \frac{\sigma^2}{n}\right)$$
The center stays at $\mu$, and the bell gets narrower as $n$ grows.`,
        focus: 'Mean of means in the Results card stays close to 1.',
        enter: () => scene({ n: 30, draws: 5000 }),
      },
      {
        title: 'How fast the bell gets narrow',
        text: String.raw`The width of the bell is $\frac{\sigma}{\sqrt{n}}$. Four times as many draws only halves the width. Here $\sigma = 1$ and $n = 12$, so the prediction is
$$\frac{1}{\sqrt{12}} \approx 0.289$$`,
        focus: 'Compare "Std of means" with "Theory σ/√n" in the Results card.',
        enter: () => scene({ n: 12, draws: 5000 }),
      },
      {
        title: 'It works for any starting shape',
        text: String.raw`Swap the population for one with two separate humps. Averages of 20 draws still make a single bell. That's why bell curves show up for heights, test scores and measurement errors: each one is the total of many small, independent effects.`,
        focus: 'Two humps on top, one bell below.',
        enter: () => scene({ dist: 'bimodal', n: 20, draws: 5000 }),
      },
      {
        title: 'Your turn',
        text: String.raw`Roll a die twice and average the two rolls: the chart already looks like a triangle, the first step toward a bell. Press Run, then change $n$ while it runs and watch the shape change.`,
        focus: 'Change the sample size n while Run is on.',
        enter: () => scene({ dist: 'die', n: 2, draws: 2000 }),
      },
    ]);

    update();
    tour.go(0);

    return () => {
      state.running = false;
      cancelAnimationFrame(animationId);
      population.destroy();
      means.destroy();
    };
  },
};

// ---- Helpers ---------------------------------------------------------------------------

function binIndex(x, [lo, hi]) {
  const index = Math.floor(((x - lo) / (hi - lo)) * BIN_COUNT);
  return index >= 0 && index < BIN_COUNT ? index : -1;
}

/** Turn counts into a density (bar areas sum to 1), so it can be compared with a pdf. */
function densityOf(counts, total, [lo, hi]) {
  const binWidth = (hi - lo) / BIN_COUNT;
  return counts.map((c) => (total ? c / (total * binWidth) : 0));
}

/** Approximate the population's shape with a histogram of many samples. */
function histogramOf(dist) {
  const counts = new Array(BIN_COUNT).fill(0);
  const total = 40000;
  for (let i = 0; i < total; i++) {
    const bin = binIndex(dist.sample(), dist.range);
    if (bin !== -1) counts[bin] += 1;
  }
  return { density: densityOf(counts, total, dist.range) };
}

function drawHistogram(plot, density, [lo, hi], fill) {
  const binWidth = (hi - lo) / BIN_COUNT;
  density.forEach((height, i) => {
    if (height <= 0) return;
    const x = lo + i * binWidth;
    plot.path([[x, 0], [x, height], [x + binWidth, height], [x + binWidth, 0]], { fill, color: null, closed: true });
  });
}

function normalPdf(x, mean, sd) {
  return Math.exp(-((x - mean) ** 2) / (2 * sd * sd)) / (sd * Math.sqrt(2 * Math.PI));
}

/** A y-grid step that gives about 4 lines. */
function niceY(yMax) {
  const rough = yMax / 4;
  const power = Math.pow(10, Math.floor(Math.log10(rough)));
  return [1, 2, 5, 10].map((m) => m * power).find((step) => step >= rough);
}
