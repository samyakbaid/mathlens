// The notebook: saved lessons, from /api/lessons.

async function request(path, options) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Something went wrong (${response.status})`);
  return data;
}

/** [{ id, title, question, sourceName, createdAt, steps }] newest first */
export async function listLessons() {
  return (await request('/api/lessons')).lessons ?? [];
}

/** { id, title, question, sourceName, createdAt, steps, answer } */
export function getLesson(id) {
  return request(`/api/lessons/${encodeURIComponent(id)}`);
}

export function deleteLesson(id) {
  return request(`/api/lessons/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** Earlier lessons on nearly the same question: [{ id, title, question, score }] */
export async function similarLessons(question) {
  try {
    return (await request(`/api/lessons/similar?q=${encodeURIComponent(question)}`)).matches ?? [];
  } catch {
    return [];
  }
}

/** "3 Nov", or "today" / "yesterday" */
export function friendlyDate(sqliteDate) {
  const date = new Date(`${String(sqliteDate).replace(' ', 'T')}Z`);
  if (Number.isNaN(date.getTime())) return '';
  const days = Math.floor((Date.now() - date.getTime()) / 86400000);
  if (days < 1 && new Date().getDate() === date.getDate()) return 'today';
  if (days < 2) return 'yesterday';
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}
