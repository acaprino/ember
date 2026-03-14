import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ProjectInfo, Settings, UsageData, SORT_ORDERS } from "../types";
import { applyTheme } from "../themes";
import { BUILTIN_PROMPTS } from "../prompts";

function scanProjects(s: Settings): Promise<ProjectInfo[]> {
  return invoke<ProjectInfo[]>("scan_projects", {
    projectDirs: s.project_dirs,
    singleProjectDirs: s.single_project_dirs,
    labels: s.project_labels,
  });
}

export function useProjects() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [usage, setUsage] = useState<UsageData>({});
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);

  // R9: Ref for settings so updateSettings callback is stable
  const settingsRef = useRef(settings);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  const load = useCallback(async () => {
    try {
      const [s, u] = await Promise.all([
        invoke<Settings>("load_settings"),
        invoke<UsageData>("load_usage"),
      ]);
      // Seed example prompts on first run (empty list, never seeded)
      if (s.system_prompts.length === 0 && !s.prompts_seeded) {
        s.system_prompts = BUILTIN_PROMPTS.map((bp) => ({
          id: bp.id,
          name: bp.name,
          description: bp.description,
          content: bp.content,
        }));
        if (!(s.active_prompt_ids ?? []).includes("builtin-claudione")) {
          s.active_prompt_ids = [...(s.active_prompt_ids ?? []), "builtin-claudione"];
        }
        s.prompts_seeded = true;
        (s as any).claudione_migrated = true;
        invoke("save_settings", { settings: s }).catch(console.error);
      }
      // One-time migration: activate claudione for existing users who already
      // seeded but haven't had this migration yet. Runs once, then sets a flag
      // so users who later deactivate it are respected.
      if (
        s.prompts_seeded &&
        !(s as any).claudione_migrated &&
        s.system_prompts.some((p) => p.id === "builtin-claudione") &&
        !(s.active_prompt_ids ?? []).includes("builtin-claudione")
      ) {
        s.active_prompt_ids = [...(s.active_prompt_ids ?? []), "builtin-claudione"];
        (s as any).claudione_migrated = true;
        invoke("save_settings", { settings: s }).catch(console.error);
      }
      setSettings(s);
      setUsage(u);

      const projs = await scanProjects(s);
      setProjects(projs);
    } catch (err) {
      console.error("Failed to load projects:", err);
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Auto-refresh when filesystem changes are detected in project directories
  useEffect(() => {
    const unlisten = listen("projects-changed", () => {
      const s = settingsRef.current;
      if (!s) return;
      scanProjects(s).then(setProjects).catch(console.error);
    });
    return () => { unlisten.then((f) => f()); };
  }, []);

  // Apply theme whenever theme_idx changes
  const themeIdx = settings?.theme_idx ?? 0;
  useEffect(() => {
    applyTheme(themeIdx);
  }, [themeIdx]);

  const retry = useCallback(() => {
    setError(null);
    setLoading(true);
    load();
  }, [load]);

  // R9: Stable callback using ref — no longer recreated on every settings change
  const updateSettings = useCallback(
    async (updates: Partial<Settings>) => {
      const current = settingsRef.current;
      if (!current) return;
      const newSettings = { ...current, ...updates };
      setSettings(newSettings);
      try {
        await invoke("save_settings", { settings: newSettings });
        // Rescan projects if dirs or labels changed
        if (updates.project_dirs || updates.single_project_dirs || updates.project_labels) {
          setLoading(true);
          const projs = await scanProjects(newSettings);
          setProjects(projs);
          setLoading(false);
        }
      } catch (err) {
        console.error("Failed to save settings:", err);
        setSettings(current);
      }
    },
    [],
  );

  // R4: Only depend on sort_idx, not the entire settings object
  const sortIdx = settings?.sort_idx ?? 0;

  const filteredProjects = useMemo(() => {
    if (!settingsRef.current) return [];

    let list = projects;

    if (filter) {
      const lower = filter.toLowerCase();
      list = list.filter((p) => {
        const name = (p.label ?? p.name).toLowerCase();
        return name.includes(lower);
      });
    }

    const sortOrder = SORT_ORDERS[sortIdx] ?? "alpha";
    if (sortOrder === "alpha") {
      list = [...list].sort((a, b) =>
        (a.label ?? a.name).localeCompare(b.label ?? b.name),
      );
    } else if (sortOrder === "last used") {
      list = [...list].sort((a, b) => {
        const aUsage = usage[a.path]?.last_used ?? 0;
        const bUsage = usage[b.path]?.last_used ?? 0;
        return bUsage - aUsage;
      });
    } else if (sortOrder === "most used") {
      const HALF_LIFE = 30 * 24 * 3600;
      const now = Date.now() / 1000;
      list = [...list].sort((a, b) => {
        const aEntry = usage[a.path];
        const bEntry = usage[b.path];
        const aWeight = aEntry
          ? aEntry.count * Math.pow(0.5, (now - aEntry.last_used) / HALF_LIFE)
          : 0;
        const bWeight = bEntry
          ? bEntry.count * Math.pow(0.5, (now - bEntry.last_used) / HALF_LIFE)
          : 0;
        return bWeight - aWeight;
      });
    }

    return list;
    // Note: `settings` is in deps only for the null guard on initial load.
    // The sort logic only uses `sortIdx` which is extracted above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, filter, sortIdx, usage]);

  const refresh = useCallback(async () => {
    const s = settingsRef.current;
    if (!s) return;
    setLoading(true);
    const projs = await scanProjects(s);
    setProjects(projs);
    setLoading(false);
  }, []);

  const recordUsage = useCallback(async (projectPath: string) => {
    await invoke("record_usage", { projectPath });
    const u = await invoke<UsageData>("load_usage");
    setUsage(u);
  }, []);

  return {
    settings,
    projects: filteredProjects,
    loading,
    error,
    filter,
    setFilter,
    updateSettings,
    refresh,
    recordUsage,
    retry,
  };
}
