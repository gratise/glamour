---
name: glamour-site-builder
description: Build or revise production website code from screenshots, design exports, or prepared reference bundles, then use Glamour's CLI or MCP workflow to measure and verify visual fidelity across states and viewports. Use when an agent is asked to create, recreate, or visually refine a website. Do not use for a read-only visual critique.
---

# Build websites with Glamour

You are the coding agent and author of the application. Glamour supplies structured reference facts, deterministic browser rendering, visual diagnostics, and verified experiments; it does not write the target application's source code. Make real, semantic, responsive changes in the target repository, then use Glamour to measure the result.

## Start from the available evidence

- Inspect the target repository, its local instructions, framework, existing routes, design tokens, and dev/build commands before editing. Preserve its conventions and reuse its components and assets.
- Inspect every provided reference image and bundle. Use original SVG/raster assets, fonts, exact copy, chart data, and interaction metadata when available; do not redraw information that already exists in source assets.
- Do not ask the user to manually measure details that the image, repository, or Glamour can reveal. Derive screenshot pixel dimensions directly. If only a screenshot is provided, start with that and state only genuinely unknowable assumptions (such as an absent interaction state); do not block the implementation on a richer bundle.
- For a screenshot-only reference, use its bitmap width and height as the CSS viewport only when no capture metadata exists and record that assumption. Use DPR 1 only as an explicit fallback, never infer the original browser/device from pixels.
- Keep evidence and interpretation separate. Treat measured boxes/pixels and supplied assets as facts; label inferred component semantics and responsive rules as hypotheses.

## Create the website in source

- For an existing app, implement the requested route in its current stack. For an empty destination, choose a conventional, maintainable stack that fits the request and environment; build a working site rather than a static screenshot collage.
- Reconstruct the page structure and visual hierarchy first, then typography, spacing, colors, effects, and detailed geometry. Use semantic HTML, keyboard-accessible controls, and real responsive behavior.
- Implement every requested state that has evidence: navigation, hover/focus, modal, form, chart, animation, or loading states. When behavior is genuinely unspecified, use the least surprising accessible behavior and identify that assumption in the final report.
- Prefer exact source/design tokens and provided geometry. For difficult curves and chart marks, use supplied SVG or source data first; use `glamour extract` only as an approximate, browser-validated fallback. Preserve uncertainty instead of inventing facts.

## Run the visual correction loop

Use the same Glamour project and core workflow through MCP when connected, or through the `glamour` CLI when available. Read `CONTRIBUTING.md` and the repository README for installation and exact command options. If neither integration is available, continue implementing the site; do not pretend a visual verification ran.

1. Create a project from the screenshot or prepared bundle and the live route. Include every supplied viewport/state and the target repository settings when known.
2. Analyze the references before coding further. Reuse exact assets/fonts/data and inspect complex regions; do not flood context with the entire bundle when targeted inspection is enough.
3. Start the target app with its existing development command and run compare for all viewport references.
4. Inspect the highest-impact mismatch regions. Use the classification and ranked target candidates to decide whether source changes belong to layout, spacing, typography, paint, effects, asset choice, or geometry. Verify measured deltas against the rendered page before applying them.
5. For an ambiguous CSS value, test a transient override or bounded optimization. Apply a candidate to source only when it improves the relevant region without damaging the rest of the page. Overrides are experiments; they do not modify source.
6. Repeat browser comparisons after source edits. Fix the largest remaining supported mismatches first and recheck all affected responsive references and states.
7. Finalize only after the requested routes/states are implemented. Report per-reference metrics, the most important remaining mismatches, assumptions, and anything the available source evidence could not establish.

## Evidence and quality bar

- A lower aggregate loss is useful only if the rendered site remains structurally correct and interactive. Do not trade accessibility or responsive behavior for pixel alignment.
- Do not call a page finished because it builds or because one screenshot looks close. Compare every provided viewport/state in pinned Chromium and run the target repository's relevant checks.
- When a requested exact detail cannot be recovered from a raster reference, use the best measured approximation, call it out as estimated, and avoid presenting it as recovered source truth.
- Keep unrelated project changes out of the implementation. Follow the target repository's commit and verification conventions when commits are part of the request.
