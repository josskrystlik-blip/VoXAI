/** Configuration Tailwind : réglages par défaut du CDN v3, en analysant tous les fichiers de l'interface. */
const defaultTheme = require('tailwindcss/defaultTheme');

module.exports = {
  content: ['./index.html', './app.js', './confluence.js', './live.js', './db.js'],
  theme: {
    extend: {
      // Polices servies localement (vendor/fonts.css)
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', ...defaultTheme.fontFamily.sans],
        mono: ['"JetBrains Mono"', ...defaultTheme.fontFamily.mono]
      }
    }
  },
  plugins: []
};
