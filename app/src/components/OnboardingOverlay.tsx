import { memo, useState, useCallback } from "react";
import "./OnboardingOverlay.css";

interface Props {
  onDismiss: () => void;
}

const SLIDES = [
  {
    title: "Welcome to Figtree",
    body: "A tabbed interface for launching and managing Claude Code Agent SDK sessions.\nSelect a project, pick your model, and start coding with AI.",
  },
  {
    title: "Keyboard-First",
    body: "Figtree is designed for speed. Key shortcuts:\n\n  Tab      Cycle permission mode\n  F2       Cycle effort level\n  F4       Cycle model\n  Enter    Launch selected project\n  Ctrl+T   New tab\n  Ctrl+F4  Close tab\n  F1       Show all shortcuts",
  },
  {
    title: "Dual View Modes",
    body: "Switch between Terminal (raw output) and Chat (markdown rendering) in Settings.\n\nChat view includes a right sidebar with bookmarks, minimap, todos, thinking history, and agent tree.",
  },
  {
    title: "Ready to go",
    body: "Open Settings with Ctrl+, to choose your theme.\n14 themes available — including retro, cyberpunk, and light modes.\n\nSelect a project and press Enter to start.",
  },
];

export default memo(function OnboardingOverlay({ onDismiss }: Props) {
  const [slide, setSlide] = useState(0);

  const next = useCallback(() => {
    if (slide < SLIDES.length - 1) {
      setSlide((s) => s + 1);
    } else {
      onDismiss();
    }
  }, [slide, onDismiss]);

  const prev = useCallback(() => {
    setSlide((s) => Math.max(0, s - 1));
  }, []);

  const current = SLIDES[slide];

  return (
    <div className="onboarding-overlay" onClick={onDismiss}>
      <div className="onboarding-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="onboarding-slide-count">{slide + 1} / {SLIDES.length}</div>
        <h2 className="onboarding-title">{current.title}</h2>
        <pre className="onboarding-body">{current.body}</pre>
        <div className="onboarding-actions">
          {slide > 0 && (
            <button className="onboarding-btn" onClick={prev}>Back</button>
          )}
          <div className="onboarding-spacer" />
          <button className="onboarding-btn onboarding-btn-skip" onClick={onDismiss}>Skip</button>
          <button className="onboarding-btn onboarding-btn-next" onClick={next}>
            {slide < SLIDES.length - 1 ? "Next" : "Get Started"}
          </button>
        </div>
      </div>
    </div>
  );
});
