import { memo, useMemo } from "react";
import "./DiffView.css";

interface EditInput {
  file_path: string;
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}

interface WriteInput {
  file_path: string;
  content: string;
}

interface Props {
  tool: "Edit" | "Write";
  input: EditInput | WriteInput;
}

/** Build unified-diff lines from Edit or Write input. */
function buildDiffLines(tool: string, input: EditInput | WriteInput): string[] {
  const lines: string[] = [];
  const filePath = input.file_path;

  if (tool === "Edit") {
    const { old_string, new_string } = input as EditInput;
    lines.push(`--- a/${filePath}`);
    lines.push(`+++ b/${filePath}`);
    lines.push("@@ @@");
    for (const line of old_string.split("\n")) {
      lines.push(`-${line}`);
    }
    for (const line of new_string.split("\n")) {
      lines.push(`+${line}`);
    }
  } else {
    // Write = new file
    lines.push(`--- /dev/null`);
    lines.push(`+++ b/${filePath}`);
    lines.push("@@ @@");
    for (const line of (input as WriteInput).content.split("\n")) {
      lines.push(`+${line}`);
    }
  }
  return lines;
}

export default memo(function DiffView({ tool, input }: Props) {
  const diffLines = useMemo(() => buildDiffLines(tool, input), [tool, input]);

  return (
    <div className="diff-view">
      <div className="diff-header">{input.file_path}</div>
      <pre className="diff-body">
        {diffLines.map((line, i) => {
          const type = line.startsWith("+++") || line.startsWith("---") ? "meta"
            : line.startsWith("@@") ? "hunk"
            : line.startsWith("+") ? "add"
            : line.startsWith("-") ? "del"
            : "ctx";
          return (
            <div key={i} className={`diff-line diff-${type}`}>
              <span className="diff-gutter">
                {type === "add" ? "+" : type === "del" ? "-" : " "}
              </span>
              <span className="diff-text">{type === "add" || type === "del" ? line.slice(1) : line}</span>
            </div>
          );
        })}
      </pre>
    </div>
  );
});
