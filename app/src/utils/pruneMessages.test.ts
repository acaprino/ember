import { describe, it, expect } from "vitest";
import { pruneMessages, PRUNE_THRESHOLD, KEEP_RECENT } from "./pruneMessages";
import type { ChatMessage } from "../types";

function makeMsg(id: string, role: ChatMessage["role"], extra?: Partial<ChatMessage>): ChatMessage {
  const base = { id, role, timestamp: Date.now() } as ChatMessage;
  return { ...base, ...extra } as ChatMessage;
}

describe("pruneMessages", () => {
  it("returns same array reference when below threshold", () => {
    const msgs: ChatMessage[] = [
      makeMsg("1", "user", { text: "hi" }),
      makeMsg("2", "assistant", { text: "hello", streaming: false }),
    ];
    const result = pruneMessages(msgs);
    expect(result).toBe(msgs); // same reference
  });

  it("prunes when above threshold", () => {
    const msgs: ChatMessage[] = [];
    for (let i = 0; i < PRUNE_THRESHOLD + 100; i++) {
      if (i % 3 === 0) {
        msgs.push(makeMsg(`u${i}`, "user", { text: `message ${i}` }));
      } else if (i % 3 === 1) {
        msgs.push(makeMsg(`t${i}`, "tool", { tool: "Bash", input: {}, output: "x".repeat(500), success: true }));
      } else {
        msgs.push(makeMsg(`a${i}`, "assistant", { text: `response ${i}`, streaming: false }));
      }
    }
    const result = pruneMessages(msgs);
    // Old result/status/thinking messages are dropped, tool outputs truncated
    // so pruned array should be smaller or at least have truncated content
    expect(result.length).toBeLessThanOrEqual(msgs.length);
    // Verify some old tool outputs were truncated
    const oldToolMsg = result.find(m => m.role === "tool" && m.output?.includes("…(truncated)"));
    expect(oldToolMsg).toBeTruthy();
  });

  it("keeps recent messages in full", () => {
    const msgs: ChatMessage[] = [];
    for (let i = 0; i < PRUNE_THRESHOLD + 50; i++) {
      msgs.push(makeMsg(`t${i}`, "tool", { tool: "Read", input: {}, output: "x".repeat(1000), success: true }));
    }
    const result = pruneMessages(msgs);
    // Last KEEP_RECENT messages should have full output
    const lastMsg = result[result.length - 1];
    if (lastMsg.role === "tool") {
      expect(lastMsg.output?.length).toBe(1000);
    }
  });

  it("truncates tool output in old messages", () => {
    const msgs: ChatMessage[] = [];
    for (let i = 0; i < PRUNE_THRESHOLD + 50; i++) {
      msgs.push(makeMsg(`t${i}`, "tool", { tool: "Bash", input: {}, output: "x".repeat(5000), success: true }));
    }
    const result = pruneMessages(msgs);
    // First message should be truncated
    const first = result[0];
    if (first.role === "tool" && first.output) {
      expect(first.output.length).toBeLessThan(5000);
      expect(first.output).toContain("…(truncated)");
    }
  });

  it("drops old result/status/thinking messages", () => {
    const msgs: ChatMessage[] = [];
    // Fill with result messages that should be dropped when old
    for (let i = 0; i < PRUNE_THRESHOLD + 100; i++) {
      msgs.push(makeMsg(`r${i}`, "result", {
        cost: 0.01, inputTokens: 100, outputTokens: 50,
        cacheReadTokens: 0, cacheWriteTokens: 0,
        turns: 1, durationMs: 1000, isError: false,
        sessionId: "s1", contextWindow: 200000,
      } as Partial<ChatMessage>));
    }
    const result = pruneMessages(msgs);
    // Old result messages should be dropped, only KEEP_RECENT remain
    expect(result.length).toBe(KEEP_RECENT);
  });

  it("preserves user and assistant messages when old", () => {
    const msgs: ChatMessage[] = [];
    for (let i = 0; i < PRUNE_THRESHOLD + 100; i++) {
      msgs.push(makeMsg(`u${i}`, "user", { text: `msg ${i}` }));
    }
    const result = pruneMessages(msgs);
    // All user messages should be kept
    expect(result.length).toBe(msgs.length);
  });
});
