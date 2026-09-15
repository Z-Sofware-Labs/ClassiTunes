import { EqualizerBands, EQPreset } from '../types';

export const EQ_PRESETS: Record<EQPreset, EqualizerBands> = {
  'Flat': { b32: 0, b64: 0, b125: 0, b250: 0, b500: 0, b1k: 0, b2k: 0, b4k: 0, b8k: 0, b16k: 0 },
  'Acoustic': { b32: 4, b64: 3, b125: 2, b250: 0, b500: 1, b1k: 2, b2k: 3, b4k: 3, b8k: 2, b16k: 1 },
  'Bass Booster': { b32: 6, b64: 5, b125: 4, b250: 2, b500: 0, b1k: 0, b2k: 0, b4k: 0, b8k: 0, b16k: 0 },
  'Bass Reducer': { b32: -6, b64: -5, b125: -4, b250: -2, b500: 0, b1k: 0, b2k: 0, b4k: 0, b8k: 0, b16k: 0 },
  'Classical': { b32: 5, b64: 4, b125: 3, b250: 2, b500: -1, b1k: -1, b2k: 0, b4k: 2, b8k: 3, b16k: 4 },
  'Dance': { b32: 6, b64: 5, b125: 2, b250: 0, b500: 1, b1k: 3, b2k: 4, b4k: 3, b8k: 1, b16k: 0 },
  'Deep': { b32: 4, b64: 3, b125: 1, b250: 2, b500: -1, b1k: -2, b2k: -1, b4k: 1, b8k: 3, b16k: 4 },
  'Electronic': { b32: 5, b64: 4, b125: 1, b250: 0, b500: -2, b1k: 2, b2k: 1, b4k: 3, b8k: 4, b16k: 5 },
  'Hip-Hop': { b32: 5, b64: 4, b125: 1, b250: 3, b500: -1, b1k: -1, b2k: 1, b4k: -1, b8k: 2, b16k: 3 },
  'Jazz': { b32: 4, b64: 3, b125: 1, b250: 2, b500: -2, b1k: -2, b2k: 0, b4k: 1, b8k: 3, b16k: 4 },
  'Latin': { b32: 4, b64: 2, b125: 0, b250: -1, b500: -1, b1k: -1, b2k: 0, b4k: 2, b8k: 3, b16k: 4 },
  'Loudness': { b32: 6, b64: 4, b125: 0, b250: 0, b500: -2, b1k: 0, b2k: -1, b4k: 5, b8k: 6, b16k: 1 },
  'Pop': { b32: -1, b64: 2, b125: 4, b250: 5, b500: 4, b1k: 1, b2k: -1, b4k: -1, b8k: 1, b16k: 2 },
  'Rock': { b32: 5, b64: 4, b125: 2, b250: -1, b500: -2, b1k: 1, b2k: 3, b4k: 4, b8k: 4, b16k: 4 },
  'Small Speakers': { b32: 8, b64: 6, b125: 4, b250: 2, b500: 1, b1k: 0, b2k: -1, b4k: -2, b8k: -3, b16k: -4 },
  'Spoken Word': { b32: -4, b64: -1, b125: 0, b250: 2, b500: 4, b1k: 4, b2k: 3, b4k: 1, b8k: -1, b16k: -3 },
  'Treble Booster': { b32: 0, b64: 0, b125: 0, b250: 0, b500: 0, b1k: 1, b2k: 3, b4k: 4, b8k: 5, b16k: 6 },
};

type Deck = {
  audio: HTMLAudioElement;
  filters: BiquadFilterNode[];
  analyser: AnalyserNode;
  master: GainNode;
  normalizationGain: number;
  fadeGain: number;
};

export class AudioEngine {
  private audioCtx: AudioContext | null = null;
  private decks: [Deck | null, Deck | null] = [null, null];
  private activeIndex = 0;
  private currentVolume = 0.8;
  private isInitialized = false;
  private normalizationEnabled = false;
  // Prevents the same codec-missing dialog from appearing more than once per session.
  private _codecPromptShown = false;
  private crossfadeActive = false;
  private normalizationCache = new Map<string, number>();
  private frequencies = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  private endedCallbacks = new Set<() => void>();
  private timeUpdateCallbacks = new Set<() => void>();
  private loadedMetadataCallbacks = new Set<() => void>();

  private get activeDeck(): Deck | null { return this.decks[this.activeIndex]; }
  private get activeAudio(): HTMLAudioElement | null { return this.activeDeck?.audio || null; }

  constructor() {
    // Decks are created lazily after a user gesture so AudioContext creation remains autoplay-safe.
  }

  private buildDeck(index: number): Deck {
    const ctx = this.audioCtx!;
    const audio = new Audio();
    audio.crossOrigin = 'anonymous';
    audio.preload = 'auto';

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    const master = ctx.createGain();

    const filters = this.frequencies.map(freq => {
      const filter = ctx.createBiquadFilter();
      filter.type = freq <= 32 ? 'lowshelf' : freq >= 16000 ? 'highshelf' : 'peaking';
      filter.frequency.value = freq;
      if (filter.type === 'peaking') filter.Q.value = 1.4;
      filter.gain.value = 0;
      return filter;
    });

    const source = ctx.createMediaElementSource(audio);
    let last: AudioNode = source;
    filters.forEach(filter => { last.connect(filter); last = filter; });
    last.connect(analyser);
    analyser.connect(master);
    master.connect(ctx.destination);

    const deck: Deck = { audio, filters, analyser, master, normalizationGain: 1, fadeGain: index === this.activeIndex ? 1 : 0 };
    audio.addEventListener('ended', () => {
      if (this.activeDeck === deck && !this.crossfadeActive) this.endedCallbacks.forEach(cb => cb());
    });
    audio.addEventListener('timeupdate', () => {
      if (this.activeDeck === deck) this.timeUpdateCallbacks.forEach(cb => cb());
    });
    audio.addEventListener('loadedmetadata', () => {
      if (this.activeDeck === deck) this.loadedMetadataCallbacks.forEach(cb => cb());
    });
    // Detect codec-level failures on the media element.
    // MEDIA_ERR_DECODE (3) = codec cannot decode the stream.
    // MEDIA_ERR_SRC_NOT_SUPPORTED (4) = container/codec not supported by the platform.
    audio.addEventListener('error', () => {
      const code = audio.error?.code;
      if (code === MediaError.MEDIA_ERR_DECODE || code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
        console.warn('AudioEngine: media decode/codec error detected, code:', code);
        this.showCodecInstallPrompt();
      }
    });
    this.applyDeckGain(deck);
    return deck;
  }

  public initWebAudio() {
    if (this.isInitialized) return;
    try {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtxClass) return;
      this.audioCtx = new AudioCtxClass();
      this.decks = [this.buildDeck(0), this.buildDeck(1)];
      this.isInitialized = true;
    } catch (e) {
      console.warn('WebAudio initialization error:', e);
    }
  }

  private applyDeckGain(deck: Deck) {
    deck.master.gain.value = this.currentVolume * deck.normalizationGain * deck.fadeGain;
  }

  public setNormalizationEnabled(enabled: boolean) {
    this.normalizationEnabled = enabled;
    this.decks.forEach(deck => {
      if (deck) {
        deck.normalizationGain = 1;
        this.applyDeckGain(deck);
      }
    });
  }

  // Informs Linux/Fedora users about missing audio codecs.
  // Only fires once per session and only on Linux to avoid false positives on other platforms.
  private showCodecInstallPrompt(): void {
    const isLinux = typeof navigator !== 'undefined' &&
      navigator.userAgent.toLowerCase().includes('linux');
    if (!isLinux || this._codecPromptShown) return;
    this._codecPromptShown = true;
    const message =
      'ClassiTunes could not decode this audio file.\n\n' +
      'Your system may be missing required multimedia codecs.\n' +
      'On Fedora / RPM-based distros, open a terminal and run:\n\n' +
      '  sudo dnf install gstreamer1-plugins-base gstreamer1-plugins-good ' +
      'gstreamer1-plugins-bad-free gstreamer1-plugins-ugly ffmpeg\n\n' +
      'On Ubuntu / Debian-based distros run:\n\n' +
      '  sudo apt install gstreamer1.0-plugins-good gstreamer1.0-plugins-bad ' +
      'gstreamer1.0-plugins-ugly ffmpeg\n\n' +
      'After installing, restart the application.';
    // alert() is intentional here: it blocks and ensures the user reads the message.
    alert(message);
  }

  private async estimateNormalizationGain(url: string, replayGainDb?: number): Promise<number> {
    if (!this.normalizationEnabled || !url) return 1;
    if (replayGainDb !== undefined && Number.isFinite(replayGainDb)) {
      return Math.pow(10, Math.max(-12, Math.min(12, replayGainDb)) / 20);
    }
    const cached = this.normalizationCache.get(url);
    if (cached !== undefined) return cached;

    // Prefer an actual ReplayGain/RVA2 value when callers supply one through the URL cache.
    // Otherwise estimate average RMS from a bounded decoded sample. This is playback
    // normalization, not destructive file rewriting.
    try {
      const response = await fetch(url);
      if (!response.ok) return 1;
      const bytes = await response.arrayBuffer();
      if (!this.audioCtx || bytes.byteLength === 0) return 1;
      const decoded = await this.audioCtx.decodeAudioData(bytes.slice(0));
      const duration = decoded.duration;
      const start = Math.max(0, Math.min(duration * 0.35, duration - 30));
      const length = Math.min(30, duration);
      const startFrame = Math.floor(start * decoded.sampleRate);
      const endFrame = Math.min(decoded.length, startFrame + Math.floor(length * decoded.sampleRate));
      let sum = 0;
      let count = 0;
      const channels = decoded.numberOfChannels;
      for (let ch = 0; ch < channels; ch++) {
        const data = decoded.getChannelData(ch);
        const step = Math.max(1, Math.floor((endFrame - startFrame) / 200000));
        for (let i = startFrame; i < endFrame; i += step) {
          const v = data[i];
          sum += v * v;
          count++;
        }
      }
      if (!count) return 1;
      const rms = Math.sqrt(sum / count);
      const db = 20 * Math.log10(Math.max(rms, 1e-6));
      // Target roughly -18 dBFS RMS; clamp to avoid extreme boosts/cuts and prevent clipping.
      let gainDb = Math.max(-12, Math.min(12, -18 - db));
      const gain = Math.pow(10, gainDb / 20);
      this.normalizationCache.set(url, gain);
      return gain;
    } catch (e) {
      console.warn('Audio normalization analysis failed:', e);
      // decodeAudioData throws a DOMException when the codec is missing on Linux.
      if (e instanceof DOMException || (e instanceof Error && e.name === 'EncodingError')) {
        this.showCodecInstallPrompt();
      }
      return 1;
    }
  }

  public async playTrack(url: string, replayGainDb?: number): Promise<void> {
    this.initWebAudio();
    if (!this.activeDeck || !this.audioCtx) return;
    if (this.audioCtx.state === 'suspended') await this.audioCtx.resume();

    const deck = this.activeDeck;
    const other = this.decks[1 - this.activeIndex];
    if (other) {
      other.audio.pause();
      other.fadeGain = 0;
      other.normalizationGain = 1;
      this.applyDeckGain(other);
    }
    deck.audio.src = url;
    deck.audio.currentTime = 0;
    deck.fadeGain = 1;
    deck.normalizationGain = await this.estimateNormalizationGain(url, replayGainDb);
    this.applyDeckGain(deck);

    try { await deck.audio.play(); }
    catch (e) {
      console.warn('Playback error:', e);
      // NotSupportedError is thrown by play() when the codec is not available.
      if (e instanceof DOMException && (e.name === 'NotSupportedError' || e.name === 'NotAllowedError')) {
        if (e.name === 'NotSupportedError') this.showCodecInstallPrompt();
      }
    }
  }

  public async crossfadeTo(url: string, seconds: number, replayGainDb?: number): Promise<void> {
    this.initWebAudio();
    if (!this.audioCtx || !this.activeDeck || !url) return;
    if (this.audioCtx.state === 'suspended') await this.audioCtx.resume();

    const oldIndex = this.activeIndex;
    const newIndex = 1 - oldIndex;
    const oldDeck = this.decks[oldIndex]!;
    const newDeck = this.decks[newIndex]!;
    const duration = Math.max(0.25, seconds || 1);
    const now = this.audioCtx.currentTime;

    newDeck.audio.pause();
    newDeck.audio.src = url;
    newDeck.audio.currentTime = 0;
    newDeck.normalizationGain = 1;
    newDeck.fadeGain = 0;
    this.applyDeckGain(newDeck);

    // Start the next track immediately. Normalization analysis must never delay the fade.
    await newDeck.audio.play();
    this.crossfadeActive = true;
    // ReplayGain is safe to apply immediately. For files without ReplayGain, the
    // regular playTrack path performs RMS analysis without delaying playback. Do not
    // asynchronously overwrite the scheduled crossfade gain, or it would jump to
    // full volume mid-fade.
    if (this.normalizationEnabled && replayGainDb !== undefined && Number.isFinite(replayGainDb)) {
      newDeck.normalizationGain = Math.pow(10, Math.max(-12, Math.min(12, replayGainDb)) / 20);
    }
    newDeck.master.gain.cancelScheduledValues(now);
    oldDeck.master.gain.cancelScheduledValues(now);
    oldDeck.master.gain.setValueAtTime(this.currentVolume * oldDeck.normalizationGain, now);
    newDeck.master.gain.setValueAtTime(0, now);
    oldDeck.master.gain.linearRampToValueAtTime(0, now + duration);
    newDeck.master.gain.linearRampToValueAtTime(this.currentVolume * newDeck.normalizationGain, now + duration);
    newDeck.fadeGain = 1;

    window.setTimeout(() => {
      oldDeck.audio.pause();
      oldDeck.fadeGain = 0;
      this.applyDeckGain(oldDeck);
      this.activeIndex = newIndex;
      this.crossfadeActive = false;
    }, duration * 1000 + 100);
  }

  public pause(): void { this.activeAudio?.pause(); }

  public resume(): void {
    this.initWebAudio();
    if (!this.activeAudio) return;
    if (this.audioCtx?.state === 'suspended') this.audioCtx.resume();
    this.activeAudio.play().catch(console.warn);
  }

  public seek(seconds: number): void { if (this.activeAudio) this.activeAudio.currentTime = seconds; }
  public setVolume(val: number): void {
    this.currentVolume = Math.max(0, Math.min(1, val));
    this.decks.forEach(deck => deck && this.applyDeckGain(deck));
  }
  public getVolume(): number { return this.currentVolume; }
  public getCurrentTime(): number { return this.activeAudio?.currentTime || 0; }
  public getDuration(): number { return this.activeAudio?.duration || 0; }
  public isPaused(): boolean { return this.activeAudio?.paused ?? true; }

  public setEQPreset(bands: EqualizerBands): void {
    const values = [bands.b32, bands.b64, bands.b125, bands.b250, bands.b500, bands.b1k, bands.b2k, bands.b4k, bands.b8k, bands.b16k];
    this.decks.forEach(deck => deck?.filters.forEach((filter, i) => {
      filter.gain.setValueAtTime(values[i], this.audioCtx?.currentTime || 0);
    }));
  }

  public getAnalyserData(dataArray: Uint8Array): void { this.activeDeck?.analyser.getByteFrequencyData(dataArray); }
  public getWaveformData(dataArray: Uint8Array): void { this.activeDeck?.analyser.getByteTimeDomainData(dataArray); }

  public onEnded(callback: () => void): () => void {
    this.endedCallbacks.add(callback);
    return () => this.endedCallbacks.delete(callback);
  }

  public onTimeUpdate(callback: () => void): () => void {
    this.timeUpdateCallbacks.add(callback);
    return () => this.timeUpdateCallbacks.delete(callback);
  }

  public onLoadedMetadata(callback: () => void): () => void {
    this.loadedMetadataCallbacks.add(callback);
    return () => this.loadedMetadataCallbacks.delete(callback);
  }

}

export const audioEngine = new AudioEngine();
