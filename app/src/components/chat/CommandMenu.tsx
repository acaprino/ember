import { memo, useState, useEffect, useLayoutEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import type { SlashCommand } from "../../types";

export interface Command {
  name: string;
  description: string;
  argumentHint?: string;
  source: "local" | "skill";
}

const LOCAL_COMMANDS: Command[] = [
  { name: "/clear", description: "Clear chat messages", source: "local" },
  { name: "/compact", description: "Summarize conversation", source: "local" },
  { name: "/sidebar", description: "Toggle right sidebar", source: "local" },
  { name: "/theme", description: "Change theme", source: "local" },
  { name: "/sessions", description: "Browse sessions", source: "local" },
  { name: "/help", description: "Show help", source: "local" },
  { name: "/login", description: "Authenticate with Anthropic", source: "local" },
  { name: "/logout", description: "Remove credentials", source: "local" },
  { name: "/status", description: "Show auth & connection status", source: "local" },
  { name: "/doctor", description: "Diagnose configuration issues", source: "local" },
];

const LOCAL_NAMES = new Set(LOCAL_COMMANDS.map((c) => c.name));

interface Props {
  filter: string;
  sdkCommands?: SlashCommand[];
  onSelect: (command: Command) => void;
  onDismiss: () => void;
}

export default memo(function CommandMenu({ filter, sdkCommands = [], onSelect, onDismiss }: Props) {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({ visibility: "hidden", position: "fixed" });

  const lowerFilter = filter.replace(/^\//, "").toLowerCase();

  const { filteredLocal, filteredSdk, selectableItems } = useMemo(() => {
    const sdkMapped: Command[] = sdkCommands
      .filter((c) => !LOCAL_NAMES.has("/" + c.name))
      .reduce<Command[]>((acc, c) => {
        const name = "/" + c.name;
        if (!acc.some((x) => x.name === name)) {
          acc.push({ name, description: c.description, argumentHint: c.argumentHint || undefined, source: "skill" });
        }
        return acc;
      }, []);
    if (!lowerFilter) return { filteredLocal: LOCAL_COMMANDS, filteredSdk: sdkMapped, selectableItems: [...LOCAL_COMMANDS, ...sdkMapped] };
    const matchAndSort = (list: Command[]) => {
      const matches = list.filter(
        (c) => c.name.toLowerCase().includes(lowerFilter) || c.description.toLowerCase().includes(lowerFilter),
      );
      const starts: Command[] = [];
      const rest: Command[] = [];
      for (const c of matches) {
        (c.name.slice(1).toLowerCase().startsWith(lowerFilter) ? starts : rest).push(c);
      }
      return [...starts, ...rest];
    };
    const local = matchAndSort(LOCAL_COMMANDS);
    const sdk = matchAndSort(sdkMapped);
    return { filteredLocal: local, filteredSdk: sdk, selectableItems: [...local, ...sdk] };
  }, [sdkCommands, lowerFilter]);

  useEffect(() => { setSelectedIdx(0); }, [filter]);

  // Position portal: measure the invisible wrapper placeholder, place menu above it
  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const update = () => {
      const rect = wrapper.getBoundingClientRect();
      const spaceAbove = rect.top - 8;
      const spaceBelow = window.innerHeight - rect.bottom - 8;
      const maxH = Math.max(120, Math.min(Math.max(spaceAbove, spaceBelow), 400));
      if (spaceAbove >= spaceBelow) {
        setStyle({ position: "fixed", bottom: window.innerHeight - rect.top + 2, top: "auto", left: rect.left, right: "auto", width: rect.width, maxHeight: maxH });
      } else {
        setStyle({ position: "fixed", top: rect.bottom + 2, bottom: "auto", left: rect.left, right: "auto", width: rect.width, maxHeight: maxH });
      }
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [selectableItems.length]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(i + 1, selectableItems.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && selectableItems.length > 0) {
        e.preventDefault();
        onSelect(selectableItems[selectedIdx]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onDismiss();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [selectableItems, selectedIdx, onSelect, onDismiss]);

  useEffect(() => {
    const el = listRef.current?.querySelector(".command-item.selected") as HTMLElement | null;
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIdx]);

  if (selectableItems.length === 0) return null;

  const sdkOffset = filteredLocal.length;

  const menu = (
    <div className="command-menu" ref={listRef} style={style} role="listbox" aria-label="Commands">
      {filteredLocal.length > 0 && (
        <>
          <div className="command-section-header">
            <span className="rule" />
            <span>Figtree</span>
            <span className="rule" />
          </div>
          {filteredLocal.map((cmd, i) => (
            <div
              key={cmd.name}
              className={`command-item${i === selectedIdx ? " selected" : ""}`}
              role="option"
              aria-selected={i === selectedIdx}
              onClick={() => onSelect(cmd)}
              onMouseEnter={() => setSelectedIdx(i)}
            >
              <span className="command-item-indicator">&gt;</span>
              <span className="command-name">{cmd.name}</span>
              <span className="command-desc">{cmd.description}</span>
            </div>
          ))}
        </>
      )}
      {filteredSdk.length > 0 && (
        <>
          <div className="command-section-header">
            <span className="rule" />
            <span>Skills</span>
            <span className="rule" />
          </div>
          {filteredSdk.map((cmd, i) => {
            const idx = sdkOffset + i;
            return (
              <div
                key={cmd.name}
                className={`command-item${idx === selectedIdx ? " selected" : ""}`}
                role="option"
                aria-selected={idx === selectedIdx}
                onClick={() => onSelect(cmd)}
                onMouseEnter={() => setSelectedIdx(idx)}
              >
                <span className="command-item-indicator">&gt;</span>
                <span className="command-name">{cmd.name}</span>
                <span className="command-desc">
                  {cmd.description}
                  {cmd.argumentHint && <span className="command-arg-hint"> {cmd.argumentHint}</span>}
                </span>
              </div>
            );
          })}
        </>
      )}
    </div>
  );

  // Render an invisible placeholder in-flow + the actual menu in a body portal
  return (
    <>
      <div ref={wrapperRef} style={{ height: 0, overflow: "hidden" }} />
      {createPortal(menu, document.body)}
    </>
  );
});
