import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        deck: {
          bg: "#0a0a0b",
          surface: "#141416",
          border: "#27272a",
          muted: "#71717a",
          accent: "#3b82f6",
        },
      },
    },
  },
  plugins: [],
};

export default config;
