# 04 - Layout & Spatial Design Review

**Scope**: All frontend layout, spacing, typography, and desktop-native chrome.
**Files reviewed**: App.tsx/css, TabBar.tsx/css, Terminal.tsx/css, NewTabPage.tsx/css, ProjectList.tsx/css, StatusBar.tsx/css, types.ts

---

## What Is Done Well

1. **Clean vertical layout scaffold.** The app uses a simple and correct flex-column structure (`app > tab-bar + tab-content`) that fills the viewport without any scroll fights. The `tab-panel` is absolutely positioned within a `position: relative` container -- a solid pattern for layered tab panels that avoids layout thrash on tab switch.

2. **Spacing token system exists and is used consistently.** `--space-1` through `--space-4` are defined in `:root` and applied throughout. The 4px base unit is appropriate for a dense desktop tool UI. Nearly all component padding and gap values reference these tokens rather than magic numbers.

3. **Typography scale is defined as tokens.** `--text-xs` through `--text-xl` are centralized in `:root` and referenced by class. This prevents scattered font-size literals.

4. **Tab bar has correct drag region handling.** The `-webkit-app-region: drag` on `.tab-bar` with `no-drag` on interactive children is the correct Tauri pattern for a custom titlebar that doubles as a tab strip.

5. **Terminal resize handling is correct.** The `ResizeObserver` on the xterm container feeding `FitAddon.fit()` plus a debounced `resizePty` call ensures the PTY dimensions track the visual size. This is the standard approach and avoids the common bug of stale terminal dimensions.

6. **Scroll behavior in project list.** `scrollIntoView({ block: "nearest" })` on selection change, thin scrollbar styling, and `overflow-y: auto` are all correct. The list scrolls naturally without fighting the outer layout.

7. **`prefers-reduced-motion` respected.** The global media query in App.css that zeroes out animation and transition durations is a good accessibility baseline.

8. **Color scheme is cohesive.** Catppuccin Mocha tokens are defined in one place and used everywhere. The surface/mantle/bg layering creates appropriate depth without shadows, matching the elevation model of a flat dark UI.

---

## Findings

### CRITICAL

**(none)**

No structural layout bugs that would break the application at any viewport size. The architecture is fundamentally sound.

---

### HIGH

#### H1. No minimum window size enforced in CSS

**File**: `App.css` (global)
**Lines**: 34-43, 45-49

The layout has no `min-width` or `min-height` on the root container. While Tauri can enforce minimum window dimensions at the native level (via `tauri.conf.json`), the CSS layout itself has no protection. If the window is resized very small, the status bar items will overlap, tab labels will compress to nothing, and the project list will become unusable.

**Fix** -- add CSS-level minimums as a defensive measure:

```css
.app {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 480px;
  min-height: 320px;
}
```

Also confirm `tauri.conf.json` sets `"minWidth": 480, "minHeight": 320` on the window configuration.

---

#### H2. Project list is not virtualized

**File**: `ProjectList.tsx`, lines 46-74
**File**: `ProjectList.css`, lines 1-7

The project list renders every item into the DOM. For a user with dozens of configured project directories containing hundreds of projects total, this means hundreds of DOM nodes all rendered at once. Each item has two flex rows, multiple spans, and conditional badges -- the node count scales linearly.

This is a desktop launcher that will typically have 10-80 projects, so this is "high" rather than "critical." But the absence of any windowing means:
- Initial render cost grows linearly with project count.
- Scroll performance may degrade on older hardware with 200+ projects.
- Memory usage is unnecessarily high for off-screen items.

**Fix** -- consider `react-window` or `@tanstack/virtual` for the project list:

```tsx
import { useVirtualizer } from '@tanstack/react-virtual';

// Inside ProjectList:
const parentRef = useRef<HTMLDivElement>(null);
const virtualizer = useVirtualizer({
  count: projects.length,
  getScrollElement: () => parentRef.current,
  estimateSize: () => 48, // approximate row height
  overscan: 5,
});
```

Alternatively, if you want to keep it simple and the target is under 200 projects, add a comment documenting the expected upper bound so future maintainers know the design boundary.

---

#### H3. Status bar items wrap/overlap at narrow widths

**File**: `StatusBar.css`, lines 1-11
**File**: `StatusBar.tsx`, lines 17-38

The status bar is `display: flex; justify-content: space-between` with no `flex-wrap` and no `min-width` on children. At window widths below ~700px, the right-side items (Model, Effort, Sort, Perms) will either overflow or compress against the filter text, causing overlap or text truncation without ellipsis.

**Fix** -- allow wrapping and set overflow behavior:

```css
.status-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-2) var(--space-4);
  background: var(--mantle);
  border-top: 1px solid var(--surface);
  font-size: var(--text-sm);
  color: var(--text-dim);
  gap: var(--space-4);
  flex-wrap: wrap;
  min-height: 28px;
}

.status-right {
  display: flex;
  gap: var(--space-4);
  flex-wrap: wrap;
  overflow: hidden;
}

.status-item {
  white-space: nowrap;
}
```

---

### MEDIUM

#### M1. Project item has no horizontal padding -- selection highlight clips to edge

**File**: `ProjectList.css`, lines 18-26

The `.project-item` has `padding: var(--space-2) 0` -- vertical padding only. The `.project-list` container has `padding: var(--space-1) var(--space-4)`, which provides outer gutter, but the item itself has no inline padding. This means:
- The `box-shadow: inset 2px 0 0 var(--accent)` selection indicator sits at the very left edge of the item, but the text also starts at the left edge, visually colliding with the accent bar.
- The hover background extends to the full width of the item but the text has no breathing room from the highlight edge.

**Fix**:

```css
.project-item {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background 0.12s ease-out, box-shadow 0.12s ease-out;
}
```

This adds 12px inline padding, giving the accent bar visual separation from the text content and the hover/selected background breathing room.

---

#### M2. Terminal container has minimal padding -- text crowds edges

**File**: `Terminal.css`, lines 8-11

The `.terminal-container .xterm` has `padding: 4px`. This is very tight. On the left edge especially, the first column of terminal text sits 4px from the window edge, which feels cramped for a primary content area.

**Fix**:

```css
.terminal-container .xterm {
  height: 100%;
  padding: var(--space-2) var(--space-3);
}
```

This gives 8px top/bottom and 12px left/right, which better matches the spacing rhythm of the rest of the UI and provides a more comfortable reading margin for terminal output. Verify that FitAddon recalculates columns correctly after the padding change (it should, since it measures the container's inner dimensions).

---

#### M3. Tab bar has no max-tab-count / overflow strategy

**File**: `TabBar.css`, lines 12-18
**File**: `TabBar.tsx`

The `.tab-list` has `overflow-x: auto` with hidden scrollbars. This means when many tabs are open, the tab strip silently becomes horizontally scrollable with no visual indication. Users will not discover that tabs exist beyond the visible area.

**Fix** -- add scroll indicators or limit visible tab width more aggressively:

```css
.tab-list {
  display: flex;
  flex: 1;
  overflow-x: auto;
  gap: var(--space-1);
  scrollbar-width: none;
  -webkit-app-region: no-drag;
  /* Add scroll shadows as overflow hint */
  mask-image: linear-gradient(
    to right,
    transparent 0px,
    black 8px,
    black calc(100% - 8px),
    transparent 100%
  );
}
```

A more robust approach: dynamically shrink `max-width` on `.tab` based on tab count, similar to how browser tab bars compress. Alternatively, add small left/right chevron buttons that appear when the tab list overflows.

---

#### M4. Shortcut hints in header will truncate without grace on narrow windows

**File**: `NewTabPage.css`, lines 8-13
**File**: `NewTabPage.tsx`, line 209

The `.new-tab-header` is `display: flex; justify-content: space-between` with the shortcut hints as a single long `<span>`. At narrow widths, the hints text will either overflow or compress the title.

**Fix**:

```css
.new-tab-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--surface);
  gap: var(--space-4);
  flex-wrap: wrap;
}

.shortcut-hints {
  font-size: var(--text-sm);
  color: var(--text-dim);
  font-family: "Cascadia Code", "Consolas", monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
```

---

#### M5. Typography scale uses fixed px values -- no DPI awareness

**File**: `App.css`, lines 20-25

The type scale is defined in absolute pixels:
```css
--text-xs: 10px;
--text-sm: 11px;
--text-base: 13px;
--text-md: 14px;
--text-lg: 16px;
--text-xl: 18px;
```

On high-DPI displays (common on modern laptops at 150-200% scaling), Windows handles this through display scaling, so the text will scale. However, on displays where the user has customized their system font size preference, px-based sizes will not respond. More importantly, the scale itself has very tight ratios -- the difference between `text-xs` (10px) and `text-base` (13px) is only 3px, which on a high-DPI display may not provide sufficient visual differentiation.

For a Tauri desktop app targeting Windows specifically, px values are acceptable (WebView2 respects the OS display scale factor). This is medium rather than high because the practical impact is limited. However, the scale could be improved:

**Fix** -- widen the ratio between tiers for better hierarchy:

```css
:root {
  --text-xs: 10px;
  --text-sm: 11px;
  --text-base: 13px;
  --text-md: 15px;   /* was 14px -- more separation from base */
  --text-lg: 18px;   /* was 16px -- stronger heading presence */
  --text-xl: 22px;   /* was 18px -- clear display tier */
}
```

---

#### M6. Project path text can push layout when path is very long

**File**: `ProjectList.css`, lines 75-80

The `.project-path` has `text-overflow: ellipsis` and `white-space: nowrap`, which is correct. However, it is inside a flex row (`.project-meta`) without `min-width: 0` on the flex child, which means the ellipsis may not trigger in all cases -- flex items default to `min-width: auto`, which prevents them from shrinking below their content size.

**Fix**:

```css
.project-meta {
  display: flex;
  gap: var(--space-3);
  font-size: var(--text-sm);
  color: var(--text-dim);
  min-width: 0;
}

.project-path {
  opacity: 0.6;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
```

Both the flex container and the child need `min-width: 0` to allow the ellipsis truncation to work correctly in a flex context.

---

#### M7. Missing gap between spacing tokens `--space-4` (16px) and the next useful size

**File**: `App.css`, lines 14-18

The spacing scale stops at `--space-4` (16px). But the application already uses larger spacing values in inline styles -- for example, `marginTop: "8px"` and `marginTop: "12px"` in NewTabPage.tsx error state (lines 188, 193), and the section padding in Terminal/NewTabPage headers uses `--space-3` and `--space-4`. There is no token for 24px, 32px, or 48px, which means any future need for larger spacing will require either magic numbers or extending the scale.

**Fix** -- extend the scale to cover common desktop app spacing needs:

```css
:root {
  /* existing */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  /* add */
  --space-6: 24px;
  --space-8: 32px;
  --space-12: 48px;
}
```

Also replace the inline style magic numbers in `NewTabPage.tsx` (lines 188, 193) with token references.

---

### LOW

#### L1. Inline styles in NewTabPage error state bypass the design system

**File**: `NewTabPage.tsx`, lines 188-196

The error state uses inline styles with hardcoded values:
```tsx
style={{ fontSize: "var(--text-sm, 11px)", marginTop: "8px", color: "var(--red)" }}
```
```tsx
style={{ marginTop: "12px", padding: "6px 16px", background: "var(--surface)", ... }}
```

While the values roughly match tokens, inline styles are harder to maintain and cannot be overridden by themes. These should be extracted to CSS classes.

**Fix** -- create classes in `NewTabPage.css`:

```css
.new-tab-error-detail {
  font-size: var(--text-sm);
  margin-top: var(--space-2);
  color: var(--red);
}

.new-tab-retry-btn {
  margin-top: var(--space-3);
  padding: var(--space-2) var(--space-4);
  background: var(--surface);
  border: 1px solid var(--accent);
  border-radius: var(--radius-sm);
  color: var(--text);
  cursor: pointer;
  font-size: var(--text-base);
}

.new-tab-retry-btn:hover {
  background: var(--hover-overlay);
}
```

---

#### L2. Tab bar height is fixed at 36px with 28px tabs -- 8px gap feels incidental

**File**: `App.css`, line 11; `TabBar.css`, lines 3, 30

The tab bar is 36px tall and tabs are 28px, leaving 8px of dead space. The tabs are bottom-aligned (no top rounding visible since the bar background and tab background differ). This 8px gap is not harmful but it is not obviously intentional -- it does not correspond to a spacing token or a visual design pattern like "tabs emerge from the bottom of the bar."

**Fix** -- either:
- Make tabs fill the height: `.tab { height: var(--tab-height); }` and adjust padding, or
- Make the gap intentional by top-aligning tabs with margin-top to create a clear "shelf" effect:

```css
.tab {
  height: 28px;
  margin-top: auto; /* push to bottom of 36px bar */
}
```

The `margin-top: auto` approach creates a clear bottom-aligned tab shelf that visually connects the active tab to the content area below.

---

#### L3. No hover state feedback on project list items beyond background change

**File**: `ProjectList.css`, lines 27-29

The hover state only changes background to a 5% white overlay. On a dark theme, this is very subtle and may not be noticeable on some displays. The selected state uses a blue left-border accent bar, but hover has no equivalent affordance.

**Fix** -- add a subtle left-border hint on hover that previews the selected state:

```css
.project-item:hover:not(.selected) {
  background: var(--hover-overlay-subtle);
  box-shadow: inset 2px 0 0 color-mix(in srgb, var(--accent) 40%, transparent);
}
```

---

#### L4. Empty state text in ProjectList uses inline styles

**File**: `ProjectList.tsx`, lines 39-40

```tsx
<div style={{ fontSize: "var(--text-sm, 11px)", marginTop: "8px" }}>
```

Same pattern as the NewTabPage error state -- should be a class.

---

#### L5. `line-height: 1.5` on body may cause extra spacing in dense UI areas

**File**: `App.css`, line 42

A line-height of 1.5 at 13px base means ~20px line height. For body text and project list items this is fine. But for the tab bar (11px font, 28px height) and status bar (11px font), the line-height is irrelevant since height is constrained. This is not a bug, just a note -- if any future component relies on natural flow height (no explicit height), the 1.5 line-height may produce more vertical space than expected for a dense desktop tool. Consider `line-height: 1.4` for a slightly tighter default, or scope `1.5` to content areas only.

---

## Summary

| Severity | Count | Key Themes |
|----------|-------|------------|
| Critical | 0 | -- |
| High | 3 | Min window size, list virtualization, status bar overflow |
| Medium | 7 | Item padding, terminal margins, tab overflow, path truncation, type scale |
| Low | 5 | Inline styles, tab height gap, hover states, line-height |

The layout architecture is well-structured. The flex-column app shell, absolute-positioned tab panels, and token-based spacing system are all correct patterns for a desktop launcher. The primary areas for improvement are defensive behavior at extreme sizes (narrow windows, many tabs, long project lists) and tightening the spacing/typography consistency where inline styles or missing tokens create gaps in the design system.
