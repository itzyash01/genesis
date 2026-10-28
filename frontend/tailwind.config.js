/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{vue,ts}"],
  theme: {
    extend: {
      colors: {
        ink: "#1c2528",
        paper: "#f7f8f5",
        line: "#e5e9e5",
        accent: "#176a56",
        "accent-soft": "#e5f1ec",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "monospace"],
      },
      boxShadow: {
        panel: "0 20px 60px rgba(25, 44, 39, .08)",
      },
    },
  },
  plugins: [],
};
