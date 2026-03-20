import { describe, it, expect } from "vitest";
import type { ChatMessage } from "../types";

// Test the displayItems grouping logic extracted from useSessionController
// This is a pure function we can test directly

type ToolGroupItem = { role: "tool-group"; id: string; timestamp: number; tools: Extract<ChatMessage, { role: "tool" }>[] };
type DisplayItem = ChatMessage | ToolGroupItem;

function groupDisplayItems(messages: ChatMessage[]): DisplayItem[] {
  const result: DisplayItem[] = [];
  let toolRun: Extract<ChatMessage, { role: "tool" }>[] = [];
  const flush = () => {
    if (toolRun.length === 1) result.push(toolRun[0]);
    else if (toolRun.length > 1) result.push({ role: "tool-group", id: toolRun[0].id, timestamp: toolRun[0].timestamp, tools: toolRun });
    toolRun = [];
  };
  for (const msg of messages) {
    if (msg.role === "tool") {
      toolRun.push(msg);
    } else {
      flush();
      result.push(msg);
    }
  }
  flush();
  return result;
}

describe("groupDisplayItems", () => {
  it("returns empty array for empty messages", () => {
    expect(groupDisplayItems([])).toEqual([]);
  });

  it("passes through non-tool messages unchanged", () => {
    const msgs: ChatMessage[] = [
      { id: "1", role: "user", text: "hi", timestamp: 1 },
      { id: "2", role: "assistant", text: "hello", streaming: false, timestamp: 2 },
    ];
    const result = groupDisplayItems(msgs);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(msgs[0]);
    expect(result[1]).toBe(msgs[1]);
  });

  it("keeps a single tool message as-is (not grouped)", () => {
    const msgs: ChatMessage[] = [
      { id: "1", role: "user", text: "do it", timestamp: 1 },
      { id: "2", role: "tool", tool: "Bash", input: {}, timestamp: 2 },
      { id: "3", role: "assistant", text: "done", streaming: false, timestamp: 3 },
    ];
    const result = groupDisplayItems(msgs);
    expect(result).toHaveLength(3);
    expect(result[1]).toEqual(msgs[1]);
  });

  it("groups consecutive tool messages into a tool-group", () => {
    const msgs: ChatMessage[] = [
      { id: "1", role: "user", text: "do it", timestamp: 1 },
      { id: "t1", role: "tool", tool: "Read", input: {}, timestamp: 2 },
      { id: "t2", role: "tool", tool: "Edit", input: {}, timestamp: 3 },
      { id: "t3", role: "tool", tool: "Write", input: {}, timestamp: 4 },
      { id: "2", role: "assistant", text: "done", streaming: false, timestamp: 5 },
    ];
    const result = groupDisplayItems(msgs);
    expect(result).toHaveLength(3); // user, tool-group, assistant
    expect(result[1].role).toBe("tool-group");
    if (result[1].role === "tool-group") {
      expect(result[1].tools).toHaveLength(3);
      expect(result[1].id).toBe("t1");
    }
  });

  it("handles trailing tool messages", () => {
    const msgs: ChatMessage[] = [
      { id: "t1", role: "tool", tool: "Bash", input: {}, timestamp: 1 },
      { id: "t2", role: "tool", tool: "Read", input: {}, timestamp: 2 },
    ];
    const result = groupDisplayItems(msgs);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("tool-group");
  });

  it("creates separate groups for non-consecutive tool runs", () => {
    const msgs: ChatMessage[] = [
      { id: "t1", role: "tool", tool: "Bash", input: {}, timestamp: 1 },
      { id: "t2", role: "tool", tool: "Read", input: {}, timestamp: 2 },
      { id: "a1", role: "assistant", text: "ok", streaming: false, timestamp: 3 },
      { id: "t3", role: "tool", tool: "Write", input: {}, timestamp: 4 },
      { id: "t4", role: "tool", tool: "Edit", input: {}, timestamp: 5 },
    ];
    const result = groupDisplayItems(msgs);
    expect(result).toHaveLength(3); // group1, assistant, group2
    expect(result[0].role).toBe("tool-group");
    expect(result[2].role).toBe("tool-group");
  });
});
