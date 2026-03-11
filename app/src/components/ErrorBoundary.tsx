import { Component, ReactNode } from "react";

interface ErrorBoundaryProps {
  tabId: string;
  onClose: (tabId: string) => void;
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("Terminal crashed:", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          gap: "12px",
          color: "var(--text, #cdd6f4)",
          fontFamily: "'Cascadia Code', 'Consolas', monospace",
          padding: "24px",
        }}>
          <div style={{ fontSize: "16px", fontWeight: "bold" }}>
            Terminal failed to initialize
          </div>
          <div style={{
            fontSize: "12px",
            color: "var(--subtext, #a6adc8)",
            maxWidth: "500px",
            textAlign: "center",
            wordBreak: "break-word",
          }}>
            {this.state.error?.message ?? "An unexpected error occurred."}
          </div>
          <button
            onClick={() => this.props.onClose(this.props.tabId)}
            style={{
              marginTop: "8px",
              padding: "6px 16px",
              background: "var(--surface, #313244)",
              border: "1px solid var(--accent, #cba6f7)",
              borderRadius: "4px",
              color: "var(--text, #cdd6f4)",
              cursor: "pointer",
              fontSize: "13px",
              fontFamily: "inherit",
            }}
          >
            Close Tab
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
