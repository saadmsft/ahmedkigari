import type { Vehicle } from "../vehicle/Vehicle";

/**
 * Minimal procedural audio using the WebAudio API — no asset files required.
 * - Engine: sawtooth oscillator with pitch tied to "RPM" (approximated from speed/gear)
 * - Skid: filtered noise gated by tire slip
 * - Wind: filtered noise gated by speed
 * - Collision: short noise burst on impulse spikes
 */
export class AudioManager {
  ctx!: AudioContext;
  master!: GainNode;

  // Engine
  private engineOsc!: OscillatorNode;
  private engineGain!: GainNode;
  private engineSub!: OscillatorNode;
  private engineSubGain!: GainNode;

  // Skid
  private skidGain!: GainNode;
  // Wind
  private windGain!: GainNode;

  private lastSpeed = 0;
  private started = false;

  async init() {
    // defer context creation until user gesture
    document.addEventListener("pointerdown", () => this.ensureCtx(), {
      once: true,
    });
    document.addEventListener("keydown", () => this.ensureCtx(), {
      once: true,
    });
  }

  private ensureCtx() {
    if (this.ctx) return;
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(this.ctx.destination);
  }

  startEngine() {
    this.ensureCtx();
    if (!this.ctx || this.started) return;
    this.started = true;

    // Engine (two oscillators for richness)
    this.engineOsc = this.ctx.createOscillator();
    this.engineOsc.type = "sawtooth";
    this.engineOsc.frequency.value = 60;
    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0.0;
    const engineLP = this.ctx.createBiquadFilter();
    engineLP.type = "lowpass";
    engineLP.frequency.value = 1200;
    this.engineOsc
      .connect(engineLP)
      .connect(this.engineGain)
      .connect(this.master);
    this.engineOsc.start();

    this.engineSub = this.ctx.createOscillator();
    this.engineSub.type = "square";
    this.engineSub.frequency.value = 30;
    this.engineSubGain = this.ctx.createGain();
    this.engineSubGain.gain.value = 0.0;
    this.engineSub.connect(this.engineSubGain).connect(this.master);
    this.engineSub.start();

    // Skid: white noise → highpass
    const skidNoise = this.createNoiseSource();
    const skidHP = this.ctx.createBiquadFilter();
    skidHP.type = "highpass";
    skidHP.frequency.value = 1800;
    this.skidGain = this.ctx.createGain();
    this.skidGain.gain.value = 0;
    skidNoise.connect(skidHP).connect(this.skidGain).connect(this.master);

    // Wind
    const windNoise = this.createNoiseSource();
    const windLP = this.ctx.createBiquadFilter();
    windLP.type = "lowpass";
    windLP.frequency.value = 600;
    this.windGain = this.ctx.createGain();
    this.windGain.gain.value = 0;
    windNoise.connect(windLP).connect(this.windGain).connect(this.master);
  }

  update(vehicle: Vehicle, _dt: number) {
    if (!this.ctx || !this.started) return;
    const speed = vehicle.getSpeed();
    const fwd = Math.abs(vehicle.getForwardSpeed());
    const kmh = fwd * 3.6;

    // Engine freq: ramp through gears
    const base = 55; // idle Hz
    const gearBands = [0, 30, 60, 100, 150, 200];
    let band = 0;
    for (let i = 0; i < gearBands.length - 1; i++) {
      if (kmh >= gearBands[i] && kmh < gearBands[i + 1]) {
        band = i;
        break;
      }
      if (kmh >= gearBands[gearBands.length - 1]) band = gearBands.length - 2;
    }
    const lo = gearBands[band];
    const hi = gearBands[band + 1] ?? lo + 50;
    const gearT = Math.min(1, Math.max(0, (kmh - lo) / (hi - lo)));
    const freq = base + band * 25 + gearT * 120;
    const t = this.ctx.currentTime;
    this.engineOsc.frequency.cancelScheduledValues(t);
    this.engineOsc.frequency.linearRampToValueAtTime(freq, t + 0.05);
    this.engineSub.frequency.linearRampToValueAtTime(freq * 0.5, t + 0.05);

    const throttleGain =
      0.05 + Math.min(0.22, vehicle.throttle * 0.22 + kmh * 0.0008);
    this.engineGain.gain.linearRampToValueAtTime(throttleGain, t + 0.08);
    this.engineSubGain.gain.linearRampToValueAtTime(
      throttleGain * 0.35,
      t + 0.08,
    );

    // Skid
    const slip = vehicle.getSlip();
    const skid = slip > 0.2 ? Math.min(0.2, (slip - 0.2) * 0.8) : 0;
    this.skidGain.gain.linearRampToValueAtTime(skid, t + 0.05);

    // Wind
    const wind = Math.min(0.15, (kmh / 200) * 0.15);
    this.windGain.gain.linearRampToValueAtTime(wind, t + 0.1);

    // Collision detection: sudden drop in speed
    const delta = this.lastSpeed - speed;
    if (delta > 4) this.playImpact(Math.min(1, delta / 12));
    this.lastSpeed = speed;
  }

  playImpact(intensity: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const noise = this.createNoiseSource(0.25);
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 400 + intensity * 1200;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.8 * intensity, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    noise.connect(lp).connect(g).connect(this.master);
  }

  /** Cartoony "Hawwww!!" gasp — falling vowel synthesized with formants. */
  playHaww() {
    this.ensureCtx();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const duration = 1.1;

    // Voiced base: sawtooth swept from high to low (surprised gasp)
    const osc = this.ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(260, t);
    osc.frequency.linearRampToValueAtTime(330, t + 0.15);
    osc.frequency.linearRampToValueAtTime(180, t + duration);

    // Vibrato for cartoon feel
    const lfo = this.ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 6;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 12;
    lfo.connect(lfoGain).connect(osc.frequency);
    lfo.start(t);
    lfo.stop(t + duration + 0.1);

    // Formant shaping: "aah" vowel — two bandpass peaks around 730Hz and 1090Hz
    const f1 = this.ctx.createBiquadFilter();
    f1.type = "bandpass";
    f1.frequency.value = 730;
    f1.Q.value = 8;
    const f2 = this.ctx.createBiquadFilter();
    f2.type = "bandpass";
    f2.frequency.value = 1090;
    f2.Q.value = 9;

    const mix = this.ctx.createGain();
    mix.gain.value = 1.0;

    // Amplitude envelope: quick attack, sustained, fade out
    const amp = this.ctx.createGain();
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(0.55, t + 0.06);
    amp.gain.linearRampToValueAtTime(0.45, t + 0.7);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + duration);

    osc.connect(f1);
    osc.connect(f2);
    f1.connect(mix);
    f2.connect(mix);
    mix.connect(amp).connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.05);

    // Breathy noise overlay for the "Haw" consonant
    const noise = this.createNoiseSource(duration);
    const hp = this.ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 800;
    const noiseAmp = this.ctx.createGain();
    noiseAmp.gain.setValueAtTime(0.15, t);
    noiseAmp.gain.exponentialRampToValueAtTime(0.02, t + 0.25);
    noiseAmp.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    noise.connect(hp).connect(noiseAmp).connect(this.master);
  }

  private lastHayeOye = 0;

  /**
   * Cartoon Urdu-flavored "Haye Oyeee Zalimaaa!" — synthesized via formant-filtered
   * sawtooth per syllable. Purely procedural, no asset files.
   */
  playHayeOye() {
    this.ensureCtx();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    // Cooldown so rapid cone-spam doesn't layer into noise
    if (now - this.lastHayeOye < 1.6) return;
    this.lastHayeOye = now;

    // Vowel formants: rough F1/F2 pairs for ae, oh, ee, ah.
    const VOWELS: Record<string, [number, number]> = {
      ae: [700, 1600],
      oh: [550, 880],
      ee: [300, 2300],
      ah: [800, 1200],
      aa: [820, 1180],
    };

    // Syllable schedule: [vowel, start-pitch Hz, end-pitch Hz, duration s, gain]
    const syllables: Array<[keyof typeof VOWELS, number, number, number, number]> = [
      // "Haa-aye"  (whiny rising-then-falling)
      ['ae', 260, 320, 0.22, 0.55],
      ['ee', 320, 240, 0.18, 0.5],
      // brief pause
      // "Oh-yeee"  (drawn out)
      ['oh', 230, 260, 0.14, 0.5],
      ['ee', 300, 220, 0.42, 0.55],
      // "Za-li-maa-aa"
      ['ah', 240, 230, 0.18, 0.55],
      ['ee', 260, 250, 0.14, 0.5],
      ['aa', 230, 200, 0.55, 0.6],
    ];
    const gaps = [0.02, 0.08, 0.02, 0.15, 0.04, 0.02, 0.0];

    let t = now;
    for (let i = 0; i < syllables.length; i++) {
      const [vowel, f0Start, f0End, dur, amp] = syllables[i];
      const [F1, F2] = VOWELS[vowel];
      this.speakSyllable(t, f0Start, f0End, F1, F2, dur, amp);
      t += dur + gaps[i];
    }

    // Extra breath on the first "H" consonant
    const breath = this.createNoiseSource(0.12);
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1200;
    const bAmp = this.ctx.createGain();
    bAmp.gain.setValueAtTime(0.18, now);
    bAmp.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    breath.connect(hp).connect(bAmp).connect(this.master);
  }

  /** Synthesize one voiced vowel syllable with two formants and a pitch glide. */
  private speakSyllable(
    start: number,
    f0Start: number,
    f0End: number,
    F1: number,
    F2: number,
    duration: number,
    amp: number
  ) {
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(f0Start, start);
    osc.frequency.linearRampToValueAtTime(f0End, start + duration);

    // Vibrato — adds the whiny Urdu inflection
    const lfo = this.ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 5.5;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 8;
    lfo.connect(lfoGain).connect(osc.frequency);
    lfo.start(start);
    lfo.stop(start + duration + 0.05);

    // Two parallel bandpass formants
    const b1 = this.ctx.createBiquadFilter();
    b1.type = 'bandpass';
    b1.frequency.value = F1;
    b1.Q.value = 9;
    const b2 = this.ctx.createBiquadFilter();
    b2.type = 'bandpass';
    b2.frequency.value = F2;
    b2.Q.value = 10;

    const mix = this.ctx.createGain();
    mix.gain.value = 1.0;

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(amp, start + 0.03);
    env.gain.setValueAtTime(amp, start + duration * 0.7);
    env.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    osc.connect(b1);
    osc.connect(b2);
    b1.connect(mix);
    b2.connect(mix);
    mix.connect(env).connect(this.master);

    osc.start(start);
    osc.stop(start + duration + 0.05);
  }

  private createNoiseSource(durationSec = 0): AudioNode {
    const bufSec = 2;
    const buf = this.ctx.createBuffer(
      1,
      this.ctx.sampleRate * bufSec,
      this.ctx.sampleRate,
    );
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = durationSec === 0;
    src.start();
    if (durationSec > 0) src.stop(this.ctx.currentTime + durationSec);
    return src;
  }
}
