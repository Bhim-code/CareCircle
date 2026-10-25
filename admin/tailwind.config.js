/** Rebuild the CSS after changing classes in index.html or app.js:  npm run build:css */
module.exports = {
  content: ['./index.html', './app.js'],
  theme: {
    extend: {
      fontFamily: { sans: ['"Atkinson Hyperlegible"', 'system-ui', 'sans-serif'] },
      colors: {
        paper: '#F6F7F9', ink: '#1C2433', muted: '#5A6377', rule: '#E1E4EA',
        sage: { DEFAULT: '#2E6A5C', dark: '#22524A', soft: '#E6F0ED' },
        taken: '#2F7D4F', due: '#9A5A00', missed: '#B0242D', upcoming: '#56637D',
      },
    },
  },
};
