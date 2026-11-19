# Global DOM Optimizer — Violentmonkey Userscript

<img src="icons/leaf.svg" width="96" align="right" alt="Global DOM Optimizer leaf icon">

[![Version](https://img.shields.io/badge/version-0.0.7-1fe779)](https://github.com/LucianoSkx/global-dom-optimizer-userscript/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Violentmonkey](https://img.shields.io/badge/Violentmonkey-userscript-orange)](https://violentmonkey.github.io)

A Violentmonkey/Tampermonkey userscript port of the **Global DOM Optimizer** browser extension by **ArkFlame Studios**. It applies CSS containment — `content-visibility: auto` with a measured `contain-intrinsic-block-size` — to offscreen content blocks on long pages, so the browser can skip style, layout and paint for blocks that are not on screen. **Nothing is removed from the DOM and no data is collected.**

This is an independent port maintained by [LucianoSkx](https://github.com/LucianoSkx). The containment strategy, the layout-safety design and the diagnostics concept belong to the original extension by ArkFlame Studios ([arkflame.com](https://arkflame.com)). See [Credits](#credits).

## What it actually does

`content-visibility: auto` is a real CSS primitive (Chrome 85+, Firefox 125+, Safari 18+): the browser skips rendering work for the element's subtree until it approaches the viewport, while the element keeps its box. This script:

1. **Scans** the page for text-bearing blocks (`p`, headings, list items, `section`, `article`, `figure`, `div`, …) at `document-idle`, in time-sliced batches.
2. **Filters out** anything unsafe: forms, inputs, iframes, video/canvas, `contenteditable`, navigation landmarks, the focused element, animated/transformed/filtered blocks, multi-column parents, margin-collapsing children, blocks with no measurable size or inside short scrollers.
3. **Applies containment** with an intrinsic-block-size hint measured from the element's real height (remembered per element).
4. **Guards geometry**: after each batch it checks the scroller's `scrollHeight`/`scrollTop`; if anything moved, containment is rolled back automatically (bisecting the batch so one bad element doesn't spoil 31 good ones).
5. **Skips far blocks**: an IntersectionObserver with a 96px margin flips offscreen contained blocks to `content-visibility: hidden` (`[data-gdo-far]`), and flips them back when they approach the viewport.
6. **Rescans lazily**: mutations trigger incremental, debounced (950ms) scoped rescans; full rescans happen on navigation, resize and `pageshow`.

The script does **not** remove, hide, lazy-load or rewrite your content. It does not skip downloading. It does not touch scripts, styles or handlers of the page.

## Does it work? — measured, not claimed

Verified on a synthetic long page (1,200 articles, ~8,400 DOM nodes; `<main>` eligible for containment, `<nav>` control group excluded), in **Firefox 161.0 on Linux**, with the userscript installed exactly as distributed here. Numbers sent back from the page automatically:

| Metric | t+3s | t+8s |
| --- | --- | --- |
| DOM nodes | 8,415 | 8,415 |
| Blocks contained | 1,504 | 1,504 |
| Blocks far-skipped | 1,498 | 1,498 |
| Computed `content-visibility` (contained / control) | `auto` / `visible` | `auto` / `visible` |
| Forced reflow, 40 iterations (contained / control) | 21.3 ms / 26.2 ms (−19%) | 24.8 ms / 25.4 ms (−2%) |

Honest reading of these numbers:

- The **mechanism works**: containment is applied where eligible, the control group is untouched, far blocks are marked, and the DOM stays intact. `@media print` restores `content-visibility: visible`.
- The **reflow win on this synthetic page is small and noisy** (~0–20%). Text layout dominates; the savings from skipping offscreen subtree layout are page-dependent and usually modest. Paint/style-skipping benefits of the far-block state are real but not captured by this micro-benchmark.
- **There are no universal speed claims here.** On most pages the effect is negligible; on very long pages with heavy style/layout cost it can matter. Measure on your own page before assuming anything.

The original extension's own diagnostics exist for a reason: check the floating panel's coverage ring on your pages, ideally against a baseline dashboard.

## Install

1. Install [Violentmonkey](https://violentmonkey.github.io) (or another userscript manager).
2. Open the raw link — your userscript manager will intercept the page and ask to confirm:

   **[Install / Update `global-dom-optimizer.user.js`](https://raw.githubusercontent.com/LucianoSkx/global-dom-optimizer-userscript/main/global-dom-optimizer.user.js)**

3. Alternative: download the file and drag it into your userscript manager's dashboard.

The script runs on `http://*/*` and `https://*/*` at `document-idle`. Updates are picked up automatically once installed from the raw link (via `@updateURL`).

## Usage

- **Floating leaf button** (bottom-right): toggles the diagnostics panel (ring with skipped-height coverage, managed/hidden counters, scan stats, scroll-root detection, global and per-site toggles).
- **Violentmonkey menu** → *Global DOM Optimizer*:
  - **Pause/Resume optimization** — global on/off
  - **Exclude/Include this site** — per-hostname exclusion
  - **Toggle interface** — show/hide the floating button
- Settings persist via GM storage.

## Limitations

- **Not a memory or CPU firewall.** `content-visibility` skips *rendering*, not *memory* and not JavaScript execution.
- **Short pages gain nothing.** The containment threshold (`extent >= 0.6 * viewport height`) means only scrollable pages are a candidate.
- **`[data-gdo-far]` uses `content-visibility: hidden`**, which removes the subtree from rendering; nearest-hit assistive technology and some find-in-page edge cases may be affected in far blocks until they approach the viewport. The `auto` state alone is unaffected.
- **Complex widgets are excluded by design**: anything inside forms, navigations, `contenteditable` regions, iframes/canvas/video, or with transforms/animations/filters is not touched.
- **SPAs that change URL without DOM mutations** may not trigger a rescan (same limitation as the original extension).
- **`!important` is used** on the containment rules (as in the original extension); it overrides a page's own `content-visibility` declarations on contained elements.

## Development

```sh
node --check global-dom-optimizer.user.js
node tests/smoke.test.js   # assert-based smoke (DOM/GM shims, no browser needed)
```

The smoke test boots the script against a minimal fake DOM + GM API and asserts that containment is applied, site exclusions persist and menu commands register.

## Credits

- **[ArkFlame Studios](https://arkflame.com)** — original *Global DOM Optimizer* browser extension (containment strategy, layout-safety rollback, diagnostics).
- **[Violentmonkey](https://violentmonkey.github.io)** — the userscript manager this port targets.
- **LucianoSkx** ([@LucianoSkx](https://github.com/LucianoSkx)) — userscript port, packaging, maintenance and verification work.

## License

[MIT](LICENSE) © ArkFlame Studios (original extension) and LucianoSkx (this port).
