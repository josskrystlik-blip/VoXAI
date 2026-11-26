/**
 * VoxAI - Encodeur MP3 (Web Worker, hors du fil de l'interface).
 * Son mono reçu par paquets, rééchantillonné (moyenne sur la fenêtre : filtre passe-bas simple),
 * encodé en MP3 par LAME (vendor/lame, licence LGPL). Un enregistrement d'une heure tient en
 * quelques dizaines de Mo, sans jamais garder tout le son non compressé en mémoire.
 *
 * Messages reçus : { type: 'init', inRate, outRate, kbps } ; { type: 'pcm', data: Float32Array } ;
 * { type: 'end' }. Messages envoyés : { type: 'done', blob } ou { type: 'error', message }.
 */
/* global lamejs */
importScripts('vendor/lame/lamejs.iife.js');

let encoder = null;
let ratio = 1;
let carry = new Float32Array(0);
let pos = 0;
const chunks = [];

function resample(input) {
  if (ratio === 1) return input;
  const buf = new Float32Array(carry.length + input.length);
  buf.set(carry);
  buf.set(input, carry.length);
  const out = new Float32Array(Math.ceil(buf.length / ratio) + 1);
  let n = 0;
  while (pos + ratio <= buf.length) {
    const start = Math.floor(pos), end = Math.floor(pos + ratio);
    let sum = 0;
    for (let i = start; i < end; i++) sum += buf[i];
    out[n++] = sum / Math.max(1, end - start);
    pos += ratio;
  }
  const keep = Math.floor(pos);
  carry = buf.slice(keep);
  pos -= keep;
  return out.subarray(0, n);
}

function toInt16(f32) {
  const out = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

function push(bytes) {
  if (bytes && bytes.length) chunks.push(new Uint8Array(bytes)); // copie : LAME réutilise sa mémoire
}

self.onmessage = (e) => {
  const msg = e.data;
  try {
    if (msg.type === 'init') {
      ratio = msg.inRate / msg.outRate;
      encoder = new lamejs.Mp3Encoder(1, msg.outRate, msg.kbps);
    } else if (msg.type === 'pcm' && encoder) {
      const pcm = toInt16(resample(msg.data));
      for (let i = 0; i < pcm.length; i += 1152 * 8) push(encoder.encodeBuffer(pcm.subarray(i, i + 1152 * 8)));
    } else if (msg.type === 'end' && encoder) {
      push(encoder.flush());
      self.postMessage({ type: 'done', blob: new Blob(chunks, { type: 'audio/mpeg' }) });
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message });
  }
};
