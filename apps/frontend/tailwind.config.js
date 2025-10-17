/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        ipl: {
          purple: '#6C3483',
          gold: '#F4B400',
        },
      },
    },
  },
  plugins: [],
};
