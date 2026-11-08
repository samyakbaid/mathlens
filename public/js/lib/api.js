// Calls to our own server (see server/server.js).

/**
 * Ask the AI tutor for a lesson. Pass `document` ({ name, text }) to have it teach from a paper.
 * @returns {Promise<{title, intro, steps, keyIdeas, visualizationHtml, relatedBuiltInTopic, lessonId, billing}>}
 */
export async function askAI(question, topics, signal, document = null) {
  const response = await fetch('/api/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question,
      builtInTopics: topics.map((t) => ({ id: t.id, title: t.title })),
      ...(document ? { document: { name: document.name, text: document.text } } : {}),
    }),
    signal,
  });

  const data = await response.json().catch(() => ({}));
  // A slow answer is sent with status 200 to keep the connection open, so its real status is in the body
  const status = data.httpStatus ?? response.status;
  if (!response.ok || status >= 400 || data.error) {
    const error = new Error(data.error || `Server error (${status})`);
    error.code = data.code; // 'login_required' | 'payment_required' | 'busy'
    error.status = status;
    throw error;
  }
  return data;
}

/** Ask something inside a lesson, or ask for its picture to change. Counts as one chat. */
export async function askFollowUp(body) {
  const response = await fetch('/api/followups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  const status = data.httpStatus ?? response.status;
  if (!response.ok || status >= 400 || data.error) {
    const error = new Error(data.error || `Server error (${status})`);
    error.code = data.code;
    error.status = status;
    throw error;
  }
  return data;
}

/** The chat so far for a lesson ({ lessonId }) or a built-in topic ({ topicId }). */
export async function listFollowUps(source) {
  const response = await fetch(`/api/followups?${new URLSearchParams(source)}`);
  if (!response.ok) return [];
  return (await response.json()).items ?? [];
}
