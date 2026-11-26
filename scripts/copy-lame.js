/**
 * Copie l'encodeur MP3 LAME (lamejs, licence LGPL-3.0) dans vendor/lame, pour encoder les
 * enregistrements en MP3 dans le navigateur, sans accès à Internet (pas de CDN).
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = path.join(root, 'node_modules', '@breezystack', 'lamejs');
const outDir = path.join(root, 'vendor', 'lame');
fs.mkdirSync(outDir, { recursive: true });
fs.copyFileSync(path.join(pkg, 'dist', 'lamejs.iife.js'), path.join(outDir, 'lamejs.iife.js'));
fs.copyFileSync(path.join(pkg, 'LICENSE'), path.join(outDir, 'LICENSE-lamejs.txt'));
console.log('Encodeur MP3 copié dans vendor/lame');
