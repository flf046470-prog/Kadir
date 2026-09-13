import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#171123",
        bloom: {
          50: "#fff5f7",
          100: "#ffe4ea",
          200: "#ffc2d1",
          300: "#ff9bb3",
          400: "#fb6f92",
          500: "#e8446b",
          600: "#c62f54",
          700: "#9e2344",
          800: "#731a34",
          900: "#4a1122"
        },
        dusk: {
          50: "#f4f2ff",
          100: "#e6e0ff",
          200: "#c9bdff",
          300: "#a68cff",
          400: "#8360f5",
          500: "#6a41e0",
          600: "#5330b8",
          700: "#3f2590",
          800: "#2c1968",
          900: "#1a0f42"
        }
      },
      fontFamily: {
        display: ["var(--font-fraunces)", "Georgia", "serif"],
        sans: ["var(--font-inter)", "system-ui", "sans-serif"]
      },
      backgroundImage: {
        aurora:
          "radial-gradient(circle at 15% 20%, rgba(251,111,146,0.35), transparent 40%), radial-gradient(circle at 85% 0%, rgba(131,96,245,0.35), transparent 45%), radial-gradient(circle at 50% 100%, rgba(230,224,255,0.6), transparent 55%)"
      }
    }
  },
  plugins: []
};

export default config;
