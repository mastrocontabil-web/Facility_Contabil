/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Paleta Facility Contábil (quente + slate). As 6 cores da marca caem
        // nos stops "redondos"; os intermediários (50/200/400/900) são derivados
        // pra estados de hover/borda.
        cream: '#F2E6D6',
        ink: '#1E293B',
        brand: {
          50: '#FBF6EF',
          100: '#F2E6D6', // cream
          200: '#E6D4C2',
          300: '#C8A99D', // blush
          400: '#AB9086',
          500: '#8A7D7B', // taupe
          600: '#5C6B66', // sage
          700: '#334155', // slate
          800: '#1E293B', // ink
          900: '#131C2B',
        },
        // Remapeia a escala `slate` do Tailwind pra neutros quentes — os ~180
        // usos de slate-* no app seguem a paleta sem tocar em cada arquivo.
        // 700/800 já batem com as cores da marca; o resto vira tom terroso.
        slate: {
          50: '#F6EFE4',
          100: '#EDE1D0',
          200: '#DED0BE',
          300: '#C9B6A1',
          400: '#8A7D7B',
          500: '#6F625A',
          600: '#544A44',
          700: '#334155',
          800: '#1E293B',
          900: '#131B29',
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};
