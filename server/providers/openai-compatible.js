// Provider: any server that speaks the OpenAI Chat Completions API.
// That covers OpenAI itself, and open-weight models (Qwen, DeepSeek, Kimi, GLM, gpt-oss, ...)
// run locally with Ollama, LM Studio, llama.cpp or vLLM, or hosted on OpenRouter, Together,
// Groq, Fireworks, DeepInfra and others. Uses plain fetch, so no extra dependency.

import { UserFacingError } from '../errors.js';

export const name = 'openai-compatible';

const DEFAULT_BASE_URL = 'http://localhost:11434/v1'; // Ollama

function baseUrl() {
  return (process.env.AI_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function isOpenAI() {
  return /(^|\.)api\.openai\.com/i.test(new URL(baseUrl()).hostname);
}

export function modelName() {
  return process.env.AI_MODEL || '';
}

export function setupProblem() {
  return modelName() ? null : 'AI_MODEL is not set';
}

/** An HTTP error from the model server. */
class ProviderHttpError extends Error {
  constructor(status, body) {
    super(`HTTP ${status}: ${body.slice(0, 500)}`);
    this.status = status;
    this.body = body;
  }
}

/**
 * Returns { text, usage: { inputTokens, outputTokens, model } }. With maxTokens, an answer that runs
 * out of room comes back with cutOff: true instead of failing.
 */
export async function generate({ system, user, schema, effort, maxTokens }) {
  if (!modelName()) {
    throw new UserFacingError(500, 'AI is not set up yet. Set AI_MODEL in .env (for example AI_MODEL=qwen3-coder:30b) and restart the server.');
  }

  // Ask for the exact JSON schema first. Some servers/models only support plain JSON mode,
  // so if the server rejects the schema we retry once with that.
  const strict = {
    type: 'json_schema',
    json_schema: { name: 'mathlens_answer', strict: true, schema },
  };
  let options = { system, user, responseFormat: strict, includeUsage: true, effort, maxTokens };
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await requestCompletion(options);
    } catch (err) {
      const rejected = (pattern) => err instanceof ProviderHttpError && err.status >= 400 && err.status < 500 && pattern.test(err.body);
      if (options.includeUsage && rejected(/stream_options|include_usage/i)) {
        console.warn('[ai] server rejected stream_options, retrying without usage reporting');
        options = { ...options, includeUsage: false };
      } else if (options.responseFormat === strict && rejected(/response_format|json_schema|schema/i)) {
        console.warn('[ai] server rejected json_schema, retrying with json_object mode');
        options = { ...options, responseFormat: { type: 'json_object' } };
      } else {
        throw err;
      }
    }
  }
  return requestCompletion(options);
}

async function requestCompletion({ system, user, responseFormat, includeUsage, effort, maxTokens: limit }) {
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.AI_API_KEY) headers.Authorization = `Bearer ${process.env.AI_API_KEY}`;

  const maxTokens = limit || Number(process.env.AI_MAX_TOKENS) || 16384;
  const body = {
    model: modelName(),
    // Streaming so the connection stays alive while a slow model writes a long answer.
    stream: true,
    response_format: responseFormat,
    // Ask for token counts in the last chunk, so each answer can be billed at its real cost
    ...(includeUsage ? { stream_options: { include_usage: true } } : {}),
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  };

  if (isOpenAI()) {
    // OpenAI's reasoning models want max_completion_tokens and only the default temperature.
    // The limit also covers hidden reasoning tokens, so give it more room.
    body.max_completion_tokens = limit || Number(process.env.AI_MAX_TOKENS) || 32000;
  } else {
    body.max_tokens = maxTokens;
    body.temperature = 0.4;
  }
  // Optional: how hard a reasoning model thinks (none | low | medium | high). Lower = cheaper, faster.
  if (process.env.AI_REASONING_EFFORT) body.reasoning_effort = effort || process.env.AI_REASONING_EFFORT;

  const response = await fetch(`${baseUrl()}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new ProviderHttpError(response.status, await response.text().catch(() => ''));
  }

  const { text, finishReason, usage } = await readStream(response.body);

  if (finishReason === 'length' && !limit) {
    throw new UserFacingError(502, 'The answer was too long and got cut off. Try a more specific question, or raise AI_MAX_TOKENS (and the model\'s context length).');
  }
  if (finishReason === 'content_filter') {
    throw new UserFacingError(422, 'The AI declined to answer this question. Try rephrasing it.');
  }
  return {
    text,
    cutOff: finishReason === 'length',
    usage: {
      model: modelName(),
      // If the server didn't report usage, estimate it (about 4 characters per token)
      inputTokens: usage?.prompt_tokens ?? Math.ceil((system.length + user.length) / 4),
      outputTokens: usage?.completion_tokens ?? Math.ceil(text.length / 4),
      estimated: !usage,
    },
  };
}

/** Read a server-sent-events stream of chat completion chunks into one string. */
async function readStream(body) {
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let finishReason = null;
  let usage = null;

  const handleLine = (line) => {
    line = line.trim();
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;
    let chunk;
    try {
      chunk = JSON.parse(data);
    } catch {
      return; // ignore keep-alive or partial noise
    }
    if (chunk.error) {
      throw new ProviderHttpError(502, JSON.stringify(chunk.error));
    }
    if (chunk.usage) usage = chunk.usage;
    const choice = chunk.choices?.[0];
    if (!choice) return;
    // Only `content` is the answer; reasoning models may also stream `reasoning`/`reasoning_content`.
    if (typeof choice.delta?.content === 'string') text += choice.delta.content;
    if (choice.finish_reason) finishReason = choice.finish_reason;
  };

  for await (const piece of body) {
    buffer += decoder.decode(piece, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    lines.forEach(handleLine);
  }
  buffer += decoder.decode();
  if (buffer) handleLine(buffer);

  return { text, finishReason, usage };
}

/** Map errors from this provider to a status + message, or return null if this isn't one. */
export function describeError(err) {
  if (err instanceof ProviderHttpError) {
    // Out of credit: OpenAI says 429 "insufficient_quota", other servers often say 402
    if (err.status === 402 || /insufficient_quota|exceeded your current quota|insufficient (credits|balance)/i.test(err.body)) {
      return { status: 503, outOfCredit: true, message: 'The tutor is taking a short break. Please try again in a little while. Nothing was charged.' };
    }
    if (err.status === 401 || err.status === 403) {
      return { status: 500, message: 'The model server rejected the API key. Check AI_API_KEY in .env.' };
    }
    if (err.status === 404) {
      return { status: 500, message: `Model "${modelName()}" was not found at ${baseUrl()}. Check AI_MODEL (with Ollama, run "ollama pull ${modelName()}" first).` };
    }
    if (err.status === 429) {
      return { status: 429, message: 'Too many requests right now. Wait a minute and try again.' };
    }
    return { status: 502, message: `The model server returned an error: ${err.message}` };
  }
  // fetch() throws a TypeError("fetch failed") when the server can't be reached.
  if (err instanceof TypeError && /fetch failed/i.test(err.message)) {
    const local = /localhost|127\.0\.0\.1/.test(baseUrl());
    return {
      status: 502,
      message: local
        ? `Could not reach the model server at ${baseUrl()}. Is it running? (For Ollama: "ollama serve".)`
        : `Could not reach the model server at ${baseUrl()}. Check AI_BASE_URL and your internet connection.`,
    };
  }
  return null;
}
