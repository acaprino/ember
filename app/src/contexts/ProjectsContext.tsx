import { createContext, useContext, useMemo, ReactNode } from "react";
import { useProjects } from "../hooks/useProjects";

type ProjectsContextValue = ReturnType<typeof useProjects>;

const ProjectsContext = createContext<ProjectsContextValue | null>(null);

export function ProjectsProvider({ children }: { children: ReactNode }) {
  const projectsData = useProjects();

  // R2: Memoize context value to prevent broadcasting on every render.
  // Only re-creates the value object when one of the constituent values changes.
  const value = useMemo(
    () => projectsData,
    [
      projectsData.settings,
      projectsData.projects,
      projectsData.loading,
      projectsData.error,
      projectsData.filter,
      projectsData.setFilter,
      projectsData.updateSettings,
      projectsData.refresh,
      projectsData.recordUsage,
      projectsData.retry,
    ],
  );

  return (
    <ProjectsContext.Provider value={value}>
      {children}
    </ProjectsContext.Provider>
  );
}

export function useProjectsContext(): ProjectsContextValue {
  const ctx = useContext(ProjectsContext);
  if (!ctx) throw new Error("useProjectsContext must be used within ProjectsProvider");
  return ctx;
}
