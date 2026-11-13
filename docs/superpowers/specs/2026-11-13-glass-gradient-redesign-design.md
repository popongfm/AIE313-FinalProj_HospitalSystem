# Glass-gradient redesign of the web UI (2026-11-13)

**Why:** make the hospital site read as a modern, AI-era medical product: sky-blue glass, soft moving gradients, fluid motion.
References: landing-page mockups and a moodboard supplied by Mickie (light blue / white / beige, frosted cards, pill buttons,
large light type, lots of space).

**Scope:** `web/index.html`, `web/register.html`, `web/app.html`, `web/css/app.css`, new `web/js/motion.js`, `web/img/`,
chart palette in `web/js/dashboard.js`, `.jpg` MIME type in `scripts/serve.mjs` and the test harness.
No change to ids, data logic, Supabase calls or auth.

**Approaches considered**
1. Re-theme through the existing CSS tokens and rewrite only the landing markup (chosen: keeps every test and JS hook).
2. Move to a framework/component library (rejected: breaks the smoke tests and the no-build deploy).
3. Landing page only (rejected: the app screens are what gets demonstrated).

**Design**
- Colour: navy ink `#0b2545`, navy primary `#123a70`, sky `#3f8ef0`, mist `#edf3fb`, sand `#f4ede3`, mint `#6ff0b0`.
  Token names (`--scrub` …) are unchanged; only their values moved. Secondary text `#40536b` (≥ 5.2:1 on every light surface).
- Type: Anuphan (Thai + Latin); large headings at weight 300–400, tight tracking.
- Glass: `--glass`, `--glass-strong`, `--glass-line` + `backdrop-filter` on nav, cards, drawer, toasts.
- Motion: drifting aurora with grain behind the public pages (pointer parallax), scroll reveal (`[data-reveal]`),
  pointer spotlight (`[data-glow]`), tab/card/chat rise-in, drawer slide. All off under `prefers-reduced-motion`.
- Landing: hero = headline + one portrait + two CTAs (sign up, see features); sign-in form in its own section right
  after the hero (`#signin` anchor kept); service photo cards with a neutral scrim; a sand panel of 3D clinical renders;
  navy AI panel with two example exchanges; numbered access steps. Clock moved to the footer.
- Images: Unsplash (free licence), stored in `web/img/`; each `<img>` removes itself on error and the gradient behind shows.

**Constraints kept**
- `.chart-card[data-chart="billing"]` still spans the grid; the pinned actions column stays opaque and sticky.
- No transform on `.account-type span` (it would cover the hidden radio and swallow clicks).
- `tests/screens.mjs` runs with reduced motion so full-page screenshots show below-the-fold content.

**Not done:** "forgot password" (needs a reset flow and Supabase email, a feature rather than styling).
