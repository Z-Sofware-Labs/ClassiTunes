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
  private playbackErrorCallbacks = new Set<(error: Error) => void>();
  // Tracks blob: URLs we created so we can revoke them after track changes (memory management).
  private activeBlobUrls = new Set<string>();

  private get activeDeck(): Deck | null { return this.decks[this.activeIndex]; }
  private get activeAudio(): HTMLAudioElement | null { return this.activeDeck?.audio || null; }

  constructor() {
    // Decks are created lazily after a user gesture so AudioContext creation remains autoplay-safe.
  }

  // ── Blob URL helpers ─────────────────────────────────────────────────────────
  //
  // On Linux, WebKit2GTK runs its media pipeline in a sandboxed subprocess that
  // cannot load system GStreamer plugins (e.g. avdec_mp3). Any asset:// URL fed
  // to an HTMLAudioElement is decoded by that sandboxed process, so MP3/AAC/etc.
  // fail with MEDIA_ERR_SRC_NOT_SUPPORTED (error code 4).
  //
  // The workaround: read the file bytes via the Tauri fs plugin (which runs in
  // the privileged main process) and wrap them in a blob: URL. The browser then
  // decodes the audio data in-process using WebKit's own codec stack rather than
  // the sandboxed GStreamer pipeline, which resolves the error on Fedora/GNOME.

  // Robust synchronous platform detection:
  // 1. Checks navigator.userAgentData?.platform (modern standard)
  // 2. Checks navigator.platform (legacy standard, e.g. "Win32", "Linux x86_64", "MacIntel")
  // 3. Checks navigator.userAgent
  // Notice: Windows is always checked first to prevent WebView2 on Windows from matching "Linux".
  private getPlatformSync(): 'linux' | 'windows' | 'macos' | 'other' {
    if (typeof navigator === 'undefined') return 'other';
    const ua = (navigator.userAgent || '').toLowerCase();
    const platform = (
      (navigator as any).userAgentData?.platform ||
      navigator.platform ||
      ''
    ).toLowerCase();

    if (platform.includes('win') || ua.includes('windows') || ua.includes('win32') || ua.includes('win64')) {
      return 'windows';
    }
    if (platform.includes('mac') || ua.includes('macintosh') || ua.includes('mac os')) {
      return 'macos';
    }
    if (platform.includes('linux') || ua.includes('linux') || ua.includes('x11')) {
      return 'linux';
    }
    return 'other';
  }

  private isTauriEnv(): boolean {
    return typeof window !== 'undefined' &&
      !!((window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__ || (window as any).__TAURI_METADATA__);
  }

  private revokeStaleBlobUrls(keepUrl?: string): void {
    for (const blobUrl of this.activeBlobUrls) {
      if (blobUrl !== keepUrl) {
        URL.revokeObjectURL(blobUrl);
        this.activeBlobUrls.delete(blobUrl);
      }
    }
  }

  /**
   * Helper to extract a clean filesystem path from a Tauri asset:// URL or direct path.
   * Handles both Linux (/home/...) and Windows (C:/... or C:\...) correctly.
   */
  public extractFsPathFromUrl(url: string): string | null {
    if (!url) return null;
    if (url.startsWith('blob:') || url.startsWith('data:') || url.startsWith('http:') || url.startsWith('https:')) {
      return null;
    }
    let fsPath = url;
    if (fsPath.startsWith('asset://')) {
      fsPath = fsPath.replace(/^asset:\/\/[^/]*/, '');
      fsPath = decodeURIComponent(fsPath);
    }
    // On Windows, asset:// URLs often encode the drive letter with a leading slash:
    // e.g. "/C:/Users/..." or "/C:\Users\..." — strip that leading slash so fs plugins get a valid path.
    if (/^\/[A-Za-z]:[/\\]/.test(fsPath)) {
      fsPath = fsPath.slice(1);
    }
    return fsPath;
  }

  /**
   * Reads the file via Tauri fs plugin and creates a blob: URL.
   * Used on Linux (WebKit2GTK sandbox workaround) and as a fallback if asset:// fails.
   */
  public async createBlobUrlFromFs(urlOrPath: string): Promise<string | null> {
    if (!this.isTauriEnv()) return null;
    const fsPath = this.extractFsPathFromUrl(urlOrPath);
    if (!fsPath) return null;
    try {
      const { readFile } = await import('@tauri-apps/plugin-fs');
      const bytes = await readFile(fsPath);
      const ext = fsPath.split('.').pop()?.toLowerCase() || '';
      const mime = (ext === 'm4a' || ext === 'aac' || ext === 'mp4') ? 'audio/mp4' : 'audio/mpeg';
      const blobUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
      this.activeBlobUrls.add(blobUrl);
      return blobUrl;
    } catch (e) {
      console.warn('[AudioEngine] createBlobUrlFromFs failed for path:', fsPath, e);
      return null;
    }
  }

  private _streamPort: number | null = null;

  private async getStreamPort(): Promise<number | null> {
    if (this._streamPort !== null) return this._streamPort;
    if (!this.isTauriEnv()) return null;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const port = await invoke<number>('get_audio_stream_port');
      if (port && port > 0) {
        this._streamPort = port;
        return port;
      }
    } catch (e) {
      console.warn('[AudioEngine] get_audio_stream_port not available:', e);
    }
    return null;
  }

  /**
   * On Linux/Tauri: streams audio through the local HTTP stream server (127.0.0.1:PORT)
   * with full HTTP 206 Partial Content and Range headers support, exactly like Museeks.
   * This completely bypasses WebKitGTK's GStreamer sandbox and broken asset:// seeking.
   * On Windows and macOS: returns the original asset:// URL unchanged, which is
   * natively supported by Chromium WebView2 and WebKit macOS.
   */
  private async resolveAudioUrl(url: string): Promise<string> {
    if (!this.isTauriEnv()) return url;
    const platform = this.getPlatformSync();
    if (platform === 'linux') {
      const fsPath = this.extractFsPathFromUrl(url);
      if (fsPath) {
        const port = await this.getStreamPort();
        if (port) {
          return `http://127.0.0.1:${port}/stream?path=${encodeURIComponent(fsPath)}`;
        }
      }
      // Fallback to blob URL if stream server port could not be obtained
      const blobUrl = await this.createBlobUrlFromFs(url);
      if (blobUrl) return blobUrl;
    }
    // On Windows, macOS, or fallback: return url as-is.
    return url;
  }

  private buildDeck(index: number): Deck {
    const ctx = this.audioCtx!;
    const audio = new Audio();
    // NOTE: Do NOT set audio.crossOrigin = 'anonymous' here.
    //
    // On Linux/WebKitGTK, setting crossOrigin on an HTMLAudioElement causes the
    // browser to enforce CORS on the Tauri asset:// protocol URL. The Tauri asset
    // handler does not return Access-Control-Allow-Origin headers for the media
    // streaming path, so WebKitGTK silently refuses to load the resource.
    // The result is: readyState stays HAVE_NOTHING (0), duration stays NaN,
    // currentTime never advances, and no loadedmetadata/canplay/timeupdate events
    // ever fire — the seek bar appears frozen and there is no audio output.
    //
    // crossOrigin is only needed when consuming decoded audio data from a
    // cross-origin resource via Web Audio. For local asset:// URLs served by the
    // same Tauri process, it provides no security benefit and actively breaks
    // media loading on WebKitGTK (Linux). Windows/macOS WebViews are more lenient
    // with local protocol CORS, which is why the bug only manifests on Linux.
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

    // ── Media lifecycle event listeners ──────────────────────────────────────────
    // These fire in order: loadstart → loadedmetadata → loadeddata →
    // canplay → canplaythrough → play → playing → timeupdate (repeating) →
    // pause | ended | error
    //
    // In development mode, all events are logged so it is immediately visible
    // exactly where the pipeline stalls (e.g. freezing after loadstart with no
    // loadedmetadata is the key indicator of Case B: media element not loading).
    if ((import.meta as any).env?.DEV) {
      const dbg = (event: string) => {
        const a = deck.audio;
        console.debug(
          `[AudioEngine] ${event} — ` +
          `readyState: ${a.readyState}, networkState: ${a.networkState}, ` +
          `duration: ${a.duration}, currentTime: ${a.currentTime}, ` +
          `paused: ${a.paused}, error: ${a.error?.code ?? 'none'}, ` +
          `src: ${a.src.slice(0, 80)}`
        );
      };
      audio.addEventListener('loadstart', () => dbg('loadstart'));
      audio.addEventListener('durationchange', () => dbg('durationchange'));
      audio.addEventListener('loadedmetadata', () => dbg('loadedmetadata'));
      audio.addEventListener('loadeddata', () => dbg('loadeddata'));
      audio.addEventListener('canplay', () => dbg('canplay'));
      audio.addEventListener('canplaythrough', () => dbg('canplaythrough'));
      audio.addEventListener('play', () => dbg('play'));
      audio.addEventListener('playing', () => dbg('playing'));
      audio.addEventListener('waiting', () => dbg('waiting'));
      audio.addEventListener('stalled', () => dbg('stalled'));
      audio.addEventListener('suspend', () => dbg('suspend'));
      audio.addEventListener('progress', () => dbg('progress'));
      audio.addEventListener('abort', () => dbg('abort'));
      audio.addEventListener('emptied', () => dbg('emptied'));
      audio.addEventListener('ended', () => dbg('ended'));
      audio.addEventListener('timeupdate', () => dbg('timeupdate'));
      audio.addEventListener('error', () => dbg('error'));
    }

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
    const isLinux = this.getPlatformSync() === 'linux';
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

    // On Linux/Tauri, convert the asset:// URL to a blob: URL to bypass the
    // WebKit2GTK GStreamer sandbox that blocks system codec plugins (error 4).
    const resolvedUrl = await this.resolveAudioUrl(url);
    // Pause current deck and reset before changing source
    deck.audio.pause();
    // For HTTP stream URLs (e.g. 127.0.0.1 stream server), crossOrigin MUST be 'anonymous'
    // so MediaElementAudioSourceNode can output audio without being muted by CORS security.
    // For asset:// URLs or blob: URLs, crossOrigin must NOT be set as it breaks WebKitGTK asset loading.
    if (resolvedUrl.startsWith('http:') || resolvedUrl.startsWith('https:')) {
      deck.audio.crossOrigin = 'anonymous';
    } else {
      deck.audio.removeAttribute('crossorigin');
    }
    deck.audio.src = resolvedUrl;
    deck.audio.load();
    deck.fadeGain = 1;
    deck.normalizationGain = 1;
    this.applyDeckGain(deck);

    // Wait for the browser media pipeline to buffer the beginning of the file (readyState >= HAVE_CURRENT_DATA)
    // so playback starts strictly from frame 0 and doesn't skip into the middle of the stream.
    const prepareAudioStart = (): Promise<void> => {
      return new Promise<void>((resolve) => {
        if (deck.audio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          try { deck.audio.currentTime = 0; } catch (_) {}
          resolve();
          return;
        }
        let settled = false;
        const onReady = () => {
          if (settled) return;
          settled = true;
          cleanup();
          try { deck.audio.currentTime = 0; } catch (_) {}
          resolve();
        };
        const cleanup = () => {
          deck.audio.removeEventListener('loadeddata', onReady);
          deck.audio.removeEventListener('canplay', onReady);
          deck.audio.removeEventListener('error', onReady);
        };
        deck.audio.addEventListener('loadeddata', onReady, { once: true });
        deck.audio.addEventListener('canplay', onReady, { once: true });
        deck.audio.addEventListener('error', onReady, { once: true });
        // Max wait 250ms so playback is not noticeably delayed if events already dispatched
        setTimeout(onReady, 250);
      });
    };

    await prepareAudioStart();

    let finalUrl = resolvedUrl;
    try {
      await deck.audio.play();
      if ((import.meta as any).env?.DEV) {
        console.debug(
          `[AudioEngine] play() resolved — currentTime: ${deck.audio.currentTime}, ` +
          `duration: ${deck.audio.duration}, paused: ${deck.audio.paused}`
        );
      }
    } catch (e) {
      // If direct playback failed and the url is an asset:// URL or local path that wasn't already a blob,
      // attempt reading directly from the filesystem as a resilient fallback for any OS.
      if (this.isTauriEnv() && !finalUrl.startsWith('blob:') && this.extractFsPathFromUrl(url)) {
        console.warn('Playback error with direct URL, attempting blob fallback:', e);
        const fallbackBlobUrl = await this.createBlobUrlFromFs(url);
        if (fallbackBlobUrl) {
          this.revokeStaleBlobUrls(fallbackBlobUrl);
          deck.audio.pause();
          deck.audio.src = fallbackBlobUrl;
          deck.audio.load();
          await prepareAudioStart();
          finalUrl = fallbackBlobUrl;
          try {
            await deck.audio.play();
            return;
          } catch (retryErr) {
            console.warn('Fallback blob playback failed:', retryErr);
          }
        }
      }

      console.warn('Playback error:', e);
      // NotSupportedError is thrown by play() when the codec is not available.
      if (e instanceof DOMException && e.name === 'NotSupportedError') {
        this.showCodecInstallPrompt();
      }
      // Propagate all errors so the UI can reset isPlaying state.
      if (e instanceof Error) {
        this.playbackErrorCallbacks.forEach(cb => cb(e as Error));
      }
      return;
    }

    // ── Apply normalization asynchronously after playback has started ──────────
    // Capture current deck/url so a rapid track-switch cannot apply a stale gain
    // to a different track. Use finalUrl for the src comparison since that's
    // what the audio element actually has.
    if (this.normalizationEnabled) {
      const capturedDeck = deck;
      const capturedUrl = finalUrl;
      this.estimateNormalizationGain(finalUrl, replayGainDb).then(gain => {
        // Only apply if this deck is still playing the same track.
        if (capturedDeck.audio.src === capturedUrl) {
          capturedDeck.normalizationGain = gain;
          this.applyDeckGain(capturedDeck);
        }
      }).catch(() => { /* Normalization failure is non-fatal; playback continues at unity gain. */ });
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

    // Resolve blob: URL on Linux/Tauri before assigning to the audio element.
    const resolvedUrl = await this.resolveAudioUrl(url);
    this.revokeStaleBlobUrls(resolvedUrl);

    newDeck.audio.pause();
    if (resolvedUrl.startsWith('http:') || resolvedUrl.startsWith('https:')) {
      newDeck.audio.crossOrigin = 'anonymous';
    } else {
      newDeck.audio.removeAttribute('crossorigin');
    }
    newDeck.audio.src = resolvedUrl;
    newDeck.audio.currentTime = 0;
    newDeck.normalizationGain = 1;
    newDeck.fadeGain = 0;
    this.applyDeckGain(newDeck);

    // Start the next track immediately. Normalization analysis must never delay the fade.
    try {
      await newDeck.audio.play();
    } catch (e) {
      // If direct asset playback fails during crossfade, try fallback to blob
      if (this.isTauriEnv() && !resolvedUrl.startsWith('blob:') && this.extractFsPathFromUrl(url)) {
        const fallbackBlob = await this.createBlobUrlFromFs(url);
        if (fallbackBlob) {
          newDeck.audio.src = fallbackBlob;
          newDeck.audio.currentTime = 0;
          try {
            await newDeck.audio.play();
          } catch (retryErr) {
            console.warn('Fallback blob crossfade failed:', retryErr);
            return;
          }
        } else {
          return;
        }
      } else {
        console.warn('Crossfade play failed:', e);
        return;
      }
    }
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

  public getAnalyserData(dataArray: Uint8Array<ArrayBuffer>): void { this.activeDeck?.analyser.getByteFrequencyData(dataArray); }
  public getWaveformData(dataArray: Uint8Array<ArrayBuffer>): void { this.activeDeck?.analyser.getByteTimeDomainData(dataArray); }

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

  /**
   * Subscribe to playback errors from play().
   * The callback receives the underlying Error so the UI can reset isPlaying state.
   */
  public onPlaybackError(callback: (error: Error) => void): () => void {
    this.playbackErrorCallbacks.add(callback);
    return () => this.playbackErrorCallbacks.delete(callback);
  }

}

export const audioEngine = new AudioEngine();
