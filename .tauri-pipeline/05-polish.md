# UI Polish Review -- Tauri 2 Claude Code Launcher

**Reviewer focus**: Visual consistency, animation quality, micro-interactions, loading states, dark theme integrity, desktop-native feel, and delight details.

**Overall assessment**: The app has a solid foundation -- clean Catppuccin Mocha palette, sensible design tokens, a global `prefers-reduced-motion` rule, and good ARIA attributes. However, the UI currently feels like a functional prototype rather than a polished desktop app. Animations are minimal, feedback is sparse, and several states (loading, empty, error, first-run) are plain text with no visual treatment. The recommendations below are ordered from highest impact to lowest.

---

## What Is Done Well

1. **Design tokens** (App.css:1-26) -- Centralized CSS custom properties for colors, spacing, radii, and font sizes. Consistent use throughout all component CSS files.
2. **prefers-reduced-motion** (App.css:64-70) -- Global rule that kills all animation/transition durations. Correct approach.
3. **Tab bar drag region** (TabBar.css:8-9) -- `-webkit-app-region: drag` on the tab bar with `no-drag` on interactive children. Good native desktop behavior.
4. **Focus-visible indicators** (TabBar.css:119-128, ProjectList.css:82-85) -- Accent-colored outlines on keyboard focus. Correct use of `:focus-visible` rather than `:focus`.
5. **ARIA roles** -- `role="tablist"`, `role="tab"`, `aria-selected`, `role="listbox"`, `role="option"`, `aria-live="polite"` on status bar. Solid accessibility baseline.
6. **Scrollbar styling** (ProjectList.css:5-6) -- Thin scrollbar matching the surface color. Unobtrusive.
7. **WebGL renderer with fallback** (Terminal.tsx:71-77) -- GPU-accelerated xterm rendering with graceful degradation.
8. **New-output pulse dot** (TabBar.css:49-57) -- Animated indicator when a background tab has new output. Good attention management.
9. **Selected project left-accent** (ProjectList.css:34) -- `inset box-shadow` acting as a left border indicator. Clean selection affordance.
10. **Terminal theme alignment** (Terminal.tsx:59-64) -- xterm background/foreground matches Catppuccin Mocha tokens exactly.

---

## Findings

### CRITICAL

#### C1. No tab entrance/exit animation -- tabs appear and disappear instantly
- **File**: TabBar.tsx (entire component), App.tsx:129-158
- **Issue**: When a tab is created or closed, it snaps in/out with zero transition. The tab-content panels also use `display: none/flex` toggling (App.tsx:133) which prevents any cross-fade between tab panels. This is the single most jarring interaction in the app.
- **Fix (TabBar)**: Wrap the tab list in an animation-aware container. Since the project already depends on React, the lightest approach is CSS-only with `@starting-style` for entry and a class-based exit animation triggered before DOM removal:
```css
/* TabBar.css -- tab entrance */
.tab {
  /* existing styles... */
  animation: tab-enter 0.2s ease-out;
}

@keyframes tab-enter {
  from {
    opacity: 0;
    max-width: 0;
    padding-left: 0;
    padding-right: 0;
  }
  to {
    opacity: 1;
    max-width: 200px;
    padding-left: var(--space-3);
    padding-right: var(--space-3);
  }
}

/* For exit, add a .closing class before removing from DOM */
.tab.closing {
  animation: tab-exit 0.15s ease-in forwards;
}

@keyframes tab-exit {
  to {
    opacity: 0;
    max-width: 0;
    padding: 0;
    overflow: hidden;
  }
}
```
- **Fix (Tab panels)**: Replace the `display: none` approach with `visibility: hidden` + `opacity: 0` and transition opacity, or use a simple cross-fade:
```css
.tab-panel {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.15s ease-out;
}

.tab-panel.active {
  opacity: 1;
  visibility: visible;
}
```
Note: For terminal tabs, `display: none` may be required to avoid xterm layout issues. In that case, at minimum animate new-tab page panels and keep terminals as-is with a comment explaining why.

---

### HIGH

#### H1. Loading state is plain text with no visual treatment
- **File**: ProjectList.tsx:31-33, ProjectList.css:9-16
- **Issue**: "Scanning projects..." is rendered as centered dim text. No skeleton, no spinner, no shimmer. For a desktop app that scans the filesystem, this could last 1-3 seconds and feels broken.
- **Fix**: Add a skeleton shimmer for the project list:
```css
/* ProjectList.css */
.project-list-loading {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-4);
  height: 100%;
}

.skeleton-row {
  height: 48px;
  border-radius: var(--radius-sm);
  background: linear-gradient(
    90deg,
    var(--surface) 25%,
    color-mix(in srgb, var(--surface) 60%, var(--bg)) 50%,
    var(--surface) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s ease-in-out infinite;
}

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```
```tsx
// ProjectList.tsx -- replace plain text loading
if (loading) {
  return (
    <div className="project-list-loading">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="skeleton-row" style={{ opacity: 1 - i * 0.1 }} />
      ))}
    </div>
  );
}
```

#### H2. Error state uses inline styles and has no hover/active feedback on retry button
- **File**: NewTabPage.tsx:184-201
- **Issue**: The error state retry button is styled entirely with inline `style={{}}` -- no hover state, no press feedback, no transition. It also breaks the design token pattern used everywhere else.
- **Fix**: Move to a proper CSS class:
```css
/* NewTabPage.css */
.error-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: var(--space-2);
}

.error-message {
  font-size: var(--text-sm);
  color: var(--red);
}

.retry-button {
  margin-top: var(--space-3);
  padding: var(--space-2) var(--space-4);
  background: var(--surface);
  border: 1px solid var(--accent);
  border-radius: var(--radius-sm);
  color: var(--text);
  cursor: pointer;
  font-size: var(--text-base);
  transition: background 0.15s ease-out, transform 0.1s ease-out, border-color 0.15s ease-out;
}

.retry-button:hover {
  background: var(--hover-overlay);
  border-color: var(--accent);
}

.retry-button:active {
  transform: scale(0.97);
}

.retry-button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
```

#### H3. Empty state for project list is visually flat and offers no guidance
- **File**: ProjectList.tsx:35-43
- **Issue**: "No projects found" with a tiny hint line. No icon, no visual hierarchy, no obvious call-to-action. The inline `style={{}}` also breaks the pattern.
- **Fix**: Add a styled empty state with visual weight:
```css
/* ProjectList.css */
.project-list-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-dim);
  gap: var(--space-2);
}

.empty-icon {
  font-size: 32px;
  opacity: 0.3;
  margin-bottom: var(--space-2);
}

.empty-title {
  font-size: var(--text-md);
  font-weight: 500;
  color: var(--text);
}

.empty-hint {
  font-size: var(--text-sm);
  color: var(--text-dim);
}

.empty-hint kbd {
  padding: 1px 5px;
  border-radius: var(--radius-sm);
  background: var(--surface);
  border: 1px solid var(--text-dim);
  font-family: inherit;
  font-size: var(--text-xs);
}
```

#### H4. Project items lack horizontal padding -- content touches the left edge inside the selected background
- **File**: ProjectList.css:18-26
- **Issue**: `.project-item` has `padding: var(--space-2) 0` -- zero horizontal padding. When selected, the surface background extends full width but the text starts flush against the left box-shadow accent stripe. Looks cramped.
- **Fix**:
```css
.project-item {
  padding: var(--space-2) var(--space-3);
}
```

#### H5. No active/press state on project items
- **File**: ProjectList.css:28-30
- **Issue**: Items have a hover state but no `:active` press feedback. Double-clicking to launch gives no visual confirmation that the click registered.
- **Fix**:
```css
.project-item:active {
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  transition-duration: 0.05s;
}
```

#### H6. Status bar items are not interactive despite being cyclable
- **File**: StatusBar.tsx:22-37, StatusBar.css
- **Issue**: Status bar items show `title` tooltips saying "Tab to cycle" / "F2 to cycle" but they are plain `<span>` elements. Users may try to click them. They have no `cursor: pointer`, no hover state, and no click handler.
- **Fix**: Either make them clickable buttons that trigger the same cycle action as the keyboard shortcut, or at minimum add a subtle hover hint that they are keyboard-controlled:
```css
.status-item {
  cursor: default;
  padding: 2px var(--space-2);
  border-radius: var(--radius-sm);
  transition: background 0.15s ease-out;
}

.status-item:hover {
  background: var(--hover-overlay-subtle);
}
```
Better: make them `<button>` elements with `onClick` handlers that call `onUpdate`.

---

### MEDIUM

#### M1. Tab close button has no active/press state
- **File**: TabBar.css:78-99
- **Issue**: The close button has hover but no `:active` state. On a frequently used action, the lack of press feedback feels dead.
- **Fix**:
```css
.tab-close:active {
  background: rgba(255, 255, 255, 0.15);
  transform: scale(0.9);
}
```

#### M2. Tab add button (+) has no active/press state
- **File**: TabBar.css:101-117
- **Issue**: Same as M1 -- hover but no press feedback.
- **Fix**:
```css
.tab-add:active {
  background: color-mix(in srgb, var(--surface) 80%, var(--accent));
  transform: scale(0.95);
}
```

#### M3. Active tab has no bottom-edge indicator connecting it to the content area
- **File**: TabBar.css:44-47
- **Issue**: The active tab gets `background: var(--bg)` which matches the content area, but there is no visual bridge (bottom border elimination or overlap) between the tab and the content below. In most tabbed UIs, the active tab visually merges with the content panel.
- **Fix**: Either extend the active tab 1px below the tab bar bottom edge, or add a 1px bottom border to the tab bar that the active tab covers:
```css
.tab-bar {
  /* existing styles... */
  border-bottom: 1px solid var(--surface);
  padding-bottom: 0;
}

.tab.active {
  background: var(--bg);
  color: var(--text);
  margin-bottom: -1px;
  padding-bottom: 1px;
}
```

#### M4. No transition on the selected project indicator
- **File**: ProjectList.css:32-35
- **Issue**: When arrowing through projects, the selection jumps instantly. The `transition` on `.project-item` covers `background` and `box-shadow` (line 25), but scrollIntoView also snaps. Consider adding `scroll-behavior: smooth` to the list container and optionally a subtle scale or y-translate to the selected item.
- **Fix**:
```css
.project-list {
  scroll-behavior: smooth;
}
```

#### M5. Filter text in status bar has no visual container -- hard to notice
- **File**: StatusBar.css:18-20
- **Issue**: The filter indicator is just blue text floating in the status bar. Easy to miss, especially when typing quickly.
- **Fix**: Give it a pill background:
```css
.status-filter {
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  padding: 1px var(--space-2);
  border-radius: 9999px;
  font-family: "Cascadia Code", "Consolas", monospace;
}
```

#### M6. "Launching" state has no visual feedback
- **File**: NewTabPage.tsx:38, 47-48
- **Issue**: When `setLaunching(true)` is called, nothing visually changes. The user double-clicks a project, and the tab switches to a terminal with no intermediate feedback. If spawning takes time, the UI appears frozen.
- **Fix**: Add a brief overlay or change the selected project item to show a launching indicator:
```css
.project-item.launching {
  position: relative;
  pointer-events: none;
}

.project-item.launching::after {
  content: "Launching...";
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--bg) 85%, transparent);
  color: var(--accent);
  font-size: var(--text-sm);
  border-radius: var(--radius-sm);
  animation: fade-in 0.15s ease-out;
}

@keyframes fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
```

#### M7. Header title "Claude Launcher" is static and plain
- **File**: NewTabPage.css:15-19
- **Issue**: The title has no branding treatment. For a launcher app, the title area is a branding opportunity. Consider a subtle gradient text or accent color on "Claude".
- **Fix**:
```css
.new-tab-header h2 {
  font-size: var(--text-lg);
  font-weight: 600;
  background: linear-gradient(135deg, var(--accent), #b4befe);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
```

#### M8. Shortcut hints are visually dense and hard to scan
- **File**: NewTabPage.tsx:208-210, NewTabPage.css:21-25
- **Issue**: All shortcuts are in a single monospace string with no visual separation. Hard to parse at a glance.
- **Fix**: Use `<kbd>` elements with styled backgrounds:
```css
.shortcut-hints kbd {
  padding: 1px 5px;
  border-radius: var(--radius-sm);
  background: var(--surface);
  font-size: var(--text-xs);
  font-family: "Cascadia Code", "Consolas", monospace;
  margin-right: 2px;
}
```

#### M9. The "MD" badge for CLAUDE.md presence is cryptic
- **File**: ProjectList.tsx:60
- **Issue**: "MD" as a badge label does not clearly communicate "this project has a CLAUDE.md file." New users will not understand what it means.
- **Fix**: Consider using a small icon or the text "CLAUDE.md" in the badge, or at minimum add a `title` attribute:
```tsx
<span className="project-badge claude" title="Has CLAUDE.md">MD</span>
```

---

### LOW

#### L1. No GPU acceleration hint on transitioned elements
- **File**: ProjectList.css:25, TabBar.css:37, StatusBar.css:30
- **Issue**: Transitions on `background` and `color` are CPU-composited. For the project list which could have 50+ items, this is fine at rest but could cause dropped frames during rapid keyboard navigation.
- **Fix**: Add `will-change: background` to `.project-item.selected` and remove it when not selected, or use `transform: translateZ(0)` as a promotion hint only on the selected item.

#### L2. Tab bar does not indicate overflow when many tabs are open
- **File**: TabBar.css:13-23
- **Issue**: The tab list scrolls horizontally with hidden scrollbars. When tabs overflow, there is no visual cue (fade edge, arrow indicator) that more tabs exist off-screen.
- **Fix**: Add fade masks on the edges:
```css
.tab-list {
  -webkit-mask-image: linear-gradient(
    to right,
    transparent 0px,
    black 12px,
    black calc(100% - 12px),
    transparent 100%
  );
  mask-image: linear-gradient(
    to right,
    transparent 0px,
    black 12px,
    black calc(100% - 12px),
    transparent 100%
  );
}
```
Note: Only apply when overflow is detected (needs a small JS check or `:has()` with a sentinel element).

#### L3. Terminal container has no entrance animation
- **File**: Terminal.css:1-6
- **Issue**: When switching to a terminal tab for the first time, the xterm canvas appears instantly. A brief fade-in would smooth the transition.
- **Fix**:
```css
.terminal-container {
  animation: terminal-in 0.2s ease-out;
}

@keyframes terminal-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
```

#### L4. Perms "SKIP" state could use stronger visual warning
- **File**: StatusBar.css:33-35
- **Issue**: The red text is correct but subtle. Given the security implications, consider a background tint:
```css
.status-item.perms.on {
  background: color-mix(in srgb, var(--red) 10%, transparent);
  border-radius: var(--radius-sm);
  padding: 2px var(--space-2);
}
```

#### L5. Missing Catppuccin Mocha colors from the palette
- **File**: App.css:1-26
- **Issue**: The design tokens only include a subset of Catppuccin Mocha. Missing: `--crust` (#11111b, darkest), `--overlay0` (#6c7086), `--overlay1` (#7f849c), `--lavender` (#b4befe), `--peach` (#fab387), `--teal` (#94e2d5). These would be useful for elevation layers, additional semantic colors, and richer badge/status styling.
- **Fix**: Add to `:root` as needed. Not all are required, but `--crust` for the deepest layer and `--lavender`/`--peach` for badge variety would help.

#### L6. No cursor change on tab drag (tab reordering not implemented)
- **File**: TabBar.tsx
- **Issue**: Tabs cannot be reordered by dragging. Not a polish issue per se, but users of tabbed desktop apps (VS Code, browsers) expect this. Adding even a `cursor: grab` would set expectations incorrectly. Noting this as a future feature gap.

#### L7. project-list-empty and project-list-loading share styles but have different needs
- **File**: ProjectList.css:9-16
- **Issue**: Both share the same centered flex layout, but loading should be a vertical column (for skeleton rows) while empty should remain centered. The shared rule will fight the skeleton layout suggested in H1.
- **Fix**: Split into separate rules or use the skeleton approach from H1 which already overrides the loading class.

#### L8. Border-bottom on header does not use the elevation hierarchy
- **File**: NewTabPage.css:13
- **Issue**: `border-bottom: 1px solid var(--surface)` is fine but a subtle shadow would create better depth:
```css
.new-tab-header {
  border-bottom: 1px solid var(--surface);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}
```

#### L9. The tab "has-output" pulse animation runs continuously
- **File**: TabBar.css:56, 130-133
- **Issue**: The pulse animation runs infinitely (`infinite`). Once a user notices it, continuing to pulse is distracting. Consider pulsing 3-5 times then settling at full opacity, or using a single attention-grab animation.
- **Fix**:
```css
.tab.has-output::before {
  animation: pulse 2s ease-in-out 3;
}
```

---

## Summary Table

| Severity | Count | Key themes |
|----------|-------|-----------|
| Critical | 1     | Tab creation/destruction has no animation |
| High     | 6     | Loading skeleton, error state, empty state, item padding, press feedback, status bar interactivity |
| Medium   | 9     | Close/add button press states, tab-content bridge, selection transitions, filter pill, launch feedback, branding, shortcut hints, badge clarity |
| Low      | 9     | GPU hints, tab overflow indicator, terminal fade-in, perms warning, missing palette colors, drag reorder, CSS splitting, header shadow, pulse iteration |

## Priority Implementation Order

1. **C1** -- Tab enter/exit animations (biggest bang for effort)
2. **H1** -- Skeleton loading shimmer (first thing users see)
3. **H4 + H5** -- Project item padding and press states (most-interacted element)
4. **H2 + H3** -- Error and empty state styling (complete the state coverage)
5. **M1 + M2 + M3** -- Button press states and tab-content bridge (tactile polish)
6. **M5 + M6** -- Filter pill and launch feedback (interaction clarity)
7. **H6** -- Status bar clickability (discoverability)
8. Remaining medium and low items as incremental polish
