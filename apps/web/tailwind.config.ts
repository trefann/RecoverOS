import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Black / blue / white, deliberately: no red/orange/green anywhere.
        // Severity is conveyed by shade (deep blue = urgent, mid blue =
        // moderate, gray = neutral) and "recovered" gets white — the one
        // color in this palette that reads as "done/clean" rather than
        // "active" — so the two accent colors both carry real meaning.
        surface: {
          DEFAULT: "#000000",
          panel: "#0a0d14",
          raised: "#12161f",
          border: "#1e2530",
        },
        ink: {
          DEFAULT: "#f5f7fa",
          muted: "#8890a0",
          faint: "#555d6e",
        },
        signal: {
          risk: "#2563eb",
          recoverable: "#3b82f6",
          recovered: "#ffffff",
          ai: "#0a84ff",
        },
      },
      fontFamily: {
        sans: ["-apple-system", "BlinkMacSystemFont", "Segoe UI", "Inter", "sans-serif"],
        mono: ["SFMono-Regular", "ui-monospace", "Menlo", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
