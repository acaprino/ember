import { memo, useEffect, useRef } from "react";
import { ProjectInfo } from "../types";
import "./ProjectList.css";

interface ProjectListProps {
  projects: ProjectInfo[];
  selectedIdx: number;
  onSelect: (idx: number) => void;
  onActivate: (project: ProjectInfo) => void;
  loading: boolean;
  launchingIdx?: number;
}

export default memo(function ProjectList({
  projects,
  selectedIdx,
  onSelect,
  onActivate,
  loading,
  launchingIdx,
}: ProjectListProps) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const item = list.children[selectedIdx] as HTMLElement;
    if (item) {
      item.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIdx]);

  if (loading) {
    return (
      <div className="project-list-loading">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="skeleton-row" style={{ opacity: 1 - i * 0.1 }} />
        ))}
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="project-list-empty">
        <div className="empty-icon">&#128269;</div>
        <div className="empty-title">No projects found</div>
        <div className="empty-hint">
          Press <kbd>F7</kbd> to add a directory or <kbd>F5</kbd> to create a project
        </div>
      </div>
    );
  }

  return (
    <div className="project-list" ref={listRef} role="listbox">
      {projects.map((project, idx) => (
        <div
          key={project.path}
          className={`project-item ${idx === selectedIdx ? "selected" : ""} ${idx === launchingIdx ? "launching" : ""}`}
          onClick={() => onSelect(idx)}
          onDoubleClick={() => onActivate(project)}
          role="option"
          aria-selected={idx === selectedIdx}
          tabIndex={idx === selectedIdx ? 0 : -1}
        >
          <div className="project-main">
            <span className="project-name">{project.label ?? project.name}</span>
            {project.hasClaudeMd && <span className="project-badge claude" title="Has CLAUDE.md">MD</span>}
          </div>
          <div className="project-meta">
            {project.branch && (
              <span className={`project-branch ${project.isDirty ? "dirty" : ""}`}>
                {project.branch}
                {project.isDirty ? " *" : ""}
              </span>
            )}
            <span className="project-path">{project.path}</span>
          </div>
        </div>
      ))}
    </div>
  );
});
