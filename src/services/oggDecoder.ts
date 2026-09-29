/**
 * OGG Vorbis JavaScript decoder for platforms without native OGG support.
 *
 * macOS WKWebView (WebKit) ships no OGG Vorbis codec. Any <audio> element
 * pointed at an OGG file on macOS fires MEDIA_ERR_SRC_NOT_SUPPORTED.
 *
 * This module fixes that by:
 *   1. Detecting whether the current platform supports OGG natively.
 *   2. If not, decoding the raw OGG bytes to PCM via a WASM-based decoder
 *      (@wasm-audio-decoders/ogg-vorbis, lazily imported on first use).
 *   3. Encoding the PCM data as a 16-bit WAV Blob that every platform can play,
 *      without any changes to the AudioEngine, EQ chain, or deck system.
 *
 * The WASM module is embedded as base64 inside the npm package so no separate
 * .wasm file handling or Vite plugin configuration is required.
 */

let _cachedOggSupport: boolean | null = null;

/**
 * Returns true when the current browser/WebView can natively decode OGG Vorbis.
 * Cached after first call.
 *
 *   macOS WKWebView  -> false  (no OGG codec in WebKit/AVFoundation)
 *   Windows WebView2 -> true   (Chromium includes OGG support)
 *   Linux WebKitGTK  -> true   (GStreamer provides OGG via system plugins)
 *   Chrome / Firefox -> true
 *   Safari           -> false
 */
export function isOggNativelySupported(): boolean {
  if (_cachedOggSupport !== null) return _cachedOggSupport;
  try {
    const a = document.createElement('audio');
    const r = a.canPlayType('audio/ogg; codecs="vorbis"');
    _cachedOggSupport = r === 'probably' || r === 'maybe';
  } catch {
    _cachedOggSupport = false;
  }
  return _cachedOggSupport;
}

/**
 * Returns true if the URL or file-path hint refers to an OGG Vorbis file.
 * Works for asset:// URLs (Tauri), plain paths, and http(s) URLs.
 * Returns false for blob: URLs (format is not encoded in the URL).
 */
export function urlOrPathIsOgg(urlOrPath: string): boolean {
  if (!urlOrPath || urlOrPath.startsWith('blob:')) return false;
  return /\.(ogg|oga)([?#]|$)/i.test(urlOrPath);
}

// ─── WAV encoding ─────────────────────────────────────────────────────────────

function writeStr(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}

/**
 * Encodes multi-channel Float32 PCM as a 16-bit PCM WAV Blob.
 * channelData layout: channelData[channel][sampleIndex] (same as AudioBuffer).
 */
export function encodeWAV(channelData: Float32Array[], sampleRate: number): Blob {
  const numChannels = channelData.length;
  const numSamples  = channelData[0]?.length ?? 0;
  const bps         = 2; // bytes per sample — 16-bit PCM
  const dataSize    = numChannels * numSamples * bps;
  const buf         = new ArrayBuffer(44 + dataSize);
  const view        = new DataView(buf);

  writeStr(view,  0, 'RIFF');
  view.setUint32 ( 4, 36 + dataSize,                  true);
  writeStr(view,  8, 'WAVE');
  writeStr(view, 12, 'fmt ');
  view.setUint32 (16, 16,                              true); // fmt chunk size
  view.setUint16 (20,  1,                              true); // PCM format
  view.setUint16 (22, numChannels,                     true);
  view.setUint32 (24, sampleRate,                      true);
  view.setUint32 (28, sampleRate * numChannels * bps,  true); // byte rate
  view.setUint16 (32, numChannels * bps,               true); // block align
  view.setUint16 (34, 16,                              true); // bits per sample
  writeStr(view, 36, 'data');
  view.setUint32 (40, dataSize,                        true);

  // Interleave channels, float32 -> int16
  let off = 44;
  for (let i = 0; i < numSamples; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const s = Math.max(-1, Math.min(1, channelData[ch][i]));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
  }

  return new Blob([buf], { type: 'audio/wav' });
}

// ─── OGG decoding ─────────────────────────────────────────────────────────────

/**
 * Decodes raw OGG Vorbis bytes to a WAV Blob via the WASM decoder
 * (@wasm-audio-decoders/ogg-vorbis), lazily loaded on first call.
 *
 * For memory safety (especially on macOS WKWebView), accepts an optional maxOutputBytes
 * guard (defaults to 128 MB PCM, ~12 minutes stereo 44.1kHz). If an OGG file is unusually huge,
 * decoding can be bounded to prevent multi-hundred-megabyte out-of-memory crashes.
 *
 * Returns null if the decoder fails to load, data is corrupt, or output exceeds safety limits.
 */
export async function decodeOggToWav(bytes: Uint8Array, maxOutputBytes: number = 128 * 1024 * 1024): Promise<Blob | null> {
  try {
    // Dynamic import keeps the ~1 MB WASM bundle out of the critical path.
    // Vite places this in a separate split chunk (see vite.config.ts manualChunks).
    const { OggVorbisDecoder } = await import('@wasm-audio-decoders/ogg-vorbis');
    const decoder = new OggVorbisDecoder();
    await decoder.ready;

    const { channelData, sampleRate } = await decoder.decode(bytes);
    decoder.free();

    if (!channelData?.length || !channelData[0]?.length) {
      console.warn('[OggDecoder] Decoder returned empty channel data.');
      return null;
    }

    const numChannels = channelData.length;
    const numSamples = channelData[0].length;
    const estimatedPcmSize = numChannels * numSamples * 2;
    if (estimatedPcmSize > maxOutputBytes) {
      console.warn(`[OggDecoder] Decoded PCM size (${(estimatedPcmSize / (1024 * 1024)).toFixed(1)} MB) exceeds safe ceiling (${(maxOutputBytes / (1024 * 1024)).toFixed(1)} MB). Aborting to avoid WKWebView memory spike.`);
      return null;
    }

    return encodeWAV(channelData, sampleRate);
  } catch (err) {
    console.warn('[OggDecoder] Failed to decode OGG Vorbis:', err);
    return null;
  }
}

/**
 * Fetches an OGG file from any URL (blob:, asset://, http(s)://) and decodes
 * it to a WAV Blob. Returns null on fetch or decode failure.
 */
export async function decodeOggUrlToWav(url: string, maxOutputBytes?: number): Promise<Blob | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[OggDecoder] HTTP ${res.status} fetching OGG: ${url.slice(0, 80)}`);
      return null;
    }
    return decodeOggToWav(new Uint8Array(await res.arrayBuffer()), maxOutputBytes);
  } catch (err) {
    console.warn('[OggDecoder] Failed to fetch OGG for decoding:', err);
    return null;
  }
}

