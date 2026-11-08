// The built-in topics and the learning paths that order them.
//
// To add a new topic:
//   1. Create a file in ./topics/<category>/ (copy an existing topic as a starting point).
//   2. Import it below and add it to the `topics` array.
//   3. Add its id to a path in `paths` (that decides where it appears on the home page map).
// The home page, search palette and AI suggestions all read from these lists.

import linearTransformations from './topics/linear-algebra/linear-transformations.js';
import matrixComposition from './topics/linear-algebra/matrix-composition.js';
import eigenvectors from './topics/linear-algebra/eigenvectors.js';
import derivative from './topics/calculus/derivative.js';
import riemannSums from './topics/calculus/riemann-sums.js';
import taylorSeries from './topics/calculus/taylor-series.js';
import fourierSeries from './topics/analysis/fourier-series.js';
import centralLimitTheorem from './topics/probability/central-limit-theorem.js';

export const topics = [
  derivative,
  riemannSums,
  taylorSeries,
  linearTransformations,
  matrixComposition,
  eigenvectors,
  fourierSeries,
  centralLimitTheorem,
];

/** Learning paths: each is an ordered route through topics, shown as a line of stations. */
export const paths = [
  {
    id: 'calculus',
    title: 'Calculus',
    blurb: 'How steep a curve is at one point, how much area sits under it, and how to copy a curve with a polynomial.',
    topics: ['derivative', 'riemann-sums', 'taylor-series'],
  },
  {
    id: 'linear-algebra',
    title: 'Linear algebra',
    blurb: 'Matrices as ways of moving the plane: what one move does, what two in a row do, and which directions stay put.',
    topics: ['linear-transformations', 'matrix-composition', 'eigenvectors'],
  },
  {
    id: 'signals-and-chance',
    title: 'Signals and chance',
    blurb: 'How smooth waves can build sharp shapes, and why averages of random things end up bell-shaped.',
    topics: ['fourier-series', 'central-limit-theorem'],
  },
];

export function findTopic(id) {
  return topics.find((topic) => topic.id === id);
}

/** Where a topic sits: { path, index, previous, next } or null. */
export function pathOf(topicId) {
  for (const path of paths) {
    const index = path.topics.indexOf(topicId);
    if (index !== -1) {
      return {
        path,
        index,
        previous: findTopic(path.topics[index - 1]) ?? null,
        next: findTopic(path.topics[index + 1]) ?? null,
      };
    }
  }
  return null;
}

/** Group topics by category, keeping the order above: [{ category, topics: [...] }, ...] */
export function topicsByCategory(list = topics) {
  const groups = new Map();
  for (const topic of list) {
    if (!groups.has(topic.category)) groups.set(topic.category, []);
    groups.get(topic.category).push(topic);
  }
  return [...groups].map(([category, items]) => ({ category, topics: items }));
}

// ---- Progress (remembered in this browser only) ------------------------------------------

const VISITED_KEY = 'mathlens-visited';

export function visitedTopics() {
  try {
    const list = JSON.parse(localStorage.getItem(VISITED_KEY) ?? '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** Remember that a topic was opened (most recent first). */
export function markVisited(topicId) {
  try {
    const list = visitedTopics().filter((id) => id !== topicId);
    list.unshift(topicId);
    localStorage.setItem(VISITED_KEY, JSON.stringify(list.slice(0, 50)));
  } catch {
    // storage blocked: progress just isn't remembered
  }
}
