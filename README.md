# Global DOM Optimizer — Violentmonkey Userscript

[![Version](https://img.shields.io/badge/version-0.0.7-1fe779)](https://github.com/LucianoSkx/global-dom-optimizer-userscript)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Violentmonkey](https://img.shields.io/badge/Violentmonkey-userscript-orange)](https://violentmonkey.github.io)

A Violentmonkey/Tampermonkey userscript port of the **Global DOM Optimizer** browser extension by **ArkFlame Studios** — viewport-aware containment for long pages. It applies `content-visibility: auto` to offscreen content blocks so the browser can skip their style, layout and paint work, while keeping every block in the DOM and out of your way.

> This is an independent **port of the original extension** ([arkflame.com](https://arkflame.com)), ported to userscript form and maintained by [LucianoSkx](https://github.com/LucianoSkx). All containment logic, the layout-safety design and the diagnostics concept come from the original work by ArkFlame Studios. See [Credits](#credits).

## Features

- **`content-visibility: auto` containment** with a measured `contain-intrinsic-block-size` (remembered per block, so skipped content never leaves a scrollbar jump)
- **IntersectionObserver**-driven far-block skipping (`data-gdo-far` → `content-visibility: hidden`) with a 96px prefetch margin
- **Layout-safety rollback**: measures scroller geometry before/after applying containment; if anything moved, the batch is reverted and bisected so one bad wrapper can't invalidate 31 safe paragraphs
- **Spatial index** (512px scroll tiles) for O(visible) rechecks instead of full-DOM scans; time-sliced scanning (6ms slices, batches of 32, hard cap at 3,000 managed blocks)
- **Lazy/mutation-aware rescans**: incremental scoped rescans (debounced 950ms) instead of full rescans on every mutation; full rescan on navigation, resize and `pageshow`
- **Floating diagnostics panel**: live ring (skipped-height coverage), managed/hidden block counts, scan count and work, grid tiles, scroll-root detection — plus global and per-site toggles
- **Per-site exclusion** and a global pause, persisted via GM storage (`GM_getValue`/`GM_setValue`)
- **Print-safe**: `@media print` restores `content-visibility: visible` and `contain-intrinsic-block-size: none`

## Install

1. Install [Violentmonkey](https://violentmonkey.github.io) (or another userscript manager) in your browser.
2. Click the raw install link — your userscript manager will intercept the page and ask to confirm:

**[Install / Update `global-dom-optimizer.user.js`](https://raw.githubusercontent.com/LucianoSkx/global-dom-optimizer-userscript/main/global-dom-optimizer.user.js)**

Alternative: download the file and drag it into the userscript manager's dashboard.

The script runs on all `http://*/*` and `https://*/*` pages at `document-idle`. No data is collected, no network requests are made, and no content is removed from the page.

## Usage

- **Floating leaf button** (bottom-right corner): toggles the diagnostics panel.
- **Violentmonkey menu** → *Global DOM Optimizer*:
  - *Pause/Resume optimization* — global on/off
  - *Exclude/Include this site* — per-hostname exclusion
  - *Toggle interface* — show/hide the floating button
- Settings persist across sessions and across SPA navigations.

## Development

```sh
node --check global-dom-optimizer.user.js
node tests/smoke.test.js   # assert-based smoke (DOM/GM shims, no browser required)
```

The smoke test boots the script against a minimal fake DOM + GM API, then asserts that containment is applied, persisted exclusions work and the menu commands register.

## FAQ

**Is content removed from the page?** No. Blocks stay in the DOM; they are only skipped during rendering.

**Does this collect data?** No. Everything stays local (GM storage). No telemetry, no network.

**Why doesn't containment apply to some blocks?** By design, for safety: forms, iframes, videos, `contenteditable`, interactive regions, navigation landmarks, elements inside short scrollers, blocks with active animations/transforms, parent multi-column flows and anything that would alter scroll geometry (verified at runtime with automatic rollback).

**Why is the coverage ring "skipped height"?** It is the percentage of the scrollable document height currently skipped from rendering — not a measured CPU/RAM saving. Treat it as a rough proxy.

## Credits

- **[ArkFlame Studios](https://arkflame.com)** — original *Global DOM Optimizer* browser extension (containment strategy, layout-safety rollback, diagnostics). This userscript is a port of that work.
- **[Violentmonkey](https://violentmonkey.github.io)** — the userscript manager this port targets.
- **LucianoSkx** ([@LucianoSkx](https://github.com/LucianoSkx)) — userscript port, packaging and maintenance.

## License

[MIT](LICENSE) © ArkFlame Studios (original extension) and LucianoSkx (this port).
