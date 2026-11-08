// Catches AI-written pictures that can't even start. One stray character in a script blanks the
// whole picture, so check that every inline script compiles before anyone sees or pays for it.
// vm.Script only parses the code; it is never run on the server.

import vm from 'node:vm';

const INLINE_SCRIPT = /(<script\b(?![^>]*\bsrc=)[^>]*>)([\s\S]*?)(<\/script>)/gi;

function compileError(code) {
  try {
    new vm.Script(code);
    return null;
  } catch (err) {
    return err instanceof SyntaxError ? err.message : null;
  }
}

/** Known slips with a safe fix: 'f\\'(x)' was meant to be 'f\'(x)', with an escaped quote. */
function quickFix(code) {
  return code.replace(/\\\\(['"])/g, '\\$1');
}

/**
 * Check a picture's scripts and fix what can be fixed locally.
 * @returns {{ html: string, broken: { code: string, error: string }[] }} broken: still doesn't compile
 */
export function checkScripts(html) {
  const broken = [];
  const fixed = String(html).replace(INLINE_SCRIPT, (match, open, code, close) => {
    const error = compileError(code);
    if (!error) return match;
    const attempt = quickFix(code);
    if (!compileError(attempt)) return open + attempt + close;
    broken.push({ code, error });
    return match;
  });
  return { html: fixed, broken };
}

export function replaceScript(html, oldCode, newCode) {
  return String(html).replace(oldCode, () => newCode);
}

export { compileError };
