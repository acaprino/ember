import skepticalPersonality from "./skeptical-personality.md?raw";
import pragmaticPersonality from "./pragmatic-personality.md?raw";
import contextMemoryHolder from "./context-memory-holder.md?raw";
import concise from "./concise.md?raw";
import safeMode from "./safe-mode.md?raw";
import commitReady from "./commit-ready.md?raw";
import testFirst from "./test-first.md?raw";
import explain from "./explain.md?raw";
import minimalChanges from "./minimal-changes.md?raw";
import securityConscious from "./security-conscious.md?raw";
import claudione from "./claudione.md?raw";

export interface BuiltinPrompt {
  id: string;
  name: string;
  description: string;
  version: string;
  content: string;
}

/** Parse YAML frontmatter (--- delimited) from raw markdown string. */
function parseFrontmatter(raw: string): { meta: Record<string, string>; content: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { meta: {}, content: raw.trim() };
  const meta: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx > 0) {
      const key = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
      meta[key] = val;
    }
  }
  return { meta, content: match[2].trim() };
}

function makePrompt(id: string, raw: string): BuiltinPrompt {
  const { meta, content } = parseFrontmatter(raw);
  return {
    id: `builtin-${id}`,
    name: meta.name ?? id,
    description: meta.description ?? "",
    version: meta.version ?? "1.0.0",
    content,
  };
}

export const BUILTIN_PROMPTS: readonly BuiltinPrompt[] = [
  makePrompt("skeptical-personality", skepticalPersonality),
  makePrompt("pragmatic-personality", pragmaticPersonality),
  makePrompt("context-memory-holder", contextMemoryHolder),
  makePrompt("concise", concise),
  makePrompt("safe-mode", safeMode),
  makePrompt("commit-ready", commitReady),
  makePrompt("test-first", testFirst),
  makePrompt("explain", explain),
  makePrompt("minimal-changes", minimalChanges),
  makePrompt("security-conscious", securityConscious),
  makePrompt("claudione", claudione),
];
