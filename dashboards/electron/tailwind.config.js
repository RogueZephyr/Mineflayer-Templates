// dashboards/electron/tailwind.config.js
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './renderer/index.html',
    './renderer/src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        gray: {
          750: '#2d3748',
        },
      },
    },
  },
  plugins: [],
};
