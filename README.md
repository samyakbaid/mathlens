# MathLens

Learn math by seeing it. Every lesson in MathLens is taught **step by step, and the visual changes with each step**: hand-built lessons for core topics, a Desmos-style **Graph Lab**, and an **Ask** page where an AI tutor (Claude, OpenAI or an open-weight model) turns any question into a step-by-step lesson with its own interactive visualization. Two themes: *paper* (light) and *chalkboard* (dark).

## Run it

```bash
npm install
cp .env.example .env      # then put your Anthropic API key in .env (or pick an open model, below)
npm start                 # http://localhost:3000
```

Use `npm run dev` to restart the server automatically when you edit server files. Frontend files need no build step: edit and refresh the browser.

The built-in topics work without an API key. Only the Ask AI page needs one.

### Using an open-weight model instead of Claude

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

## How the code is organized

```
mathlens/
├── server/                       Node + Express backend
│   ├── server.js                 serves /public; routes /api/ask, /api/me, /api/auth, /api/payments
│   ├── config.js                 free limits, pricing, keys (all overridable in .env)
│   ├── db.js                     SQLite database in data/mathlens.db (built into Node)
│   ├── auth.js                   email + password and Google sign-in, sessions
│   ├── billing.js                free trial → free sign-up answers → paid credits; per-answer cost
│   ├── payments.js               Razorpay top-ups (order, signature check, webhook)
│   ├── lessons.js                the notebook: saved lessons, matching repeat and similar questions
│   ├── email.js                  sends password reset links over SMTP
│   ├── pages.js                  /about, /pricing, /contact, /terms, /privacy, /refunds, /delivery, receipts
│   ├── ai.js                     picks the AI provider; parses and checks the lesson (intro + steps)
│   ├── latex-repair.js           fixes LaTeX backslashes the AI gets wrong in its JavaScript
│   ├── providers/
│   │   ├── anthropic.js          Claude via the Anthropic API
│   │   └── openai-compatible.js  open models via Ollama, LM Studio, vLLM, OpenRouter, ...
│   └── prompt.js                 the instructions the AI follows (edit to change tone/style)
│
└── public/                       the website (plain HTML/CSS/JS modules, no framework)
    ├── index.html
    ├── css/styles.css
    └── js/
        ├── main.js               entry point + router (#/, #/topic/<id>, #/graph, #/ask), / opens search
        ├── topics.js             built-in topics + learning paths ← register new topics here
        ├── views/                one file per page
        │   ├── home-view.js      Explore: hero, learning paths as lines of stations, tools
        │   ├── topic-view.js     the lesson player: visual + step rail, instrument cards, notes
        │   ├── palette.js        search palette (press /): find a lesson or ask the tutor
        │   ├── lesson-player.js  shows an AI lesson (visual + step rail), used by Ask and Notebook
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

## Accounts, free limits and credits

Only **Ask AI** costs money to run, so only it is limited. Built-in topics and Graph Lab stay free and need no account.

1. **Trial:** 3 AI answers without an account (counted per browser, with a per-network daily cap).
2. **Sign up** (email + password, or Google): 5 more free answers. Free sign-up answers are limited to 3 new accounts per network per day, so they can't be farmed.
3. **Credits:** after that, people top up any amount from ₹10 with Razorpay (UPI, cards, netbanking). Each answer is charged at **its real AI cost** (tokens × the model's price, converted to ₹) plus 3% to cover Razorpay's fee. With gpt-6-luna an answer costs about ₹0.15–0.20, so ₹10 ≈ 50–60 explanations. The top-up dialog shows the live average.

Failed answers are never charged, and only one question per account runs at a time. All limits and prices are in `.env.example`.

**Turn on payments:** create a Razorpay account, switch to Test Mode, copy the API keys into `.env` as `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`, and restart. Test payments use Razorpay's test cards/UPI and no real money moves. For live mode Razorpay needs your KYC and website policy pages (terms, privacy, refunds, contact). Optionally add a webhook (events `payment.captured`, `order.paid`) pointing to `https://<your-site>/api/payments/webhook` and set `RAZORPAY_WEBHOOK_SECRET`, so a payment still counts if the buyer closes the tab early.

**Turn on Google sign-in:** in Google Cloud Console create an OAuth client ID of type *Web application*, add `http://localhost:3000` and `http://localhost` (and later your real domain) under *Authorized JavaScript origins*, then set `GOOGLE_CLIENT_ID` in `.env` and restart. Only the client ID is used. The client secret isn't needed, so keep it out of MathLens.

## Policy pages and receipts

Razorpay checks these pages before it approves a live account, so they're plain server-rendered pages that load without JavaScript:

| Page | What it says |
| --- | --- |
| `/about` | what MathLens is and who runs it |
| `/pricing` | free limits, the live average price per lesson, what each top-up buys |
| `/contact` | support email, phone, address |
| `/terms` | terms and conditions |
| `/privacy` | what is stored, who it's shared with (AI provider, Razorpay, Google) |
| `/refunds` | cancellation and refund policy |
| `/delivery` (also `/shipping`) | credit is digital and added straight away |
| `/receipt/sample` | a sample receipt (print it to PDF if Razorpay asks for a sample invoice) |
| `/receipts` | a signed-in person's payments, each with a printable receipt |

Fill in your details in `.env`: `BUSINESS_NAME` (your name or company, as on your Razorpay KYC), `SUPPORT_EMAIL` and `BUSINESS_ADDRESS` are needed. `BUSINESS_PHONE`, `BUSINESS_CITY`, and `BUSINESS_GSTIN` (receipts become tax invoices) are optional. Until they're set, the pages show a red "set X in .env" marker and the server prints a reminder at startup. The policy text is a starting point. Read it and change `server/pages.js` to match how you actually run things; it isn't legal advice.

**Turn on password reset:** set `SMTP_HOST`, `SMTP_USER` and `SMTP_PASS` in `.env` (see `.env.example`), plus `PUBLIC_URL` once deployed. Links work once, for one hour, and using one logs the account out everywhere else. Without SMTP on your own machine, the link is printed in the server log so you can test it.

**Data:** everything is stored in `data/mathlens.db` (git-ignored). Passwords are hashed with scrypt; session cookies are HttpOnly. Back this file up once real people pay.

## Notebook and papers

- **Every lesson is saved.** Each answer goes into the `lessons` table with its question. Asking the same question again returns the saved lesson for free, and before asking, the Ask page checks for an earlier lesson on nearly the same question and offers to open it. Lessons asked before signing up move to the account at sign-up. `#/notebook` lists them all.
- **Papers.** On the Ask page, attach a PDF, TXT, Markdown or LaTeX file (or drag it onto the box). The browser pulls the text out with pdf.js; the file itself is never uploaded. Up to 120,000 characters go to the AI with an optional focus question, and it teaches the paper's central idea step by step with a toy visualization. Scanned PDFs (pictures of pages) have no text, so they can't be read yet. The prompt tells the AI to treat the document as material, never as instructions.

## Writing style

Lessons are written for a reader learning slowly: one idea per step, plain words before symbols, worked examples split across steps, and an occasional quick check. The AI prompt (`server/prompt.js`) bans common machine-writing habits: "not X, but Y" contrasts, double negatives, dramatic one-line endings, hype words and dashes. Bold is kept for the one phrase per step worth remembering.

## How Ask AI works

1. The browser sends the question, plus the list of built-in topics, to `POST /api/ask`. Asking the same question again within 10 minutes (for example after a reload) returns the same lesson for free.
2. `server/ai.js` calls the configured provider. Claude (`claude-opus-5-5` by default; set `CLAUDE_MODEL` to change it) uses **structured outputs**. OpenAI-compatible servers get the same schema as `response_format`, and the server falls back to plain JSON mode if the schema is rejected. Either way the reply is JSON with `title`, `explanation`, `keyIdeas`, `visualizationGuide`, `visualizationHtml` and `relatedBuiltInTopic`.
   The answer is a lesson: `title`, `intro`, 4 to 7 `steps` (each `{ title, explanation, visualFocus }`), `keyIdeas`, `visualizationHtml` and `relatedBuiltInTopic`.
3. Before sending the answer, the server repairs a common AI mistake: LaTeX written in plain JavaScript strings, where `'\frac'` silently becomes a form feed plus "rac" (`server/latex-repair.js`).
4. The page renders the explanation (Markdown + KaTeX) and loads `visualizationHtml` into an `<iframe sandbox="allow-scripts">` together with the **viz kit** (`public/viz-kit/`): polished default styles for controls, layout classes (`.ml-panel`, `.ml-grid-2`, `.ml-eq`, `.ml-stats`, `.ml-legend`...), escape-proof equations (`<div class="ml-eq" data-tex="\nabla f">`, auto-shrunk to fit), and automatic frame height so nothing is clipped. Edit `kit.css` to restyle every AI visualization at once.
5. **Steps drive the visual.** When the reader presses Next, the page sends `{ type: 'mathlens:step', index }` into the frame and the AI's code, registered with `MathLens.onStep((index) => ...)`, switches to that step's scene. The prompt requires a distinct, animated scene for every step.
6. The frame also gets the current theme's colours added as CSS variables (`--bg`, `--text`, `--blue`, ...). The prompt tells the AI to use them, so its visualizations match light or dark mode. The sandbox lets the AI-generated code run but blocks it from reading or changing the main page.

Answers usually take 20–60 seconds because the model writes a full interactive program. The prompt (`server/prompt.js`) asks for detailed, multi-view visualizations on advanced topics, 3D (Plotly) on the first try whenever the idea is three-dimensional, and live KaTeX equations inside the visualization.

## Ideas for next steps

- More built-in topics: gradient & level sets, SVD, complex functions (domain coloring), ODE phase portraits, Markov chains, Bayes' theorem, convolution.
- Save AI lessons in the database so popular questions load instantly for everyone and never cost API usage twice.
- Follow-up questions on an AI answer ("now show it in 3D").
- A "Graduate" track: measure theory, functional analysis, differential geometry.

## Deploying on an Oracle Always Free server

The site runs on one Ubuntu server, with Cloudflare Tunnel in front. Visitors reach it through Cloudflare, so the server needs no open web ports and HTTPS is handled for you.

**Server:** the Always Free `VM.Standard.E2.1.Micro` (1 GB memory) in Mumbai, because Ampere A1 was out of capacity there. Oracle treats a Micro as idle if CPU and network use stay under 20% for 7 days, which a quiet site can do. Check the server still runs now and then, and start it again if Oracle has stopped it. The setup script also works on A1 if you move later.

- `deploy/deploy.sh ubuntu@SERVER_IP https://your.site` sets up the server, uploads `.env` with the live settings, and starts the site. Use it again whenever `.env` changes.
- `deploy/deploy.sh ubuntu@SERVER_IP` sends the latest commit and restarts.
- The database is at `/var/lib/mathlens` and is backed up daily to `/var/backups/mathlens` (last 14). Those copies are on the same server, so download one regularly: if the server or account is lost, they go too.
- After the first deploy, open `/ipcheck` from two networks. `seenAs` should be your real IP each time, because the free limits count by IP. Then remove `SHOW_IP_CHECK` from the live settings.
- The tunnel gives up on a request after about 125 seconds. If a very long lesson hits that, asking again joins the same answer or opens the saved lesson without another charge.
