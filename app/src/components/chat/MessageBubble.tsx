import { memo, useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PrismLight as SyntaxHighlighter } from "react-syntax-highlighter";
import langBash from "react-syntax-highlighter/dist/esm/languages/prism/bash";
import langCss from "react-syntax-highlighter/dist/esm/languages/prism/css";
import langDiff from "react-syntax-highlighter/dist/esm/languages/prism/diff";
import langGo from "react-syntax-highlighter/dist/esm/languages/prism/go";
import langGraphql from "react-syntax-highlighter/dist/esm/languages/prism/graphql";
import langJava from "react-syntax-highlighter/dist/esm/languages/prism/java";
import langJavascript from "react-syntax-highlighter/dist/esm/languages/prism/javascript";
import langJson from "react-syntax-highlighter/dist/esm/languages/prism/json";
import langJsx from "react-syntax-highlighter/dist/esm/languages/prism/jsx";
import langKotlin from "react-syntax-highlighter/dist/esm/languages/prism/kotlin";
import langLua from "react-syntax-highlighter/dist/esm/languages/prism/lua";
import langMarkdown from "react-syntax-highlighter/dist/esm/languages/prism/markdown";
import langPowershell from "react-syntax-highlighter/dist/esm/languages/prism/powershell";
import langPython from "react-syntax-highlighter/dist/esm/languages/prism/python";
import langRuby from "react-syntax-highlighter/dist/esm/languages/prism/ruby";
import langRust from "react-syntax-highlighter/dist/esm/languages/prism/rust";
import langSql from "react-syntax-highlighter/dist/esm/languages/prism/sql";
import langToml from "react-syntax-highlighter/dist/esm/languages/prism/toml";
import langTsx from "react-syntax-highlighter/dist/esm/languages/prism/tsx";
import langTypescript from "react-syntax-highlighter/dist/esm/languages/prism/typescript";
import langYaml from "react-syntax-highlighter/dist/esm/languages/prism/yaml";

SyntaxHighlighter.registerLanguage("bash", langBash);
SyntaxHighlighter.registerLanguage("shell", langBash);
SyntaxHighlighter.registerLanguage("sh", langBash);
SyntaxHighlighter.registerLanguage("css", langCss);
SyntaxHighlighter.registerLanguage("diff", langDiff);
SyntaxHighlighter.registerLanguage("go", langGo);
SyntaxHighlighter.registerLanguage("graphql", langGraphql);
SyntaxHighlighter.registerLanguage("java", langJava);
SyntaxHighlighter.registerLanguage("javascript", langJavascript);
SyntaxHighlighter.registerLanguage("js", langJavascript);
SyntaxHighlighter.registerLanguage("json", langJson);
SyntaxHighlighter.registerLanguage("jsx", langJsx);
SyntaxHighlighter.registerLanguage("kotlin", langKotlin);
SyntaxHighlighter.registerLanguage("lua", langLua);
SyntaxHighlighter.registerLanguage("markdown", langMarkdown);
SyntaxHighlighter.registerLanguage("md", langMarkdown);
SyntaxHighlighter.registerLanguage("powershell", langPowershell);
SyntaxHighlighter.registerLanguage("python", langPython);
SyntaxHighlighter.registerLanguage("py", langPython);
SyntaxHighlighter.registerLanguage("ruby", langRuby);
SyntaxHighlighter.registerLanguage("rust", langRust);
SyntaxHighlighter.registerLanguage("rs", langRust);
SyntaxHighlighter.registerLanguage("sql", langSql);
SyntaxHighlighter.registerLanguage("toml", langToml);
SyntaxHighlighter.registerLanguage("tsx", langTsx);
SyntaxHighlighter.registerLanguage("typescript", langTypescript);
SyntaxHighlighter.registerLanguage("ts", langTypescript);
SyntaxHighlighter.registerLanguage("yaml", langYaml);
SyntaxHighlighter.registerLanguage("yml", langYaml);

/** Build a syntax theme from CSS custom properties (read at render time). */
function getAnvilTheme(): Record<string, React.CSSProperties> {
  const s = getComputedStyle(document.documentElement);
  const v = (name: string) => s.getPropertyValue(name).trim();
  return {
    'pre[class*="language-"]': { background: v("--crust"), margin: 0, padding: 0 },
    'code[class*="language-"]': { color: v("--text"), background: "none" },
    comment: { color: v("--overlay0") },
    prolog: { color: v("--overlay0") },
    keyword: { color: v("--accent") },
    "attr-name": { color: v("--accent") },
    selector: { color: v("--accent") },
    builtin: { color: v("--accent") },
    operator: { color: v("--text-dim") },
    string: { color: v("--green") },
    "attr-value": { color: v("--green") },
    char: { color: v("--green") },
    number: { color: v("--yellow") },
    boolean: { color: v("--yellow") },
    constant: { color: v("--yellow") },
    function: { color: v("--accent") },
    "class-name": { color: v("--yellow") },
    punctuation: { color: v("--text-dim") },
    tag: { color: v("--red") },
    deleted: { color: v("--red") },
    inserted: { color: v("--green") },
  };
}

let cachedTheme: Record<string, React.CSSProperties> | null = null;
function anvilTheme(): Record<string, React.CSSProperties> {
  if (!cachedTheme) cachedTheme = getAnvilTheme();
  return cachedTheme;
}
// Invalidate on theme change (CSS variable mutation) — debounced via rAF to coalesce multiple style changes
let invalidationScheduled = false;
const observer = typeof MutationObserver !== "undefined"
  ? new MutationObserver(() => {
      if (!invalidationScheduled) {
        invalidationScheduled = true;
        requestAnimationFrame(() => { cachedTheme = null; invalidationScheduled = false; });
      }
    })
  : null;
observer?.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });

interface Props {
  text: string;
  /** Controls streaming cursor CSS animation only */
  streaming?: boolean;
}

/** Safe link component — blocks javascript:, data:, vbscript: URLs */
const SafeLink = ({ href, children }: { href?: string; children?: React.ReactNode }) => {
  const safe = href && /^https?:\/\/|^#|^mailto:/i.test(href);
  return safe
    ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
    : <span>{children}</span>;
};

/** Code block with syntax highlighting + copy button */
const CodeBlock = ({ className, children }: { className?: string; children?: React.ReactNode }) => {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timerRef.current), []);

  const match = /language-(\w+)/.exec(className || "");
  const code = String(children).replace(/\n$/, "");
  const lineCount = code.split("\n").length;

  if (!match) {
    // Inline code
    return <code className={className}>{children}</code>;
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="code-block-wrapper">
      <div className="code-block-header">
        <span className="code-block-lang">{match[1]}</span>
        <button className="code-block-copy" onClick={handleCopy}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <SyntaxHighlighter
        language={match[1]}
        style={anvilTheme()}
        showLineNumbers={lineCount > 5}
        customStyle={{
          margin: 0,
          padding: "var(--space-2) var(--space-3)",
          borderRadius: "0 0 var(--radius-sm) var(--radius-sm)",
          fontSize: "var(--text-sm)",
        }}
        lineNumberStyle={{ minWidth: "2.5em" }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
};

const MD_PLUGINS = [remarkGfm];
const MD_COMPONENTS = { a: SafeLink, code: CodeBlock as never };

export default memo(function MessageBubble({ text, streaming }: Props) {
  return (
    <div className={`msg-bubble${streaming ? " streaming" : ""}`}>
      {streaming ? (
        // Raw text during streaming — avoids O(n^2) markdown re-parsing per chunk
        <span style={{ whiteSpace: "pre-wrap" }}>{text}</span>
      ) : (
        <ReactMarkdown remarkPlugins={MD_PLUGINS} components={MD_COMPONENTS}>
          {text}
        </ReactMarkdown>
      )}
    </div>
  );
});
