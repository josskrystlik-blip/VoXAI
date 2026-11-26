/**
 * VoxAI - Capture du son en direct pour l'encodage MP3 (AudioWorklet).
 * Reçoit le son (micro, ou micro + visio mélangés), le ramène en mono et l'envoie par paquets
 * d'environ 85 ms au module mp3.js, qui le transmet à l'encodeur (mp3-worker.js).
 */
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = 4096;
    this.buffer = new Float32Array(this.size);
    this.filled = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (input && input.length) {
      const frames = input[0].length;
      for (let i = 0; i < frames; i++) {
        let v = 0;
        for (let c = 0; c < input.length; c++) v += input[c][i];
        this.buffer[this.filled++] = v / input.length;
        if (this.filled === this.size) {
          this.port.postMessage(this.buffer, [this.buffer.buffer]);
          this.buffer = new Float32Array(this.size);
          this.filled = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('pcm-capture', PcmCapture);
