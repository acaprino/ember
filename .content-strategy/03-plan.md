# Content Strategy Plan

## Findings Summary

| Category | Critical | Important | Nice-to-have |
|----------|----------|-----------|--------------|
| UX & Conversion | 4 | 6 | 3 |
| Content & Copy | 2 | 6 | 3 |
| Social & Visual | 2 | 4 | 4 |
| **Total** | **8** | **16** | **10** |

---

## Quick Wins (high impact, low effort)

These can be applied immediately by editing `README.md`:

### 1. Fix broken H1 link (Critical)
- **Before:** `<h1 align="center"><a href="https://github.com/acaprino/figtree-toolset">Figtree</a></h1>`
- **After:** `<h1 align="center">Figtree</h1>`

### 2. Fix placeholder clone URL (Critical)
- **Before:** `git clone https://github.com/user/figtree.git`
- **After:** `git clone https://github.com/acaprino/figtree.git`

### 3. Replace "blazing-fast" tagline (Important)
- **Before:** "A blazing-fast terminal launcher for Claude Code & Gemini CLI"
- **After:** "Manage Claude Code & Gemini CLI sessions in tabbed terminals — one app, all your projects"

### 4. Promote the best tagline to subtitle (Important)
- Move "Pick a project. Pick a model. Hit Enter. Code." to the `<sub>` position
- Move tech stack details to secondary position

### 5. Reorder subtitle (Nice-to-have)
- **Before:** "Built with Tauri 2 + React 19 + xterm.js — Windows native, keyboard-first"
- **After:** "Windows native, keyboard-first"  (tech stack covered in Tech Stack section)

### 6. Add GitHub Stars badge (Important)
- Add `https://img.shields.io/github/stars/acaprino/figtree?style=flat-square`
- Remove redundant React 19 and Rust 2021 badges

### 7. Collapse Keyboard Shortcuts into `<details>` (Important)
- Keep 6 essential shortcuts visible
- Wrap full tables in `<details><summary>View all shortcuts</summary>`

### 8. Collapse Tech Stack, Architecture, Project Structure into `<details>` (Important)
- These 140 lines (43% of README) are contributor material, not acquisition material

### 9. Move Getting Started higher (Important)
- Currently at position 7 of 10 sections
- Move to position 3: after Features, before deep technical sections

### 10. Merge Models table into AI Tool Integration (Nice-to-have)
- Move from bottom of README to contextually relevant Features subsection

---

## Medium Effort

### 11. Rewrite "Why Figtree?" as objection-handling (Important)
- Change heading to "Why not just run `claude` in a terminal?"
- Add 2-sentence "status quo pain" intro
- Rewrite bullets with explicit contrast against manual CLI workflow

### 12. Rewrite feature bullets as benefits (Important)
- Transform "Git branch and dirty state indicators" → "See which branch each project is on and whether it has uncommitted changes"
- Transform "Smart clipboard paste (sanitizes smart quotes)" → "Paste from Slack or Notion without broken smart quotes"
- Apply to all bullet points in Features section

### 13. Rewrite "What is Figtree?" section (Important)
- Lead with the tagline, follow with concrete description
- Drop "terminal multiplexer" jargon
- Add SEO keywords naturally: "Claude Code GUI", "Claude Code desktop app"

### 14. Add Table of Contents (Important)
- Anchor-linked ToC after hero section

### 15. Condense theme table (Nice-to-have)
- Replace 10-row table with prose listing + note that screenshots show themes
- Theme table is better served by visual proof (screenshots)

### 16. Add Contributing section (Important)
- Even 3 lines: "Contributions welcome. Open an issue first to discuss."
- Link to GitHub Issues

---

## Major Recommendations (require assets or infrastructure)

### 17. Add screenshots (CRITICAL — highest impact single change)
- **Hero screenshot:** Full app, project list + terminal + tabs, Catppuccin Mocha
- **Project picker:** New tab page with git badges, filter active
- **Theme gallery:** 3-4 themes side by side
- Create `docs/screenshots/` directory
- Capture at 1200x800 (native window size), optimize with pngquant

### 18. Create GitHub social preview image
- 1280x640px image with app screenshot + logo + tagline
- Upload in GitHub Settings > General > Social preview
- Store as `docs/social-preview.png`

### 19. Add demo GIF
- 10-15 second GIF: open app → filter projects → select → Enter → terminal launches
- Use ScreenToGif, keep under 5MB
- Place below hero screenshot

### 20. Configure GitHub Topics
- Add: `claude-code`, `gemini-cli`, `terminal`, `tauri`, `rust`, `windows`, `developer-tools`, `ai-coding`, `desktop-app`, `xterm`

### 21. Publish GitHub Releases with pre-built binaries
- `.msi` or `.exe` installer via `cargo tauri build`
- Add download badge to README hero
- This removes the #2 conversion blocker (build from source only)

### 22. Create `.github/` infrastructure
- `ISSUE_TEMPLATE/bug_report.md` and `feature_request.md`
- `PULL_REQUEST_TEMPLATE.md`
- Enable GitHub Discussions

### 23. Add LICENSE file
- Badge says MIT but no LICENSE file found in repo root
- Add standard MIT LICENSE file

---

## Estimated Conversion Impact

Ordered by expected impact on converting GitHub visitors to users:

| Rank | Change | Expected Impact |
|------|--------|----------------|
| 1 | Add hero screenshot | **Very High** — proves the product is real, anchors all other improvements |
| 2 | Publish pre-built binaries | **Very High** — removes the Rust toolchain barrier for 90%+ of potential users |
| 3 | Fix broken clone URL | **High** — currently broken onboarding path |
| 4 | Rewrite hero tagline + promote "Pick a project..." | **High** — first impression determines bounce rate |
| 5 | Reorder README sections | **High** — Getting Started accessible in first scroll |
| 6 | Collapse reference sections | **Medium-High** — reduces scroll fatigue, keeps focus on value |
| 7 | Rewrite "Why Figtree?" as objection-handling | **Medium** — addresses the core "why should I care" question |
| 8 | Add GitHub Topics + social preview | **Medium** — improves discoverability and share appearance |
| 9 | Rewrite feature bullets as benefits | **Medium** — improves perceived value for those who read deeply |
| 10 | Add Contributing section + `.github/` infra | **Low-Medium** — attracts contributors, signals active project |

---

## Recommended README Structure (After Changes)

```
1. Hero: Logo + Title + Tagline + Download Badge + Stars Badge + Platform Badge
2. Hero Screenshot
3. What is Figtree? (brief, benefit-focused, with SEO keywords)
4. Why not just run claude in a terminal? (objection-handling)
5. Getting Started (download binary OR build from source)
6. Features (benefit-focused bullets, AI tool comparison table)
7. <details> Keyboard Shortcuts </details>
8. <details> Tech Stack </details>
9. Configuration + Models (compact)
10. Contributing
11. <details> Architecture & Project Structure </details>
12. License
13. Footer
```
