// Renders Markdown that contains LaTeX math.
//   Inline math:  $a^2 + b^2$   or  \( ... \)
//   Display math: $$\int_0^1 x\,dx$$  or  \[ ... \]
//   A phrase tied to something in the picture: [[orange:the tangent line]]
//
// How it works: math is cut out and replaced with placeholders first, so the Markdown
// parser can't mangle backslashes or underscores. Then the Markdown is converted and
// sanitized, and finally each placeholder is swapped for KaTeX's rendered HTML.
// Uses the globals `marked`, `DOMPurify` and `katex` loaded in index.html.

const MATH_PATTERN = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$([^$\n]+?)\$/g;

const REF_PATTERN = /\[\[(blue|orange|green|red|purple|yellow|cyan|pink):([^\]\n]+)\]\]/g;

/** One line of Markdown, without the surrounding paragraph. */
export function renderMarkdownInline(markdown) {
  return renderMarkdown(markdown).replace(/^\s*<p>/, '').replace(/<\/p>\s*$/, '');
}

export function renderMarkdown(markdown) {
  const mathHtml = [];

  const withPlaceholders = markdown.replace(MATH_PATTERN, (match, display1, display2, inline1, inline2) => {
    const isDisplay = display1 !== undefined || display2 !== undefined;
    const tex = display1 ?? display2 ?? inline1 ?? inline2;
    mathHtml.push(renderMath(tex, isDisplay));
    return `MATHPLACEHOLDER${mathHtml.length - 1}END`;
  });

  const withRefs = withPlaceholders.replace(REF_PATTERN, (_, color, words) => `<span class="ml-ref" data-ref="${color}" style="--ref: var(--c-${color})">${words}</span>`);
  const html = DOMPurify.sanitize(marked.parse(withRefs));
  return html.replace(/MATHPLACEHOLDER(\d+)END/g, (_, index) => mathHtml[Number(index)]);
}

/**
 * Render a single LaTeX string to HTML. Bad LaTeX shows in red instead of throwing.
 * \htmlClass{c-green}{...} is allowed so formulas can use the theme colours (see .c-* in styles.css).
 */
export function renderMath(tex, displayMode = false) {
  return katex.renderToString(tex, {
    displayMode,
    throwOnError: false,
    strict: 'ignore',
    trust: (context) => context.command === '\\htmlClass' && /^c-[a-z]+$/.test(context.class ?? ''),
  });
}
