// MathLens viz kit: helper script injected into every AI-built visualization.
//
// - Equations without escaping problems: <div class="ml-eq" data-tex="\nabla f = \lambda \nabla g"></div>
//   (backslashes in HTML attributes are plain text). Change el.dataset.tex later and it re-renders.
// - MathLens.tex(el, latex, { display }) renders on demand.
// - MathLens.color('blue') reads a theme colour.
// - Lessons in steps: MathLens.onStep((index) => ...) is called with the step the page is showing
//   (right away, and whenever the reader presses Back / Next). MathLens.goTo(i) asks the page to
//   move to step i. MathLens.stepCount is the number of steps.
// - Tells the page how tall the content is, so the frame can fit it (no clipping, no empty space).
(function () {
  const KATEX_CSS = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css';
  const KATEX_JS = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js';
  const pending = new Set();

  // LaTeX command names. Models sometimes write \\frac (a line break + "frac") when they mean \frac,
  // so a doubled backslash in front of one of these is turned back into a single one.
  const COMMANDS = new Set('alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi pi varpi rho varrho sigma varsigma tau upsilon phi varphi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega frac dfrac tfrac sqrt sum prod int iint iiint oint lim limsup liminf sup inf max min arg argmax argmin det exp log ln sin cos tan sec csc cot arcsin arccos arctan sinh cosh tanh left right big Big bigg Bigg bigl bigr Bigl Bigr middle text textbf textit mathrm mathbf mathit mathcal mathbb mathsf boldsymbol operatorname cdot cdots ldots dots vdots ddots times div pm mp ast star circ bullet le leq ge geq neq ne approx sim simeq equiv cong propto ll gg in notin subset subseteq supset supseteq cup cap setminus emptyset varnothing forall exists nexists to rightarrow leftarrow Rightarrow Leftarrow leftrightarrow Leftrightarrow mapsto implies iff uparrow downarrow longrightarrow longleftarrow partial nabla infty hbar ell Re Im hat bar vec tilde dot ddot overline underline widehat widetilde overrightarrow quad qquad begin end matrix pmatrix bmatrix vmatrix cases aligned langle rangle lvert rvert lVert rVert lfloor rfloor lceil rceil top perp parallel angle triangle displaystyle textstyle color mid'.split(' '));
  function normalizeTex(tex) {
    // Plain words in a formula box would lose their spaces in math mode
    if (/^[A-Za-z][A-Za-z ,.'’:;?!-]* [A-Za-z ,.'’:;?!-]*$/.test(String(tex).trim())) return `\\text{${String(tex).trim()}}`;
    return String(tex).replace(/\\\\([A-Za-z]+)/g, (match, word, offset, text) =>
      text[offset - 1] === '\\' || !COMMANDS.has(word) ? match : '\\' + word,
    );
  }
  let katexReady = typeof window.katex !== 'undefined';

  function loadKatex() {
    if (katexReady || document.querySelector('script[data-ml-katex]')) return;
    if (!document.querySelector(`link[href="${KATEX_CSS}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = KATEX_CSS;
      document.head.appendChild(link);
    }
    const script = document.createElement('script');
    script.src = KATEX_JS;
    script.dataset.mlKatex = '1';
    script.onload = () => {
      katexReady = true;
      pending.forEach(render);
      pending.clear();
    };
    document.head.appendChild(script);
  }

  function render(el) {
    if (!el.isConnected) return;
    if (el.dataset.tex == null) return;
    if (!el.dataset.tex.trim()) {
      el.textContent = '';
      el.dataset.renderedTex = '';
      return;
    }
    const tex = normalizeTex(el.dataset.tex);
    if (!katexReady && typeof window.katex !== 'undefined') katexReady = true;
    if (!katexReady) {
      pending.add(el);
      loadKatex();
      return;
    }
    if (el.dataset.renderedTex === tex) return;
    el.dataset.renderedTex = tex;
    const display = el.dataset.display !== 'inline' && (el.classList.contains('ml-eq') || el.dataset.display === 'block');
    try {
      window.katex.render(tex, el, {
        displayMode: display,
        throwOnError: false,
        strict: 'ignore',
        trust: (context) => context.command === '\\htmlClass' && /^c-[a-z]+$/.test(context.class ?? ''),
      });
    } catch (err) {
      el.textContent = tex;
    }
    fit(el);
  }

  /** Shrink an equation that is wider than the space it has, instead of cutting it off. */
  function fit(el) {
    if (getComputedStyle(el).display === 'inline') return;
    el.style.fontSize = '';
    const formula = el.querySelector('.katex-html') || el.querySelector('.katex');
    if (!formula) return;
    const style = getComputedStyle(el);
    const padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
    const parentWidth = el.parentElement ? el.parentElement.clientWidth : Infinity;
    const available = Math.min(el.clientWidth || Infinity, parentWidth || Infinity) - padding;
    if (!Number.isFinite(available) || available <= 0) return;
    // KaTeX display math is a full-width block, so measure the formula's actual ink with a Range
    const range = document.createRange();
    const width = () => {
      range.selectNodeContents(formula);
      return range.getBoundingClientRect().width;
    };
    const base = parseFloat(style.fontSize) || 16;
    let size = base;
    while (width() > available + 1 && size > base * 0.5) {
      size -= 0.5;
      el.style.fontSize = `${size}px`;
    }
  }

  function renderAll(root) {
    (root.querySelectorAll ? root : document).querySelectorAll('[data-tex]').forEach(render);
    if (root.dataset && root.dataset.tex != null) render(root);
  }

  // ---- A picture that crashes says so, instead of showing an empty box -------------
  let drewAnything = false;
  function showCrashNote() {
    if (drewAnything || document.querySelector('.ml-crash') || !document.body) return;
    const note = document.createElement('div');
    note.className = 'ml-crash';
    note.textContent = "This picture couldn't be drawn. The explanation below still works. Please email us about this lesson so we can look into it.";
    document.body.prepend(note);
  }
  window.addEventListener('error', (event) => {
    if (event.target && event.target !== window) return; // a font or image that failed to load
    if (document.body) showCrashNote();
    else document.addEventListener('DOMContentLoaded', showCrashNote);
  });

  // ---- Steps ----------------------------------------------------------------------
  let stepHandler = null;
  let currentStep = Number(window.MATHLENS_INITIAL_STEP) || 0;
  let stepCount = Number(window.MATHLENS_STEP_COUNT) || 0;

  function runStep() {
    if (!stepHandler) return;
    document.dispatchEvent(new CustomEvent('mathlens:beforestep'));
    try {
      stepHandler(currentStep, stepCount);
    } catch (err) {
      console.error('MathLens step', currentStep, err);
      drewAnything = false;
      showCrashNote();
    }
    setTimeout(reportHeight, 60);
    setTimeout(reportHeight, 1100); // after the step's animation
  }

  window.addEventListener('message', (event) => {
    if (event.source !== parent || !event.data) return;
    if (event.data.type === 'mathlens:highlight') {
      document.dispatchEvent(new CustomEvent('mathlens:highlight', { detail: event.data.color || null }));
      return;
    }
    if (event.data.type !== 'mathlens:step') return;
    currentStep = Math.max(0, Math.floor(Number(event.data.index) || 0));
    if (Number.isFinite(event.data.count)) stepCount = event.data.count;
    runStep(); // scenes are built from scratch, so running one twice is harmless
  });

  window.MathLens = {
    onStep(handler) {
      stepHandler = typeof handler === 'function' ? handler : null;
      drewAnything = true;
      runStep();
    },
    goTo(index) {
      try {
        parent.postMessage({ type: 'mathlens:goto', index: Math.floor(Number(index) || 0) }, '*');
      } catch (err) {
        // not inside MathLens
      }
    },
    get step() {
      return currentStep;
    },
    get stepCount() {
      return stepCount;
    },
    tex(el, latex, options = {}) {
      if (!el) return;
      if (options.display === false) el.dataset.display = 'inline';
      if (options.display === true) el.dataset.display = 'block';
      el.dataset.tex = latex;
      render(el);
    },
    color(name) {
      return getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
    },
  };

  /**
   * How tall the content really is. scrollHeight is useless when a layout stretches to the frame
   * (100vh / height: 100%), so measure where visible elements end, ignoring full-height wrappers.
   */
  function contentHeight() {
    const viewport = window.innerHeight;
    // A page built on .ml-page fits the frame by design. Only ask for more room if the main
    // picture would be squeezed too small to read.
    const main = document.querySelector('.ml-page > .ml-main');
    if (main && window.innerWidth > 700) {
      return viewport + Math.max(0, 200 - main.getBoundingClientRect().height);
    }
    let bottom = 0;
    for (const node of document.body.querySelectorAll('*')) {
      if (node.closest('.ml-scroll-hint, .ml-zoom.floating')) continue;
      const rect = node.getBoundingClientRect();
      if (rect.height === 0 || rect.height >= viewport - 2) continue;
      bottom = Math.max(bottom, rect.bottom + window.scrollY);
    }
    const padding = parseFloat(getComputedStyle(document.body).paddingBottom) || 0;
    return bottom > 0 ? bottom + padding + 2 : document.documentElement.scrollHeight;
  }

  function reportHeight() {
    const height = Math.ceil(contentHeight());
    try {
      parent.postMessage({ type: 'mathlens:height', height }, '*');
    } catch (err) {
      // not inside MathLens
    }
  }

  function start() {
    try {
      parent.postMessage({ type: 'mathlens:ready' }, '*');
    } catch (err) {
      // not inside MathLens
    }
    renderAll(document);
    new MutationObserver((changes) => {
      for (const change of changes) {
        if (change.type === 'attributes') render(change.target);
        else change.addedNodes.forEach((node) => node.nodeType === 1 && renderAll(node));
      }
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-tex'] });

    let timer = null;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(reportHeight, 120);
    };
    new ResizeObserver(schedule).observe(document.body);
    const refitAll = () => document.querySelectorAll('[data-tex]').forEach(fit);
    window.addEventListener('resize', refitAll);
    if (document.fonts) document.fonts.ready.then(refitAll); // KaTeX fonts change widths once loaded
    setTimeout(refitAll, 800);
    window.addEventListener('load', schedule);
    schedule();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
