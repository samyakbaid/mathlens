// The derivative as the limit of secant slopes.

import { Plot, COLORS } from '../../lib/plot.js';
import { addHeading, addSlider, addSelect, addTextInput, addCheckbox, addReadout, addButtons, addNote, addSteps } from '../../lib/controls.js';
import { parseExpression } from '../../lib/expression.js';
import { derivative, format, clamp } from '../../lib/numeric.js';

const EXAMPLES = ['sin(x) + 0.3x', 'x^3/6 - x', '3e^(-x^2)', 'abs(x)', 'ln(x)', 'sqrt(abs(x))'];

export default {
  id: 'derivative',
  title: 'The Derivative',
  category: 'Calculus',
  level: 'Foundations',
  summary: 'Shrink the line between two points until it just touches the curve, and its slope becomes the derivative.',

  explanation: String.raw`
## The idea
The derivative $f'(x_0)$ is the **instantaneous rate of change** of $f$ at $x_0$: the slope of the curve if you zoom in until it looks like a straight line.

You can't get a slope from one point, so start with two. The **secant line** through $(x_0, f(x_0))$ and $(x_0 + h, f(x_0 + h))$ has slope

$$\frac{\Delta y}{\Delta x} = \frac{f(x_0 + h) - f(x_0)}{h}.$$

Now let the second point slide toward the first. The limit of those slopes is the derivative:

$$f'(x_0) = \lim_{h \to 0} \frac{f(x_0 + h) - f(x_0)}{h}.$$

**Example.** For $f(x) = x^2$: $\frac{(x+h)^2 - x^2}{h} = 2x + h \to 2x$ as $h \to 0$.

## Things to try
- Press **Shrink h** and watch the purple secant turn into the green tangent.
- Drag the green point along the curve. Turn on **Show f′(x)** to see the slope traced out as its own curve: where $f$ peaks, $f'$ crosses zero.
- Try $|x|$ at $x_0 = 0$. The secant slope is $+1$ from the right and $-1$ from the left, so the limit doesn't exist. The function has a corner and no derivative there.
- Type your own function, such as x^4 - 3x^2 or sin(3x)/x.

## Where it's used
Velocity and acceleration in physics, marginal cost and revenue in economics, and gradient descent in machine learning, which repeatedly steps in the direction where the loss decreases fastest.
`,

  mount({ plotArea, controls, lesson }) {
    const state = {
      f: parseExpression(EXAMPLES[0]),
      x0: 1,
      h: 1.5,
      showDerivative: false,
    };
    let animationId = null;

    const plot = new Plot(plotArea, { xMin: -6, xMax: 6, yMin: -4, yMax: 4 }, { height: 460 });

    // ---- Controls ----------------------------------------------------------
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

    addHeading(controls, 'Points');
    const x0Slider = addSlider(controls, {
      label: 'x₀',
      min: -5,
      max: 5,
      step: 0.01,
      value: state.x0,
      format: (v) => v.toFixed(2),
      onInput: (v) => {
        state.x0 = v;
        update();
      },
    });
    const hSlider = addSlider(controls, {
      label: 'h (distance to second point)',
      min: -3,
      max: 3,
      step: 0.001,
      value: state.h,
      format: (v) => v.toFixed(3),
      onInput: (v) => {
        stopAnimation();
        state.h = v;
        update();
      },
    });
    addButtons(controls, [
      { label: 'Shrink h toward 0', icon: 'play', primary: true, onClick: shrinkH },
      { label: 'Reset h', onClick: () => setH(1.5) },
    ]);
    const derivativeToggle = addCheckbox(controls, {
      label: 'Show f′(x)',
      onChange: (checked) => {
        state.showDerivative = checked;
        update();
      },
    });

    addHeading(controls, 'Slopes');
    const fReadout = addReadout(controls, 'f(x₀)');
    const secantReadout = addReadout(controls, 'Secant slope Δy/h');
    const tangentReadout = addReadout(controls, "Tangent slope f′(x₀)");
    addNote(controls, 'Drag the green point to move x₀ and the purple point to change h.');

    // ---- Dragging ------------------------------------------------------------
    plot.addDraggable({
      get: () => [state.x0, state.f(state.x0)],
      set: (x) => {
        state.x0 = clamp(x, -5, 5);
        x0Slider.value = state.x0;
        update();
      },
    });
    plot.addDraggable({
      get: () => [state.x0 + state.h, state.f(state.x0 + state.h)],
      set: (x) => {
        stopAnimation();
        setH(clamp(x - state.x0, -3, 3));
      },
    });

    // ---- Drawing ---------------------------------------------------------------
    plot.onDraw = (p) => {
      const { f, x0, h } = state;
      const y0 = f(x0);
      const slope = derivative(f, x0);

      p.grid();
      if (state.showDerivative) {
        p.curve((x) => derivative(f, x), { color: COLORS.orange, width: 2, dash: [6, 4] });
        p.text("f′(x)", p.bounds.xMax - 0.3, derivative(f, p.bounds.xMax - 0.3), { color: COLORS.orange, align: 'right' });
      }
      p.curve(f, { color: COLORS.blue, width: 3 });

      if (Number.isFinite(y0)) {
        // Tangent line
        p.curve((x) => y0 + slope * (x - x0), { color: COLORS.green, width: 2 });

        // Secant line and the rise/run triangle
        const x1 = x0 + h;
        const y1 = f(x1);
        if (Math.abs(h) > 1e-6 && Number.isFinite(y1)) {
          const secantSlope = (y1 - y0) / h;
          p.curve((x) => y0 + secantSlope * (x - x0), { color: COLORS.purple, width: 2, dash: [8, 5] });
          p.line(x0, y0, x1, y0, { color: COLORS.yellow, width: 1.5, dash: [3, 3] });
          p.line(x1, y0, x1, y1, { color: COLORS.yellow, width: 1.5, dash: [3, 3] });
          p.text('h', (x0 + x1) / 2, y0, { color: COLORS.yellow, align: 'center', baseline: 'top', offset: [0, 4] });
          p.text('Δy', x1, (y0 + y1) / 2, { color: COLORS.yellow, baseline: 'middle', offset: [6, 0] });
          p.point(x1, y1, { color: COLORS.purple, radius: 6 });
        }
        p.point(x0, y0, { color: COLORS.green, radius: 7 });
      }
    };

    function update() {
      const { f, x0, h } = state;
      fReadout.text(format(f(x0)));
      secantReadout.text(Math.abs(h) > 1e-6 ? format((f(x0 + h) - f(x0)) / h) : '—');
      tangentReadout.text(format(derivative(f, x0)));
      plot.render();
    }

    function setH(value) {
      state.h = value;
      hSlider.value = value;
      update();
    }

    // Shrink h geometrically toward 0, keeping its sign
    function shrinkH() {
      stopAnimation();
      if (Math.abs(state.h) < 0.002) setH(1.5);
      const step = () => {
        setH(state.h * 0.96);
        if (Math.abs(state.h) > 0.001) animationId = requestAnimationFrame(step);
      };
      animationId = requestAnimationFrame(step);
    }

    function stopAnimation() {
      cancelAnimationFrame(animationId);
    }

    // ---- The lesson, step by step ----------------------------------------------------
    function setFormula(text) {
      formulaInput.value = text;
      formulaInput.dispatchEvent(new Event('change'));
    }
    function scene({ formula = EXAMPLES[0], x0 = 1, h = 1.5, showDerivative = false, shrink = false }) {
      stopAnimation();
      setFormula(formula);
      state.x0 = x0;
      x0Slider.value = x0;
      state.showDerivative = showDerivative;
      derivativeToggle.checked = showDerivative;
      setH(h);
      if (shrink) shrinkH();
    }

    const tour = addSteps(lesson, [
      {
        title: 'How steep is this curve?',
        text: String.raw`Here's a curve. At the green point it's climbing, and we want one number for how steep it is right there. That number is the derivative. For a straight line, steepness is easy: rise divided by run. A curve keeps bending, so we'll sneak up on it using straight lines.`,
        focus: 'Look at the green point on the blue curve.',
        enter: () => scene({ h: 1.5 }),
      },
      {
        title: 'Draw a line through two points',
        text: String.raw`Put a second point a little further along, a distance $h$ to the right (purple). Join the two points with a straight line, called a **secant line**. Its steepness is rise over run:
$$\text{slope} = \frac{f(x_0 + h) - f(x_0)}{h}$$
The yellow triangle shows the run $h$ and the rise $\Delta y$.`,
        focus: 'The purple dashed line is the secant. Its slope is in the Slopes card below.',
        enter: () => scene({ h: 1.5 }),
      },
      {
        title: 'Move the second point closer',
        text: String.raw`The secant is a rough answer, because the curve bends between the two points. Bring the purple point closer and the line hugs the curve more tightly near the green point. Try it yourself: drag the purple point toward the green one.`,
        focus: 'Drag the purple point toward the green one and watch the purple line swing.',
        enter: () => scene({ h: 0.6 }),
      },
      {
        title: 'Let the gap shrink to zero',
        text: String.raw`Keep shrinking $h$. The secant swings into one position and stays there. That final line is the **tangent line** (green), and its slope is the derivative:
$$f'(x_0) = \lim_{h \to 0} \frac{f(x_0 + h) - f(x_0)}{h}$$
Putting $h = 0$ straight into the fraction would mean dividing by zero, so instead we watch where the slopes are heading.`,
        focus: 'Watch the secant slope number settle onto the tangent slope.',
        enter: () => scene({ h: 1.5, shrink: true }),
      },
      {
        title: 'Try it by hand with x squared',
        text: String.raw`Take $f(x) = x^2$ at $x_0 = 1$ and put it into the slope formula:
$$\frac{(1 + h)^2 - 1}{h} = \frac{1 + 2h + h^2 - 1}{h} = 2 + h$$
With $h = 1$ the secant slope is 3. With $h = 0.1$ it's 2.1.`,
        focus: 'Drag the purple point. The secant slope always equals 2 + h.',
        enter: () => scene({ formula: 'x^2', x0: 1, h: 1 }),
      },
      {
        title: 'Finish the example',
        text: String.raw`As $h$ shrinks, $2 + h$ heads to 2. So the slope of $x^2$ at $x = 1$ is exactly 2. Repeat this at any point $x$ and you get $2x$, which is the rule $\frac{d}{dx}x^2 = 2x$.

Quick check: what's the slope at $x = 3$? (It's $2 \cdot 3 = 6$.)`,
        focus: 'Move the green point to x = 3 and read the tangent slope.',
        enter: () => scene({ formula: 'x^2', x0: 1, h: 0.05 }),
      },
      {
        title: 'The slope at every point',
        text: String.raw`Work out the slope at every $x$ and plot those numbers. You get a new curve, $f'(x)$ (orange, dashed). Where $f$ goes uphill, $f'$ is above zero. Where it goes downhill, $f'$ is below zero. At the top of a hill the tangent is flat, so $f'(x) = 0$. That's how you find the highest and lowest points of a curve.`,
        focus: 'Drag the green point to the top of the hump: the orange curve crosses zero right there.',
        enter: () => scene({ formula: 'x^3/6 - x', x0: -1.41, h: 0.6, showDerivative: true }),
      },
      {
        title: 'A curve with a sharp corner',
        text: String.raw`Some curves have no slope at a point. $f(x) = |x|$ has a sharp corner at 0. From the right, every secant has slope $1$. From the left, every secant has slope $-1$. The two sides never agree, so there's no single tangent line, and no derivative at 0.`,
        focus: 'Drag the purple point from the right side of 0 to the left side. The slope jumps from 1 to −1.',
        enter: () => scene({ formula: 'abs(x)', x0: 0, h: 1 }),
      },
      {
        title: 'Your turn',
        text: String.raw`Type any function into the formula box, like $x^4 - 3x^2$ or $\sin(3x)$. Pick a point, guess the slope, then press Shrink h toward 0 to check. Your speed is the derivative of your position, and machine learning models learn by following derivatives downhill.`,
        focus: 'Pick a point, guess the slope, then press Shrink h toward 0.',
        enter: () => scene({ h: 1.5 }),
      },
    ]);

    update();
    tour.go(0);

    return () => {
      stopAnimation();
      plot.destroy();
    };
  },
};
