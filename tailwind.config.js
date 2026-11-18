/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // High-density CAD/BIM workspace palette
        ws: {
          950: "#0d0f12",
          900: "#14171c",
          850: "#191d23",
          800: "#1f242b",
          700: "#2a3039",
          600: "#3a414c",
          500: "#59616e",
          400: "#7d8592",
          300: "#a3aab5",
          200: "#c6cbd3",
          100: "#e4e7ec",
        },
        accent: { DEFAULT: "#3b9eff", dim: "#1f5e99" },
        cmd: { prompt: "#8fd16a", input: "#f5f7fa", error: "#ff6b6b", kw: "#ffcc66" },
      },
      fontFamily: {
        ui: ["Inter", "Segoe UI", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "Cascadia Mono", "Consolas", "ui-monospace", "monospace"],
      },
      fontSize: { "2xs": ["10px", "14px"], xs: ["11px", "15px"], sm: ["12px", "16px"] },
    },
  },
  plugins: [],
};
