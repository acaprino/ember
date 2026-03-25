# Changes Applied

## Change 1: Fix H1 link to wrong repo
- Category: Content
- Before: `<h1><a href="https://github.com/acaprino/figtree-toolset">Figtree</a></h1>`
- After: `<h1>Figtree</h1>` (no link)
- Expected impact: Eliminates trust-breaking navigation to wrong repo

## Change 2: Fix placeholder clone URL
- Category: Content
- Before: `git clone https://github.com/user/figtree.git`
- After: `git clone https://github.com/acaprino/figtree.git`
- Expected impact: Fixes broken onboarding path

## Change 3: Replace "blazing-fast" tagline
- Category: Content
- Before: "A blazing-fast terminal launcher for Claude Code & Gemini CLI"
- After: "Manage Claude Code & Gemini CLI sessions in tabbed terminals"
- Expected impact: More specific, benefit-driven, avoids developer marketing cliche

## Change 4: Promote "Pick a project..." tagline to subtitle
- Category: UX
- Before: Buried in "What is Figtree?" body text
- After: `<sub>Pick a project. Pick a model. Hit Enter. Code.</sub>` as hero subtitle
- Expected impact: Best copy in the README now front-and-center

## Change 5: Reorder subtitle — user value before tech stack
- Category: UX
- Before: "Built with Tauri 2 + React 19 + xterm.js — Windows native, keyboard-first"
- After: Tech stack moved to footer; subtitle is now the punchy tagline
- Expected impact: First impression focuses on value, not implementation

## Change 6: Badge cleanup — add Stars, remove redundant
- Category: Social/Visual
- Before: 6 badges (version, platform, tauri, react, rust, license)
- After: 5 badges (stars, version, platform, tauri, license) — dropped React 19 and Rust 2021
- Expected impact: Social proof signal (stars), less noise

## Change 7: Add Table of Contents
- Category: UX
- Before: No navigation for 322-line document
- After: 8-item anchor-linked ToC
- Expected impact: Visitors can jump to Getting Started, Features, etc.

## Change 8: Rewrite "Why Figtree?" as objection-handling
- Category: Content
- Before: "Why Figtree?" with attribute bullets (zero friction, session persistence, etc.)
- After: "Why not just run `claude` in a terminal?" with status-quo contrast and concrete workflow descriptions
- Expected impact: Addresses the real objection, shows specific value

## Change 9: Rewrite "What is Figtree?" section
- Category: Content
- Before: "Think of it as a project-aware terminal multiplexer..." with tagline buried in body
- After: Leads with tagline, concrete description (scans directories, configure settings, tabs persist), no jargon
- Expected impact: Clearer first impression, better SEO keywords

## Change 10: Move Getting Started from position 7 to position 2
- Category: UX
- Before: Getting Started was after Features, Shortcuts, and Tech Stack (line 190)
- After: Getting Started is the second major section, right after "What is Figtree?"
- Expected impact: Developers can try the app within one scroll

## Change 11: Rewrite feature bullets as benefits
- Category: Content
- Before: "Tab output indicators show activity at a glance" / "Git branch and dirty state indicators"
- After: "See which tabs have new output without switching to them" / "See which branch each project is on..."
- Expected impact: Features communicate user value instead of technical facts

## Change 12: Condense theme table
- Category: UX
- Before: 10-row table always visible, 15+ lines
- After: Prose summary with theme names, full table in `<details>` block
- Expected impact: Reduced scroll length without losing information

## Change 13: Collapse Keyboard Shortcuts
- Category: UX
- Before: 4 tables, 43 lines always visible
- After: 6 essential shortcuts visible, full tables in `<details>` block
- Expected impact: ~37 lines saved in main flow, reference material still accessible

## Change 14: Collapse Tech Stack / Architecture / Project Structure
- Category: UX
- Before: 140 lines (43% of README) of contributor material in main flow
- After: All wrapped in single `<details>` block
- Expected impact: ~130 lines saved; acquisition content not buried under implementation details

## Change 15: Merge Models table into AI Tool Integration
- Category: UX
- Before: Standalone section at bottom of README
- After: Nested under AI Tool Integration in Features
- Expected impact: Contextually relevant placement, one less top-level section

## Change 16: Add Contributing section
- Category: Content
- Before: No contributing guidance
- After: 2-line section with link to issues and TECHNICAL.md
- Expected impact: Signals project is open to participation

## Change 17: Add License section
- Category: Content
- Before: License badge but no section or link
- After: Section with link to LICENSE file
- Expected impact: Clear licensing information

## Change 18: Add screenshot placeholder
- Category: Visual
- Before: No visual content
- After: HTML comment placeholder for hero screenshot with TODO
- Expected impact: Serves as reminder; ready to uncomment when screenshot is captured

## Change 19: Footer rewrite
- Category: Content
- Before: "Built with Rust and TypeScript. Forged on Windows."
- After: "Windows native, keyboard-first. Built with Tauri 2, React 19, and Rust."
- Expected impact: User-relevant attributes first, tech details second
