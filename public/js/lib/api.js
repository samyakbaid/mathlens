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
  if (!response.ok) {
    const error = new Error(data.error || `Server error (${response.status})`);
    error.code = data.code; // 'login_required' | 'payment_required' | 'busy'
    error.status = response.status;
    throw error;
  }
  return data;
}
