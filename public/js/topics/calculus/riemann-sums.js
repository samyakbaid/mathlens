// Riemann sums: approximating the area under a curve with rectangles.

import { Plot, COLORS, alpha } from '../../lib/plot.js';
import { addHeading, addSlider, addSelect, addTextInput, addReadout, addButtons, addSteps } from '../../lib/controls.js';
import { parseExpression } from '../../lib/expression.js';
import { integrate, format } from '../../lib/numeric.js';

const EXAMPLES = ['sin(x) + 0.1x^2 + 1', 'x^2/4', '3e^(-x^2)', '2 + cos(3x)', 'x^3/10 - x', 'sqrt(x)'];

const METHODS = {
  left: { label: 'Left endpoint', sample: (xl) => xl },
  right: { label: 'Right endpoint', sample: (xl, dx) => xl + dx },
  midpoint: { label: 'Midpoint', sample: (xl, dx) => xl + dx / 2 },
  trapezoid: { label: 'Trapezoid', sample: null },
};

export default {
  id: 'riemann-sums',
  title: 'Riemann Sums & the Integral',
  category: 'Calculus',
  level: 'Foundations',
  summary: 'Fill the space under a curve with rectangles, make them thinner, and watch the total close in on the area.',

  explanation: String.raw`
## The idea
How do you measure the area under a curve? Chop the interval $[a, b]$ into $n$ strips of width $\Delta x = \frac{b - a}{n}$, approximate each strip by a rectangle, and add them up:

$$S_n = \sum_{i=1}^{n} f(x_i^*)\,\Delta x,$$

where $x_i^*$ is a sample point in the $i$-th strip (its left end, right end or middle). As the strips get thinner, $S_n$ approaches the **definite integral**:

$$\int_a^b f(x)\,dx = \lim_{n \to \infty} \sum_{i=1}^{n} f(x_i^*)\,\Delta x.$$

Area below the x-axis counts as **negative** (shown in red).

**Example.** For $f(x) = x^2$ on $[0, 1]$ with right endpoints, $S_n = \frac{1}{n^3}\sum_{i=1}^n i^2 = \frac{(n+1)(2n+1)}{6n^2} \to \frac{1}{3}$.

## Things to try
- Press **Play** to increase $n$ and watch the error shrink.
- Compare methods at the same $n$. Left and right sums have error about proportional to $\frac{1}{n}$. Midpoint and trapezoid are much better, with error about proportional to $\frac{1}{n^2}$. Doubling $n$ cuts their error by about 4.
- On an increasing function, the left sum always underestimates and the right sum overestimates.

## Where it's used
Every numerical integration routine starts here: computing probabilities from densities, work done by a varying force, total distance from a velocity log, or the area under an ROC curve.
`,

  mount({ plotArea, controls, lesson }) {
    const state = { f: parseExpression(EXAMPLES[0]), a: 0, b: 5, n: 8, method: 'left' };
    let timerId = null;

    const plot = new Plot(plotArea, { xMin: -6, xMax: 6, yMin: -3, yMax: 6 }, { height: 460 });

    // ---- Controls ------------------------------------------------------------
    addHeading(controls, 'Function');
    const formulaInput = addTextInput(controls, {
      label: 'f(x) =',
      preview: true,
      value: EXAMPLES[0],
      onChange: (text) => {
        state.f = parseExpression(text);
        update();
      },
    });
    addSelect(controls, {
      label: 'Examples',
      options: EXAMPLES.map((e) => ({ value: e, label: e })),
      onChange: (text) => {
        formulaInput.value = text;
        formulaInput.dispatchEvent(new Event('change'));
      },
    });

    addHeading(controls, 'Rectangles');
    const methodSelect = addSelect(controls, {
      label: 'Method',
      options: Object.entries(METHODS).map(([value, m]) => ({ value, label: m.label })),
      value: state.method,
      onChange: (value) => {
        state.method = value;
        update();
      },
    });
    const nSlider = addSlider(controls, {
      label: 'n (number of strips)',
      min: 1,
      max: 200,
      value: state.n,
      onInput: (v) => {
        stopPlaying();
        state.n = v;
        update();
      },
    });
    const aSlider = addSlider(controls, {
      label: 'a (start)',
      min: -5,
      max: 5,
      step: 0.1,
      value: state.a,
      format: (v) => v.toFixed(1),
      onInput: (v) => {
        state.a = v;
        update();
      },
    });
    const bSlider = addSlider(controls, {
      label: 'b (end)',
      min: -5,
      max: 5,
      step: 0.1,
      value: state.b,
      format: (v) => v.toFixed(1),
      onInput: (v) => {
        state.b = v;
        update();
      },
    });
    addButtons(controls, [{ label: 'Play: increase n', icon: 'play', primary: true, onClick: play }]);

    addHeading(controls, 'Results');
    const sumReadout = addReadout(controls, 'Riemann sum Sₙ');
    const exactReadout = addReadout(controls, 'Integral (exact)');
    const errorReadout = addReadout(controls, 'Error');

    // ---- Drawing -----------------------------------------------------------------
    plot.onDraw = (p) => {
      const { f, a, b, n } = state;
      p.grid();

      for (const shape of strips(state)) {
        const positive = shape.height >= 0;
        p.path(shape.points, {
          fill: positive ? alpha(COLORS.blue, 0.28) : alpha(COLORS.red, 0.28),
          color: positive ? alpha(COLORS.blue, 0.9) : alpha(COLORS.red, 0.9),
          width: n > 80 ? 0 : 1,
          closed: true,
        });
      }

      p.curve(f, { color: COLORS.yellow, width: 2.5 });
      p.verticalLine(a, { color: COLORS.muted, width: 1, dash: [4, 4] });
      p.verticalLine(b, { color: COLORS.muted, width: 1, dash: [4, 4] });
      p.text('a', a, p.bounds.yMax, { color: COLORS.muted, baseline: 'top', offset: [4, 6] });
      p.text('b', b, p.bounds.yMax, { color: COLORS.muted, baseline: 'top', offset: [4, 6] });
    };

    function update() {
      const approx = strips(state).reduce((sum, s) => sum + s.area, 0);
      const exact = integrate(state.f, state.a, state.b);
      sumReadout.text(format(approx, 5));
      exactReadout.text(format(exact, 5));
      errorReadout.text(format(approx - exact, 5));
      plot.render();
    }

    function play() {
      stopPlaying();
      state.n = 1;
      timerId = setInterval(() => {
        state.n = Math.min(200, state.n < 20 ? state.n + 1 : Math.round(state.n * 1.15));
        nSlider.value = state.n;
        update();
        if (state.n >= 200) stopPlaying();
      }, 160);
    }

    function stopPlaying() {
      clearInterval(timerId);
    }

    // ---- The lesson, step by step ----------------------------------------------------
    function scene({ formula = EXAMPLES[0], a = 0, b = 5, n = 4, method = 'left', animate = false }) {
      stopPlaying();
      formulaInput.value = formula;
      formulaInput.dispatchEvent(new Event('change'));
      Object.assign(state, { a, b, n, method });
      aSlider.value = a;
      bSlider.value = b;
      nSlider.value = n;
      methodSelect.value = method;
      update();
      if (animate) play();
    }

    const tour = addSteps(lesson, [
      {
        title: 'How much area is under the curve?',
        text: String.raw`The yellow curve and the $x$-axis trap a region between $a = 0$ and $b = 5$. We want its area. Curvy shapes are hard to measure, but rectangles are easy: width times height. So we'll fill the region with rectangles and add them up.`,
        focus: 'Look at the region between the dashed lines at a and b.',
        enter: () => scene({ n: 1 }),
      },
      {
        title: 'Cut it into strips',
        text: String.raw`Cut the interval into $n$ strips of the same width:
$$\Delta x = \frac{b - a}{n} = \frac{5 - 0}{4} = 1.25$$
Each strip becomes a rectangle. Its height is the height of the curve at the strip's left edge.`,
        focus: 'Each blue rectangle touches the curve at its top-left corner.',
        enter: () => scene({ n: 4 }),
      },
      {
        title: 'Add up the rectangles',
        text: String.raw`Add the four rectangle areas:
$$S_n = f(x_1)\,\Delta x + f(x_2)\,\Delta x + \cdots + f(x_n)\,\Delta x = \sum_{i=1}^{n} f(x_i)\,\Delta x$$
This total is called a **Riemann sum**. With only four rectangles it misses some area and counts some extra.`,
        focus: 'Compare the Riemann sum with the exact value in the Results card.',
        enter: () => scene({ n: 4 }),
      },
      {
        title: 'Use thinner strips',
        text: String.raw`Thinner rectangles follow the curve more closely. Watch $n$ climb: the gaps and the overshoots both get smaller, and so does the error. Here, doubling the number of strips roughly halves the error.`,
        focus: 'Watch the Error number get smaller as n grows.',
        enter: () => scene({ n: 1, animate: true }),
      },
      {
        title: 'Measure the height in the middle',
        text: String.raw`The left edge is only one choice. If you measure each rectangle's height in the middle of its strip, the bits that overshoot and the bits that fall short mostly cancel. The answer gets better much faster.

Quick check: with the same $n$, which method gives the smaller error? (The midpoint one.)`,
        focus: 'Switch the Method between Left endpoint and Midpoint and compare the Error.',
        enter: () => scene({ n: 6, method: 'midpoint' }),
      },
      {
        title: 'Area below the axis counts as negative',
        text: String.raw`When the curve dips below the axis, those rectangles have negative height, so they subtract (red). For $\sin x$ from 0 to 5:
$$\int_0^5 \sin x\,dx = 1 - \cos 5 \approx 0.716$$
The bump above the axis is bigger than the dip below it, so the total comes out positive.`,
        focus: 'The red rectangles sit below the axis and subtract.',
        enter: () => scene({ formula: 'sin(x)', n: 20 }),
      },
      {
        title: 'The integral is where the sums settle',
        text: String.raw`As the strips get thinner and thinner, the sums settle on one number. That number is the integral:
$$\int_a^b f(x)\,dx = \lim_{n \to \infty} \sum_{i=1}^{n} f(x_i)\,\Delta x$$
You rarely add rectangles by hand. If you know a function $F$ whose derivative is $f$, the answer is $F(b) - F(a)$.`,
        focus: 'At n = 200 the rectangles are thinner than a pixel and the error is tiny.',
        enter: () => scene({ n: 200, method: 'midpoint' }),
      },
      {
        title: 'Your turn',
        text: String.raw`Try $3e^{-x^2}$, the bell curve. There's no simple formula for its area, so computers find it with sums exactly like these. Integrals turn a speed into the distance travelled, and a probability density into a probability.`,
        focus: 'Change a and b, guess the area, then read it off.',
        enter: () => scene({ formula: '3e^(-x^2)', a: -3, b: 3, n: 12, method: 'midpoint' }),
      },
    ]);

    update();
    tour.go(0);

    return () => {
      stopPlaying();
      plot.destroy();
    };
  },
};

/** Build each strip as a polygon, with its signed area. */
function strips({ f, a, b, n, method }) {
  const dx = (b - a) / n;
  const result = [];
  for (let i = 0; i < n; i++) {
    const xl = a + i * dx;
    const xr = xl + dx;
    if (method === 'trapezoid') {
      const yl = f(xl);
      const yr = f(xr);
      result.push({ points: [[xl, 0], [xl, yl], [xr, yr], [xr, 0]], height: (yl + yr) / 2, area: ((yl + yr) / 2) * dx });
    } else {
      const y = f(METHODS[method].sample(xl, dx));
      result.push({ points: [[xl, 0], [xl, y], [xr, y], [xr, 0]], height: y, area: y * dx });
    }
  }
  return result;
}
