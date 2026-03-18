import { memo, useMemo, useState } from "react";
import { Collapsible } from "radix-ui";
import DiffView from "./DiffView";

interface Props {
  tool: string;
  input: unknown;
  output?: string;
  success?: boolean;
}

export default memo(function ToolCard({ tool, input, output, success }: Props) {
  const [expanded, setExpanded] = useState(false);
  const inputStr = useMemo(
    () => typeof input === "string" ? input : JSON.stringify(input, null, 2),
    [input],
  );
  const truncatedInput = inputStr.length > 300 ? inputStr.slice(0, 300) + "..." : inputStr;
  const isDiffTool = tool === "Edit" || tool === "Write";
  const pending = success === undefined;

  return (
    <Collapsible.Root className={`tool-card${success === false ? " failed" : ""}`} open={expanded} onOpenChange={setExpanded}>
      <Collapsible.Trigger className="tool-card-header">
        <span className="tool-card-icon">$</span>
        <span className="tool-card-name">{tool}</span>
        {!expanded && <span className="tool-card-preview">{truncatedInput.split("\n")[0].slice(0, 60)}</span>}
        <span className={`tool-card-status${pending ? " pending" : success ? " ok" : " fail"}`}>
          {pending ? "\u25CB" : success ? "\u2713" : "\u2717"}
        </span>
        <span className="tool-card-toggle">{expanded ? "\u25BE" : "\u25B8"}</span>
      </Collapsible.Trigger>
      <Collapsible.Content>
        <div className="tool-card-body">
          {isDiffTool
            ? <DiffView tool={tool as "Edit" | "Write"} input={input as any} />
            : <pre className="tool-card-input">{inputStr}</pre>
          }
          {output && (
            <div className="tool-card-output">
              <span className="tool-result-prefix">{"\u23BF"}</span>
              <pre>{output}</pre>
            </div>
          )}
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  );
});
