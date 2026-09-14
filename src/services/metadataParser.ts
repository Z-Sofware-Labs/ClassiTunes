import * as parseAudioMetadata from 'music-metadata-browser';
// @ts-ignore
import jsmediatags from 'jsmediatags/dist/jsmediatags.min.js';
import { Track } from '../types';
import { generateAlbumArtwork } from '../utils/artworkGenerator';
import { saveMediaFile, getMediaFile, dataURLtoBlob } from './mediaStorage';

function bufferToBase64(buffer: ArrayBuffer | Uint8Array | number[], mimeType: string): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  const len = bytes.byteLength;
  const chunk = 8192;
  for (let i = 0; i < len; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(i, Math.min(i + chunk, len)) as unknown as number[]
    );
  }
  return `data:${mimeType || 'image/jpeg'};base64,${window.btoa(binary)}`;
}

function parseWithJsMediaTags(file: File): Promise<any> {
  return new Promise((resolve) => {
    try {
      jsmediatags.read(file, {
        onSuccess: (tag: any) => resolve(tag?.tags || null),
        onError: () => resolve(null),
      });
    } catch (e) {
      resolve(null);
    }
  });
}

export interface ExtractedID3Tags {
  title?: string;
  artist?: string;
  albumArtist?: string;
  album?: string;
  composer?: string;
  publisher?: string;
  lyrics?: string;
  replayGainDb?: number;
  genre?: string;
  year?: number;
  trackNumber?: number;
  trackTotal?: number;
  discNumber?: number;
  discTotal?: number;
  bpm?: number;
  mediaKind?: 'Music' | 'Podcast' | 'Audiobook' | 'Voice Memo' | string;
  format?: string;
  bitrate?: number;
  sampleRate?: number;
  duration?: number;
  sizeBytes?: number;
  coverUrl?: string;
  comments?: string;
}

interface Mp4TagsResult {
  title?: string;
  artist?: string;
  albumArtist?: string;
  album?: string;
  composer?: string;
  publisher?: string;
  lyrics?: string;
  genre?: string;
  year?: number;
  trackNumber?: number;
  trackTotal?: number;
  discNumber?: number;
  discTotal?: number;
  bpm?: number;
  mediaKind?: 'Music' | 'Podcast' | 'Audiobook' | 'Voice Memo' | string;
  comments?: string;
  coverUrl?: string;
  duration?: number;
  bitrate?: number;
  sampleRate?: number;
}

function findMvhdDuration(bytes: Uint8Array): number | undefined {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i <= bytes.length - 32; i++) {
    if (
      bytes[i + 4] === 0x6d && // 'm'
      bytes[i + 5] === 0x76 && // 'v'
      bytes[i + 6] === 0x68 && // 'h'
      bytes[i + 7] === 0x64    // 'd'
    ) {
      const version = bytes[i + 8];
      let timescale = 0;
      let durationUnits = 0;
      if (version === 0 && i + 28 <= bytes.length) {
        timescale = v.getUint32(i + 20, false);
        durationUnits = v.getUint32(i + 24, false);
      } else if (version === 1 && i + 36 <= bytes.length) {
        timescale = v.getUint32(i + 28, false);
        const high = v.getUint32(i + 32, false);
        const low = v.getUint32(i + 36, false);
        durationUnits = high * 4294967296 + low;
      }
      if (timescale > 0 && durationUnits > 0) {
        const dur = durationUnits / timescale;
        if (dur > 0 && isFinite(dur)) return dur;
      }
    }
  }
  return undefined;
}

async function parseMp4Atoms(file: File): Promise<Mp4TagsResult | null> {
  try {
    const findIlst = (bytes: Uint8Array): { offset: number; size: number } | null => {
      const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      for (let i = 0; i <= bytes.length - 8; i++) {
        if (
          bytes[i + 4] === 0x69 && // 'i'
          bytes[i + 5] === 0x6c && // 'l'
          bytes[i + 6] === 0x73 && // 's'
          bytes[i + 7] === 0x74    // 't'
        ) {
          const sz = v.getUint32(i, false);
          if (sz >= 8 && sz < 100 * 1024 * 1024) {
            return { offset: i + 8, size: sz - 8 };
          }
        }
      }
      return null;
    };

    let bytes: Uint8Array | null = null;
    let ilstOffset = -1;
    let ilstSize = 0;

    // First: check top-level atom structure to jump over huge 'mdat' atoms (0ms performance)
    let pos = 0;
    while (pos + 8 <= file.size && pos < 100 * 1024 * 1024) {
      const atomHeaderBuf = await file.slice(pos, pos + 16).arrayBuffer();
      if (atomHeaderBuf.byteLength < 8) break;
      const atomView = new DataView(atomHeaderBuf);
      let atomSize = atomView.getUint32(0, false);
      const atomBytes = new Uint8Array(atomHeaderBuf);
      const atomType = String.fromCharCode(atomBytes[4], atomBytes[5], atomBytes[6], atomBytes[7]);

      if (atomSize === 1 && atomHeaderBuf.byteLength >= 16) {
        const high = atomView.getUint32(8, false);
        const low = atomView.getUint32(12, false);
        atomSize = high * 4294967296 + low;
      }

      if (atomSize < 8) break;

      if (atomType === 'moov' || atomType === 'udta' || atomType === 'meta' || atomType === 'ilst') {
        const atomBuf = await file.slice(pos, Math.min(file.size, pos + atomSize)).arrayBuffer();
        const atomData = new Uint8Array(atomBuf);
        const found = findIlst(atomData);
        if (found) {
          bytes = atomData;
          ilstOffset = found.offset;
          ilstSize = found.size;
          break;
        }
      }

      pos += atomSize;
    }

    // Fallback 1: Read first 4MB
    if (ilstOffset === -1) {
      const headBuf = await file.slice(0, Math.min(file.size, 4 * 1024 * 1024)).arrayBuffer();
      const headBytes = new Uint8Array(headBuf);
      const found = findIlst(headBytes);
      if (found) {
        bytes = headBytes;
        ilstOffset = found.offset;
        ilstSize = found.size;
      }
    }

    // Fallback 2: Read last 16MB of file (where moov/ilst atoms are placed in many exported M4A/AAC files)
    if (ilstOffset === -1 && file.size > 4 * 1024 * 1024) {
      const tailSize = Math.min(file.size, 16 * 1024 * 1024);
      const tailBuf = await file.slice(file.size - tailSize, file.size).arrayBuffer();
      const tailBytes = new Uint8Array(tailBuf);
      const found = findIlst(tailBytes);
      if (found) {
        bytes = tailBytes;
        ilstOffset = found.offset;
        ilstSize = found.size;
      }
    }

    if (!bytes || ilstOffset === -1) {
      return null;
    }

    const result: Mp4TagsResult = {};
    const ilstView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const ilstEnd = Math.min(bytes.length, ilstOffset + ilstSize);
    let p = ilstOffset;
    const decoder = new TextDecoder('utf-8');

    while (p + 8 <= ilstEnd) {
      const atomSize = ilstView.getUint32(p, false);
      if (atomSize < 8 || p + atomSize > bytes.length) break;

      const tagCode = (bytes[p + 4] << 24) | (bytes[p + 5] << 16) | (bytes[p + 6] << 8) | bytes[p + 7];
      const tagStr = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);

      const itemEnd = p + atomSize;
      let dataPos = p + 8;

      while (dataPos + 8 <= itemEnd) {
        const subSize = ilstView.getUint32(dataPos, false);
        if (subSize < 8 || dataPos + subSize > itemEnd) break;

        const subType = String.fromCharCode(
          bytes[dataPos + 4], bytes[dataPos + 5], bytes[dataPos + 6], bytes[dataPos + 7]
        );

        if (subType === 'data') {
          const dataType = ilstView.getUint32(dataPos + 8, false);
          const payloadStart = dataPos + 16;
          const payloadLen = subSize - 16;

          if (payloadLen > 0 && payloadStart + payloadLen <= bytes.length) {
            const payload = bytes.subarray(payloadStart, payloadStart + payloadLen);

            if (tagStr === '©nam' || tagStr === '\xa9nam' || tagCode === 0xa96e616d) {
              result.title = decoder.decode(payload).replace(/\0/g, '').trim();
            } else if (tagStr === '©ART' || tagStr === '\xa9ART' || tagCode === 0xa9415254) {
              result.artist = decoder.decode(payload).replace(/\0/g, '').trim();
            } else if (tagStr === 'aART' || tagCode === 0x61415254) {
              result.albumArtist = decoder.decode(payload).replace(/\0/g, '').trim();
            } else if (tagStr === '©alb' || tagStr === '\xa9alb' || tagCode === 0xa9616c62) {
              result.album = decoder.decode(payload).replace(/\0/g, '').trim();
            } else if (tagStr === '©wrt' || tagStr === '\xa9wrt' || tagCode === 0xa9777274) {
              result.composer = decoder.decode(payload).replace(/\0/g, '').trim();
            } else if (tagStr === '©pub' || tagStr === '\xa9pub' || tagCode === 0xa9707562) {
              result.publisher = decoder.decode(payload).replace(/\0/g, '').trim();
            } else if (tagStr === '©lyr' || tagStr === '\xa9lyr' || tagCode === 0xa96c7972) {
              result.lyrics = decoder.decode(payload).replace(/\0/g, '').trim();
            } else if (tagStr === '©cmt' || tagStr === '\xa9cmt' || tagCode === 0xa9636d74) {
              result.comments = decoder.decode(payload).replace(/\0/g, '').trim();
            } else if (tagStr === 'tmpo' || tagCode === 0x746d706f) {
              if (payload.length >= 2) {
                const bpmVal = (payload[0] << 8) | payload[1];
                if (bpmVal > 0) result.bpm = bpmVal;
              }
            } else if (tagStr === 'stik' || tagCode === 0x7374696b) {
              if (payload.length >= 1) {
                const stikVal = payload[payload.length - 1];
                if (stikVal === 2) result.mediaKind = 'Audiobook';
                else if (stikVal === 21) result.mediaKind = 'Podcast';
                else if (stikVal === 6) result.mediaKind = 'Voice Memo';
                else result.mediaKind = 'Music';
              }
            } else if (tagStr === '©day' || tagStr === '\xa9day' || tagCode === 0xa9646179) {
              const yrStr = decoder.decode(payload).replace(/\0/g, '').trim();
              const yr = parseInt(yrStr, 10);
              if (!isNaN(yr)) result.year = yr;
            } else if (tagStr === '©gen' || tagStr === '\xa9gen' || tagCode === 0xa967656e || tagStr === 'gnre') {
              if (dataType === 1) {
                result.genre = decoder.decode(payload).replace(/\0/g, '').trim();
              } else if (payload.length >= 2) {
                const genreIdx = ((payload[0] << 8) | payload[1]) - 1;
                const GENRES = ['Blues', 'Classic Rock', 'Country', 'Dance', 'Disco', 'Funk', 'Grunge', 'Hip-Hop', 'Jazz', 'Metal', 'New Age', 'Oldies', 'Other', 'Pop', 'R&B', 'Rap', 'Reggae', 'Rock', 'Techno', 'Industrial', 'Alternative', 'Ska', 'Death Metal', 'Pranks', 'Soundtrack', 'Euro-Techno', 'Ambient', 'Trip-Hop', 'Vocal', 'Jazz+Funk', 'Fusion', 'Trance', 'Classical', 'Instrumental', 'Acid', 'House', 'Game', 'Sound Clip', 'Gospel', 'Noise', 'AlternRock', 'Bass', 'Soul', 'Punk', 'Space', 'Meditative', 'Instrumental Pop', 'Instrumental Rock', 'Ethnic', 'Gothic', 'Darkwave', 'Techno-Industrial', 'Electronic', 'Pop-Folk', 'Eurodance', 'Dream', 'Southern Rock', 'Comedy', 'Cult', 'Gangsta', 'Top 40', 'Christian Rap', 'Pop/Funk', 'Jungle', 'Native American', 'Cabaret', 'New Wave', 'Psychadelic', 'Rave', 'Showtunes', 'Trailer', 'Lo-Fi', 'Tribal', 'Acid Punk', 'Acid Jazz', 'Polka', 'Retro', 'Musical', 'Rock & Roll', 'Hard Rock'];
                if (genreIdx >= 0 && genreIdx < GENRES.length) {
                  result.genre = GENRES[genreIdx];
                }
              }
            } else if (tagStr === 'trkn' || tagCode === 0x74726b6e) {
              if (payload.length >= 4) {
                const trk = (payload[2] << 8) | payload[3];
                if (trk > 0) result.trackNumber = trk;
                if (payload.length >= 6) {
                  const tot = (payload[4] << 8) | payload[5];
                  if (tot > 0) result.trackTotal = tot;
                }
              }
            } else if (tagStr === 'disk' || tagCode === 0x6469736b) {
              if (payload.length >= 4) {
                const dsk = (payload[2] << 8) | payload[3];
                if (dsk > 0) result.discNumber = dsk;
                if (payload.length >= 6) {
                  const dtot = (payload[4] << 8) | payload[5];
                  if (dtot > 0) result.discTotal = dtot;
                }
              }
            } else if (tagStr === 'covr' || tagCode === 0x636f7672) {
              try {
                let mimeType = 'image/jpeg';
                if (
                  payload.length >= 4 &&
                  payload[0] === 0x89 &&
                  payload[1] === 0x50 &&
                  payload[2] === 0x4e &&
                  payload[3] === 0x47
                ) {
                  mimeType = 'image/png';
                }
                result.coverUrl = bufferToBase64(payload, mimeType);
              } catch (e) {}
            }
          }
          break;
        }
        dataPos += subSize;
      }

      p += atomSize;
    }

    if (!result.artist && result.albumArtist) {
      result.artist = result.albumArtist;
    }

    const dur = findMvhdDuration(bytes);
    if (dur && dur > 0) {
      result.duration = dur;
    }

    return Object.keys(result).length > 0 ? result : null;
  } catch (e) {
    return null;
  }
}

interface BinaryID3Result {
  title?: string;
  artist?: string;
  albumArtist?: string;
  album?: string;
  composer?: string;
  publisher?: string;
  lyrics?: string;
  genre?: string;
  year?: number;
  trackNumber?: number;
  trackTotal?: number;
  discNumber?: number;
  discTotal?: number;
  bpm?: number;
  mediaKind?: 'Music' | 'Podcast' | 'Audiobook' | 'Voice Memo' | string;
  comments?: string;
  coverUrl?: string;
  duration?: number;
  bitrate?: number;
  sampleRate?: number;
}

async function parseAudioFileHeader(file: File): Promise<{ duration?: number; bitrate?: number; sampleRate?: number } | null> {
  try {
    const headSlice = file.slice(0, Math.min(file.size, 256 * 1024));
    const headBuf = await headSlice.arrayBuffer();
    const bytes = new Uint8Array(headBuf);
    const view = new DataView(headBuf);

    if (bytes.length < 12) return null;

    // 1. WAV / RIFF
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) { // 'RIFF'
      let pos = 12;
      let byteRate = 0;
      let dataSize = 0;
      let sampleRate = 44100;
      while (pos + 8 <= bytes.length) {
        const chunkId = String.fromCharCode(bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]);
        const chunkSize = view.getUint32(pos + 4, true); // little-endian
        if (chunkId === 'fmt ' && pos + 20 <= bytes.length) {
          sampleRate = view.getUint32(pos + 12, true);
          byteRate = view.getUint32(pos + 16, true);
        } else if (chunkId === 'data') {
          dataSize = chunkSize || (file.size - pos - 8);
          break;
        }
        pos += 8 + chunkSize;
      }
      if (byteRate > 0) {
        const dur = (dataSize || (file.size - 44)) / byteRate;
        if (dur > 0 && isFinite(dur)) {
          return { duration: dur, sampleRate, bitrate: Math.round((byteRate * 8) / 1000) };
        }
      }
    }

    // 2. FLAC
    if (bytes[0] === 0x66 && bytes[1] === 0x4c && bytes[2] === 0x61 && bytes[3] === 0x43) { // 'fLaC'
      if (bytes.length >= 42) {
        // STREAMINFO metadata block starts at offset 4
        // Bytes 18-25: sample rate (20 bits), channels (3 bits), bits per sample (5 bits), total samples (36 bits)
        const b0 = bytes[18], b1 = bytes[19], b2 = bytes[20], b3 = bytes[21], b4 = bytes[22], b5 = bytes[23], b6 = bytes[24], b7 = bytes[25];
        const sampleRate = (b0 << 12) | (b1 << 4) | (b2 >> 4);
        const totalSamples = ((b3 & 0x0f) * 4294967296) + ((b4 << 24) | (b5 << 16) | (b6 << 8) | b7);
        if (sampleRate > 0 && totalSamples > 0) {
          const dur = totalSamples / sampleRate;
          return { duration: dur, sampleRate };
        }
      }
    }

    // 3. MP3 (MPEG audio frames / Xing / VBRI / ID3 TLEN)
    let audioOffset = 0;
    // Skip ID3v2 if present
    if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
      const tagSize = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
      audioOffset = 10 + tagSize;
    }

    // If audioOffset is beyond our slice, read a slice starting at audioOffset
    let mpegBytes = bytes;
    let mpegOffset = audioOffset;
    if (audioOffset + 32 > bytes.length && audioOffset < file.size) {
      const mpegSlice = file.slice(audioOffset, Math.min(file.size, audioOffset + 16384));
      const mpegBuf = await mpegSlice.arrayBuffer();
      mpegBytes = new Uint8Array(mpegBuf);
      mpegOffset = 0;
    }

    // Search for MPEG frame sync (11 bits all 1s: 0xFF followed by 0xE0+)
    for (let i = mpegOffset; i <= mpegBytes.length - 4; i++) {
      if (mpegBytes[i] === 0xff && (mpegBytes[i + 1] & 0xe0) === 0xe0) {
        const b1 = mpegBytes[i + 1];
        const b2 = mpegBytes[i + 2];
        const b3 = mpegBytes[i + 3];

        const mpegVersionId = (b1 >> 3) & 0x03; // 3 = MPEG-1, 2 = MPEG-2, 0 = MPEG-2.5
        const layerId = (b1 >> 1) & 0x03; // 1 = Layer III, 2 = Layer II, 3 = Layer I
        const bitrateIdx = (b2 >> 4) & 0x0f;
        const sampleRateIdx = (b2 >> 2) & 0x03;
        const channelMode = (b3 >> 6) & 0x03;

        if (layerId === 1 && mpegVersionId === 3 && bitrateIdx > 0 && bitrateIdx < 15 && sampleRateIdx < 3) {
          const BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
          const SAMPLERATES = [44100, 48000, 32000];
          const bitrate = BITRATES[bitrateIdx];
          const sampleRate = SAMPLERATES[sampleRateIdx];

          // Check for Xing / Info header
          const xingOffset = i + (channelMode === 3 ? 21 : 36);
          if (xingOffset + 12 <= mpegBytes.length) {
            const tag = String.fromCharCode(
              mpegBytes[xingOffset], mpegBytes[xingOffset + 1],
              mpegBytes[xingOffset + 2], mpegBytes[xingOffset + 3]
            );
            if (tag === 'Xing' || tag === 'Info') {
              const flags = (mpegBytes[xingOffset + 4] << 24) | (mpegBytes[xingOffset + 5] << 16) | (mpegBytes[xingOffset + 6] << 8) | mpegBytes[xingOffset + 7];
              if (flags & 1) {
                const frames = (mpegBytes[xingOffset + 8] << 24) | (mpegBytes[xingOffset + 9] << 16) | (mpegBytes[xingOffset + 10] << 8) | mpegBytes[xingOffset + 11];
                if (frames > 0 && sampleRate > 0) {
                  const dur = (frames * 1152) / sampleRate;
                  return { duration: dur, sampleRate, bitrate };
                }
              }
            }
          }

          // Check for VBRI header
          const vbriOffset = i + 36;
          if (vbriOffset + 18 <= mpegBytes.length) {
            const tag = String.fromCharCode(
              mpegBytes[vbriOffset], mpegBytes[vbriOffset + 1],
              mpegBytes[vbriOffset + 2], mpegBytes[vbriOffset + 3]
            );
            if (tag === 'VBRI') {
              const frames = (mpegBytes[vbriOffset + 14] << 24) | (mpegBytes[vbriOffset + 15] << 16) | (mpegBytes[vbriOffset + 16] << 8) | mpegBytes[vbriOffset + 17];
              if (frames > 0 && sampleRate > 0) {
                const dur = (frames * 1152) / sampleRate;
                return { duration: dur, sampleRate, bitrate };
              }
            }
          }

          // Fallback for CBR MP3: file size minus ID3 size / bitrate
          const audioBytes = Math.max(0, file.size - audioOffset);
          if (bitrate > 0 && audioBytes > 0) {
            const dur = (audioBytes * 8) / (bitrate * 1000);
            return { duration: dur, sampleRate, bitrate };
          }
        }
      }
    }

    return null;
  } catch (e) {
    return null;
  }
}

async function parseBinaryID3(file: File): Promise<BinaryID3Result | null> {
  try {
    const headerSlice = file.slice(0, Math.min(file.size, 512 * 1024));
    const buffer = await headerSlice.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const result: BinaryID3Result = {};

    if (bytes.length >= 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
      const versionMajor = bytes[3];
      const flags = bytes[5];
      const tagSize = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);

      let offset = 10;
      if ((flags & 0x40) !== 0 && versionMajor >= 3) {
        if (offset + 4 <= bytes.length) {
          const extHeaderSize = (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
          offset += extHeaderSize;
        }
      }

      const endOffset = Math.min(bytes.length, 10 + tagSize);
      const decoderIso = new TextDecoder('iso-8859-1');
      const decoderUtf8 = new TextDecoder('utf-8');
      const decoderUtf16 = new TextDecoder('utf-16');

      const decodeText = (encoding: number, data: Uint8Array): string => {
        try {
          if (encoding === 0) return decoderIso.decode(data).replace(/\0/g, '').trim();
          if (encoding === 1 || encoding === 2) return decoderUtf16.decode(data).replace(/\0/g, '').trim();
          if (encoding === 3) return decoderUtf8.decode(data).replace(/\0/g, '').trim();
        } catch (e) {
          return decoderUtf8.decode(data).replace(/\0/g, '').trim();
        }
        return decoderIso.decode(data).replace(/\0/g, '').trim();
      };

      if (versionMajor === 3 || versionMajor === 4) {
        while (offset + 10 < endOffset) {
          if (bytes[offset] === 0) break;
          const frameId = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
          let frameSize = 0;
          if (versionMajor === 4) {
            frameSize = ((bytes[offset + 4] & 0x7f) << 21) | ((bytes[offset + 5] & 0x7f) << 14) | ((bytes[offset + 6] & 0x7f) << 7) | (bytes[offset + 7] & 0x7f);
          } else {
            frameSize = (bytes[offset + 4] << 24) | (bytes[offset + 5] << 16) | (bytes[offset + 6] << 8) | bytes[offset + 7];
          }

          offset += 10;
          if (frameSize <= 0 || offset + frameSize > bytes.length) break;

          const frameData = bytes.subarray(offset, offset + frameSize);
          offset += frameSize;

          if (frameData.length > 1) {
            const encoding = frameData[0];
            const textContent = decodeText(encoding, frameData.subarray(1));

            if (frameId === 'TIT2' && textContent) result.title = textContent;
            else if (frameId === 'TPE1' && textContent) result.artist = textContent;
            else if (frameId === 'TPE2' && textContent) result.albumArtist = textContent;
            else if (frameId === 'TALB' && textContent) result.album = textContent;
            else if (frameId === 'TCOM' && textContent) result.composer = textContent;
            else if (frameId === 'TBPM' && textContent) {
              const b = parseInt(textContent, 10);
              if (!isNaN(b) && b > 0) result.bpm = b;
            } else if (frameId === 'COMM' && textContent) {
              result.comments = textContent.replace(/^[a-zA-Z]{3}/, '').trim() || textContent;
            } else if (frameId === 'TCON' && textContent) {
              const match = textContent.match(/^\(?(\d+)\)?$/);
              if (match) {
                const idx = parseInt(match[1], 10);
                const GENRES = ['Blues', 'Classic Rock', 'Country', 'Dance', 'Disco', 'Funk', 'Grunge', 'Hip-Hop', 'Jazz', 'Metal', 'New Age', 'Oldies', 'Other', 'Pop', 'R&B', 'Rap', 'Reggae', 'Rock', 'Techno', 'Industrial', 'Alternative', 'Ska', 'Death Metal', 'Pranks', 'Soundtrack', 'Euro-Techno', 'Ambient', 'Trip-Hop', 'Vocal', 'Jazz+Funk', 'Fusion', 'Trance', 'Classical', 'Instrumental', 'Acid', 'House', 'Game', 'Sound Clip', 'Gospel', 'Noise', 'AlternRock', 'Bass', 'Soul', 'Punk', 'Space', 'Meditative', 'Instrumental Pop', 'Instrumental Rock', 'Ethnic', 'Gothic', 'Darkwave', 'Techno-Industrial', 'Electronic', 'Pop-Folk', 'Eurodance', 'Dream', 'Southern Rock', 'Comedy', 'Cult', 'Gangsta', 'Top 40', 'Christian Rap', 'Pop/Funk', 'Jungle', 'Native American', 'Cabaret', 'New Wave', 'Psychadelic', 'Rave', 'Showtunes', 'Trailer', 'Lo-Fi', 'Tribal', 'Acid Punk', 'Acid Jazz', 'Polka', 'Retro', 'Musical', 'Rock & Roll', 'Hard Rock'];
                result.genre = (idx >= 0 && idx < GENRES.length) ? GENRES[idx] : textContent;
              } else {
                result.genre = textContent;
              }
            } else if ((frameId === 'TYER' || frameId === 'TDRC') && textContent) {
              const yr = parseInt(textContent, 10);
              if (!isNaN(yr)) result.year = yr;
            } else if (frameId === 'TRCK' && textContent) {
              const parts = textContent.split('/');
              const trk = parseInt(parts[0], 10);
              if (!isNaN(trk)) result.trackNumber = trk;
              if (parts.length > 1) {
                const tot = parseInt(parts[1], 10);
                if (!isNaN(tot)) result.trackTotal = tot;
              }
            } else if (frameId === 'TPOS' && textContent) {
              const parts = textContent.split('/');
              const dsk = parseInt(parts[0], 10);
              if (!isNaN(dsk)) result.discNumber = dsk;
              if (parts.length > 1) {
                const tot = parseInt(parts[1], 10);
                if (!isNaN(tot)) result.discTotal = tot;
              }
            } else if (frameId === 'TLEN' && textContent) {
              const ms = parseInt(textContent, 10);
              if (!isNaN(ms) && ms > 0) result.duration = ms / 1000;
            } else if (frameId === 'APIC') {
              try {
                let p = 1;
                let mime = '';
                while (p < frameData.length && frameData[p] !== 0) {
                  mime += String.fromCharCode(frameData[p]);
                  p++;
                }
                p++;
                if (p < frameData.length) p++;
                if (encoding === 1 || encoding === 2) {
                  while (p + 1 < frameData.length && !(frameData[p] === 0 && frameData[p + 1] === 0)) p += 2;
                  p += 2;
                } else {
                  while (p < frameData.length && frameData[p] !== 0) p++;
                  p++;
                }
                if (p < frameData.length) {
                  const imgData = frameData.subarray(p);
                  if (imgData.length > 0) {
                    const mimeType = mime.includes('/') ? mime : 'image/jpeg';
                    result.coverUrl = bufferToBase64(imgData, mimeType);
                  }
                }
              } catch (e) {}
            }
          }
        }
      } else if (versionMajor === 2) {
        while (offset + 6 < endOffset) {
          if (bytes[offset] === 0) break;
          const frameId = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2]);
          const frameSize = (bytes[offset + 3] << 16) | (bytes[offset + 4] << 8) | bytes[offset + 5];
          offset += 6;
          if (frameSize <= 0 || offset + frameSize > bytes.length) break;

          const frameData = bytes.subarray(offset, offset + frameSize);
          offset += frameSize;

          if (frameData.length > 1) {
            const encoding = frameData[0];
            const textContent = decodeText(encoding, frameData.subarray(1));

            if (frameId === 'TT2' && textContent) result.title = textContent;
            else if (frameId === 'TP1' && textContent) result.artist = textContent;
            else if (frameId === 'TP2' && textContent) result.albumArtist = textContent;
            else if (frameId === 'TAL' && textContent) result.album = textContent;
            else if (frameId === 'TCM' && textContent) result.composer = textContent;
            else if (frameId === 'TBP' && textContent) {
              const b = parseInt(textContent, 10);
              if (!isNaN(b) && b > 0) result.bpm = b;
            } else if (frameId === 'COM' && textContent) {
              result.comments = textContent.replace(/^[a-zA-Z]{3}/, '').trim() || textContent;
            } else if (frameId === 'TCO' && textContent) {
              const match = textContent.match(/^\(?(\d+)\)?$/);
              if (match) {
                const idx = parseInt(match[1], 10);
                const GENRES = ['Blues', 'Classic Rock', 'Country', 'Dance', 'Disco', 'Funk', 'Grunge', 'Hip-Hop', 'Jazz', 'Metal', 'New Age', 'Oldies', 'Other', 'Pop', 'R&B', 'Rap', 'Reggae', 'Rock', 'Techno', 'Industrial', 'Alternative', 'Ska', 'Death Metal', 'Pranks', 'Soundtrack', 'Euro-Techno', 'Ambient', 'Trip-Hop', 'Vocal', 'Jazz+Funk', 'Fusion', 'Trance', 'Classical', 'Instrumental', 'Acid', 'House', 'Game', 'Sound Clip', 'Gospel', 'Noise', 'AlternRock', 'Bass', 'Soul', 'Punk', 'Space', 'Meditative', 'Instrumental Pop', 'Instrumental Rock', 'Ethnic', 'Gothic', 'Darkwave', 'Techno-Industrial', 'Electronic', 'Pop-Folk', 'Eurodance', 'Dream', 'Southern Rock', 'Comedy', 'Cult', 'Gangsta', 'Top 40', 'Christian Rap', 'Pop/Funk', 'Jungle', 'Native American', 'Cabaret', 'New Wave', 'Psychadelic', 'Rave', 'Showtunes', 'Trailer', 'Lo-Fi', 'Tribal', 'Acid Punk', 'Acid Jazz', 'Polka', 'Retro', 'Musical', 'Rock & Roll', 'Hard Rock'];
                result.genre = (idx >= 0 && idx < GENRES.length) ? GENRES[idx] : textContent;
              } else {
                result.genre = textContent;
              }
            } else if (frameId === 'TYE' && textContent) {
              const yr = parseInt(textContent, 10);
              if (!isNaN(yr)) result.year = yr;
            } else if (frameId === 'TRK' && textContent) {
              const parts = textContent.split('/');
              const trk = parseInt(parts[0], 10);
              if (!isNaN(trk)) result.trackNumber = trk;
              if (parts.length > 1) {
                const tot = parseInt(parts[1], 10);
                if (!isNaN(tot)) result.trackTotal = tot;
              }
            } else if (frameId === 'TPA' && textContent) {
              const parts = textContent.split('/');
              const dsk = parseInt(parts[0], 10);
              if (!isNaN(dsk)) result.discNumber = dsk;
              if (parts.length > 1) {
                const tot = parseInt(parts[1], 10);
                if (!isNaN(tot)) result.discTotal = tot;
              }
            } else if (frameId === 'TLE' && textContent) {
              const ms = parseInt(textContent, 10);
              if (!isNaN(ms) && ms > 0) result.duration = ms / 1000;
            } else if (frameId === 'PIC') {
              try {
                const fmt = String.fromCharCode(frameData[1], frameData[2], frameData[3]);
                let p = 5;
                while (p < frameData.length && frameData[p] !== 0) p++;
                p++;
                if (p < frameData.length) {
                  const imgData = frameData.subarray(p);
                  if (imgData.length > 0) {
                    const mimeType = fmt.toLowerCase() === 'png' ? 'image/png' : 'image/jpeg';
                    result.coverUrl = bufferToBase64(imgData, mimeType);
                  }
                }
              } catch (e) {}
            }
          }
        }
      }
    }

    if ((!result.title || !result.artist) && file.size >= 128) {
      const v1Slice = file.slice(file.size - 128, file.size);
      const v1Buf = await v1Slice.arrayBuffer();
      const v1Bytes = new Uint8Array(v1Buf);

      if (v1Bytes[0] === 0x54 && v1Bytes[1] === 0x41 && v1Bytes[2] === 0x47) {
        const decoder = new TextDecoder('iso-8859-1');
        const parseStr = (start: number, len: number) =>
          decoder.decode(v1Bytes.subarray(start, start + len)).replace(/\0/g, '').trim();

        const v1Title = parseStr(3, 30);
        const v1Artist = parseStr(33, 30);
        const v1Album = parseStr(63, 30);
        const v1Year = parseStr(93, 4);

        if (v1Title && !result.title) result.title = v1Title;
        if (v1Artist && !result.artist) result.artist = v1Artist;
        if (v1Album && !result.album) result.album = v1Album;
        if (v1Year && !result.year) {
          const yr = parseInt(v1Year, 10);
          if (!isNaN(yr)) result.year = yr;
        }
      }
    }

    return Object.keys(result).length > 0 ? result : null;
  } catch (e) {
    return null;
  }
}

export async function parseAudioFile(file: File): Promise<Track> {
  const filePath = (file as any).path || undefined;
  let objectUrl = '';
  const isTauri = typeof window !== 'undefined' && !!((window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__ || (window as any).__TAURI_METADATA__);

  if (filePath && isTauri) {
    try {
      const { convertFileSrc } = await import('@tauri-apps/api/core');
      objectUrl = convertFileSrc(filePath);
    } catch (e) {
      objectUrl = URL.createObjectURL(file);
    }
  } else {
    objectUrl = URL.createObjectURL(file);
  }

  let title = '';
  let artist = '';
  let albumArtist: string | undefined;
  let album = '';
  let composer: string | undefined;
  let publisher: string | undefined;
  let lyrics: string | undefined;
  let replayGainDb: number | undefined;
  let genre = '';
  let year: number | undefined;
  let trackNumber: number | undefined;
  let trackTotal: number | undefined;
  let discNumber: number | undefined;
  let discTotal: number | undefined;
  let bpm: number | undefined;
  let mediaKind: string | undefined;
  let comments: string | undefined;
  let duration = 0;
  let coverUrl: string | undefined;
  let bitrate: number | undefined;
  let sampleRate: number | undefined;

  // Attempt 1: Custom MP4 / M4A / AAC pure-binary atom parser (Instant, reads MP4 ilst atoms & cover art)
  const mp4Tags = await parseMp4Atoms(file);
  if (mp4Tags) {
    if (mp4Tags.title) title = mp4Tags.title;
    if (mp4Tags.artist) artist = mp4Tags.artist;
    if (mp4Tags.albumArtist) albumArtist = mp4Tags.albumArtist;
    if (mp4Tags.album) album = mp4Tags.album;
    if (mp4Tags.composer) composer = mp4Tags.composer;
    if (mp4Tags.publisher) publisher = mp4Tags.publisher;
    if (mp4Tags.lyrics) lyrics = mp4Tags.lyrics;
    if (mp4Tags.genre) genre = mp4Tags.genre;
    if (mp4Tags.year) year = mp4Tags.year;
    if (mp4Tags.trackNumber) trackNumber = mp4Tags.trackNumber;
    if (mp4Tags.trackTotal) trackTotal = mp4Tags.trackTotal;
    if (mp4Tags.discNumber) discNumber = mp4Tags.discNumber;
    if (mp4Tags.discTotal) discTotal = mp4Tags.discTotal;
    if (mp4Tags.bpm) bpm = mp4Tags.bpm;
    if (mp4Tags.mediaKind) mediaKind = mp4Tags.mediaKind;
    if (mp4Tags.comments) comments = mp4Tags.comments;
    if (mp4Tags.coverUrl) coverUrl = mp4Tags.coverUrl;
  }

  // Attempt 2: music-metadata-browser
  try {
    const metadata = await parseAudioMetadata.parseBlob(file, {
      duration: true,
      skipCovers: false,
    });

    const common = metadata.common;
    const format = metadata.format;

    if (common.title && !title) title = common.title.trim();
    if ((common.artist || common.albumartist) && !artist) {
      artist = (common.artist || common.albumartist || '').trim();
    }
    if (common.albumartist && !albumArtist) albumArtist = common.albumartist.trim();
    if (common.album && !album) album = common.album.trim();
    if (common.composer && common.composer.length > 0 && !composer) {
      composer = common.composer.join(', ').trim();
    }
    if ((common as any).publisher && !publisher) publisher = String((common as any).publisher).trim();
    if ((common as any).lyrics && !lyrics) {
      const lyricEntries = (common as any).lyrics;
      lyrics = Array.isArray(lyricEntries) ? lyricEntries.map((entry: any) => typeof entry === 'string' ? entry : (entry?.text || entry?.syncText || '')).filter(Boolean).join('\n') : String(lyricEntries).trim();
    }
    if (common.genre && common.genre.length > 0 && !genre) genre = common.genre[0].trim();
    if (common.year && !year) year = common.year;
    if (common.track?.no && !trackNumber) trackNumber = common.track.no;
    if (common.track?.of && !trackTotal) trackTotal = common.track.of;
    if (common.disk?.no && !discNumber) discNumber = common.disk.no;
    if (common.disk?.of && !discTotal) discTotal = common.disk.of;
    if (common.bpm && !bpm) bpm = Math.round(common.bpm);
    if (common.comment && common.comment.length > 0 && !comments) {
      const c = common.comment[0] as any;
      comments = typeof c === 'string' ? c.trim() : (c?.text ? String(c.text).trim() : undefined);
    }
    if (format.duration) duration = format.duration;
    if (format.bitrate) bitrate = Math.round(format.bitrate / 1000);
    if (format.sampleRate) sampleRate = format.sampleRate;
    if ((format as any).trackGain !== undefined) replayGainDb = Number((format as any).trackGain);

    if (!coverUrl && common.picture && common.picture.length > 0) {
      const pic = common.picture[0];
      try {
        const blob = new Blob([pic.data], { type: pic.format || 'image/jpeg' });
        coverUrl = URL.createObjectURL(blob);
      } catch (e) {
        coverUrl = bufferToBase64(pic.data, pic.format);
      }
    }
  } catch (err) {
    // metadata parsing notice
  }

  // Attempt 2: jsmediatags fallback / supplementation
  const jsTags = await parseWithJsMediaTags(file);
  if (jsTags) {
    if (!title && jsTags.title) title = jsTags.title.trim();
    if (!artist && jsTags.artist) artist = jsTags.artist.trim();
    if (!album && jsTags.album) album = jsTags.album.trim();
    if (!genre && jsTags.genre) genre = jsTags.genre.trim();
    if (!year && jsTags.year) year = parseInt(jsTags.year, 10) || undefined;
    if (!trackNumber && jsTags.track) {
      const tr = parseInt(jsTags.track, 10);
      if (!isNaN(tr)) trackNumber = tr;
    }
    if (!coverUrl && jsTags.picture) {
      const format = jsTags.picture.format || 'image/jpeg';
      try {
        const dataArr = jsTags.picture.data instanceof Uint8Array ? jsTags.picture.data : new Uint8Array(jsTags.picture.data);
        const blob = new Blob([dataArr], { type: format });
        coverUrl = URL.createObjectURL(blob);
      } catch (e) {
        if (jsTags.picture.data) {
          coverUrl = bufferToBase64(jsTags.picture.data, format);
        }
      }
    }
  }

  // Attempt 3: Custom pure-JS binary ID3 parser (Offline-safe, zero dependency)
  const binaryTags = await parseBinaryID3(file);
  if (binaryTags) {
    if (!title && binaryTags.title) title = binaryTags.title.trim();
    if (!artist && binaryTags.artist) artist = binaryTags.artist.trim();
    if (!albumArtist && binaryTags.albumArtist) albumArtist = binaryTags.albumArtist.trim();
    if (!album && binaryTags.album) album = binaryTags.album.trim();
    if (!composer && binaryTags.composer) composer = binaryTags.composer.trim();
    if (!genre && binaryTags.genre) genre = binaryTags.genre.trim();
    if (!year && binaryTags.year) year = binaryTags.year;
    if (!trackNumber && binaryTags.trackNumber) trackNumber = binaryTags.trackNumber;
    if (!trackTotal && binaryTags.trackTotal) trackTotal = binaryTags.trackTotal;
    if (!discNumber && binaryTags.discNumber) discNumber = binaryTags.discNumber;
    if (!discTotal && binaryTags.discTotal) discTotal = binaryTags.discTotal;
    if (!bpm && binaryTags.bpm) bpm = binaryTags.bpm;
    if (!comments && binaryTags.comments) comments = binaryTags.comments;
    if (!coverUrl && binaryTags.coverUrl) coverUrl = binaryTags.coverUrl;
  }

  // Attempt 4: Smart Filename parsing (ONLY filling in fields that are missing, NEVER overwriting existing ID3 fields!)
  const cleanFileName = file.name.replace(/\.[^/.]+$/, '').trim();

  if (!title && !artist) {
    // Completely missing ID3 tags
    const parts = cleanFileName.split(/\s*-\s*|\s*_\s*/).filter(Boolean);
    if (parts.length >= 3) {
      if (!trackNumber && /^\d+$/.test(parts[0])) {
        trackNumber = parseInt(parts[0], 10);
        artist = parts[1];
        title = parts.slice(2).join(' - ');
      } else {
        artist = parts[0];
        title = parts[1];
        if (!album) album = parts.slice(2).join(' - ');
      }
    } else if (parts.length === 2) {
      artist = parts[0];
      title = parts[1];
    } else {
      title = cleanFileName;
    }
  } else if (title && (!artist || artist === 'Unknown Artist')) {
    // Title is already known from ID3 tag, but Artist is missing!
    const parts = cleanFileName.split(/\s*-\s*|\s*_\s*/).filter(Boolean);
    const titleLower = title.toLowerCase();

    // Check if filename parts contains artist
    const matchingPartIdx = parts.findIndex(p => p.toLowerCase() === titleLower || titleLower.includes(p.toLowerCase()));
    if (matchingPartIdx !== -1) {
      const otherParts = parts.filter((_, idx) => idx !== matchingPartIdx && !/^\d+$/.test(parts[idx]));
      if (otherParts.length > 0) {
        artist = otherParts[0];
      }
    } else if (parts.length >= 2) {
      if (parts[1].toLowerCase() === titleLower && !/^\d+$/.test(parts[0])) {
        artist = parts[0];
      } else if (parts[0].toLowerCase() === titleLower && !/^\d+$/.test(parts[1])) {
        artist = parts[1];
      } else if (!/^\d+$/.test(parts[0])) {
        artist = parts[0];
      }
    }
  } else if (!title && artist && artist !== 'Unknown Artist') {
    // Artist is known from ID3, but Title is missing!
    const parts = cleanFileName.split(/\s*-\s*|\s*_\s*/).filter(Boolean);
    const artistLower = artist.toLowerCase();
    const otherParts = parts.filter(p => p.toLowerCase() !== artistLower && !/^\d+$/.test(p));
    if (otherParts.length > 0) {
      title = otherParts.join(' - ');
    } else {
      title = cleanFileName;
    }
  }

  if (!title) title = cleanFileName;
  if (!artist) artist = 'Unknown Artist';
  if (!album) album = 'Unknown Album';
  if (!genre) genre = 'Uncategorized';

  // Fast duration determination chain
  if (mp4Tags?.duration && mp4Tags.duration > 0) {
    duration = mp4Tags.duration;
  }

  // Attempt header-level binary scanner (WAV, FLAC, MP3 Xing/VBRI/CBR)
  if (!duration || duration === 0) {
    const headerInfo = await parseAudioFileHeader(file);
    if (headerInfo?.duration && headerInfo.duration > 0) {
      duration = headerInfo.duration;
      if (headerInfo.bitrate && !bitrate) bitrate = headerInfo.bitrate;
      if (headerInfo.sampleRate && !sampleRate) sampleRate = headerInfo.sampleRate;
    }
  }

  // Check ID3 TLEN
  if ((!duration || duration === 0) && binaryTags?.duration && binaryTags.duration > 0) {
    duration = binaryTags.duration;
  }

  // Fallback duration using HTML Audio element with generous timeout
  if (!duration || duration === 0) {
    duration = await getAudioDuration(objectUrl);
  }

  // Fallback cover if no embedded artwork found
  if (!coverUrl) {
    coverUrl = generateAlbumArtwork(album, artist);
  }

  const trackId = `track_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  // Store audio file in IndexedDB for persistence across app restarts (ONLY for non-Tauri local files)
  if (!filePath) {
    try {
      await saveMediaFile(`audio_${trackId}`, file);
    } catch (e) {
      console.warn('Failed to save audio file to IndexedDB:', e);
    }
  }

  // If coverUrl is a blob or data URL, convert and save to IndexedDB as well
  if (coverUrl && coverUrl.startsWith('data:')) {
    const blob = dataURLtoBlob(coverUrl);
    if (blob) {
      try {
        await saveMediaFile(`cover_${trackId}`, blob);
      } catch (e) {}
    }
  } else if (coverUrl && coverUrl.startsWith('blob:')) {
    try {
      const r = await fetch(coverUrl);
      const blob = await r.blob();
      await saveMediaFile(`cover_${trackId}`, blob);
    } catch (e) {}
  }

  return {
    id: trackId,
    title,
    artist,
    albumArtist: albumArtist || undefined,
    album,
    composer: composer || undefined,
    publisher: publisher || undefined,
    lyrics: lyrics || undefined,
    replayGainDb,
    genre,
    duration: Math.round(duration * 100) / 100,
    year,
    trackNumber,
    trackTotal,
    discNumber,
    discTotal,
    bpm,
    mediaKind: mediaKind || 'Music',
    comments: comments || undefined,
    rating: 0,
    playCount: 0,
    coverUrl,
    audioUrl: objectUrl,
    file: filePath ? undefined : file, // Release local file blobs to prevent memory leakage
    format: getReadableAudioFormat(file),
    bitrate: bitrate || 320,
    sampleRate: sampleRate || 44100,
    sizeBytes: file.size,
    dateAdded: new Date().toISOString(),
    filePath,
  };
}

export function getReadableAudioFormat(file: File | Blob, codecOrContainer?: string): string {
  const name = (file as File).name?.toLowerCase() || '';
  const type = file.type?.toLowerCase() || '';
  const c = (codecOrContainer || '').toLowerCase();

  if (name.endsWith('.mp3') || type.includes('mpeg') || type.includes('mp3') || c.includes('mpeg') || c.includes('mp3')) {
    return 'MPEG audio file';
  }
  if (name.endsWith('.m4a') || name.endsWith('.aac') || name.endsWith('.alac') || type.includes('mp4') || type.includes('aac') || type.includes('m4a') || c.includes('aac') || c.includes('alac') || c.includes('mp4')) {
    return 'AAC audio file';
  }
  if (name.endsWith('.flac') || type.includes('flac') || c.includes('flac')) {
    return 'FLAC audio file';
  }
  if (name.endsWith('.wav') || name.endsWith('.wave') || type.includes('wav') || c.includes('wav') || c.includes('riff')) {
    return 'WAV audio file';
  }
  if (name.endsWith('.ogg') || name.endsWith('.oga') || type.includes('ogg') || c.includes('vorbis') || c.includes('ogg')) {
    return 'Ogg Vorbis audio file';
  }
  if (name.endsWith('.aiff') || name.endsWith('.aif') || type.includes('aiff')) {
    return 'AIFF audio file';
  }
  return file.type || 'Audio file';
}

export async function extractID3TagsFromFile(file: File | Blob): Promise<ExtractedID3Tags> {
  const result: ExtractedID3Tags = {
    sizeBytes: file.size,
  };

  const fileObj = file instanceof File ? file : new File([file], 'audio.mp3', { type: file.type || 'audio/mpeg' });

  // 1. MP4 / M4A / AAC Atoms
  try {
    const mp4Tags = await parseMp4Atoms(fileObj);
    if (mp4Tags) {
      if (mp4Tags.title) result.title = mp4Tags.title;
      if (mp4Tags.artist) result.artist = mp4Tags.artist;
      if (mp4Tags.albumArtist) result.albumArtist = mp4Tags.albumArtist;
      if (mp4Tags.album) result.album = mp4Tags.album;
      if (mp4Tags.composer) result.composer = mp4Tags.composer;
      if (mp4Tags.publisher) result.publisher = mp4Tags.publisher;
      if (mp4Tags.lyrics) result.lyrics = mp4Tags.lyrics;
      if (mp4Tags.genre) result.genre = mp4Tags.genre;
      if (mp4Tags.year) result.year = mp4Tags.year;
      if (mp4Tags.trackNumber) result.trackNumber = mp4Tags.trackNumber;
      if (mp4Tags.trackTotal) result.trackTotal = mp4Tags.trackTotal;
      if (mp4Tags.discNumber) result.discNumber = mp4Tags.discNumber;
      if (mp4Tags.discTotal) result.discTotal = mp4Tags.discTotal;
      if (mp4Tags.bpm) result.bpm = mp4Tags.bpm;
      if (mp4Tags.mediaKind) result.mediaKind = mp4Tags.mediaKind;
      if (mp4Tags.comments) result.comments = mp4Tags.comments;
      if (mp4Tags.coverUrl) result.coverUrl = mp4Tags.coverUrl;
      if (mp4Tags.duration) result.duration = mp4Tags.duration;
      if (mp4Tags.bitrate) result.bitrate = mp4Tags.bitrate;
      if (mp4Tags.sampleRate) result.sampleRate = mp4Tags.sampleRate;
    }
  } catch (e) {}

  // 2. music-metadata-browser
  try {
    const metadata = await parseAudioMetadata.parseBlob(file, {
      duration: true,
      skipCovers: false,
    });
    const common = metadata.common;
    const fmt = metadata.format;

    if (common.title && !result.title) result.title = common.title.trim();
    if ((common.artist || common.albumartist) && !result.artist) {
      result.artist = (common.artist || common.albumartist || '').trim();
    }
    if (common.albumartist && !result.albumArtist) result.albumArtist = common.albumartist.trim();
    if (common.album && !result.album) result.album = common.album.trim();
    if (common.composer && common.composer.length > 0 && !result.composer) {
      result.composer = common.composer.join(', ').trim();
    }
    if ((common as any).publisher && !result.publisher) result.publisher = String((common as any).publisher).trim();
    if ((common as any).lyrics && !result.lyrics) {
      const lyricEntries = (common as any).lyrics;
      result.lyrics = Array.isArray(lyricEntries) ? lyricEntries.map((entry: any) => typeof entry === 'string' ? entry : (entry?.syncText || entry?.text || '')).filter(Boolean).join('\n') : String(lyricEntries).trim();
    }
    if (common.genre && common.genre.length > 0 && !result.genre) result.genre = common.genre[0].trim();
    if (common.year && !result.year) result.year = common.year;
    if (common.track?.no && !result.trackNumber) result.trackNumber = common.track.no;
    if (common.track?.of && !result.trackTotal) result.trackTotal = common.track.of;
    if (common.disk?.no && !result.discNumber) result.discNumber = common.disk.no;
    if (common.disk?.of && !result.discTotal) result.discTotal = common.disk.of;
    if (common.bpm && !result.bpm) result.bpm = Math.round(common.bpm);
    if (common.comment && common.comment.length > 0 && !result.comments) {
      const c = common.comment[0] as any;
      result.comments = typeof c === 'string' ? c.trim() : (c?.text ? String(c.text).trim() : undefined);
    }
    if (fmt.duration && !result.duration) result.duration = fmt.duration;
    if (fmt.bitrate && !result.bitrate) result.bitrate = Math.round(fmt.bitrate / 1000);
    if (fmt.sampleRate && !result.sampleRate) result.sampleRate = fmt.sampleRate;
    if ((fmt as any).trackGain !== undefined && result.replayGainDb === undefined) result.replayGainDb = Number((fmt as any).trackGain);
    if (!result.format) result.format = getReadableAudioFormat(file, fmt.container || fmt.codec);

    if (common.picture && common.picture.length > 0 && !result.coverUrl) {
      const pic = common.picture[0];
      try {
        const blob = new Blob([pic.data], { type: pic.format || 'image/jpeg' });
        result.coverUrl = URL.createObjectURL(blob);
      } catch (e) {
        result.coverUrl = bufferToBase64(pic.data, pic.format);
      }
    }
  } catch (e) {}

  // 3. jsmediatags
  try {
    const jsTags = await parseWithJsMediaTags(fileObj);
    if (jsTags) {
      if (!result.title && jsTags.title) result.title = jsTags.title.trim();
      if (!result.artist && jsTags.artist) result.artist = jsTags.artist.trim();
      if (!result.album && jsTags.album) result.album = jsTags.album.trim();
      if (!result.genre && jsTags.genre) result.genre = jsTags.genre.trim();
      if (!result.year && jsTags.year) result.year = parseInt(jsTags.year, 10) || undefined;
      if (!result.trackNumber && jsTags.track) {
        const tr = parseInt(jsTags.track, 10);
        if (!isNaN(tr)) result.trackNumber = tr;
      }
      if (!result.coverUrl && jsTags.picture) {
        const format = jsTags.picture.format || 'image/jpeg';
        try {
          const dataArr = jsTags.picture.data instanceof Uint8Array ? jsTags.picture.data : new Uint8Array(jsTags.picture.data);
          const blob = new Blob([dataArr], { type: format });
          result.coverUrl = URL.createObjectURL(blob);
        } catch (e) {
          if (jsTags.picture.data) {
            result.coverUrl = bufferToBase64(jsTags.picture.data, format);
          }
        }
      }
    }
  } catch (e) {}

  // 4. Binary ID3 parser
  try {
    const binaryTags = await parseBinaryID3(fileObj);
    if (binaryTags) {
      if (!result.title && binaryTags.title) result.title = binaryTags.title.trim();
      if (!result.artist && binaryTags.artist) result.artist = binaryTags.artist.trim();
      if (!result.albumArtist && binaryTags.albumArtist) result.albumArtist = binaryTags.albumArtist.trim();
      if (!result.album && binaryTags.album) result.album = binaryTags.album.trim();
      if (!result.composer && binaryTags.composer) result.composer = binaryTags.composer.trim();
      if (!result.genre && binaryTags.genre) result.genre = binaryTags.genre.trim();
      if (!result.year && binaryTags.year) result.year = binaryTags.year;
      if (!result.trackNumber && binaryTags.trackNumber) result.trackNumber = binaryTags.trackNumber;
      if (!result.trackTotal && binaryTags.trackTotal) result.trackTotal = binaryTags.trackTotal;
      if (!result.discNumber && binaryTags.discNumber) result.discNumber = binaryTags.discNumber;
      if (!result.discTotal && binaryTags.discTotal) result.discTotal = binaryTags.discTotal;
      if (!result.bpm && binaryTags.bpm) result.bpm = binaryTags.bpm;
      if (!result.comments && binaryTags.comments) result.comments = binaryTags.comments.trim();
      if (!result.coverUrl && binaryTags.coverUrl) result.coverUrl = binaryTags.coverUrl;
      if (!result.duration && binaryTags.duration) result.duration = binaryTags.duration;
    }
  } catch (e) {}

  // 5. Audio File Header Parser (WAV / FLAC / MP3)
  try {
    const headerInfo = await parseAudioFileHeader(fileObj);
    if (headerInfo) {
      if (!result.duration && headerInfo.duration) result.duration = headerInfo.duration;
      if (!result.bitrate && headerInfo.bitrate) result.bitrate = headerInfo.bitrate;
      if (!result.sampleRate && headerInfo.sampleRate) result.sampleRate = headerInfo.sampleRate;
    }
  } catch (e) {}

  if (!result.format) {
    result.format = getReadableAudioFormat(fileObj);
  }
  if (!result.mediaKind) {
    result.mediaKind = 'Music';
  }

  return result;
}

export async function extractID3TagsFromTrack(track: Track, options: { fallbackToTrack?: boolean } = {}): Promise<ExtractedID3Tags> {
  const fallbackToTrack = options.fallbackToTrack !== false;
  let fileOrBlob: Blob | null = null;
  let filename = (track.title || 'song') + '.mp3';

  // 1. In-memory File
  if (track.file) {
    fileOrBlob = track.file;
    if ((track.file as any).name) filename = (track.file as any).name;
  }

  // 2. Tauri native file path
  if (!fileOrBlob && track.filePath) {
    const isTauri = typeof window !== 'undefined' && !!((window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__ || (window as any).__TAURI_METADATA__);
    if (isTauri) {
      try {
        const { readFile } = await import('@tauri-apps/plugin-fs');
        const uint8Array = await readFile(track.filePath);
        if (uint8Array && uint8Array.length > 0) {
          const parts = track.filePath.replace(/\\/g, '/').split('/');
          filename = parts[parts.length - 1] || filename;
          fileOrBlob = new File([uint8Array], filename, { type: track.format || 'audio/mpeg' });
        }
      } catch (e) {
        console.warn('Tauri readFile error in extractID3TagsFromTrack:', e);
      }
    }
  }

  // 3. IndexedDB Media Storage
  if (!fileOrBlob && track.id) {
    try {
      const storedBlob = await getMediaFile(`audio_${track.id}`);
      if (storedBlob) {
        fileOrBlob = new File([storedBlob], filename, { type: track.format || storedBlob.type || 'audio/mpeg' });
      }
    } catch (e) {
      console.warn('IndexedDB retrieval error:', e);
    }
  }

  // 4. Fetch blob URL or data URL
  if (!fileOrBlob && track.audioUrl && (track.audioUrl.startsWith('blob:') || track.audioUrl.startsWith('data:') || track.audioUrl.startsWith('http:') || track.audioUrl.startsWith('https:'))) {
    try {
      const res = await fetch(track.audioUrl);
      if (res.ok) {
        const b = await res.blob();
        fileOrBlob = new File([b], filename, { type: track.format || b.type || 'audio/mpeg' });
      }
    } catch (e) {
      console.warn('Fetch audioUrl error:', e);
    }
  }

  // If we found a File or Blob, extract full tags
  if (fileOrBlob) {
    const tags = await extractID3TagsFromFile(fileOrBlob);
    return {
      title: tags.title || (fallbackToTrack ? track.title : undefined),
      artist: tags.artist || (fallbackToTrack ? track.artist : undefined),
      albumArtist: tags.albumArtist || (fallbackToTrack ? track.albumArtist : undefined),
      album: tags.album || (fallbackToTrack ? track.album : undefined),
      composer: tags.composer || (fallbackToTrack ? track.composer : undefined),
      publisher: tags.publisher || (fallbackToTrack ? track.publisher : undefined),
      lyrics: tags.lyrics || (fallbackToTrack ? track.lyrics : undefined),
      replayGainDb: tags.replayGainDb !== undefined ? tags.replayGainDb : (fallbackToTrack ? track.replayGainDb : undefined),
      genre: tags.genre || (fallbackToTrack ? track.genre : undefined),
      year: tags.year !== undefined ? tags.year : (fallbackToTrack ? track.year : undefined),
      trackNumber: tags.trackNumber !== undefined ? tags.trackNumber : (fallbackToTrack ? track.trackNumber : undefined),
      trackTotal: tags.trackTotal !== undefined ? tags.trackTotal : (fallbackToTrack ? track.trackTotal : undefined),
      discNumber: tags.discNumber !== undefined ? tags.discNumber : (fallbackToTrack ? track.discNumber : undefined),
      discTotal: tags.discTotal !== undefined ? tags.discTotal : (fallbackToTrack ? track.discTotal : undefined),
      bpm: tags.bpm !== undefined ? tags.bpm : (fallbackToTrack ? track.bpm : undefined),
      mediaKind: tags.mediaKind || (fallbackToTrack ? track.mediaKind : undefined) || 'Music',
      format: tags.format || (fallbackToTrack ? track.format : undefined) || getReadableAudioFormat(fileOrBlob),
      bitrate: tags.bitrate || (fallbackToTrack ? track.bitrate : undefined),
      sampleRate: tags.sampleRate || (fallbackToTrack ? track.sampleRate : undefined),
      duration: tags.duration || (fallbackToTrack ? track.duration : undefined),
      sizeBytes: tags.sizeBytes || (fallbackToTrack ? track.sizeBytes : undefined) || fileOrBlob.size,
      coverUrl: tags.coverUrl || (fallbackToTrack ? track.coverUrl : undefined),
      comments: tags.comments || (fallbackToTrack ? track.comments : undefined),
    };
  }

  // Fallback to track's current metadata if no binary file found (e.g. synth tracks)
  return {
    title: track.title,
    artist: track.artist,
    albumArtist: track.albumArtist,
    album: track.album,
    composer: track.composer,
    publisher: track.publisher,
    lyrics: track.lyrics,
    replayGainDb: track.replayGainDb,
    genre: track.genre,
    year: track.year,
    trackNumber: track.trackNumber,
    trackTotal: track.trackTotal,
    discNumber: track.discNumber,
    discTotal: track.discTotal,
    bpm: track.bpm,
    mediaKind: track.mediaKind || 'Music',
    format: track.format || 'Audio file',
    bitrate: track.bitrate || 320,
    sampleRate: track.sampleRate || 44100,
    duration: track.duration,
    sizeBytes: track.sizeBytes,
    coverUrl: track.coverUrl,
    comments: track.comments,
  };
}

function getAudioDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    const audio = new Audio();
    audio.preload = 'metadata';
    let resolved = false;

    const cleanup = () => {
      audio.onerror = null;
      audio.onloadedmetadata = null;
      audio.ondurationchange = null;
      audio.oncanplay = null;
      audio.src = '';
    };

    const finish = (d: number) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      cleanup();
      resolve(d > 0 && isFinite(d) ? d : 0);
    };

    // 8-second timeout for async decoding
    const timer = setTimeout(() => {
      const d = audio.duration;
      finish(d && isFinite(d) ? d : 0);
    }, 8000);

    audio.onloadedmetadata = () => {
      const d = audio.duration;
      if (d && isFinite(d) && d > 0) {
        finish(d);
      }
    };

    audio.ondurationchange = () => {
      const d = audio.duration;
      if (d && isFinite(d) && d > 0) {
        finish(d);
      }
    };

    audio.oncanplay = () => {
      const d = audio.duration;
      if (d && isFinite(d) && d > 0) {
        finish(d);
      }
    };

    audio.onerror = () => {
      finish(0);
    };

    audio.src = url;
  });
}

