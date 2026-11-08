// Provider: Claude, through the Anthropic API.

import Anthropic from '@anthropic-ai/sdk';
import { UserFacingError } from '../errors.js';

// Created on first use so that .env has been loaded by then.
let client = null;
function getClient() {
  if (!client) client = new Anthropic();
  return client;
}

export const name = 'anthropic';

export function modelName() {
  return process.env.CLAUDE_MODEL || 'claude-opus-5-5';
}

export function setupProblem() {
  return process.env.ANTHROPIC_API_KEY ? null : 'ANTHROPIC_API_KEY is not set';
}

/** Returns { text, usage: { inputTokens, outputTokens, model } }. */
export async function generate({ system, user, schema, effort }) {
  // Streaming keeps long generations (a full HTML visualization) from hitting HTTP timeouts.
  // `fallbacks: "default"` lets the API retry on a fallback model if the main one declines.
  const stream = getClient().beta.messages.stream({
    model: modelName(),
    max_tokens: 32000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: {
      effort: effort || 'medium',
      format: { type: 'json_schema', schema },
    },
    system,
    messages: [{ role: 'user', content: user }],
  });

  const message = await stream.finalMessage();

  if (message.stop_reason === 'refusal') {
    throw new UserFacingError(422, 'The AI declined to answer this question. Try rephrasing it.');
  }
  if (message.stop_reason === 'max_tokens') {
    throw new UserFacingError(502, 'The answer was too long and got cut off. Try a more specific question.');
  }

  const text = message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');
  const u = message.usage ?? {};
  return {
    text,
    usage: {
      model: message.model ?? modelName(),
      inputTokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
      outputTokens: u.output_tokens ?? 0,
    },
  };
}

/** Map Anthropic SDK errors to a status + message, or return null if this isn't one. */
export function describeError(err) {
  if (err instanceof Anthropic.AuthenticationError) {
    return { status: 500, message: 'The server\'s Anthropic API key is invalid. Check ANTHROPIC_API_KEY in .env.' };
  }
  if (err instanceof Anthropic.RateLimitError) {
    return { status: 429, message: 'Too many requests right now. Wait a minute and try again.' };
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return { status: 502, message: 'Could not reach the AI service. Check your internet connection.' };
  }
  if (err instanceof Anthropic.APIError) {
    return { status: 502, message: `The AI service returned an error: ${err.message}` };
  }
  if (err instanceof Anthropic.AnthropicError) {
    // Usually: no API key configured.
    return { status: 500, message: 'AI is not set up yet. Add ANTHROPIC_API_KEY to a .env file and restart the server.' };
  }
  return null;
}
