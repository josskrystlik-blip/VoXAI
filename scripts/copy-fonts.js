/**
 * Copie les polices (OFL) dans vendor/fonts et génère vendor/fonts.css,
 * pour que l'interface s'affiche sans accès à Internet (pas de Google Fonts).
 * Seuls les sous-ensembles latin et latin-ext (accents) sont conservés.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'vendor', 'fonts');
fs.mkdirSync(outDir, { recursive: true });

const fonts = [
  { pkg: '@fontsource-variable/plus-jakarta-sans', family: 'Plus Jakarta Sans', licence: 'OFL-plus-jakarta-sans.txt' },
  { pkg: '@fontsource-variable/jetbrains-mono', family: 'JetBrains Mono', licence: 'OFL-jetbrains-mono.txt' }
];

let css = '/* Généré par scripts/copy-fonts.js — ne pas modifier à la main. Polices sous licence SIL OFL 1.1. */\n';
for (const font of fonts) {
  const dir = path.join(root, 'node_modules', font.pkg);
  const source = fs.readFileSync(path.join(dir, 'wght.css'), 'utf8');
  const blocks = source.match(/@font-face\s*{[^}]*}/g) || [];
  for (const block of blocks) {
    const file = (block.match(/url\(\.\/files\/([^)]+\.woff2)\)/) || [])[1];
    if (!file || !/-latin(-ext)?-wght-normal\.woff2$/.test(file)) continue;
    fs.copyFileSync(path.join(dir, 'files', file), path.join(outDir, file));
    css += block
      .replace(/font-family:\s*'[^']+'/, `font-family: '${font.family}'`)
      .replace(/url\(\.\/files\//g, 'url(./fonts/') + '\n';
  }
  fs.copyFileSync(path.join(dir, 'LICENSE'), path.join(outDir, font.licence));
}
fs.writeFileSync(path.join(root, 'vendor', 'fonts.css'), css);
console.log('Polices copiées dans vendor/fonts');
