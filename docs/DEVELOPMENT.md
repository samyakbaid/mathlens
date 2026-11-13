# MathLens: developer guide

How the code fits together, how to add a lesson, and how the AI lessons and chats are built. For running the live site, see [OPERATIONS.md](OPERATIONS.md).

## How the code is organized

```
mathlens/
├── server/                       Node + Express backend
│   ├── server.js                 serves /public; routes /api/ask, /api/me, /api/auth, /api/payments
│   ├── config.js                 free limits, pricing, keys (all overridable in .env)
│   ├── db.js                     SQLite database in data/mathlens.db (built into Node)
│   ├── auth.js                   email + password and Google sign-in, sessions
│   ├── billing.js                free sign-up answers → paid credits; per-answer cost
│   ├── payments.js               Razorpay top-ups (order, signature check, webhook)
│   ├── lessons.js                the notebook: saved lessons, matching repeat and similar questions
│   ├── email.js                  sends password reset links and alerts over SMTP
│   ├── alerts.js                 emails the owner when something needs them (e.g. AI credit ran out)
│   ├── followups.js              chats inside a lesson: questions and picture changes
│   ├── viz-check.js              compiles every lesson's scripts before it's saved
│   ├── keep-alive.js             keeps slow answers connected through Cloudflare
│   ├── pages.js                  /about, /pricing, /contact, /terms, /privacy, /refunds, /delivery, receipts
│   ├── ai.js                     picks the AI provider; parses and checks the lesson (intro + steps)
│   ├── latex-repair.js           fixes LaTeX backslashes the AI gets wrong in its JavaScript
│   ├── providers/
│   │   ├── anthropic.js          Claude via the Anthropic API
│   │   └── openai-compatible.js  open models via Ollama, LM Studio, vLLM, OpenRouter, ...
│   └── prompt.js                 the instructions the AI follows (edit to change tone/style)
│
├── deploy/                       server setup, deploy, backups, usage report
│
└── public/                       the website (plain HTML/CSS/JS modules, no framework)
    ├── index.html
    ├── css/styles.css
    ├── viz-kit/                  styles and helpers loaded into every AI picture (graph.js, kit.js, kit.css)
    └── js/
        ├── main.js               entry point + router (#/, #/topic/<id>, #/graph, #/ask), / opens search
        ├── topics.js             built-in topics + learning paths ← register new topics here
        ├── views/                one file per page
        │   ├── home-view.js      Explore: hero, learning paths as lines of stations, tools
        │   ├── topic-view.js     the lesson player: visual + step rail, instrument cards, notes
        │   ├── palette.js        search palette (press /): find a lesson or ask the tutor
        │   ├── lesson-player.js  shows an AI lesson (visual + step rail), used by Ask and Notebook
        │   ├── lesson-chat.js    the "Ask a question" chat in every lesson
        │   ├── notebook-view.js  Notebook: every saved lesson, searchable, free to reopen
        │   ├── graph-view.js     Graph Lab: type equations, letters become sliders
        │   ├── account-ui.js     top-bar account button, log in / sign up and add-credits dialogs
        │   └── ask-view.js
        ├── lib/                  shared helpers
        │   ├── plot.js           2D coordinate plane on <canvas> (curves, arrows, dragging, zoom/pan)
        │   ├── theme.js          light/dark theme; COLORS and alpha() for canvas drawing
        │   ├── controls.js       sliders (typeable values), matrix input, addSteps (the step rail), readouts
        │   ├── icons.js          small line icons (no emoji anywhere)
        │   ├── hero-art.js       the home page's moving Fourier drawing
        │   ├── expression.js     safe parser for formulas like "a sin(bx) + x^2" (+ LaTeX preview)
        │   ├── linalg.js         2×2 matrix maths + drawing (transformed grid, basis vectors, det square)
        │   ├── animate.js        animate(duration, t => ...) with easing
        │   ├── numeric.js        derivative, integral, formatting, random numbers
        │   ├── markdown.js       Markdown + LaTeX rendering (marked + KaTeX)
        │   ├── account.js        signed-in user, balance, free answers (from /api/me)
        │   ├── notebook.js       saved lessons API (/api/lessons)
        │   ├── documents.js      reads an attached PDF / text file in the browser (pdf.js)
        │   ├── api.js            fetch wrapper for /api/ask
        │   └── dom.js            el() helper for creating elements
        └── topics/               one file per built-in topic
            ├── calculus/         derivative, riemann-sums, taylor-series
            ├── linear-algebra/   linear-transformations, matrix-composition, eigenvectors
            ├── analysis/         fourier-series
            └── probability/      central-limit-theorem
```

## Adding a topic

1. Create `public/js/topics/<category>/<name>.js`. Copying an existing topic is the quickest start. A topic is one object:

   ```js
   import { Plot, COLORS } from '../../lib/plot.js';
   import { addSlider, addReadout, addSteps } from '../../lib/controls.js';

   export default {
     id: 'my-topic',                    // used in the URL: #/topic/my-topic
     title: 'My Topic',
     category: 'Calculus',
     level: 'Undergraduate',            // Foundations | Undergraduate | Graduate
     summary: 'One sentence for the card.',
     explanation: String.raw`Markdown with $LaTeX$ here.`,

     mount({ plotArea, controls, lesson }) {
       const state = { k: 1 };
       const plot = new Plot(plotArea, { xMin: -5, xMax: 5, yMin: -3, yMax: 3 });
       const readout = addReadout(controls, 'k²');

       addSlider(controls, { label: 'k', min: 0, max: 3, step: 0.1, value: 1,
         onInput: (v) => { state.k = v; update(); } });

       plot.onDraw = (p) => {
         p.grid();
         p.curve((x) => Math.sin(state.k * x));
       };

       function update() {
         readout.text(String(state.k ** 2));
         plot.render();
       }

       // The lesson: each step's enter() sets up the scene the text talks about
       const steps = addSteps(lesson, [
         { title: 'Start with k = 1', text: String.raw`One wave: $\sin x$.`, focus: 'Watch the curve.',
           enter: () => { state.k = 1; update(); } },
         { title: 'Double the frequency', text: String.raw`Now $\sin 2x$ wiggles twice as fast.`,
           enter: () => { state.k = 2; update(); } },
       ]);
       update();
       steps.go(0);

       return () => plot.destroy();     // cleanup when the user leaves the page
     },
   };
   ```

2. Import it in `public/js/topics.js`, add it to the `topics` array, and add its id to a learning path in `paths` (that places it on the Explore map).

Tips:
- Read colours from `COLORS` inside `onDraw` (not once at the top of the file), so the light/dark switch repaints correctly. For transparency use `alpha(COLORS.blue, 0.3)`, never a hard-coded `rgba(...)`.
- Every lesson should have steps: `addSteps(lesson, [{ title, text, focus, enter() }])`. `text` is Markdown with LaTeX, `focus` is the "Look for" line, and `enter()` sets up the scene so the visual matches the text. Readers can jump to any step, so set the whole scene in each `enter()`.
- Controls are grouped into cards automatically: every `addHeading()` starts a new card.
- No emoji in labels: use `addButtons(controls, [{ label: 'Play', icon: 'play', ... }])` with an icon from `lib/icons.js`.
- Use `String.raw` for explanations so LaTeX backslashes work as written. Never write `${` inside it.
- Keep one `update()` function per topic that refreshes the readouts and calls `plot.render()`. Every control and drag handler calls it.
- If you start an animation (`requestAnimationFrame`/`setInterval`), stop it in the returned cleanup function.

## Design, theme, zoom and Graph Lab

- **Layout:** no sidebars. A top bar (Explore, Graph Lab, Ask, search), and lesson pages built as a *lesson player*: the visual and the step rail share one card that fits the screen on desktop, so the picture and the explanation are always visible together. Controls sit below as a row of instrument cards. ← and → move between steps.
- **Explore** shows learning paths as lines of stations and remembers which lessons you've opened (in this browser only).
- **Type:** Fraunces for headings, IBM Plex Sans for text, IBM Plex Mono for numbers (Google Fonts).
- **Colours** live in one place: the `--plot-*` and `--c-*` variables at the top of `public/css/styles.css`, one block for light and one for dark. `theme.js` reads them into `COLORS`. Inside KaTeX you can colour text with `\htmlClass{c-green}{...}`.
- **Zoom/pan** is built into every `Plot`. Scroll or pinch to zoom (plain scrolling zooms after you click the graph, so the page still scrolls), drag empty space to pan, double-click to zoom in, and use the corner buttons. Pass `{ zoom: false }` to turn it off.
- **Graph Lab 3D:** switch to 3D at the top of Graph Lab. `z = x^2 - y^2` (or any expression using x and y) draws a rotatable surface with contour lines, `(a, b, c)` draws a point, and sliders still animate everything. It uses Plotly, loaded only when you open 3D.
- **Graph Lab** (`#/graph`) understands `y = …`, `f(x) = …`, `a = 2` (a slider), `k = 2a`, `x = 3`, points like `(h, k)` (draggable when they use sliders) and plain calculations. The graph is saved in the URL, so the Share button gives a link that reproduces it.

## How Ask AI works

1. The browser sends the question, plus the list of built-in topics, to `POST /api/ask`. Asking the same question again within 10 minutes (for example after a reload) returns the same lesson for free.
2. `server/ai.js` calls the configured provider. Claude (`claude-opus-5-5` by default; set `CLAUDE_MODEL` to change it) uses **structured outputs**. OpenAI-compatible servers get the same schema as `response_format`, and the server falls back to plain JSON mode if the schema is rejected. The answer is a lesson: `title`, `intro`, up to 12 `steps` (each `{ title, explanation, visualFocus }`), `keyIdeas`, `visualizationHtml` and `relatedBuiltInTopic`.
3. Before sending the answer, the server repairs a common AI mistake: LaTeX written in plain JavaScript strings, where `'\frac'` silently becomes a form feed plus "rac" (`server/latex-repair.js`).
4. The page renders the explanation (Markdown + KaTeX) and loads `visualizationHtml` into an `<iframe sandbox="allow-scripts">` together with the **viz kit** (`public/viz-kit/`): polished default styles for controls, layout classes (`.ml-panel`, `.ml-grid-2`, `.ml-eq`, `.ml-stats`, `.ml-legend`...), escape-proof equations (`<div class="ml-eq" data-tex="\nabla f">`, auto-shrunk to fit), and automatic frame height so nothing is clipped. Edit `kit.css` to restyle every AI visualization at once.
5. **Steps drive the visual.** When the reader presses Next, the page sends `{ type: 'mathlens:step', index }` into the frame and the AI's code, registered with `MathLens.onStep((index) => ...)`, switches to that step's scene. The prompt requires a distinct, animated scene for every step.
6. The frame also gets the current theme's colours added as CSS variables (`--bg`, `--text`, `--blue`, ...). The prompt tells the AI to use them, so its visualizations match light or dark mode. The sandbox lets the AI-generated code run but blocks it from reading or changing the main page.

A new lesson usually takes one to two minutes, because the model writes a full interactive program. The prompt (`server/prompt.js`) asks for detailed, multi-view visualizations on advanced topics, 3D (Plotly) on the first try whenever the idea is three-dimensional, and live KaTeX equations inside the visualization.

## How AI lessons are built

The AI writes one running example worked by hand, and only then the formula (the method is in `server/prompt.js`). The page adds these around whatever it writes, so saved lessons get most of them without being rewritten:

- `public/viz-kit/graph.js`: `MathLens.graph`, a 2D graph that zooms, moves and keeps labels on the exact point they name, plus zoom buttons for Plotly charts and any other canvas or SVG.
- Coloured phrases: `[[orange:the tangent line]]` in a step's text shows a dot and underline in that colour, and hovering lights up that colour in the picture.
- `server/viz-check.js`: every lesson's scripts must compile before it's saved. Known slips are fixed locally, others go back to the AI once, and if it's still broken the lesson fails and isn't charged.
- If a lesson takes over 20 seconds, the server sends spaces to keep the connection open, because Cloudflare gives up after about 125 seconds of silence.

To compare models, set `AI_MODEL` and `AI_REASONING_EFFORT`. Prices live in `server/billing.js`, and customers are charged each lesson's real cost, so the displayed average follows the model.

## Follow-up chats

Every lesson, AI or built-in, has an **Ask a question** button that opens a chat in place of the step text, so the picture stays in view (`public/js/views/lesson-chat.js`, `server/followups.js`).

- A question gets a quick answer from one small AI call that doesn't carry the picture's code (about ₹0.04 and 5 seconds with gpt-6-luna). `AI_CHAT_EFFORT` can set a different effort from lessons, but in testing low effort barely saved money and made more mistakes.
- A request to change the picture makes a second call that rewrites it. In an AI lesson that edits the current picture. In a built-in lesson it builds a new one that replaces the hand-made picture until the reader goes back. Changed pictures go through the same compile check as lessons, and the original is always one click away.
- The first 4 questions a day are free for each person. After that, the first question of a set takes one chat (a free chat, or the average chat price from credit) and covers 3 more, which stay until they're used. Changing a picture always uses a chat of its own.
- What free questions can cost is capped four ways: 150 a day per network for people without an account, 250 a day per network for everyone, 300 a day on the whole site, and a limit of 2,000 tokens on each reply. A reply that hits that limit is cut at its last whole sentence and still counts as a question, so asking for something huge over and over can't run up the bill. Answers still being written count toward the limits, so a burst of requests can't get past them.
- Asking the same thing about the same step again is free, and a failed answer is never charged.
- Chats are saved in the `followups` table with the lesson or topic, and a reopened lesson shows its latest changed picture.

## Notebook and papers

- **Every lesson is saved.** Each answer goes into the `lessons` table with its question. Asking the same question again returns the saved lesson for free, and before asking, the Ask page checks for an earlier lesson on nearly the same question and offers to open it. Lessons asked before signing up move to the account at sign-up. `#/notebook` lists them all.
- **Papers.** On the Ask page, attach a PDF, TXT, Markdown or LaTeX file (or drag it onto the box). The browser pulls the text out with pdf.js; the file itself is never uploaded. Up to 120,000 characters go to the AI with an optional focus question, and it teaches the paper's central idea step by step with a toy visualization. Scanned PDFs (pictures of pages) have no text, so they can't be read yet. The prompt tells the AI to treat the document as material, never as instructions.

## Writing style

Lessons are written for a reader learning slowly: one idea per step, plain words before symbols, worked examples split across steps, and an occasional quick check. The AI prompt (`server/prompt.js`) bans common machine-writing habits: "not X, but Y" contrasts, double negatives, dramatic one-line endings, hype words and dashes. Bold is kept for the one phrase per step worth remembering.

## Using an open-weight model

Set `AI_PROVIDER=openai-compatible` in `.env`. That works with any server that speaks the OpenAI Chat Completions API, so you can run models locally (Ollama, LM Studio, llama.cpp, vLLM) or use a hosted provider (OpenRouter, Together, Groq, DeepInfra, Fireworks).

```bash
# Local, with Ollama
ollama pull qwen3-coder:30b
# .env
AI_PROVIDER=openai-compatible
AI_BASE_URL=http://localhost:11434/v1
AI_MODEL=qwen3-coder:30b
```

For a hosted provider, set `AI_BASE_URL` to its `/v1` URL, `AI_API_KEY` to your key, and `AI_MODEL` to its model id. `.env.example` has ready-made blocks.

Each answer is a long, working HTML/JavaScript program, so model size matters. Large open models (Qwen3-Coder 480B, DeepSeek V3, Kimi K2, GLM 4.6, gpt-oss-120b) do well. Models around 30B are usable. Below that, visualizations often break. With Ollama, raise the context window (for example `OLLAMA_CONTEXT_LENGTH=32768 ollama serve`). Otherwise long answers get cut off.
