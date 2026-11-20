/**
 * Configuration Tailwind : réglages par défaut du CDN v3, en analysant tous les fichiers de l'interface.
 *
 * Thème clair / sombre : les couleurs utilisées par l'interface passent par des variables CSS
 * (générées ci-dessous à partir de la palette officielle). Le thème sombre est la palette
 * d'origine ; le thème clair ([data-theme="light"] sur <html>) inverse l'échelle des gris
 * (fonds sombres → clairs, textes clairs → foncés) et fonce les teintes claires des couleurs
 * d'accent pour qu'elles restent lisibles sur fond blanc. Le balisage n'a pas à changer.
 */
const defaultTheme = require('tailwindcss/defaultTheme');
const palette = require('tailwindcss/colors');
const plugin = require('tailwindcss/plugin');

const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const NEUTRALS = ['slate'];
const ACCENTS = ['indigo', 'purple', 'violet', 'fuchsia', 'pink', 'rose', 'red', 'orange', 'amber', 'yellow', 'emerald', 'green', 'teal', 'cyan', 'sky', 'blue'];

// Thème clair : échelle des gris inversée…
const NEUTRAL_LIGHT = { 50: 950, 100: 900, 200: 800, 300: 700, 400: 600, 500: 500, 600: 400, 700: 300, 800: 200, 900: 100, 950: 50 };
// …et teintes d'accent claires (texte sur fond sombre) foncées, teintes très sombres (fonds teintés) éclaircies.
const ACCENT_LIGHT = { 50: 50, 100: 800, 200: 800, 300: 700, 400: 600, 500: 500, 600: 600, 700: 700, 800: 200, 900: 100, 950: 50 };

const rgb = (hex) => {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join(''); // #fff → #ffffff
  const n = parseInt(h, 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
};
const ref = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;

const colors = { white: ref('white') };
const darkVars = { '--c-white': rgb(palette.white) };
const lightVars = { '--c-white': rgb(palette.slate[900]) };

for (const name of [...NEUTRALS, ...ACCENTS]) {
  const map = NEUTRALS.includes(name) ? NEUTRAL_LIGHT : ACCENT_LIGHT;
  colors[name] = {};
  for (const shade of SHADES) {
    colors[name][shade] = ref(`${name}-${shade}`);
    darkVars[`--c-${name}-${shade}`] = rgb(palette[name][shade]);
    lightVars[`--c-${name}-${shade}`] = rgb(palette[name][map[shade]]);
  }
}

module.exports = {
  content: ['./index.html', './app.js', './confluence.js', './live.js', './db.js', './series.js'],
  theme: {
    extend: {
      colors,
      // Polices servies localement (vendor/fonts.css)
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', ...defaultTheme.fontFamily.sans],
        mono: ['"JetBrains Mono"', ...defaultTheme.fontFamily.mono]
      }
    }
  },
  plugins: [
    plugin(({ addBase }) => {
      addBase({
        ':root': darkVars,
        ':root[data-theme="light"]': lightVars
      });
    })
  ]
};
