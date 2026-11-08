// Taylor polynomials: approximating a function near a point with a polynomial.

import { Plot, COLORS, alpha } from '../../lib/plot.js';
import { addHeading, addSlider, addSelect, addReadout, addButtons, addNote, addSteps } from '../../lib/controls.js';
import { format, clamp } from '../../lib/numeric.js';

// Each function gives its Taylor coefficient cₖ = f⁽ᵏ⁾(a) / k! around a center a.
// `radius` is the radius of convergence (Infinity if the series converges everywhere).
const FUNCTIONS = {
  sin: {
    label: 'sin(x)',
    tex: String.raw`\sin x`,
    f: Math.sin,
    coefficient: (k, a) => Math.sin(a + (k * Math.PI) / 2) / factorial(k),
    radius: () => Infinity,
  },
  cos: {
    label: 'cos(x)',
    tex: String.raw`\cos x`,
    f: Math.cos,
    coefficient: (k, a) => Math.cos(a + (k * Math.PI) / 2) / factorial(k),
    radius: () => Infinity,
  },
  exp: {
    label: 'eˣ',
    tex: 'e^x',
    f: Math.exp,
    coefficient: (k, a) => Math.exp(a) / factorial(k),
    radius: () => Infinity,
  },
  log: {
    label: 'ln(1 + x)',
    tex: String.raw`\ln(1 + x)`,
    f: (x) => Math.log(1 + x),
    coefficient: (k, a) => (k === 0 ? Math.log(1 + a) : (k % 2 === 1 ? 1 : -1) / (k * Math.pow(1 + a, k))),
    radius: (a) => 1 + a, // distance to the singularity at x = −1
    validCenter: (a) => a > -0.95,
  },
  geometric: {
    label: '1 / (1 − x)',
    tex: String.raw`\frac{1}{1 - x}`,
    f: (x) => 1 / (1 - x),
    coefficient: (k, a) => 1 / Math.pow(1 - a, k + 1),
    radius: (a) => Math.abs(1 - a), // distance to the singularity at x = 1
    validCenter: (a) => Math.abs(1 - a) > 0.05,
  },
};

export default {
  id: 'taylor-series',
  title: 'Taylor Series',
  category: 'Calculus',
  level: 'Undergraduate',
  summary: 'Copy a curve with a polynomial, one term at a time, and see how far the copy holds up.',

  explanation: String.raw`
## The idea
Near a point $a$, a smooth function can be approximated by a polynomial that matches its value, slope, curvature and higher derivatives at $a$:

$$P_n(x) = \sum_{k=0}^{n} \frac{f^{(k)}(a)}{k!}\,(x - a)^k = f(a) + f'(a)(x-a) + \frac{f''(a)}{2!}(x-a)^2 + \cdots$$

Each extra term fixes one more derivative, so the approximation hugs the curve over a wider range.

**Example.** Around $a = 0$: $\;e^x = 1 + x + \frac{x^2}{2!} + \frac{x^3}{3!} + \cdots$ and $\;\sin x = x - \frac{x^3}{3!} + \frac{x^5}{5!} - \cdots$

## How good is it?
Taylor's theorem bounds the error: for some $\xi$ between $a$ and $x$,

$$f(x) - P_n(x) = \frac{f^{(n+1)}(\xi)}{(n+1)!}(x - a)^{n+1}.$$

For $\sin$, $\cos$ and $e^x$ the factorial wins, and the series converges for every $x$. For $\ln(1+x)$ and $\frac{1}{1-x}$ it converges only within the **radius of convergence** $R$, the distance from $a$ to the nearest point where the function blows up. Outside that range, adding terms makes things *worse*.

## Things to try
- Press **Play** to add terms one by one.
- Pick $\frac{1}{1-x}$ and watch the polynomials diverge wildly outside the shaded region, no matter how many terms you add.
- Move the center $a$ and notice the radius of convergence change with it.
- Drag the orange probe point to read the error at a specific $x$.

## Where it's used
Physics approximations such as $\sin\theta \approx \theta$ for small angles, error analysis of numerical methods, Newton's method, and how calculators and math libraries compute $\sin$, $\exp$ and $\log$.
`,

  mount({ plotArea, controls, lesson }) {
    const state = { name: 'sin', degree: 3, center: 0, probe: 2 };
    let timerId = null;

    const plot = new Plot(plotArea, { xMin: -7, xMax: 7, yMin: -4, yMax: 4 }, { height: 440 });
    const formulaReadout = addReadout(plotArea, 'Pₙ(x)', { wide: true });

    // ---- Controls --------------------------------------------------------------
    addHeading(controls, 'Function');
    const functionSelect = addSelect(controls, {
      options: Object.entries(FUNCTIONS).map(([value, fn]) => ({ value, label: fn.label })),
      value: state.name,
      onChange: (name) => {
        state.name = name;
        update();
      },
    });

    addHeading(controls, 'Polynomial');
    const degreeSlider = addSlider(controls, {
      label: 'Degree n',
      min: 0,
      max: 25,
      value: state.degree,
      onInput: (v) => {
        stopPlaying();
        state.degree = v;
        update();
      },
    });
    const centerSlider = addSlider(controls, {
      label: 'Center a',
      min: -3,
      max: 3,
      step: 0.05,
      value: state.center,
      format: (v) => v.toFixed(2),
      onInput: (v) => {
        state.center = v;
        update();
      },
    });
    addButtons(controls, [{ label: 'Play: add terms', icon: 'play', primary: true, onClick: play }]);

    addHeading(controls, 'At the probe point');
    const probeReadout = addReadout(controls, 'x');
    const exactReadout = addReadout(controls, 'f(x)');
    const approxReadout = addReadout(controls, 'Pₙ(x)');
    const errorReadout = addReadout(controls, '|error|');
    const radiusReadout = addReadout(controls, 'Radius of convergence');
    const warning = addNote(controls, '');
    addNote(controls, 'Drag the orange point along the x-axis.');

    plot.addDraggable({
      get: () => [state.probe, 0],
      set: (x) => {
        state.probe = clamp(x, -7, 7);
        update();
      },
    });

    // ---- Drawing ----------------------------------------------------------------
    plot.onDraw = (p) => {
      const fn = FUNCTIONS[state.name];
      const a = state.center;
      const valid = !fn.validCenter || fn.validCenter(a);
      const R = fn.radius(a);

      // Shade where the series diverges
      if (valid && Number.isFinite(R)) {
        const { xMin, xMax, yMin, yMax } = p.bounds;
        const shade = { fill: alpha(COLORS.red, 0.08), color: null };
        p.path([[xMin, yMin], [a - R, yMin], [a - R, yMax], [xMin, yMax]], { ...shade, closed: true });
        p.path([[a + R, yMin], [xMax, yMin], [xMax, yMax], [a + R, yMax]], { ...shade, closed: true });
        p.verticalLine(a - R, { color: alpha(COLORS.red, 0.5), width: 1, dash: [5, 4] });
        p.verticalLine(a + R, { color: alpha(COLORS.red, 0.5), width: 1, dash: [5, 4] });
      }

      p.grid();
      p.curve(fn.f, { color: COLORS.blue, width: 3 });

      if (valid) {
        const P = taylorPolynomial(fn, a, state.degree);
        p.curve(P, { color: COLORS.green, width: 2.5 });
        p.point(a, fn.f(a), { color: COLORS.green, radius: 6 });
        p.text('a', a, fn.f(a), { color: COLORS.green });

        // Probe: vertical gap between f and P
        const x = state.probe;
        p.line(x, fn.f(x), x, clamp(P(x), -50, 50), { color: COLORS.orange, width: 1.5, dash: [3, 3] });
        p.point(x, fn.f(x), { color: COLORS.blue, radius: 4 });
        p.point(x, P(x), { color: COLORS.green, radius: 4 });
      }
      p.point(state.probe, 0, { color: COLORS.orange, radius: 7 });
    };

    function update() {
      const fn = FUNCTIONS[state.name];
      const a = state.center;
      const valid = !fn.validCenter || fn.validCenter(a);
      const x = state.probe;

      probeReadout.text(format(x, 2));
      exactReadout.text(format(fn.f(x)));
      const R = fn.radius(a);
      radiusReadout.text(Number.isFinite(R) ? format(R, 3) : '∞');

      if (valid) {
        const P = taylorPolynomial(fn, a, state.degree);
        approxReadout.text(format(P(x)));
        errorReadout.text(format(Math.abs(fn.f(x) - P(x))));
        formulaReadout.math(polynomialTex(fn, a, state.degree));
        warning.textContent = '';
      } else {
        approxReadout.text('—');
        errorReadout.text('—');
        formulaReadout.text('—');
        warning.textContent = `${fn.label} is not defined at a = ${format(a, 2)}, so there is no Taylor series there. Move the center.`;
      }
      plot.render();
    }

    function play() {
      stopPlaying();
      state.degree = 0;
      degreeSlider.value = 0;
      update();
      timerId = setInterval(() => {
        state.degree += 1;
        degreeSlider.value = state.degree;
        update();
        if (state.degree >= 25) stopPlaying();
      }, 450);
    }

    function stopPlaying() {
      clearInterval(timerId);
    }

    // ---- The lesson, step by step ----------------------------------------------------
    function scene({ name = 'sin', degree = 0, center = 0, probe = 2, animate = false }) {
      stopPlaying();
      Object.assign(state, { name, degree, center, probe });
      functionSelect.value = name;
      degreeSlider.value = degree;
      centerSlider.value = center;
      update();
      if (animate) play();
    }

    const tour = addSteps(lesson, [
      {
        title: 'Copy a curve with a polynomial',
        text: String.raw`Polynomials like $1 + x + x^2$ only need adding and multiplying, so they're easy to compute. The plan: near one point $a$, build a polynomial that behaves like $\sin x$. Start with the simplest copy, a flat line at the right height. At $a = 0$ that's $P_0(x) = 0$.`,
        focus: 'The green line is our copy so far. The blue curve is sin x.',
        enter: () => scene({ degree: 0 }),
      },
      {
        title: 'Match the slope',
        text: String.raw`A flat line has the wrong steepness. Tilt it so its slope matches the curve's slope at $a$:
$$P_1(x) = f(a) + f'(a)\,(x - a)$$
For $\sin x$ at 0 the slope is 1, so $P_1(x) = x$. Close to 0 it's a very good copy.`,
        focus: 'The orange probe sits at x = 0.6. Check the error there.',
        enter: () => scene({ degree: 1, probe: 0.6 }),
      },
      {
        title: 'Far away, the copy falls apart',
        text: String.raw`Now look at $x = 2.5$. The line keeps climbing while $\sin x$ turns back down. A straight line can only match the height and the slope. To follow the bend, the copy needs a term that bends.`,
        focus: 'Compare the blue and green curves near x = 2.5.',
        enter: () => scene({ degree: 1, probe: 2.5 }),
      },
      {
        title: 'Add a term for the bend',
        text: String.raw`Each extra power of $(x - a)$ lets the copy match one more derivative of the curve. The general recipe is
$$P_n(x) = \sum_{k=0}^{n} \frac{f^{(k)}(a)}{k!}\,(x - a)^k$$
For $\sin x$ the even-numbered terms are zero, so the next term is $-\frac{x^3}{6}$, giving $P_3(x) = x - \frac{x^3}{6}$.`,
        focus: 'The green curve now bends along with sin x for longer.',
        enter: () => scene({ degree: 3, probe: 2.5 }),
      },
      {
        title: 'Why we divide by k!',
        text: String.raw`Take the derivative of $x^3$ three times and you're left with $3 \cdot 2 \cdot 1 = 3! = 6$. Dividing by $k!$ cancels that out, so the copy's $k$-th derivative at $a$ equals the curve's.

Quick check: what's the coefficient of $x^5$ for $\sin x$? (It's $\frac{1}{5!} = \frac{1}{120}$.)`,
        focus: 'Read the polynomial under the graph and spot each coefficient.',
        enter: () => scene({ degree: 5, probe: 2 }),
      },
      {
        title: 'Keep adding terms',
        text: String.raw`Watch the degree go up one term at a time. Each new term pushes the good part of the copy a little further out. For $\sin x$, $\cos x$ and $e^x$ this keeps working forever: with enough terms the copy is as close as you like at every $x$.`,
        focus: 'Watch the error at the probe shrink as the degree climbs.',
        enter: () => scene({ degree: 0, probe: 4, animate: true }),
      },
      {
        title: 'Some copies only work nearby',
        text: String.raw`Some functions are less friendly. For
$$\frac{1}{1 - x} = 1 + x + x^2 + x^3 + \cdots$$
the terms only get smaller when $x$ is between $-1$ and $1$. Outside that range (shaded red) adding terms makes the copy worse. How far the safe range reaches is called the **radius of convergence**.`,
        focus: 'The probe at x = 1.5 is outside the safe range. Add terms and watch the error grow.',
        enter: () => scene({ name: 'geometric', degree: 8, probe: 1.5 }),
      },
      {
        title: 'Your turn',
        text: String.raw`Change the function and move the center $a$. Taylor polynomials are how calculators work out $\sin$ and $e^x$, and they're why physicists can write $\sin\theta \approx \theta$ for small angles.`,
        focus: 'Try ln(1 + x) and find where the copy stops working.',
        enter: () => scene({ name: 'exp', degree: 3, center: 0, probe: 1.5 }),
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

/** Returns P(x) = Σ cₖ (x − a)^k, evaluated with Horner's method. */
function taylorPolynomial(fn, a, degree) {
  const coefficients = [];
  for (let k = 0; k <= degree; k++) coefficients.push(fn.coefficient(k, a));
  return (x) => {
    let result = 0;
    for (let k = degree; k >= 0; k--) result = result * (x - a) + coefficients[k];
    return result;
  };
}

/** LaTeX for the polynomial, showing at most the first 5 non-zero terms. */
function polynomialTex(fn, a, degree) {
  const base = Math.abs(a) < 1e-9 ? 'x' : `(x ${a > 0 ? '-' : '+'} ${format(Math.abs(a), 2)})`;
  const terms = [];
  let hidden = false;
  for (let k = 0; k <= degree; k++) {
    const c = fn.coefficient(k, a);
    if (Math.abs(c) < 1e-12) continue;
    if (terms.length === 5) {
      hidden = true;
      break;
    }
    const power = k === 0 ? '' : k === 1 ? base : `${base}^{${k}}`;
    const magnitude = Math.abs(c);
    const coefficientText = k > 0 && Math.abs(magnitude - 1) < 1e-9 ? '' : format(magnitude, 4);
    const sign = c < 0 ? '-' : terms.length ? '+' : '';
    terms.push(`${sign} ${coefficientText}${power}`);
  }
  const body = terms.length ? terms.join(' ') : '0';
  return `${fn.tex} \\approx ${body}${hidden ? ' + \\cdots' : ''}`;
}

function factorial(n) {
  let result = 1;
  for (let i = 2; i <= n; i++) result *= i;
  return result;
}
