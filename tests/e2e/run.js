/**
 * VoxAI — lance les tests de bout en bout (un fichier après l'autre) et affiche le bilan.
 *
 * Lancement : node tests/e2e/run.js            (tous les fichiers)
 *             node tests/e2e/run.js series     (fichiers dont le nom contient « series »)
 */
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const filter = process.argv[2] || '';
const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js') && f.includes(filter)).sort();
const summary = [];
for (const file of files) {
  const t0 = Date.now();
  const res = spawnSync(process.execPath, [path.join(__dirname, file)], { stdio: 'inherit' });
  summary.push({ file, ok: res.status === 0, s: Math.round((Date.now() - t0) / 1000) });
  console.log('');
}
console.log('Bilan des tests de bout en bout');
for (const r of summary) console.log(`  ${r.ok ? '✓' : '✗'} ${r.file} (${r.s} s)`);
const failed = summary.filter(r => !r.ok).length;
console.log(failed ? `\n${failed} fichier(s) en échec` : `\nTous les fichiers réussis (${summary.length})`);
process.exit(failed || !files.length ? 1 : 0);
