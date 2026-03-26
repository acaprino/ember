import type { Block } from "./Block";
import type { TerminalPalette } from "../themes";
import { fg, DIM, RESET, ICON, boxDraw, wordWrap, sanitizeAgentText } from "../AnsiUtils";

export class ToolBlock implements Block {
  readonly type = "tool";
  readonly timestamp = Date.now();
  startLine = 0;
  lineCount = 0;
  frozen = false;
  status: "pending" | "success" | "fail" = "pending";
  output?: string;
  readonly toolUseId?: string;

  constructor(
    public readonly id: string,
    public tool: string,
    public input: unknown,
    toolUseId?: string,
  ) {
    this.toolUseId = toolUseId;
  }

  update(data: { output?: string; success?: boolean }): boolean {
    if (data.output !== undefined) this.output = data.output;
    if (data.success !== undefined) this.status = data.success ? "success" : "fail";
    return true;
  }

  private statusIcon(palette: TerminalPalette): string {
    switch (this.status) {
      case "pending": return `${fg(palette.yellow)}${ICON.pending}${RESET}`;
      case "success": return `${fg(palette.green)}${ICON.success}${RESET}`;
      case "fail": return `${fg(palette.red)}${ICON.fail}${RESET}`;
    }
  }

  private inputPreview(): string {
    if (!this.input) return "";
    const str = typeof this.input === "string" ? this.input : JSON.stringify(this.input);
    const truncated = str.length > 80 ? str.slice(0, 77) + "..." : str;
    return sanitizeAgentText(truncated);
  }

  render(cols: number, palette: TerminalPalette): string {
    const icon = this.statusIcon(palette);
    const title = `${this.tool}`;
    const content: string[] = [];

    const inputStr = this.inputPreview();
    if (inputStr) {
      const wrapped = wordWrap(inputStr, cols - 6);
      for (const line of wrapped) {
        content.push(`${DIM}${line}${RESET}`);
      }
    }

    if (this.output) {
      content.push("");
      const sanitizedOutput = sanitizeAgentText(this.output);
      const outputLines = sanitizedOutput.split("\n").slice(0, 20);
      for (const line of outputLines) {
        const truncated = line.length > cols - 6 ? line.slice(0, cols - 9) + "..." : line;
        content.push(truncated);
      }
      if (this.output.split("\n").length > 20) {
        content.push(`${DIM}... (${this.output.split("\n").length - 20} more lines)${RESET}`);
      }
    }

    const borderColor = this.status === "fail" ? palette.red
      : this.status === "success" ? palette.green
      : palette.textDim;

    const lines = boxDraw(`${title} ${icon}`, content, cols, borderColor, palette);
    return lines.join("\r\n") + "\r\n";
  }
}
