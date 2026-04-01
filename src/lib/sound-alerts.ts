const audioCtxRef: { current: AudioContext | null } = { current: null };

function getAudioCtx(): AudioContext {
  if (!audioCtxRef.current) {
    audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  return audioCtxRef.current;
}

function playTone(frequency: number, duration: number, type: OscillatorType = 'sine', volume = 0.15) {
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, ctx.currentTime);
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  } catch {
    // Audio not available
  }
}

export function playBullishAlert() {
  // Rising two-tone: C5 → E5
  playTone(523.25, 0.15, 'sine', 0.12);
  setTimeout(() => playTone(659.25, 0.2, 'sine', 0.12), 150);
}

export function playBearishAlert() {
  // Falling two-tone: E5 → C5
  playTone(659.25, 0.15, 'sine', 0.12);
  setTimeout(() => playTone(523.25, 0.2, 'sine', 0.12), 150);
}

export function playHighProbabilityAlert() {
  // Triple ascending: C5 → E5 → G5
  playTone(523.25, 0.12, 'sine', 0.15);
  setTimeout(() => playTone(659.25, 0.12, 'sine', 0.15), 120);
  setTimeout(() => playTone(783.99, 0.25, 'sine', 0.15), 240);
}

export function playConfluenceAlert() {
  // Chord-like: play 3 notes simultaneously
  playTone(523.25, 0.3, 'sine', 0.08);
  playTone(659.25, 0.3, 'sine', 0.08);
  playTone(783.99, 0.3, 'sine', 0.08);
}

export function playScanComplete() {
  playTone(440, 0.1, 'triangle', 0.08);
}
