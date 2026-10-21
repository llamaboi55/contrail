// Cabin sound made on the fly: a soft engine rumble (filtered brown noise) and the
// two-tone chime before announcements. No audio files.
let ctx = null;
let master = null;
let noise = null;

function ensure() {
  if (ctx) return ctx;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);
  return ctx;
}

function brownNoise() {
  const len = ctx.sampleRate * 4;
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.2;
    }
  }
  return buf;
}

/** Starts or stops the engine hum. */
export function cabin(on, volume = 0.5) {
  ensure();
  if (ctx.state === 'suspended') ctx.resume();
  if (on && !noise) {
    noise = ctx.createBufferSource();
    noise.buffer = brownNoise();
    noise.loop = true;
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 520;
    const hum = ctx.createBiquadFilter();
    hum.type = 'peaking';
    hum.frequency.value = 110;
    hum.gain.value = 5;
    noise.connect(low).connect(hum).connect(master);
    noise.start();
  }
  if (!on && noise) {
    const n = noise;
    noise = null;
    setTimeout(() => n.stop(), 900);
  }
  master.gain.cancelScheduledValues(ctx.currentTime);
  master.gain.setTargetAtTime(on ? volume * 0.55 : 0, ctx.currentTime, 0.3);
}

export function setVolume(v) {
  if (master && noise) master.gain.setTargetAtTime(v * 0.55, ctx.currentTime, 0.1);
}

/** The "bing-bong". */
export function chime(volume = 0.5) {
  ensure();
  const t = ctx.currentTime;
  [[784, 0], [622, 0.42]].forEach(([f, at]) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = f;
    g.gain.setValueAtTime(0, t + at);
    g.gain.linearRampToValueAtTime(0.22 * volume + 0.05, t + at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + at + 1.4);
    o.connect(g).connect(ctx.destination);
    o.start(t + at);
    o.stop(t + at + 1.5);
  });
}
