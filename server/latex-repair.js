// Fixes the most common bug in AI-written visualizations: LaTeX inside JavaScript strings.
//
// In JavaScript, '\frac' is a form feed + "rac", '\text' a tab + "ext", '\big' a backspace + "ig",
// '\alpha' just "alpha". Models often forget to double the backslash, so equations come out
// broken. This scans inline <script> code and doubles the backslash in front of known LaTeX
// commands ('\leftarrow' → '\\leftarrow'). It leaves alone:
//   - backslashes that are already doubled ('\\frac')
//   - String.raw`...` templates, where a single backslash is correct
//   - ordinary escapes like '\n' or '²' (they are not LaTeX command names)

const LATEX_COMMANDS = new Set(`
  alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi pi varpi rho
  varrho sigma varsigma tau upsilon phi varphi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega
  frac dfrac tfrac sqrt sum prod int iint iiint oint lim limsup liminf sup inf max min arg argmax argmin det exp log ln
  sin cos tan sec csc cot arcsin arccos arctan sinh cosh tanh
  left right big Big bigg Bigg bigl bigr Bigl Bigr middle
  text textbf textit mathrm mathbf mathit mathcal mathbb mathsf boldsymbol operatorname
  cdot cdots ldots dots vdots ddots times div pm mp ast star circ bullet
  le leq ge geq neq ne approx sim simeq equiv cong propto ll gg
  in notin subset subseteq supset supseteq cup cap setminus emptyset varnothing forall exists nexists
  to rightarrow leftarrow Rightarrow Leftarrow leftrightarrow Leftrightarrow mapsto implies iff
  uparrow downarrow longrightarrow longleftarrow
  partial nabla infty hbar ell Re Im
  hat bar vec tilde dot ddot overline underline widehat widetilde overrightarrow
  quad qquad
  begin end matrix pmatrix bmatrix vmatrix cases aligned
  langle rangle lvert rvert lVert rVert lfloor rfloor lceil rceil
  top perp parallel angle triangle
  displaystyle textstyle color mid
`.trim().split(/\s+/));

/** Repair LaTeX backslashes inside every inline <script> of an HTML document. */
export function repairLatexInScripts(html) {
  return String(html).replace(/(<script\b(?![^>]*\bsrc=)[^>]*>)([\s\S]*?)(<\/script>)/gi, (match, open, code, close) => open + repairLatexInCode(code) + close);
}

/** Repair one piece of JavaScript source. Exported for tests. */
export function repairLatexInCode(code) {
  let out = '';
  let i = 0;
  while (i < code.length) {
    // Skip String.raw`...` entirely: single backslashes are correct there
    if (code.startsWith('String.raw`', i)) {
      const end = findTemplateEnd(code, i + 'String.raw`'.length);
      out += code.slice(i, end);
      i = end;
      continue;
    }
    const ch = code[i];
    if (ch !== '\\') {
      out += ch;
      i++;
      continue;
    }
    // An already-doubled backslash: keep both
    if (code[i + 1] === '\\') {
      out += '\\\\';
      i += 2;
      continue;
    }
    const word = /^[A-Za-z]+/.exec(code.slice(i + 1, i + 40))?.[0] ?? '';
    out += word && LATEX_COMMANDS.has(word) ? `\\\\${word}` : `\\${word}`;
    i += 1 + word.length;
  }
  return out;
}

/** Index just after the closing backtick of a template literal that starts at `start`. */
function findTemplateEnd(code, start) {
  let depth = 0;
  for (let i = start; i < code.length; i++) {
    const ch = code[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    if (depth === 0 && ch === '`') return i + 1;
    if (ch === '$' && code[i + 1] === '{') {
      depth++;
      i++;
    } else if (ch === '}' && depth > 0) {
      depth--;
    }
  }
  return code.length;
}
