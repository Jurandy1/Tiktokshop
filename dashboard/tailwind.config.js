/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        tiktok: {
          bg: '#000000',
          card: '#121214',
          border: '#2A2A32',
          hover: '#18181B',
          cyan: '#25F4EE',
          pink: '#FE2C55',
          muted: '#A1A1AA',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
