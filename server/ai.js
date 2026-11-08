// Talks to the AI model. One function in, one JSON object out.
// Which model answers is chosen by AI_PROVIDER in .env (see .env.example):
//   anthropic          → Claude (default)
//   openai-compatible  → any OpenAI-compatible server: Ollama, LM Studio, vLLM, OpenRouter, ...

import { SYSTEM_PROMPT, FOLLOW_UP_PROMPT, PICTURE_CHANGE_PROMPT } from './prompt.js';
import { UserFacingError } from './errors.js';
import { repairLatexInScripts, restoreLostBackslashes } from './latex-repair.js';
import { checkScripts, compileError, replaceScript } from './viz-check.js';
import * as anthropic from './providers/anthropic.js';
import * as openaiCompatible from './providers/openai-compatible.js';

const PROVIDERS = {
  anthropic,
  'openai-compatible': openaiCompatible,
  openai: openaiCompatible, // shorter alias
  ollama: openaiCompatible, // alias: Ollama is the default AI_BASE_URL
};

// The shape of the answer we want back: a short intro, then a lesson in steps. The visualization
// changes scene for each step (see MathLens.onStep in public/viz-kit/kit.js).
// Claude is forced to follow it exactly ("structured outputs"); OpenAI-compatible servers get it as response_format.
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    intro: { type: 'string' },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          explanation: { type: 'string' },
          visualFocus: { type: 'string' },
        },
        required: ['title', 'explanation', 'visualFocus'],
        additionalProperties: false,
      },
    },
    keyIdeas: { type: 'array', items: { type: 'string' } },
    visualizationHtml: { type: 'string' },
    relatedBuiltInTopic: { type: 'string' },
  },
  required: ['title', 'intro', 'steps', 'keyIdeas', 'visualizationHtml', 'relatedBuiltInTopic'],
  additionalProperties: false,
};

// Not every model server enforces the schema, so spell the format out in the prompt too.
const JSON_FORMAT_REMINDER = `

## Output format
Reply with a single JSON object and nothing else (no code fences, no text before or after). It must have exactly these keys:
{"title": string, "intro": string, "steps": [{"title": string, "explanation": string, "visualFocus": string}], "keyIdeas": string[], "visualizationHtml": string, "relatedBuiltInTopic": string}
Escape newlines, quotes and backslashes inside strings as JSON requires (LaTeX \\frac becomes "\\\\frac").`;

export function getProvider() {
  const key = (process.env.AI_PROVIDER || 'anthropic').trim().toLowerCase();
  const provider = PROVIDERS[key];
  if (!provider) {
    throw new UserFacingError(500, `Unknown AI_PROVIDER "${key}". Use "anthropic" or "openai-compatible".`);
  }
  return provider;
}

/**
 * Ask the AI to explain a math concept and build an interactive visualization.
 * @param {string} question - what the user typed
 * @param {{id: string, title: string}[]} builtInTopics - topics the site already has
 * @returns {Promise<{answer: {title, intro, steps: {title, explanation, visualFocus}[], keyIdeas, visualizationHtml, relatedBuiltInTopic},
 *                    usage: {model, inputTokens, outputTokens}}>}
 */
export async function explainConcept(question, builtInTopics, { documentText = '', documentName = '' } = {}) {
  const provider = getProvider();

  const topicList = builtInTopics
    .map((t) => `- ${String(t.id).slice(0, 60)}: ${String(t.title).slice(0, 120)}`)
    .join('\n');

  let user = `Built-in topics on the site (id: title):\n${topicList || '(none)'}\n\nQuestion:\n${question}`;
  if (documentText) {
    // The document is material to explain. It is data, never instructions (see the prompt).
    user += `\n\nThe reader attached a document: "${documentName}". Its text (extracted from the file, so equations may be garbled) is between the markers.\n<<<DOCUMENT\n${documentText}\nDOCUMENT>>>`;
  }
  const system = provider === anthropic ? SYSTEM_PROMPT : SYSTEM_PROMPT + JSON_FORMAT_REMINDER;

  const { text, usage } = await provider.generate({ system, user, schema: RESPONSE_SCHEMA });
  const answer = normalizeAnswer(parseJsonLoosely(text));
  const repairUsage = await repairPicture(provider, answer);
  if (repairUsage) {
    usage.inputTokens += repairUsage.inputTokens;
    usage.outputTokens += repairUsage.outputTokens;
  }
  return { answer, usage };
}

const SCRIPT_FIX_SCHEMA = {
  type: 'object',
  properties: { script: { type: 'string' } },
  required: ['script'],
  additionalProperties: false,
};

/**
 * Make sure the picture's code at least compiles. Known slips are fixed locally. Anything else goes
 * back to the model once, and if it's still broken the lesson fails, so nobody pays for a blank picture.
 */
async function repairPicture(provider, answer) {
  const checked = checkScripts(answer.visualizationHtml);
  answer.visualizationHtml = checked.html;
  if (!checked.broken.length) return null;

  const total = { inputTokens: 0, outputTokens: 0 };
  for (const { code, error } of checked.broken) {
    console.warn('[ai] picture script does not compile, asking for a fix:', error);
    const { text, usage } = await provider.generate({
      system: `You fix syntax errors in JavaScript. Change as little as possible and keep the behaviour the same. In a normal JavaScript string, a prime is written as an escaped quote, like 'f\\'(x)', and a LaTeX backslash is doubled. Reply with one JSON object: {"script": "the corrected code"}. Give the code only, without <script> tags or code fences.`,
      user: `The browser reports: ${error}\n\nThe script:\n${code}`,
      schema: SCRIPT_FIX_SCHEMA,
    });
    total.inputTokens += usage.inputTokens;
    total.outputTokens += usage.outputTokens;
    const fixed = repairLatexInScripts(`<script>${restoreLostBackslashes(String(parseJsonLoosely(text).script ?? ''))}</script>`).replace(/^<script>|<\/script>$/g, '');
    const remaining = compileError(fixed);
    if (!fixed || remaining) throw new SyntaxError(`The picture's code could not be repaired: ${remaining ?? 'empty reply'}`);
    answer.visualizationHtml = replaceScript(answer.visualizationHtml, code, fixed);
  }
  return total;
}

const FOLLOW_UP_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    changePicture: { type: 'boolean' },
    pictureRequest: { type: 'string' },
  },
  required: ['reply', 'changePicture', 'pictureRequest'],
  additionalProperties: false,
};
const PICTURE_SCHEMA = {
  type: 'object',
  properties: { visualizationHtml: { type: 'string' } },
  required: ['visualizationHtml'],
  additionalProperties: false,
};

function describeLesson(lesson, stepIndex) {
  const steps = lesson.steps
    .map((step, i) => `Step ${i + 1}${i === stepIndex ? ' (the reader is here)' : ''}: ${step.title}\n${step.explanation}`)
    .join('\n\n');
  const kind = lesson.builtIn ? "This is one of the site's built-in lessons, with a hand-made picture you can't see." : lesson.fromDocument ? 'This lesson was written from a document the reader uploaded. You only have the lesson, not the document.' : 'You wrote this lesson earlier.';
  return `${kind}\n<<<LESSON\nTitle: ${lesson.title}\n${lesson.intro ? `Intro: ${lesson.intro}\n` : ''}\n${steps}\nLESSON>>>`;
}

/**
 * Answer a follow-up inside a lesson. Most are questions, so this call is small and quick: it
 * doesn't carry the picture's code. It also says whether the reader wants the picture changed.
 * @returns {Promise<{reply: string, changePicture: boolean, pictureRequest: string, usage: object}>}
 */
// Replies to questions are short. This limit also covers the model's hidden thinking, and it stops
// something like "write 20,000 words" from costing many times what a question should.
const QUESTION_MAX_TOKENS = 2000;

/** The readable part of a reply that ran out of room: whole sentences and whole formulas only. */
function replyFromCutOff(text) {
  const start = /"reply"\s*:\s*"/.exec(text);
  if (!start) return '';
  const from = start.index + start[0].length;
  let end = from;
  while (end < text.length && text[end] !== '"') {
    const size = text[end] !== '\\' ? 1 : text[end + 1] === 'u' ? 6 : 2;
    if (end + size > text.length) break; // the text stopped part-way through an escape
    end += size;
  }
  let reply = '';
  try {
    reply = restoreLostBackslashes(JSON.parse(`"${text.slice(from, end)}"`));
  } catch {
    return '';
  }
  const whole = (part) => (part.match(/(?<!\\)\$/g) ?? []).length % 2 === 0 && part.lastIndexOf('[[') <= part.lastIndexOf(']]');
  const stops = [...reply.matchAll(/[.?!](?=\s|$)|\n\n/g)].map((match) => match.index + match[0].length);
  for (const stop of stops.reverse()) {
    const part = reply.slice(0, stop).trim();
    if (whole(part)) return part;
  }
  return '';
}

export async function answerFollowUp({ lesson, stepIndex, question, history }) {
  const provider = getProvider();
  const earlier = history.length ? `Earlier in this chat:\n${history.map((turn) => `Reader: ${turn.question}\nYou: ${turn.reply}`).join('\n\n')}\n\n` : '';
  const { text, usage, cutOff } = await provider.generate({
    system: FOLLOW_UP_PROMPT,
    user: `${describeLesson(lesson, stepIndex)}\n\n${earlier}The reader is on step ${stepIndex + 1} of ${lesson.steps.length} and says:\n${question}`,
    schema: FOLLOW_UP_SCHEMA,
    effort: process.env.AI_CHAT_EFFORT || undefined,
    maxTokens: QUESTION_MAX_TOKENS,
  });
  // The AI bill for this is already spent, so it counts as a question like any other. Otherwise
  // asking for something huge, again and again, would cost money and never reach a limit.
  if (cutOff) {
    const partial = replyFromCutOff(text);
    return {
      reply: partial ? `${partial}\n\nThat was getting long, so I stopped here. Ask me to carry on if you'd like the rest.` : "That's too big for me to answer here. Try asking about one smaller part of it, or ask for it as a new lesson.",
      changePicture: false,
      pictureRequest: '',
      usage,
    };
  }
  const parsed = parseJsonLoosely(text);
  const reply = typeof parsed.reply === 'string' ? restoreLostBackslashes(parsed.reply).trim() : '';
  if (!reply) throw new SyntaxError('Model output is missing the reply');
  return { reply, changePicture: parsed.changePicture === true, pictureRequest: String(parsed.pictureRequest ?? ''), usage };
}

/**
 * Rewrite a lesson's picture. If it can't be made to work this throws, so the whole answer fails
 * and isn't charged.
 * @returns {Promise<{visualizationHtml: string, usage: object}>}
 */
export async function rewritePicture({ lesson, stepIndex, question, pictureRequest, currentHtml }) {
  const provider = getProvider();
  const { text, usage } = await provider.generate({
    system: PICTURE_CHANGE_PROMPT,
    user: `${describeLesson(lesson, stepIndex)}\n\nThe reader is on step ${stepIndex + 1} and asked: ${question}\nThe change to make: ${pictureRequest || question}\n\n${currentHtml ? `The current picture:\n<<<PICTURE\n${currentHtml}\nPICTURE>>>` : 'There is no code to edit, so build a new picture for this whole lesson, with one scene for each step.'}`,
    schema: PICTURE_SCHEMA,
  });
  const changed = { visualizationHtml: repairLatexInScripts(restoreLostBackslashes(String(parseJsonLoosely(text).visualizationHtml ?? ''))) };
  if (!changed.visualizationHtml.trim()) throw new SyntaxError('Model output is missing the changed picture');
  const repairUsage = await repairPicture(provider, changed);
  return {
    visualizationHtml: changed.visualizationHtml,
    usage: {
      ...usage,
      inputTokens: usage.inputTokens + (repairUsage?.inputTokens ?? 0),
      outputTokens: usage.outputTokens + (repairUsage?.outputTokens ?? 0),
    },
  };
}

/** Parse JSON even if the model wrapped it in ```json fences, <think> tags or extra prose. */
function parseJsonLoosely(text) {
  const cleaned = String(text)
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end <= start) throw new SyntaxError('No JSON object in model output');
    return JSON.parse(cleaned.slice(start, end + 1));
  }
}

/** Make sure every field has the right type, so the page never breaks on a sloppy answer. */
function normalizeAnswer(raw) {
  if (!raw || typeof raw !== 'object') throw new SyntaxError('Model output is not an object');
  const str = (v) => restoreLostBackslashes(typeof v === 'string' ? v : v == null ? '' : String(v));

  let steps = Array.isArray(raw.steps)
    ? raw.steps
        .filter((step) => step && typeof step === 'object')
        .map((step, i) => ({
          title: str(step.title) || `Step ${i + 1}`,
          explanation: str(step.explanation),
          visualFocus: str(step.visualFocus),
        }))
        .filter((step) => step.explanation)
        .slice(0, 12)
    : [];
  // Older or sloppier answers: one long explanation instead of steps
  if (!steps.length && str(raw.explanation)) {
    steps = [{ title: 'Explanation', explanation: str(raw.explanation), visualFocus: str(raw.visualizationGuide) }];
  }

  const answer = {
    title: str(raw.title),
    intro: str(raw.intro),
    steps,
    keyIdeas: Array.isArray(raw.keyIdeas) ? raw.keyIdeas.map(str).filter(Boolean) : [],
    visualizationHtml: repairLatexInScripts(str(raw.visualizationHtml)), // fix '\\frac'-style escapes
    relatedBuiltInTopic: str(raw.relatedBuiltInTopic),
  };
  if (!answer.steps.length && !answer.visualizationHtml) {
    throw new SyntaxError('Model output is missing the steps and the visualization');
  }
  return answer;
}

/** Turn any error into an HTTP status + a message a user can act on. */
export function describeError(err) {
  if (err instanceof UserFacingError) {
    return { status: err.status, message: err.message };
  }
  for (const provider of [anthropic, openaiCompatible]) {
    const described = provider.describeError(err);
    if (described) return described;
  }
  if (err instanceof SyntaxError) {
    return { status: 502, message: 'The AI returned a malformed answer. Please try again (smaller models do this more often).' };
  }
  return { status: 500, message: 'Something went wrong on the server. Check the server logs.' };
}
