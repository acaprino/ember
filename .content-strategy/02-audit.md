# Phase 2: Content Strategy Audit

## UX & Conversion Findings

### Critical
1. **No screenshot or demo GIF** — A desktop app with custom chrome, 10 themes, tabbed terminals, and ASCII art has ZERO visual representation. This is the #1 conversion killer. Developers cannot see what they're evaluating.
2. **No download/install path** — The only way to use Figtree is cloning and building from source (Rust + Node.js). No pre-built binaries, no GitHub Releases link. Eliminates 90%+ of potential users.
3. **Getting Started buried at line 190** — A developer wanting to try Figtree must scroll past Features, Keyboard Shortcuts, and Tech Stack (60% of the README).
4. **Placeholder clone URL** — `git clone https://github.com/user/figtree.git` is broken. The single most action-oriented line fails.

### Important
5. **No Table of Contents** — 322-line README with no navigation. Visitors must scroll or Ctrl+F.
6. **Content order is documentation-first, not acquisition-first** — Current: Features → Shortcuts → Tech Stack → Getting Started. Should be: Screenshot → Value prop → Quick Start → Features.
7. **Keyboard Shortcuts section (43 lines)** — Reference material taking prime real estate. Should be collapsed with `<details>`.
8. **Tech Stack / Architecture / Project Structure (140 lines, 43% of README)** — Implementation details diluting the "try this" message. Should be collapsed or moved to docs.
9. **No Contributing section** — No guidance for potential contributors.
10. **No social proof** — No stars badge, no user count, no community links, no "others use this" signal.

### Nice-to-have
11. **No star/watch prompt** — Low-effort social proof accumulation.
12. **Models table buried at bottom** — Useful info in the wrong location; should be in AI Tool Integration section.
13. **Inconsistent section density** — "What is Figtree?" is 8 lines; "Features" is 58 lines; "Keyboard Shortcuts" is 43 lines.

---

## Content & Copy Findings

### Critical
14. **H1 title links to wrong repo** — `<a href="https://github.com/acaprino/figtree-toolset">Figtree</a>` links to a different repository. Trust-breaking bug.
15. **Placeholder clone URL** — `github.com/user/figtree.git` will 404 for anyone copy-pasting.

### Important
16. **"Blazing-fast" tagline** — The most parodied adjective in developer marketing. Undermines credibility with the target audience. Replace with specific, benefit-driven language.
17. **"Why Figtree?" fails to address the core objection** — "I already run `claude` in my terminal, why do I need a separate app?" The section lists attributes without contrasting against the status quo.
18. **"What is Figtree?" uses jargon** — "project-aware terminal multiplexer" undersells the product. Not every Claude Code user knows what a terminal multiplexer is.
19. **Feature bullets are feature-focused, not benefit-focused** — "Git branch and dirty state indicators" vs. "See which branch each project is on and whether it has uncommitted changes."
20. **SEO keyword gaps** — Missing high-value search phrases: "Claude Code GUI", "Claude Code desktop app", "AI terminal manager", "Windows terminal app for Claude".
21. **"Pick a project. Pick a model. Hit Enter. Code." is buried** — The best copy in the README is hidden in the "What is Figtree?" section instead of being the hero subtitle.

### Nice-to-have
22. **Subtitle tech stack line puts implementation before value** — "Built with Tauri 2 + React 19 + xterm.js — Windows native, keyboard-first" should lead with user-relevant attributes.
23. **Theme table is too long** — 10 rows of hex codes that would be better served by a screenshot.
24. **Tone inconsistency** — Hero copy uses marketing-speak ("blazing-fast") while Architecture section speaks precise engineering language. Architecture tone is stronger.

---

## Social & Visual Findings

### Critical
25. **Zero screenshots** — For an extremely visual application, this is the single biggest barrier to engagement.
26. **No GitHub social preview image** — Shared links on Twitter/LinkedIn/Discord/Slack render as plain text with auto-generated card.

### Important
27. **No GitHub Topics configured** — Missing discoverability tags: `claude-code`, `gemini-cli`, `terminal`, `tauri`, `rust`, `react`, `windows`, `developer-tools`, `ai-coding`, `desktop-app`.
28. **No `.github/` infrastructure** — No issue templates, PR templates, discussions, or release workflow.
29. **Badge strategy suboptimal** — 6 badges, 2 redundant (React 19, Rust 2021 are implementation details). Missing: GitHub Stars, Downloads.
30. **No demo GIF** — A 10-15 second GIF showing the launch flow would be high-impact.

### Nice-to-have
31. **Logo style** — Clipart-like with thick outlines; functional but not polished brand identity.
32. **No social links** — No Discord, Twitter/X, blog. Acceptable for early-stage but limits community building.
33. **No FUNDING.yml** — If accepting sponsors.
34. **Version badge is hardcoded** — Should be dynamic via GitHub release tag.

---

## What's Working Well

1. **"Pick a project. Pick a model. Hit Enter. Code."** — Genuinely excellent copy. Concrete, rhythmic, memorable. Should be promoted to hero position.
2. **Badge row** — Clean, informative, visually establishes credibility.
3. **Keyboard shortcuts tables** — Thorough and well-organized for the keyboard-first audience.
4. **Architecture Highlights section** — Unusually strong for a README. Shows engineering depth that builds trust.
5. **AI Tool comparison table** — Smart formatting, instantly communicates Claude vs. Gemini feature parity.
6. **Tech Stack ASCII diagram** — Fits the terminal-tool aesthetic.
7. **Theme table** — Color swatches with hex codes and style descriptors are appealing.
8. **"Why Figtree?" bullet formatting** — Good benefit framing with em-dash explanations.
9. **Consistent formatting** — Tables, bullets, code blocks, headers used consistently.
10. **Footer tagline** — "Built with Rust and TypeScript. Forged on Windows." has personality.
11. **Build optimization details** — LTO, codegen-units, strip signal craft and performance attention.
