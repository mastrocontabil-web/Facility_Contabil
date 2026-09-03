/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef5ff',
          100: '#d9e8ff',
          200: '#bcd7ff',
          300: '#8ebdff',
          400: '#5998ff',
          500: '#356ff6',
          600: '#1f50eb',
          700: '#193dd4',
          800: '#1a34ab',
          900: '#1b3187',
        },
      },
    },
  },
  plugins: [],
};
