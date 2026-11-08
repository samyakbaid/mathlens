// Turns a formula typed by a user, like "a sin(bx) + x^2/3", into something we can evaluate.
//
// This is a small hand-written parser (no eval), so only math can run.
// Supported:  numbers, variables (x, a, b, ... single letters), pi / π, e, theta / θ
//             + - * / ^, parentheses, implicit multiplication (2x, 3sin(x), ab, (x+1)(x-1))
//             sin cos tan sec csc cot asin acos atan sinh cosh tanh exp ln log sqrt cbrt
//             abs floor ceil round sign, min(a, b), max(a, b), mod(a, b)
//             user-defined functions such as f(x) (pass their names in `functionNames`)
//
// Two ways to use it:
//   parseExpression('x^3 - 2x')      → (x) => number      (only x allowed; used by the topics)
//   parse('a sin(bx)')               → { evaluate(env), variables, functions, tex }
//        env = { vars: { x: 1, a: 2, b: 3 }, fns: { f: (x) => ... } }
//
// Grammar (lowest to highest precedence):
//   sum     = product (("+" | "-") product)*
//   product = unary (("*" | "/" | implicit) unary)*
//   unary   = "-" unary | "+" unary | power
//   power   = atom ("^" unary)?          → right-associative, and -x^2 means -(x^2)
//   atom    = number | name | function "(" args ")" | "(" sum ")" | "|" sum "|"

const FUNCTIONS = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  sec: (x) => 1 / Math.cos(x), csc: (x) => 1 / Math.sin(x), cot: (x) => 1 / Math.tan(x),
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  arcsin: Math.asin, arccos: Math.acos, arctan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  exp: Math.exp, ln: Math.log, log: Math.log, sqrt: Math.sqrt, cbrt: Math.cbrt,
  abs: Math.abs, floor: Math.floor, ceil: Math.ceil, round: Math.round, sign: Math.sign,
  min: Math.min, max: Math.max, mod: (a, b) => ((a % b) + b) % b,
};

const CONSTANTS = { pi: Math.PI, e: Math.E };

// Multi-letter words the tokenizer recognises; anything else splits into single letters ("ab" → a·b).
const WORDS = [...Object.keys(FUNCTIONS), 'pi', 'theta'].sort((p, q) => q.length - p.length);

const TEX_FUNCTIONS = new Set(['sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'sinh', 'cosh', 'tanh', 'exp', 'ln', 'log', 'min', 'max']);

/**
 * @param {string} text
 * @param {{functionNames?: Iterable<string>}} options - names of user-defined functions
 * @returns {{evaluate: (env) => number, variables: Set<string>, functions: Set<string>, tex: string}}
 * @throws {Error} with a readable message if the formula is invalid
 */
export function parse(text, { functionNames = [] } = {}) {
  const userFunctions = new Set(functionNames);
  const tokens = tokenize(normalize(text));
  if (tokens.length === 0) throw new Error('Type a formula, for example sin(x) + x^2');

  const variables = new Set();
  const functions = new Set();
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  const expect = (token) => {
    const got = next();
    if (got !== token) throw new Error(got === undefined ? `Missing "${token}"` : `Expected "${token}" but found "${got}"`);
  };
  const startsAtom = (token) => token !== undefined && (token === '(' || /^[a-z0-9.]/.test(token));
  let absDepth = 0; // inside |...|, a "|" closes instead of opening

  function parseSum() {
    let left = parseProduct();
    while (peek() === '+' || peek() === '-') {
      left = { type: 'binary', op: next(), a: left, b: parseProduct() };
    }
    return left;
  }

  function parseProduct() {
    let left = parseUnary();
    while (true) {
      const token = peek();
      if (token === '*' || token === '/') {
        next();
        left = { type: 'binary', op: token, a: left, b: parseUnary() };
      } else if (startsAtom(token) || (token === '|' && absDepth === 0)) {
        left = { type: 'binary', op: '*', implicit: true, a: left, b: parseUnary() };
      } else {
        return left;
      }
    }
  }

  function parseUnary() {
    if (peek() === '-') {
      next();
      return { type: 'negate', a: parseUnary() };
    }
    if (peek() === '+') {
      next();
      return parseUnary();
    }
    return parsePower();
  }

  function parsePower() {
    const base = parseAtom();
    if (peek() !== '^') return base;
    next();
    return { type: 'binary', op: '^', a: base, b: parseUnary() };
  }

  function parseArguments() {
    expect('(');
    const args = [parseSum()];
    while (peek() === ',') {
      next();
      args.push(parseSum());
    }
    expect(')');
    return args;
  }

  function parseAtom() {
    const token = next();
    if (token === undefined) throw new Error('The formula ends too early');

    if (token === '(') {
      const inner = parseSum();
      expect(')');
      return { ...inner, parens: true };
    }
    if (token === '|') {
      absDepth++;
      const inner = parseSum();
      absDepth--;
      expect('|');
      return { type: 'call', name: 'abs', args: [inner] };
    }
    if (/^[0-9.]/.test(token)) {
      const value = Number(token);
      if (!Number.isFinite(value)) throw new Error(`"${token}" is not a number`);
      return { type: 'number', value };
    }
    if (Object.hasOwn(FUNCTIONS, token)) {
      if (peek() !== '(') throw new Error(`Write ${token}(...) with parentheses`);
      const args = parseArguments();
      const arity = FUNCTIONS[token].length || 1;
      if (!['min', 'max'].includes(token) && args.length !== arity) {
        throw new Error(`${token} takes ${arity} input${arity > 1 ? 's' : ''}`);
      }
      return { type: 'call', name: token, args };
    }
    if (userFunctions.has(token) && peek() === '(') {
      functions.add(token);
      const args = parseArguments();
      if (args.length !== 1) throw new Error(`${token}(...) takes one input`);
      return { type: 'user', name: token, args };
    }
    if (Object.hasOwn(CONSTANTS, token)) return { type: 'constant', name: token, value: CONSTANTS[token] };
    if (/^[a-z]+$/.test(token)) {
      variables.add(token);
      return { type: 'variable', name: token };
    }
    throw new Error(`Unexpected "${token}"`);
  }

  const tree = parseSum();
  if (pos < tokens.length) {
    const token = tokens[pos];
    throw new Error(token === ')' ? 'There is an extra ")"' : `Unexpected "${token}"`);
  }

  return { evaluate: compile(tree), variables, functions, tex: toTex(tree), tree };
}

/**
 * Compatibility helper for formulas in x only.
 * @returns {(x: number) => number}
 */
export function parseExpression(text) {
  const parsed = parse(text);
  const unknown = [...parsed.variables].filter((name) => name !== 'x');
  if (unknown.length) throw new Error(`Unknown name "${unknown[0]}". Use x as the variable.`);
  const env = { vars: { x: 0 }, fns: {} };
  return (x) => {
    env.vars.x = x;
    return parsed.evaluate(env);
  };
}

/** LaTeX for a formula, or null if it doesn't parse. Used for pretty previews. */
export function formulaToTex(text, options) {
  try {
    return parse(text, options).tex;
  } catch {
    return null;
  }
}

// ---- Internals --------------------------------------------------------------

/** Accept common Unicode math characters. */
function normalize(text) {
  return String(text)
    .toLowerCase()
    .replace(/π/g, 'pi')
    .replace(/θ/g, 'theta')
    .replace(/[−–]/g, '-')
    .replace(/[×·⋅]/g, '*')
    .replace(/÷/g, '/')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .replace(/√/g, 'sqrt');
}

/** Split "2ax^2+sin(x)" into ["2", "a", "x", "^", "2", "+", "sin", "(", "x", ")"]. */
function tokenize(text) {
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const number = /^(\d+\.?\d*|\.\d+)/.exec(text.slice(i));
    if (number) {
      tokens.push(number[1]);
      i += number[1].length;
      continue;
    }
    if (/[a-z]/.test(ch)) {
      const word = WORDS.find((w) => text.startsWith(w, i));
      tokens.push(word ?? ch);
      i += word ? word.length : 1;
      continue;
    }
    if ('+-*/^(),|'.includes(ch)) {
      tokens.push(ch);
      i++;
      continue;
    }
    throw new Error(`Unexpected character "${ch}"`);
  }
  return tokens;
}

/** Turn the tree into a fast closure (env) => number. */
function compile(node) {
  switch (node.type) {
    case 'number':
    case 'constant': {
      const value = node.value;
      return () => value;
    }
    case 'variable': {
      const name = node.name;
      return (env) => {
        const value = env.vars[name];
        return value === undefined ? NaN : value;
      };
    }
    case 'negate': {
      const a = compile(node.a);
      return (env) => -a(env);
    }
    case 'binary': {
      const a = compile(node.a);
      const b = compile(node.b);
      switch (node.op) {
        case '+': return (env) => a(env) + b(env);
        case '-': return (env) => a(env) - b(env);
        case '*': return (env) => a(env) * b(env);
        case '/': return (env) => a(env) / b(env);
        case '^': return (env) => Math.pow(a(env), b(env));
      }
      break;
    }
    case 'call': {
      const fn = FUNCTIONS[node.name];
      const args = node.args.map(compile);
      if (args.length === 1) {
        const [a] = args;
        return (env) => fn(a(env));
      }
      return (env) => fn(...args.map((arg) => arg(env)));
    }
    case 'user': {
      const name = node.name;
      const [a] = node.args.map(compile);
      return (env) => {
        const fn = env.fns?.[name];
        return fn ? fn(a(env)) : NaN;
      };
    }
  }
  throw new Error('Could not understand the formula');
}

/** Turn the tree back into LaTeX for a nicely typeset preview. */
function toTex(node, parent = null) {
  const wrap = (tex) => (node.parens ? String.raw`\left(${tex}\right)` : tex);
  switch (node.type) {
    case 'number':
      return String(node.value);
    case 'constant':
      return node.name === 'pi' ? String.raw`\pi` : 'e';
    case 'variable':
      return node.name === 'theta' ? String.raw`\theta` : node.name;
    case 'negate': {
      const inner = toTex(node.a, node);
      const needs = node.a.type === 'binary' && (node.a.op === '+' || node.a.op === '-') && !node.a.parens;
      return wrap(`-${needs ? String.raw`\left(${inner}\right)` : inner}`);
    }
    case 'binary': {
      const { op, a, b } = node;
      if (op === '/') return wrap(String.raw`\frac{${stripParens(a)}}{${stripParens(b)}}`);
      if (op === '^') {
        const base = toTex(a, node);
        const needsBase = (a.type === 'binary' || a.type === 'negate') && !a.parens;
        return wrap(`${needsBase ? String.raw`\left(${base}\right)` : `{${base}}`}^{${stripParens(b)}}`);
      }
      const left = toTex(a, node);
      const right = toTex(b, node);
      if (op === '*') {
        const lowPrecedence = (n) => n.type === 'binary' && (n.op === '+' || n.op === '-') && !n.parens;
        const l = lowPrecedence(a) ? String.raw`\left(${left}\right)` : left;
        const r = lowPrecedence(b) ? String.raw`\left(${right}\right)` : right;
        // Juxtapose like handwriting (2x, ab, 3\sin x); use a dot when a number or minus follows
        if (/^[\d.-]/.test(r)) return wrap(String.raw`${l} \cdot ${r}`);
        const space = /\\[a-zA-Z]+$/.test(l) ? ' ' : ''; // "\pi x", not "\pix"
        return wrap(`${l}${space}${r}`);
      }
      return wrap(`${left} ${op} ${right}`);
    }
    case 'call': {
      const args = node.args.map((arg) => stripParens(arg));
      if (node.name === 'sqrt') return String.raw`\sqrt{${args[0]}}`;
      if (node.name === 'cbrt') return String.raw`\sqrt[3]{${args[0]}}`;
      if (node.name === 'abs') return String.raw`\left|${args[0]}\right|`;
      if (node.name === 'floor') return String.raw`\left\lfloor ${args[0]}\right\rfloor`;
      if (node.name === 'ceil') return String.raw`\left\lceil ${args[0]}\right\rceil`;
      const name = TEX_FUNCTIONS.has(node.name) ? `\\${node.name}` : String.raw`\operatorname{${node.name}}`;
      return String.raw`${name}\left(${args.join(', ')}\right)`;
    }
    case 'user':
      return String.raw`${node.name}\left(${stripParens(node.args[0])}\right)`;
  }
  return '';
}

/** LaTeX of a node without its own outer parentheses (inside \frac, \sqrt, exponents...). */
function stripParens(node) {
  return toTex({ ...node, parens: false });
}
