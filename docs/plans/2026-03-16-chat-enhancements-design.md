# Chat UI Enhancements — Design Spec

**Date:** 2026-03-16
**Status:** Reviewed (spec review passed — 3 critical issues resolved)
**Layout:** Slack/Discord style — chat center, tabbed right sidebar, input bar bottom (with terminal-style option)

---

## Overview

14 features + 1 user preference, grouped into 4 implementation phases. The chat UI was recently migrated from xterm.js to React components (commit 7980018). This spec builds on that foundation to add rich input handling, better rendering, navigation panels, and power-user features.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ TitleBar                                                    │
├──────┬──────────────────────────────────┬───────────────────┤
│ Tab  │                                  │ [📑][🗺][☑][🧠]  │
│ Side │     Chat Message Area            │                   │
│ bar  │                                  │  Right Sidebar    │
│      │  [user msg]                      │  (tabbed panel)   │
│      │  [assistant + code highlight]    │                   │
│      │  [thinking block ▾]             │  Bookmarks /      │
│      │  [tool card]                     │  Minimap /        │
│      │  [permission card]               │  Todos /          │
│      │  [choice buttons]                │  Thinking         │
│      │                                  │                   │
│      ├──────────────────────────────────┤                   │
│      │ [+] [img.png ✕]                  │                   │
│      │ [/cmd menu ▴]  Type...    [Send] │                   │
├──────┴──────────────────────────────────┴───────────────────┤
│ InfoStrip                                                   │
└─────────────────────────────────────────────────────────────┘
```

The input bar position depends on user preference:
- **Chat style** (default): fixed at bottom of chat area (`position: sticky`)
- **Terminal style**: inline at end of message flow, with floating mini-input when scrolled up

---

## Phase 1: Input Bar + Critical Fix

### 1.1 Text Sanitization

**Problem:** Sending text with lone surrogates causes API error `invalid high surrogate in string` (see output.txt evidence).

**Solution:** New utility `app/src/utils/sanitizeInput.ts`:

```typescript
export function sanitizeInput(text: string): string {
  return text
    // Strip lone surrogates (the actual crash cause)
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '')
    .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
    // Smart quotes → straight quotes
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    // Em/en dashes
    .replace(/\u2014/g, '--')
    .replace(/\u2013/g, '-')
    // Ellipsis
    .replace(/\u2026/g, '...')
    // Zero-width characters
    .replace(/[\u200B\u200C\u200D\uFEFF]/g, '');
}
```

**Integration point:** Called in `handleSubmit()` before `sendAgentMessage()`. Replaces the existing `stripNonBmp()` function in ChatView.tsx (which only handles surrogates and only on system prompts). Remove `stripNonBmp` and use `sanitizeInput` everywhere.

### 1.2 Input Bar Redesign

**New component:** `app/src/components/chat/ChatInput.tsx`

Extracted from ChatView's inline textarea. Responsibilities:
- Text input with auto-grow (1 → 6 lines, then scroll)
- Attachment management (add, remove, preview)
- Submit handling (Enter to send, Shift+Enter for newline)
- Paste interception (images, files, text)
- Drag & drop zone management
- / command and @ mention trigger detection (Phase 4)

**Layout:**
```
┌──────────────────────────────────────────┐
│ [img.png ✕] [data.csv ✕]                │  ← attachment chips row (conditional)
├──────────────────────────────────────────┤
│ [+]  Type a message...            [Send] │  ← main input row
└──────────────────────────────────────────┘
```

- `[+]` button: opens native file picker via `@tauri-apps/plugin-dialog` `open()` with multi-select
- `[Send]` button: only visible when input has content (text or attachments)
- Attachment chips row: only rendered when `attachments.length > 0`

**State:**
```typescript
interface Attachment {
  id: string;
  path: string;
  name: string;
  type: 'file' | 'image';
  thumbnail?: string; // base64 data URL for images
}
```

**On submit:** File paths prepended to message:
```
[Attached: D:\data\file.csv]
[Attached: C:\Users\alfio\img.png]

User's actual message text here
```

### 1.3 Attachment Chip Component

**New component:** `app/src/components/chat/AttachmentChip.tsx`

- Shows filename (truncated to 20 chars) + remove `✕` button
- Images get 24x24 thumbnail preview (loaded via `convertFileSrc` from Tauri)
- File type icon based on extension (📄 text, 🖼 image, 📊 data, 📦 archive)
- Hover shows full path in tooltip

### 1.4 Drag & Drop

- `ChatView` gets `onDragOver`, `onDragEnter`, `onDragLeave`, `onDrop` handlers
- When dragging over chat area, overlay appears:
  ```
  ┌─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐
  │                                     │
  │         Drop files here             │
  │         ───────────────             │
  │                                     │
  └─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘
  ```
- Dashed border using `--accent` color, semi-transparent `--backdrop` overlay
- Accepts any file type
- Dropped files added to `ChatInput` attachment state
- Uses Tauri's drag-drop event system or HTML5 drag events

### 1.5 Paste Handling

**In ChatInput textarea `onPaste` handler:**

1. **Image paste** (clipboard has image data):
   - Call `saveClipboardImage()` from `useAgentSession` hook
   - Returns temp file path
   - Add as attachment chip with thumbnail

2. **File paste** (clipboard has file list):
   - Extract file paths
   - Add as attachment chips

3. **Text paste**:
   - Run through `sanitizeInput()` before inserting
   - Normal textarea paste behavior

### 1.6 Input Mode Setting

**New setting in Ctrl+, settings panel:**

- **Label:** "Input style"
- **Options:** "Chat (fixed bottom)" | "Terminal (inline flow)"
- **Default:** "Chat"
- **Storage:** Persisted in app settings alongside theme, font, etc.

**Implementation:**
- Chat mode: `ChatInput` rendered outside the scrollable message area, `position: sticky; bottom: 0`
- Terminal mode: `ChatInput` rendered as the last element inside the scrollable message list
  - When user scrolls up > 200px from bottom, a floating mini-input fades in at the actual bottom
  - Mini-input is a compact version (no attachment chips, just text + send)
  - Clicking the mini-input or pressing Enter scrolls back to the full inline input

---

## Phase 2: Message Rendering

### 2.1 Code Syntax Highlighting

**Dependency:** `react-syntax-highlighter` (Prism backend)

**Integration:** Override `code` component in `MessageBubble.tsx`'s `react-markdown`:

```typescript
components={{
  code({ className, children, ...props }) {
    const match = /language-(\w+)/.exec(className || '');
    return match ? (
      <SyntaxHighlighter
        language={match[1]}
        style={figtreeTheme}
        showLineNumbers={lineCount > 5}
      >
        {String(children).replace(/\n$/, '')}
      </SyntaxHighlighter>
    ) : (
      <code className={className} {...props}>{children}</code>
    );
  }
}}
```

**Theme:** Custom theme object mapping Figtree CSS variables:
- Background: `--crust`
- Text: `--text`
- Keywords: `--accent`
- Strings: `--green`
- Numbers: `--yellow`
- Comments: `--overlay0`
- Errors: `--red`

**Copy button:** Appears on hover, top-right corner of code block. Uses clipboard API.

### 2.2 Thinking Panel

**Replaces:** `ThinkingIndicator.tsx` (bouncing dots)

**New component:** `app/src/components/chat/ThinkingBlock.tsx`

```
┌─ 🧠 Thinking ──────────────────── [▾] ─┐
│ I need to analyze the user's request... │
│ First, let me check the file structure  │
│ of the project to understand...         │
└──────────────────────────────────────────┘
```

**Behavior:**
- First 500ms: show bouncing dots (thinking hasn't produced text yet)
- Once thinking text arrives: replace dots with streaming text
- Text rendered in italic, using `--text-dim` color
- `--surface` background with `--overlay0` left border (4px accent bar)
- While thinking is active: expanded by default
- When thinking ends (next non-thinking event): auto-collapse to single line summary
- Click header to toggle expand/collapse
- Collapsed shows: "🧠 Thinking (N lines)" with expand arrow

**Data:** Uses existing `thinking` role in `ChatMessage`. Accumulates text from multiple thinking events.

**Important:** The current `result` event handler removes all thinking messages (`prev.filter(m => m.role !== "thinking")`). This must change — thinking messages should persist with an `ended: true` flag instead. Inline ThinkingBlocks collapse when ended, and the ThinkingPanel (Phase 3) shows the full history.

### 2.3 Permission UX Improvements

**Enhanced `PermissionCard.tsx`:**

- Show full context: file path, command, or tool being requested
- Color-coded type icons:
  - 📄 Read file → blue-tinted card
  - ✏️ Write file → yellow-tinted card
  - ⚡ Execute command → orange-tinted card
  - 🌐 Web request → purple-tinted card

- **Batch permissions (deferred):** The Agent SDK sends permissions one at a time and waits for a response before continuing. True batching would require sidecar-side buffering which is complex. For v1, keep single permission cards. Batch grouping can be added later if the sidecar is extended to support it.

- **Resolved state:** Collapse to single line:
  - `✓ Allowed: Read src/App.tsx` (green dim text)
  - `✗ Denied: Execute rm -rf /` (red dim text)

### 2.4 Dialog Management

**New message type:**
```typescript
| { id; role: "choice"; prompt: string; options: string[]; multiselect: boolean; resolved?: string | string[]; timestamp }
```

**Rendering — `ChoiceCard.tsx`:**

**Single-select:**
```
┌─────────────────────────────────────────┐
│ Which approach do you prefer?           │
│                                         │
│  [Option A: Refactor]  [Option B: New]  │
│  [Option C: Hybrid]                     │
└─────────────────────────────────────────┘
```
- Click sends selection as user message
- Buttons disable + highlight chosen option after selection

**Multi-select:**
```
┌─────────────────────────────────────────┐
│ Select files to include:                │
│                                         │
│  ☐ src/App.tsx                          │
│  ☐ src/types.ts                         │
│  ☐ src/utils.ts                         │
│                                         │
│  [Submit Selection]                     │
└─────────────────────────────────────────┘
```
- Checkboxes + submit button
- After submit, shows selected items in green

**Protocol:** The Agent SDK does not emit structured choice events. Implementation approach:
1. **Primary:** Parse `toolUse` events where the tool is a user-facing choice (e.g., `AskUser` pattern). The sidecar can intercept these and forward as `choice` events.
2. **Fallback:** Detect numbered list patterns in assistant messages (e.g., lines matching `^\d+[\.\)]\s+.+` after a question sentence ending with `?`). This is heuristic and opt-in via a setting.
3. **Manual:** User can right-click any assistant message and select "Convert to choices" to create interactive buttons from detected options.

For v1, implement approach 3 (manual) as it is reliable. Approaches 1-2 are future enhancements.

### 2.5 Loading Animations

- **Streaming indicator:** Pulsing accent-colored bar (2px height) at bottom of the last assistant message during streaming
- **Tool in-progress:** Replace static ⚙ with CSS spinning animation on the tool icon
- **Processing state:** Subtle pulse animation on input bar border when `inputState === "processing"` (using `@keyframes pulse` with `--accent` at 30% opacity)
- **Agent starting:** Skeleton loading animation in chat area while waiting for first event

---

## Phase 3: Navigation & Panels

### 3.1 Right Sidebar

**New component:** `app/src/components/chat/RightSidebar.tsx`

- 4 tab icons across the top: 📑 Bookmarks, 🗺 Minimap, ☑ Todos, 🧠 Thinking
- Tabs use icon-only buttons with tooltips
- Resizable via drag handle (reuse existing sidebar resize pattern)
- Default width: 220px, min: 150px, max: 350px
- Collapsible: double-click handle or keyboard shortcut (Ctrl+B)
- State persisted: open/closed, active tab, width — stored in settings

**Integration:** Rendered inside `ChatView.tsx` (not App.tsx) so it has direct access to the `messages` state without prop-drilling or context lifting. ChatView's layout becomes a flex row: `[message-area] [right-sidebar]`.

### 3.2 Bookmark Tab

**Component:** `app/src/components/chat/BookmarkPanel.tsx`

- Auto-populated from `messages.filter(m => m.role === 'user')`
- Each entry:
  ```
  ▸ "rainstorm on some func..."     12:34
  ▸ "also dialog management..."     12:35
  ```
- Truncated to 35 chars + timestamp
- Click → smooth scroll to message + 1s yellow highlight flash
- Current viewport message highlighted with `--accent` left border
- Uses `IntersectionObserver` on user messages to track which is in view

### 3.3 Minimap Tab

**Component:** `app/src/components/chat/MinimapPanel.tsx`

- Scaled-down vertical representation of the conversation
- Each message rendered as a colored block:
  - 🔵 User messages: `--accent` color
  - ⚪ Assistant: `--overlay0`
  - 🟠 Tool cards: `--yellow`
  - 🟡 Permissions: `--yellow` (brighter)
  - 🔴 Errors: `--red`
  - 🟢 Results: `--green`
- Block height proportional to message length
- Semi-transparent viewport indicator overlay
- Click to jump to position
- Implementation: CSS-based (div blocks with background colors) — simpler than canvas, good enough for this use case

### 3.4 Todo List Tab

**Component:** `app/src/components/chat/TodoPanel.tsx`

**Data source:** New `todo` event type from sidecar:
```typescript
| { id; role: "todo"; todos: TodoItem[]; timestamp }

interface TodoItem {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'completed';
  category?: string;
}
```

**Rendering:**
```
☐ Analyze existing code        pending
◉ Implement sanitizer          in progress
☑ Create ChatInput component   done
☐ Add drag & drop              pending
```

- Read-only checklist (user can't modify, reflects agent state)
- Status badges with color: pending (dim), in-progress (accent pulse), done (green + strikethrough)
- Grouped by category if provided
- Updates in real-time as `todo` events arrive

**Sidecar change:** The Agent SDK surfaces `TodoWrite` as a regular `toolUse` event with `tool: "TodoWrite"` and a JSON input containing the todo list. The sidecar must:
1. Intercept `toolUse` events where `tool === "TodoWrite"` (or `tool === "TodoRead"`)
2. Parse the `input` JSON to extract the todo items array
3. Forward as a structured `todo` event to the frontend
4. **Verification needed:** Before implementation, confirm that `TodoWrite` tool names appear in Agent SDK toolUse events by running a test session and logging all tool names. If TodoWrite is internal-only and not surfaced, this feature should use a simpler approach: parse the assistant's text output for checklist patterns (`- [ ]`, `- [x]`).

### 3.5 Thinking History Tab

**Component:** `app/src/components/chat/ThinkingPanel.tsx`

- Chronological list of all thinking blocks from the session
- Each entry: collapsible with timestamp header
- Full thinking text preserved (not truncated like inline blocks)
- Useful for reviewing Claude's reasoning chain after the conversation
- Data shared with inline `ThinkingBlock` components (same source of truth)

---

## Phase 4: Power User

### 4.1 / Commands Menu

**Component:** `app/src/components/chat/CommandMenu.tsx`

**Trigger:** Typing `/` as the first character in the input textarea.

**Menu:**
```
┌───────────────────────────┐
│ 🔍 Filter commands...     │
├───────────────────────────┤
│ /clear    Clear chat      │
│ /compact  Summarize       │
│ /model    Switch model    │
│ /effort   Switch effort   │
│ /help     Show help       │
│ /sessions Browse sessions │
│ /theme    Change theme    │
└───────────────────────────┘
```

- Popup positioned above the input bar (or below if near top)
- Filters as user types after `/`
- Arrow keys navigate, Enter selects, Esc dismisses
- Selected command either executes immediately (e.g., `/clear`) or inserts text (e.g., `/model opus`)
- Styled: `--surface` bg, `--accent` highlight on selected item, `--text-dim` descriptions
- Extensible: commands defined as an array, easy to add new ones

### 4.2 @ Agent Mentions

**Component:** `app/src/components/chat/MentionMenu.tsx`

**Trigger:** Typing `@` in the input textarea.

**Menu:**
```
┌───────────────────────────┐
│ 🔍 Filter agents...      │
├───────────────────────────┤
│ @opus     Claude Opus     │
│ @sonnet   Claude Sonnet   │
│ @haiku    Claude Haiku    │
└───────────────────────────┘
```

- Similar popup behavior to CommandMenu
- Selected mention inserted as styled inline tag: `[@opus]` with accent background
- On submit, the mention sets the model for the **rest of the session** (not per-message — the Agent SDK doesn't support per-message model override). This is equivalent to changing the model in the tab header, but inline.
- **Limitation:** Mid-session model switching requires restarting the agent session with the new model. The UX should warn the user: "Switching to @opus will restart the session. Continue?"
- Future: could list custom sub-agents, MCP servers, etc.

### 4.3 Command Palette

**Component:** `app/src/components/chat/CommandPalette.tsx`

**Trigger:** Ctrl+K (note: Ctrl+Shift+P is already bound to System Prompts tab globally)

- Full-width overlay centered in chat area
- Combines both / commands and @ agents in one searchable list
- Categorized: "Commands" section + "Agents" section
- Type to filter across all entries
- Enter to select, Esc to dismiss
- Alternative entry point for keyboard-heavy users
- **YAGNI note:** This duplicates / commands menu. Consider deferring to a later iteration — the / menu alone covers the use case for v1.

---

## New Files Summary

### Phase 1
- `app/src/utils/sanitizeInput.ts` — text sanitization utility
- `app/src/components/chat/ChatInput.tsx` — redesigned input component
- `app/src/components/chat/AttachmentChip.tsx` — file/image attachment display

### Phase 2
- `app/src/components/chat/ThinkingBlock.tsx` — inline thinking display (replaces ThinkingIndicator)
- `app/src/components/chat/ChoiceCard.tsx` — dialog management buttons/checkboxes

### Phase 3
- `app/src/components/chat/RightSidebar.tsx` — tabbed sidebar container
- `app/src/components/chat/BookmarkPanel.tsx` — user message navigation
- `app/src/components/chat/MinimapPanel.tsx` — conversation overview
- `app/src/components/chat/TodoPanel.tsx` — task list display
- `app/src/components/chat/ThinkingPanel.tsx` — thinking history

### Phase 4
- `app/src/components/chat/CommandMenu.tsx` — / command popup
- `app/src/components/chat/MentionMenu.tsx` — @ agent popup
- `app/src/components/chat/CommandPalette.tsx` — unified command palette

### Modified Files (across all phases)
- `app/src/components/ChatView.tsx` — integrate new components, drag-drop, input mode
- `app/src/components/ChatView.css` — new styles for all components
- `app/src/components/chat/MessageBubble.tsx` — syntax highlighting integration
- `app/src/components/chat/PermissionCard.tsx` — enhanced UX
- `app/src/components/chat/ToolCard.tsx` — loading animation
- `app/src/types.ts` — new ChatMessage roles (choice, todo), Attachment type
- `app/src/App.tsx` — RightSidebar integration, input mode setting
- `app/src/themes.ts` — syntax highlighter theme generation
- `sidecar/sidecar.js` — todo event forwarding, choice detection
- `app/package.json` — add `react-syntax-highlighter`

## Dependencies to Add

- `react-syntax-highlighter` — code block highlighting with Prism
- `@types/react-syntax-highlighter` — TypeScript types

## Settings Additions

- `inputStyle`: `"chat"` | `"terminal"` (default: `"chat"`)
- `rightSidebarOpen`: boolean (default: `false`)
- `rightSidebarTab`: `"bookmarks"` | `"minimap"` | `"todos"` | `"thinking"` (default: `"bookmarks"`)
- `rightSidebarWidth`: number (default: `220`)
