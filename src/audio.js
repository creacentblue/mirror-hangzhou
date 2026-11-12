// 极简 WebAudio 音效（无资源文件）
let ctx = null, master = null, eng = null, engG = null, heli = null, heliG = null, muted = false, noiseBuf = null;
export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)(); master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1, ctx.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch (e) { ctx = null; }
}
function noise(dur, freq, vol, q = 1) {
  if (!ctx || muted) return; const s = ctx.createBufferSource(); s.buffer = noiseBuf; const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq; f.Q.value = q; const g = ctx.createGain();
  g.gain.setValueAtTime(vol, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur); s.connect(f); f.connect(g); g.connect(master); s.start(); s.stop(ctx.currentTime + dur);
}
function tone(f0, f1, dur, vol, type = 'square') {
  if (!ctx || muted) return; const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.frequency.setValueAtTime(f0, ctx.currentTime); o.frequency.exponentialRampToValueAtTime(f1, ctx.currentTime + dur);
  g.gain.setValueAtTime(vol, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur); o.connect(g); g.connect(master); o.start(); o.stop(ctx.currentTime + dur);
}
export function sfx(name, v) {
  if (name === 'mute') { muted = !!v; if (master) master.gain.value = muted ? 0 : 0.5; if (eng) engG.gain.value = 0; if (heliG) heliG.gain.value = 0; return; }
  if (name === 'break') { noise(0.18, 1800, 0.5); tone(220, 70, 0.12, 0.2); }
  else if (name === 'blast') { noise(0.7, 700, 1.0); tone(90, 30, 0.5, 0.5, 'sawtooth'); }
  else if (name === 'collapse') { noise(1.4, 400, 1.0); tone(60, 25, 1.0, 0.5, 'sawtooth'); }
  else if (name === 'crash') { noise(0.5, 1200, 0.9); tone(120, 40, 0.3, 0.4, 'sawtooth'); }
  else if (name === 'bump') { noise(0.15, 500, 0.4); }
  else if (name === 'jump') { tone(300, 520, 0.08, 0.05, 'sine'); }
  else if (name === 'heli') { noise(0.25, 400, 0.3); }
}
export function engineSet(speed01, on) {
  if (!ctx) return;
  if (on && !eng) { eng = ctx.createOscillator(); eng.type = 'sawtooth'; const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500; engG = ctx.createGain(); engG.gain.value = 0; eng.connect(lp); lp.connect(engG); engG.connect(master); eng.start(); }
  if (!eng) return;
  if (!on) { engG.gain.value = 0; return; }
  eng.frequency.value = 45 + speed01 * 130; engG.gain.value = muted ? 0 : 0.05 + speed01 * 0.07;
}

export function heliSet(on, speed01 = 0.5) {
  if (!ctx) return;
  if (on && !heli) {
    heli = ctx.createOscillator(); heli.type = 'sawtooth';
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 280;
    heliG = ctx.createGain(); heliG.gain.value = 0;
    heli.connect(lp); lp.connect(heliG); heliG.connect(master); heli.start();
  }
  if (!heli) return;
  if (!on) { heliG.gain.value = 0; return; }
  heli.frequency.value = 28 + speed01 * 18;
  heliG.gain.value = muted ? 0 : 0.04 + speed01 * 0.05;
}
