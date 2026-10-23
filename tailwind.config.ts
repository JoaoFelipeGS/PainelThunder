import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0b0d12",
        panel: "#121620",
        line: "#252b38",
        muted: "#8b95a7",
        accent: "#818cf8"
      },
      boxShadow: {
        soft: "0 12px 36px rgba(0,0,0,.18)"
      }
    }
  },
  plugins: []
};

export default config;
