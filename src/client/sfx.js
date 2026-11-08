let context = null;
let noise = null;

function ensureContext() {
  if (!context) {
    const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContextClass) return null;
    context = new AudioContextClass();
    noise = context.createBuffer(1, context.sampleRate * 0.3, context.sampleRate);
    const samples = noise.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
  }
  if (context.state === 'suspended') context.resume();
  return context;
}

export function playSound(kind, volume = 1) {
  const audio = ensureContext();
  if (!audio) return;
  const now = audio.currentTime;
  const source = audio.createBufferSource();
  source.buffer = noise;
  source.playbackRate.value = kind === 'break' ? 0.7 + Math.random() * 0.2 : 1.1 + Math.random() * 0.2;
  const filter = audio.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = kind === 'break' ? 900 : kind === 'step' ? 500 : 1400;
  const gain = audio.createGain();
  const length = kind === 'break' ? 0.18 : kind === 'step' ? 0.06 : 0.09;
  gain.gain.setValueAtTime(0.32 * volume, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + length);
  source.connect(filter).connect(gain).connect(audio.destination);
  source.start(now);
  source.stop(now + length + 0.02);
}
