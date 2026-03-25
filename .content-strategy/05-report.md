# Content Strategy Audit Report

## Target: GitHub Repository README — https://github.com/acaprino/figtree
## Date: 2026-03-14

## Executive Summary

Figtree's README was technically thorough but structured as implementation documentation rather than a product landing page. The copy quality was generally strong — particularly the "Pick a project. Pick a model. Hit Enter. Code." tagline — but was undermined by two critical bugs (wrong repo link, placeholder clone URL), a cliche headline ("blazing-fast"), and a content order that buried the "try it now" path under 190 lines of feature and architecture details. The complete absence of screenshots for a rich visual application was the single biggest conversion gap.

## Findings by Category

| Category | Critical | Important | Nice-to-have | Fixed |
|----------|----------|-----------|--------------|-------|
| UX & Conversion | 4 | 6 | 3 | 10 |
| Content & Copy | 2 | 6 | 3 | 10 |
| Social & Visual | 2 | 4 | 4 | 3 |
| **Total** | **8** | **16** | **10** | **23** |

## Changes Applied

19 changes across 4 categories:

### Copy Fixes (Critical)
- Removed broken H1 link to `figtree-toolset` repo
- Fixed placeholder clone URL (`user/figtree` -> `acaprino/figtree`)
- Replaced "blazing-fast" with benefit-driven tagline
- Promoted best copy ("Pick a project...") to hero subtitle

### Structure Changes (High Impact)
- Added Table of Contents for 300+ line document
- Moved Getting Started from position 7 to position 2
- Collapsed Keyboard Shortcuts (43 lines -> 6 visible + details)
- Collapsed Tech Stack / Architecture / Project Structure (140 lines -> details block)
- Merged Models table into AI Tool Integration section

### Content Rewrites (Medium Impact)
- Rewrote "Why Figtree?" as objection-handling ("Why not just run claude in a terminal?")
- Rewrote "What is Figtree?" — concrete, no jargon, SEO-friendly
- Rewrote feature bullets as benefits (user-facing, not technical)
- Condensed theme table to prose summary + collapsible detail
- Added Contributing section with issue link
- Added License section

### Visual/Social (Quick Wins)
- Added GitHub Stars badge for social proof
- Removed redundant tech badges (React 19, Rust 2021)
- Added screenshot placeholder (HTML comment, ready to uncomment)

## Remaining Recommendations

Items requiring manual intervention — cannot be fixed via README edits alone:

### High Priority
1. **Capture and add screenshots** — Hero shot (project picker + terminal + tabs), theme gallery (3-4 themes side by side). This is the #1 remaining improvement. Create `docs/screenshots/` directory.
2. **Publish GitHub Releases** with pre-built `.msi` or `.exe` binaries. Add download badge to hero area. This removes the build-from-source barrier.
3. **Add LICENSE file** to repo root (MIT). Badge references it but file doesn't exist.
4. **Configure GitHub Topics** in repo settings: `claude-code`, `gemini-cli`, `terminal`, `tauri`, `rust`, `windows`, `developer-tools`, `ai-coding`, `desktop-app`, `xterm`

### Medium Priority
5. **Create social preview image** (1280x640px) — app screenshot with logo and tagline. Upload in GitHub Settings > General > Social preview.
6. **Record demo GIF** (10-15 seconds) — open app, filter projects, select, Enter, terminal opens. Place below hero screenshot.
7. **Create `.github/` directory** — issue templates (bug report, feature request), PR template
8. **Enable GitHub Discussions** for community Q&A

### Nice-to-have
9. **Make version badge dynamic** — link to GitHub releases instead of hardcoded
10. **Commission refined logo** — current icon is functional but clipart-style
11. **Set up GitHub Actions CI** — enables build status badge
12. **Create FUNDING.yml** if accepting sponsors

## Ongoing Strategy

- **Content calendar:** Update screenshots when UI changes. Update models table when new models are added.
- **A/B testing opportunities:** The hero tagline could be tested — "Manage Claude Code & Gemini CLI sessions in tabbed terminals" vs. "One app for all your Claude Code and Gemini CLI sessions"
- **Metrics to track:** GitHub stars growth, clone count (Insights > Traffic), release download count
- **Review frequency:** Quarterly README review aligned with feature releases

## Audit Metadata
- Agents used: 3 (UX & Conversion, Content & Copy, Social & Visual)
- Total findings: 34
- Fixes applied: 19 (23 findings addressed)
- Remaining: 12 (require screenshots, releases, or GitHub settings)
