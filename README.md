<div align="center">

<img src="assets/banner.svg" width="100%" alt="Global DOM Optimizer — Violentmonkey userscript">

[![Version](https://img.shields.io/badge/version-0.0.7-1fe779?style=flat-square)](https://github.com/LucianoSkx/global-dom-optimizer-userscript)
[![License: MIT](https://img.shields.io/badge/license-MIT-34d399?style=flat-square)](LICENSE)
[![Violentmonkey](https://img.shields.io/badge/userscript-Violentmonkey-f97316?style=flat-square)](https://violentmonkey.github.io)
[![JavaScript](https://img.shields.io/badge/JavaScript-100%25-fbbf24?style=flat-square&logo=javascript&logoColor=black)](https://github.com/LucianoSkx/global-dom-optimizer-userscript)

**Viewport-aware containment for long pages — without removing a single node.**<br>
A [Violentmonkey](https://violentmonkey.github.io) userscript port of the original **Global DOM Optimizer** browser extension by **ArkFlame Studios**.

[![Install Userscript](https://img.shields.io/badge/Install_Userscript-8b5cf6?style=for-the-badge&logoColor=white)](https://raw.githubusercontent.com/LucianoSkx/global-dom-optimizer-userscript/main/global-dom-optimizer.user.js)

</div>

---

## ✦ What it does

`content-visibility: auto` is a first-class CSS primitive (Chrome 85+, Firefox 125+, Safari 18+): the browser skips style, layout and paint for a subtree until it approaches the viewport, while the element keeps its box. This script applies that to the long tail of a document:

| Step | What happens |
| --- | --- |
| **Scan** | Text-bearing blocks (`p`, headings, list items, `section`, `article`, `figure`, `div`, …) are found at `document-idle`, in time-sliced batches |
| **Filter** | Forms, inputs, iframes, media, `contenteditable`, navigation landmarks, focused elements, animated/transformed blocks and multi-column parents are never touched |
| **Contain** | `content-visibility: auto` is applied with a `contain-intrinsic-block-size` measured from the real height — remembered per element, so no scrollbar jump |
| **Guard** | Scroller geometry is measured before/after each batch; if anything moved, containment is rolled back automatically (bisecting the batch) |
| **Skip** | An `IntersectionObserver` flips offscreen contained blocks to `content-visibility: hidden`; they flip back before they reach the viewport |
| **Rescan lazily** | Debounced, scoped rescans on mutations; full rescans on navigation, resize and `pageshow` |

**No content is removed. No handlers, styles or scripts of the page are touched. No data is collected.**

## ✦ Honest performance

Measured on a synthetic long page (1,200 articles, ~8,400 DOM nodes; `<main>` eligible, `<nav>` as control group), on **Firefox 161.0 / Linux** with the exact userscript distributed here:

| Metric | t+3s | t+8s |
| --- | --- | --- |
| DOM nodes | 8,415 | 8,415 |
| Blocks contained | 1,504 | 1,504 |
| Blocks far-skipped | 1,498 | 1,498 |
| Computed `content-visibility` (contained / control) | `auto` / `visible` | `auto` / `visible` |
| Forced reflow — 40 iterations (contained / control) | 21.3 ms / 26.2 ms (**−19%**) | 24.8 ms / 25.4 ms (**−2%**) |

> The mechanism is verified working; **the speed win is page-dependent and usually modest**. Skipping offscreen layout saves little when text dominates layout cost. If you need a hard number for your page, measure it — the floating panel's coverage ring is there for exactly that.

## ✦ Install

1. Install [Violentmonkey](https://violentmonkey.github.io) (or any userscript manager).
2. Open the install link — your manager will intercept the page and ask to confirm:

   **[Install / Update `global-dom-optimizer.user.js`](https://raw.githubusercontent.com/LucianoSkx/global-dom-optimizer-userscript/main/global-dom-optimizer.user.js)**

3. Or download the file and drag it into the userscript manager's dashboard.

Runs on `http://*/*` and `https://*/*` at `document-idle`. Updates are picked up automatically once installed from the raw link (`@updateURL`).

<details>
<summary><b>✦ Usage & controls</b> (click to expand)</summary>

- **Floating leaf button** (bottom-right) — toggles the diagnostics panel: skipped-height ring, managed/hidden counters, scan stats, scroll-root detection, global and per-site toggles.
- **Violentmonkey menu** → *Global DOM Optimizer*:
  - **Pause/Resume optimization** — global on/off
  - **Exclude/Include this site** — per-hostname exclusion
  - **Toggle interface** — show/hide the floating button
- Settings persist via GM storage across sessions and SPA navigations.
</details>

<details>
<summary><b>✦ FAQ & limitations</b> (click to expand)</summary>

**Is content removed?** No. Blocks remain in the DOM; they are only skipped during rendering.

**Does it collect data?** No. Everything stays local (GM storage). No telemetry, no network.

**Why doesn't containment apply to some blocks?** By design: unsafe or geometry-sensitive blocks are excluded, and if a containment batch changes scroll geometry at runtime it is rolled back automatically.

**Short pages gain nothing.** The containment threshold requires a scrollable document (`extent ≥ 0.6 × viewport height`).

**`[data-gdo-far]` uses `content-visibility: hidden`** — far subtrees leave the rendering tree until they approach the viewport. Nearest-hit assistive technology and some find-in-page edge cases may be affected in far blocks; the `auto` state alone is unaffected. The stylesheet restores `content-visibility: visible` for print.

**It is not a CPU or RAM firewall.** `content-visibility` skips rendering work only.

**SPAs that mutate nothing** may not trigger a rescan (same as the original extension).

**`!important` is used** on the containment rules (as in the original) to win against a page's own declarations.

**The coverage ring is "skipped height"** — a proxy for how much of the scrollable document is currently skipped, not a measured CPU/RAM saving.
</details>

<details>
<summary><b>✦ Development</b> (click to expand)</summary>

```sh
node --check global-dom-optimizer.user.js
node tests/smoke.test.js   # assert-based smoke (DOM/GM shims, no browser needed)
```

The smoke test boots the script against a minimal fake DOM + GM API and asserts that containment is applied, site exclusions persist and menu commands register.
</details>

## ✦ Credits

- **[ArkFlame Studios](https://arkflame.com)** — original *Global DOM Optimizer* browser extension (containment strategy, layout-safety rollback, diagnostics).
- **[Violentmonkey](https://violentmonkey.github.io)** — the userscript manager this port targets.
- **[LucianoSkx](https://github.com/LucianoSkx)** — userscript port, packaging, maintenance and verification.

## ✦ License

[MIT](LICENSE) © ArkFlame Studios (original extension) and LucianoSkx (this port).
