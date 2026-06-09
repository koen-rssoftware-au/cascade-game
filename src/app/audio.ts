// All sounds are synthesized with the Web Audio API — zero audio assets (spec §1.1, §3.6).
export class GameAudio {
  muted = false;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;

  /** Call from a user gesture (pointerdown) — iOS requires it. Safe to call repeatedly. */
  unlock(): void {
    try {
      if (this.ctx === null) {
        const Ctor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.5;
        this.master.connect(this.ctx.destination);
        const len = Math.floor(this.ctx.sampleRate * 0.25);
        this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const data = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      this.ctx = null; // audio must never break the game
    }
  }

  private active(): { ctx: AudioContext; master: GainNode; noiseBuf: AudioBuffer } | null {
    if (this.muted || this.ctx === null || this.ctx.state !== 'running' || this.master === null || this.noiseBuf === null) {
      return null;
    }
    return { ctx: this.ctx, master: this.master, noiseBuf: this.noiseBuf };
  }

  private tone(
    freq: number,
    start: number,
    dur: number,
    type: OscillatorType,
    peak: number,
    endFreq?: number,
  ): void {
    const a = this.active();
    if (!a) return;
    const t = a.ctx.currentTime + start;
    const osc = a.ctx.createOscillator();
    const gain = a.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (endFreq !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(endFreq, 1), t + dur);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(a.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noise(start: number, dur: number, peak: number, filterFreq: number): void {
    const a = this.active();
    if (!a) return;
    const t = a.ctx.currentTime + start;
    const src = a.ctx.createBufferSource();
    src.buffer = a.noiseBuf;
    const filter = a.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    const gain = a.ctx.createGain();
    gain.gain.setValueAtTime(peak, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(gain).connect(a.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  /** Soft placement thock (spec §3.6). */
  place(): void {
    this.noise(0, 0.06, 0.5, 900);
    this.tone(180, 0, 0.07, 'sine', 0.35, 120);
  }

  pickup(): void {
    this.tone(520, 0, 0.05, 'sine', 0.12);
  }

  /** Crisp tick on tap-to-rotate. */
  rotate(): void {
    this.tone(740, 0, 0.045, 'sine', 0.14);
    this.tone(988, 0.03, 0.05, 'sine', 0.08);
  }

  /** Two rising notes when the run passes the all-time best. */
  newBest(): void {
    this.tone(659.25, 0, 0.16, 'sine', 0.22);
    this.tone(987.77, 0.1, 0.24, 'sine', 0.24);
  }

  illegal(): void {
    this.tone(160, 0, 0.09, 'triangle', 0.15, 120);
  }

  /** Chime arpeggio on clears; pitch rises one pentatonic step per chain step (spec §3.4/§3.6). */
  clear(chainStep: number, lines: number): void {
    // C major pentatonic, shifted up by (chainStep - 1) scale degrees.
    const penta = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.5, 1568.0, 1760.0];
    const shift = Math.min(chainStep - 1, 4);
    const notes = Math.min(2 + lines, 4);
    for (let i = 0; i < notes; i++) {
      const f = penta[Math.min(shift + i, penta.length - 1)] ?? 880;
      this.tone(f, i * 0.055, 0.22, 'sine', 0.28);
      this.tone(f * 2, i * 0.055, 0.12, 'sine', 0.08);
    }
  }

  /** Deep satisfying boom on all-clear (spec §3.6). */
  allClear(): void {
    this.tone(70, 0, 0.7, 'sine', 0.6, 40);
    this.noise(0, 0.45, 0.3, 350);
    const penta = [523.25, 659.25, 783.99, 1046.5];
    penta.forEach((f, i) => this.tone(f, 0.08 + i * 0.07, 0.3, 'sine', 0.2));
  }

  gameOver(): void {
    this.tone(330, 0, 0.18, 'sine', 0.2, 280);
    this.tone(262, 0.16, 0.22, 'sine', 0.2, 220);
    this.tone(196, 0.34, 0.4, 'sine', 0.22, 150);
  }

  button(): void {
    this.tone(440, 0, 0.05, 'sine', 0.1);
  }
}
