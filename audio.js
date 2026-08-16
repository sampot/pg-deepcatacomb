const SFX = {
  click: "./assets/audio/click.ogg",
  step: "./assets/audio/step.ogg",
  hit: "./assets/audio/hit.ogg",
  kill: "./assets/audio/kill.ogg",
  hurt: "./assets/audio/hurt.ogg",
  pickup: "./assets/audio/pickup.ogg",
  equip: "./assets/audio/equip.ogg",
  quaff: "./assets/audio/quaff.ogg",
  eat: "./assets/audio/eat.ogg",
  stairs: "./assets/audio/stairs.ogg",
  level: "./assets/audio/level.ogg",
  win: "./assets/audio/win.ogg",
  lose: "./assets/audio/lose.ogg",
};

const TRACKS = {
  delve: "./assets/audio/music.ogg",
  throne: "./assets/audio/boss.ogg",
};

const MUSIC_VOLUME = 0.2;

export class GameAudio {
  constructor() {
    this.enabled = true;
    this.ctx = null;
    this.buffers = new Map();
    this.track = null;
    this.source = null;
    this.gain = null;
  }

  async start() {
    this.ctx ??= new AudioContext();
    await this.ctx.resume();
    await Promise.all(Object.entries(SFX).map(([name, url]) => this.#load(name, url)));
  }

  async #load(name, url) {
    if (this.buffers.has(name)) return this.buffers.get(name);
    try {
      const res = await fetch(url);
      const buffer = await this.ctx.decodeAudioData(await res.arrayBuffer());
      this.buffers.set(name, buffer);
      return buffer;
    } catch {
      this.buffers.set(name, null);
      return null;
    }
  }

  /** 切換背景曲目（深窟／王座大廳）；同一首則不重來。 */
  async playMusic(name) {
    if (!this.ctx || this.track === name || !TRACKS[name]) return;
    const buffer = await this.#load(`music:${name}`, TRACKS[name]);
    if (!buffer) return;
    this.#fadeOut();
    const source = this.ctx.createBufferSource();
    const gain = this.ctx.createGain();
    source.buffer = buffer;
    source.loop = true;
    gain.gain.value = 0;
    gain.gain.linearRampToValueAtTime(this.enabled ? MUSIC_VOLUME : 0, this.ctx.currentTime + 1.4);
    source.connect(gain).connect(this.ctx.destination);
    source.start();
    this.track = name;
    this.source = source;
    this.gain = gain;
  }

  #fadeOut() {
    const { source, gain } = this;
    if (!source || !gain) return;
    const end = this.ctx.currentTime + 0.9;
    gain.gain.linearRampToValueAtTime(0, end);
    source.stop(end + 0.05);
    this.source = null;
    this.gain = null;
  }

  stopMusic() {
    this.#fadeOut();
    this.track = null;
  }

  play(name, { volume = 0.5, rate = 1 } = {}) {
    const buffer = this.buffers.get(name);
    if (!this.enabled || !this.ctx || !buffer) return;
    const source = this.ctx.createBufferSource();
    const gain = this.ctx.createGain();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    gain.gain.value = volume;
    source.connect(gain).connect(this.ctx.destination);
    source.start();
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.gain) this.gain.gain.value = on ? MUSIC_VOLUME : 0;
  }
}
