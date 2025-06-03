import daisyui from 'daisyui';

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [
    daisyui,
  ],
  // Optional: DaisyUI configuration (e.g., themes)
  daisyui: {
    themes: ["light", "dark", "cupcake", "wireframe", "black"], 
  },
}