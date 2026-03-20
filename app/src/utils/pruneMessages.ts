import type { ChatMessage } from "../types";

/** Maximum messages before pruning triggers */
export const PRUNE_THRESHOLD = 600;

/** Messages kept in full (most recent) */
export const KEEP_RECENT = 400;

/** Max characters for tool output in pruned messages */
const PRUNED_OUTPUT_LIMIT = 200;

/**
 * Prune old messages to prevent unbounded memory growth in long sessions.
 *
 * Strategy:
 * - Keep the most recent KEEP_RECENT messages in full
 * - For older messages: keep user + assistant text, truncate tool outputs
 * - Never prune permission/ask messages (security-relevant)
 * - Return original array if below threshold (referential equality preserved)
 */
export function pruneMessages(messages: ChatMessage[]): ChatMessage[] {
  if (messages.length <= PRUNE_THRESHOLD) return messages;

  const cutoff = messages.length - KEEP_RECENT;
  const pruned: ChatMessage[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    if (i >= cutoff) {
      // Recent messages: keep in full
      pruned.push(msg);
      continue;
    }

    // Old messages: prune based on role
    switch (msg.role) {
      case "tool":
        if (msg.output !== undefined && msg.output.length > PRUNED_OUTPUT_LIMIT) {
          pruned.push({ ...msg, output: msg.output.slice(0, PRUNED_OUTPUT_LIMIT) + "\n…(truncated)" });
        } else {
          pruned.push(msg);
        }
        break;
      case "result":
      case "status":
      case "thinking":
        // Drop verbose noise from old turns
        break;
      default:
        // Keep user, assistant, permission, ask, error, todo, history-separator
        pruned.push(msg);
        break;
    }
  }

  return pruned;
}
