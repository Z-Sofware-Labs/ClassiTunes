use std::collections::HashMap;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::Path;

const MAC_EPOCH_OFFSET: u32 = 2_082_844_800; // Seconds between Jan 1 1904 and Jan 1 1970

#[derive(Debug, Clone)]
pub struct IpodTrackEntry {
    pub file_path_colon: String, // e.g. ":iPod_Control:Music:F00:ITUN_0001.mp3"
    pub title: String,
    pub artist: String,
    pub album_artist: Option<String>,
    pub album: String,
    pub genre: Option<String>,
    pub format_ext: String,
    pub duration_secs: f64,
    pub size_bytes: u64,
    pub bitrate_kbps: u32,
    pub sample_rate: u32,
    pub year: i32,
    pub track_num: i32,
    pub has_artwork: bool,
    pub local_full_path: Option<String>,
    pub cover_url: Option<String>,
}

fn current_mac_timestamp() -> u32 {
    let now_unix = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as u32;
    now_unix.wrapping_add(MAC_EPOCH_OFFSET)
}

fn encode_utf16_le(s: &str) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(s.len() * 2);
    for u in s.encode_utf16() {
        bytes.extend_from_slice(&u.to_le_bytes());
    }
    bytes
}

/// Builds an mhod (Music Header Object Data) string descriptor chunk.
///
/// Layout:
/// - 0x00: b"mhod"
/// - 0x04: header length (24)
/// - 0x08: total length (40 + str_len_bytes)
/// - 0x0C: mhod type (1=Title, 2=Path, 3=Album, 4=Artist, 5=Genre, 6=Filetype, 12=Composer, 22=AlbumArtist)
/// - 0x10: unk1 (0)
/// - 0x14: unk2 (0)
/// - 0x18: position / extra (1)
/// - 0x1C: string length in bytes
/// - 0x20: encoding (1 = UTF-16LE)
/// - 0x24: unk4 (0)
/// - 0x28: raw UTF-16LE string bytes (no null terminator)
fn build_string_mhod(mhod_type: u32, text: &str) -> Vec<u8> {
    let utf16 = encode_utf16_le(text);
    let str_len = utf16.len() as u32;
    let total_len = 40 + str_len;
    let mut buf = Vec::with_capacity(total_len as usize);

    buf.extend_from_slice(b"mhod");
    buf.extend_from_slice(&24u32.to_le_bytes());
    buf.extend_from_slice(&total_len.to_le_bytes());
    buf.extend_from_slice(&mhod_type.to_le_bytes());
    buf.extend_from_slice(&0u32.to_le_bytes());
    buf.extend_from_slice(&0u32.to_le_bytes());
    buf.extend_from_slice(&1u32.to_le_bytes());
    buf.extend_from_slice(&str_len.to_le_bytes());
    buf.extend_from_slice(&1u32.to_le_bytes());
    buf.extend_from_slice(&0u32.to_le_bytes());
    buf.extend_from_slice(&utf16);

    buf
}

/// Builds an mhit (Track Item) record chunk including its child mhod chunks.
fn build_mhit(track_id: u32, track: &IpodTrackEntry) -> Vec<u8> {
    let now_mac = current_mac_timestamp();
    let duration_ms = (track.duration_secs * 1000.0).max(0.0) as u32;

    // Build child mhods
    let mut mhods = Vec::new();

    // Type 1: Title
    if !track.title.is_empty() {
        mhods.push(build_string_mhod(1, &track.title));
    }
    // Type 2: Location (:iPod_Control:Music:F00:xxxx.mp3)
    if !track.file_path_colon.is_empty() {
        mhods.push(build_string_mhod(2, &track.file_path_colon));
    }
    // Type 3: Album
    if !track.album.is_empty() {
        mhods.push(build_string_mhod(3, &track.album));
    }
    // Type 4: Artist
    if !track.artist.is_empty() {
        mhods.push(build_string_mhod(4, &track.artist));
    }
    // Type 5: Genre
    if let Some(g) = &track.genre {
        if !g.is_empty() {
            mhods.push(build_string_mhod(5, g));
        }
    }
    // Type 6: Filetype description
    let filetype_desc = match track.format_ext.to_lowercase().as_str() {
        "m4a" | "aac" | "alac" => "AAC audio file",
        "wav" => "WAV audio file",
        "aiff" => "AIFF audio file",
        _ => "MPEG audio file",
    };
    mhods.push(build_string_mhod(6, filetype_desc));

    // Type 22: Album Artist
    if let Some(aa) = &track.album_artist {
        if !aa.is_empty() {
            mhods.push(build_string_mhod(22, aa));
        }
    }

    let mhods_len: usize = mhods.iter().map(|m| m.len()).sum();
    let header_len: u32 = 0x148; // 328 bytes standard iTunes 5/6/7 mhit header
    let total_len: u32 = header_len + mhods_len as u32;

    let mut header = vec![0u8; header_len as usize];

    // 0x00: "mhit"
    header[0..4].copy_from_slice(b"mhit");
    // 0x04: header length
    header[4..8].copy_from_slice(&header_len.to_le_bytes());
    // 0x08: total length
    header[8..12].copy_from_slice(&total_len.to_le_bytes());
    // 0x0c: number of mhods
    header[12..16].copy_from_slice(&(mhods.len() as u32).to_le_bytes());
    // 0x10: track ID
    header[16..20].copy_from_slice(&track_id.to_le_bytes());
    // 0x14: visible flag (1 = visible)
    header[20..24].copy_from_slice(&1u32.to_le_bytes());

    // 0x18: file type fourcc
    let type_fourcc = match track.format_ext.to_lowercase().as_str() {
        "m4a" | "aac" | "alac" => *b"M4A ",
        "wav" => *b"WAV ",
        _ => *b"MP3 ",
    };
    header[24..28].copy_from_slice(&type_fourcc);

    // 0x1c: file subtype (0x0100 for CBR/VBR)
    header[28..30].copy_from_slice(&0x0100u16.to_le_bytes());
    // 0x1e: compilation flag
    header[30] = 0;
    // 0x1f: rating
    header[31] = 0;

    // 0x20: last modified timestamp (Mac epoch)
    header[32..36].copy_from_slice(&now_mac.to_le_bytes());
    // 0x24: file size in bytes
    header[36..40].copy_from_slice(&(track.size_bytes as u32).to_le_bytes());
    // 0x28: duration in milliseconds
    header[40..44].copy_from_slice(&duration_ms.to_le_bytes());
    // 0x2c: track number
    let safe_track_num = if track.track_num > 0 { track.track_num as u32 } else { 1 };
    header[44..48].copy_from_slice(&safe_track_num.to_le_bytes());
    // 0x30: total tracks
    header[48..52].copy_from_slice(&0u32.to_le_bytes());
    // 0x34: year
    let safe_year = if track.year > 0 { track.year as u32 } else { 0 };
    header[52..56].copy_from_slice(&safe_year.to_le_bytes());
    // 0x38: bitrate in kbps
    let safe_bitrate = if track.bitrate_kbps > 0 { track.bitrate_kbps } else { 256 };
    header[56..60].copy_from_slice(&safe_bitrate.to_le_bytes());
    // 0x3c: sample rate fixed point (sample_rate << 16)
    let safe_sr = if track.sample_rate > 0 { track.sample_rate } else { 44100 };
    header[60..64].copy_from_slice(&(safe_sr << 16).to_le_bytes());
    // 0x40: volume
    header[64..68].copy_from_slice(&0u32.to_le_bytes());
    // 0x44: start time
    header[68..72].copy_from_slice(&0u32.to_le_bytes());
    // 0x48: stop time
    header[72..76].copy_from_slice(&duration_ms.to_le_bytes());
    // 0x4c: soundcheck
    header[76..80].copy_from_slice(&0u32.to_le_bytes());
    // 0x50: play count
    header[80..84].copy_from_slice(&0u32.to_le_bytes());
    // 0x54: play count recent
    header[84..88].copy_from_slice(&0u32.to_le_bytes());
    // 0x58: last played time
    header[88..92].copy_from_slice(&0u32.to_le_bytes());
    // 0x5c: disc number
    header[92..96].copy_from_slice(&1u32.to_le_bytes());
    // 0x60: total discs
    header[96..100].copy_from_slice(&1u32.to_le_bytes());
    // 0x64: user id
    header[100..104].copy_from_slice(&0u32.to_le_bytes());
    // 0x68: date added (Mac epoch)
    header[104..108].copy_from_slice(&now_mac.to_le_bytes());
    // 0x6c: bookmark time
    header[108..112].copy_from_slice(&0u32.to_le_bytes());
    // 0x70: db ID (64-bit int)
    let db_id = (track_id as u64) | 0x80000000_00000000;
    header[112..120].copy_from_slice(&db_id.to_le_bytes());
    // 0x78: checked (0 = checked)
    header[120] = 0;
    // 0x79: app rating
    header[121] = 0;
    // 0x7a: bpm
    header[122..124].copy_from_slice(&0u16.to_le_bytes());
    // 0x7c: artwork count
    header[124..126].copy_from_slice(&(if track.has_artwork { 1u16 } else { 0u16 }).to_le_bytes());
    // 0x7e: unk
    header[126..128].copy_from_slice(&0u16.to_le_bytes());
    // 0x80: artwork size (20,000 bytes for standard 100x100 RGB565 frame)
    let art_size: u32 = if track.has_artwork { 20_000 } else { 0 };
    header[128..132].copy_from_slice(&art_size.to_le_bytes());
    // 0x84: unk
    header[132..136].copy_from_slice(&0u32.to_le_bytes());
    // 0x88: sample rate int
    header[136..140].copy_from_slice(&safe_sr.to_le_bytes());
    // 0x8c: release date
    header[140..144].copy_from_slice(&now_mac.to_le_bytes());

    let mut out = Vec::with_capacity(total_len as usize);
    out.extend_from_slice(&header);
    for m in mhods {
        out.extend_from_slice(&m);
    }

    out
}

/// Builds an mhlt (Track List) chunk.
fn build_mhlt(mhits: &[Vec<u8>]) -> Vec<u8> {
    let header_len: u32 = 0x5C; // 92 bytes
    let total_mhits_len: usize = mhits.iter().map(|m| m.len()).sum();
    let total_len: u32 = header_len + total_mhits_len as u32;

    let mut buf = vec![0u8; header_len as usize];
    buf[0..4].copy_from_slice(b"mhlt");
    buf[4..8].copy_from_slice(&header_len.to_le_bytes());
    buf[8..12].copy_from_slice(&(mhits.len() as u32).to_le_bytes());

    let mut out = Vec::with_capacity(total_len as usize);
    out.extend_from_slice(&buf);
    for m in mhits {
        out.extend_from_slice(m);
    }
    out
}

/// Builds an mhip (Playlist Track Item pointer).
fn build_mhip(index: u32, track_id: u32) -> Vec<u8> {
    let header_len: u32 = 0x18; // 24 bytes
    let mut buf = vec![0u8; header_len as usize];

    buf[0..4].copy_from_slice(b"mhip");
    buf[4..8].copy_from_slice(&header_len.to_le_bytes());
    buf[8..12].copy_from_slice(&header_len.to_le_bytes());
    buf[12..16].copy_from_slice(&0u32.to_le_bytes());
    buf[16..20].copy_from_slice(&index.to_le_bytes());
    buf[20..24].copy_from_slice(&track_id.to_le_bytes());
    buf
}

/// Builds an mhyp (Playlist) record.
fn build_mhyp(
    name: &str,
    is_master: bool,
    track_ids: &[u32],
    playlist_id: u64,
) -> Vec<u8> {
    let header_len: u32 = 0x60; // 96 bytes
    let now_mac = current_mac_timestamp();

    let name_mhod = build_string_mhod(1, name);
    let mhips_len = track_ids.len() * 24;
    let total_len = header_len + name_mhod.len() as u32 + mhips_len as u32;

    let mut header = vec![0u8; header_len as usize];
    header[0..4].copy_from_slice(b"mhyp");
    header[4..8].copy_from_slice(&header_len.to_le_bytes());
    header[8..12].copy_from_slice(&total_len.to_le_bytes());
    header[12..16].copy_from_slice(&1u32.to_le_bytes()); // 1 mhod (name)
    header[16..20].copy_from_slice(&(track_ids.len() as u32).to_le_bytes()); // Number of items
    header[20..24].copy_from_slice(&(if is_master { 1u32 } else { 0u32 }).to_le_bytes());
    header[24..28].copy_from_slice(&now_mac.to_le_bytes());
    header[28..36].copy_from_slice(&playlist_id.to_le_bytes());
    header[36..40].copy_from_slice(&1u32.to_le_bytes()); // sort order

    let mut out = Vec::with_capacity(total_len as usize);
    out.extend_from_slice(&header);
    out.extend_from_slice(&name_mhod);
    for (i, &tid) in track_ids.iter().enumerate() {
        out.extend_from_slice(&build_mhip((i + 1) as u32, tid));
    }
    out
}

/// Builds an mhlp (Playlist List) chunk.
fn build_mhlp(playlists: &[Vec<u8>]) -> Vec<u8> {
    let header_len: u32 = 0x5C; // 92 bytes
    let total_mhyps_len: usize = playlists.iter().map(|p| p.len()).sum();
    let total_len: u32 = header_len + total_mhyps_len as u32;

    let mut buf = vec![0u8; header_len as usize];
    buf[0..4].copy_from_slice(b"mhlp");
    buf[4..8].copy_from_slice(&header_len.to_le_bytes());
    buf[8..12].copy_from_slice(&(playlists.len() as u32).to_le_bytes());

    let mut out = Vec::with_capacity(total_len as usize);
    out.extend_from_slice(&buf);
    for p in playlists {
        out.extend_from_slice(p);
    }
    out
}

/// Builds an mhsd (Section Dataset) container chunk.
fn build_mhsd(section_type: u32, payload: &[u8]) -> Vec<u8> {
    let header_len: u32 = 0x60; // 96 bytes
    let total_len: u32 = header_len + payload.len() as u32;

    let mut buf = vec![0u8; header_len as usize];
    buf[0..4].copy_from_slice(b"mhsd");
    buf[4..8].copy_from_slice(&header_len.to_le_bytes());
    buf[8..12].copy_from_slice(&total_len.to_le_bytes());
    buf[12..16].copy_from_slice(&section_type.to_le_bytes()); // 1 = tracks, 2 = playlists

    let mut out = Vec::with_capacity(total_len as usize);
    out.extend_from_slice(&buf);
    out.extend_from_slice(payload);
    out
}

/// Builds the root mhbd (Master Database) container chunk.
/// Header length is 0xBC (188 bytes), standard for iTunes 7.3+ and necessary
/// for holding the hash58 HMAC-SHA1 signature for iPod Classic / Nano.
fn build_mhbd(mhsd_tracks: &[u8], mhsd_playlists: &[u8]) -> Vec<u8> {
    let header_len: u32 = 0xBC; // 188 bytes
    let total_len: u32 = header_len + mhsd_tracks.len() as u32 + mhsd_playlists.len() as u32;

    let mut buf = vec![0u8; header_len as usize];
    buf[0..4].copy_from_slice(b"mhbd");
    buf[4..8].copy_from_slice(&header_len.to_le_bytes());
    buf[8..12].copy_from_slice(&total_len.to_le_bytes());
    buf[12..16].copy_from_slice(&1u32.to_le_bytes()); // unk1 = 1
    buf[16..20].copy_from_slice(&0x19u32.to_le_bytes()); // version = 0x19 (iTunes 7.x schema)
    buf[20..24].copy_from_slice(&2u32.to_le_bytes()); // 2 children (tracks + playlists)
    let db_id: u64 = 0x434c4153_53495455; // 'CLASSITU' in hex
    buf[24..32].copy_from_slice(&db_id.to_le_bytes());
    buf[32..34].copy_from_slice(&2u16.to_le_bytes()); // language = 2 (English)
    buf[34..42].copy_from_slice(&db_id.to_le_bytes()); // library persistent ID

    let mut out = Vec::with_capacity(total_len as usize);
    out.extend_from_slice(&buf);
    out.extend_from_slice(mhsd_tracks);
    out.extend_from_slice(mhsd_playlists);
    out
}

/// Generates iTunesSD database for iPod Shuffle 1G & 2G.
fn build_itunes_sd(tracks: &[IpodTrackEntry]) -> Vec<u8> {
    let mut out = Vec::new();
    let num_tracks = tracks.len().min(65535) as u16;

    // Header: 18 bytes
    out.extend_from_slice(&[0x00, 0x00, 0x00, 0x01]); // magic
    out.extend_from_slice(&num_tracks.to_be_bytes()); // total tracks
    out.extend_from_slice(&1u16.to_be_bytes());       // 1 playlist
    out.extend_from_slice(&[0u8; 10]);                // padding

    // Track records (558 bytes each)
    for t in tracks {
        let mut rec = vec![0u8; 558];

        // 512 bytes: path in UTF-16BE (256 u16 characters)
        let utf16_be: Vec<u8> = t.file_path_colon
            .encode_utf16()
            .take(255)
            .flat_map(|u| u.to_be_bytes())
            .collect();

        rec[0..utf16_be.len()].copy_from_slice(&utf16_be);

        // 0x200 (512): start time (0)
        rec[512..516].copy_from_slice(&0u32.to_be_bytes());
        // 0x204 (516): stop time (duration ms)
        let duration_ms = (t.duration_secs * 1000.0).max(0.0) as u32;
        rec[516..520].copy_from_slice(&duration_ms.to_be_bytes());
        // 0x208 (520): volume (0)
        rec[520..524].copy_from_slice(&0u32.to_be_bytes());

        // 0x20C (524): file type fourcc
        let type_fourcc = match t.format_ext.to_lowercase().as_str() {
            "m4a" | "aac" => *b"aac ",
            "wav" => *b"wav ",
            _ => *b"mp3 ",
        };
        rec[524..528].copy_from_slice(&type_fourcc);

        out.extend_from_slice(&rec);
    }

    out
}

struct ArtworkFormatDescriptor {
    format_id: u32,
    ithmb_colon_path: &'static str,
    width: u16,
    height: u16,
    frame_size: u32,
    offset: u32,
}

fn hash_bytes(bytes: &[u8]) -> u64 {
    use std::collections::hash_map::DefaultHasher;
    let mut hasher = DefaultHasher::new();
    bytes.hash(&mut hasher);
    hasher.finish()
}

fn extract_raw_cover_bytes(entry: &IpodTrackEntry) -> Option<Vec<u8>> {
    // 1. If cover_url points to a local file on disk
    if let Some(ref url) = entry.cover_url {
        let p = Path::new(url);
        if p.is_file() {
            if let Ok(bytes) = fs::read(p) {
                if !bytes.is_empty() {
                    return Some(bytes);
                }
            }
        }
        // 2. If cover_url is a data URL (data:image/jpeg;base64,...)
        if url.starts_with("data:") {
            if let Some(comma_pos) = url.find(',') {
                let b64_part = &url[comma_pos + 1..];
                if let Ok(bytes) = crate::decode_base64(b64_part) {
                    if !bytes.is_empty() {
                        return Some(bytes);
                    }
                }
            }
        }
    }

    // 3. Fallback: Read directly from audio file on the device
    if let Some(ref path_str) = entry.local_full_path {
        let p = Path::new(path_str);
        if p.is_file() {
            // ID3
            if let Ok(tag) = id3::Tag::read_from_path(p) {
                if let Some(pic) = tag.pictures().next() {
                    return Some(pic.data.to_vec());
                }
            }
            // MP4
            if let Ok(tag) = mp4ameta::Tag::read_from_path(p) {
                if let Some(art) = tag.artwork() {
                    return Some(art.data.to_vec());
                }
            }
            // Lofty
            if let Ok(probe) = lofty::probe::Probe::open(p) {
                if let Ok(tagged_file) = probe.read() {
                    use lofty::file::TaggedFileExt;
                    if let Some(tag) = tagged_file.primary_tag().or_else(|| tagged_file.first_tag()) {
                        if let Some(pic) = tag.pictures().first() {
                            return Some(pic.data().to_vec());
                        }
                    }
                }
            }
        }
    }

    None
}

fn convert_image_to_rgb565(raw_bytes: &[u8], width: u32, height: u32) -> Option<Vec<u8>> {
    let img = image::load_from_memory(raw_bytes).ok()?;
    let resized = img.resize_exact(width, height, image::imageops::FilterType::Triangle);
    let rgb = resized.to_rgb8();

    let mut out = Vec::with_capacity((width * height * 2) as usize);
    for pixel in rgb.pixels() {
        let r = pixel[0] as u16;
        let g = pixel[1] as u16;
        let b = pixel[2] as u16;
        let rgb565: u16 = ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
        out.extend_from_slice(&rgb565.to_le_bytes());
    }
    Some(out)
}

fn build_mhni(
    format_id: u32,
    offset: u32,
    size: u32,
    width: u16,
    height: u16,
    ithmb_colon_path: &str,
) -> Vec<u8> {
    let mhod3 = build_string_mhod(3, ithmb_colon_path);
    let header_len = 76u32;
    let total_len = header_len + mhod3.len() as u32;

    let mut buf = vec![0u8; header_len as usize];
    buf[0..4].copy_from_slice(b"mhni");
    buf[4..8].copy_from_slice(&header_len.to_le_bytes());
    buf[8..12].copy_from_slice(&total_len.to_le_bytes());
    buf[12..16].copy_from_slice(&1u32.to_le_bytes()); // 1 child
    buf[16..20].copy_from_slice(&format_id.to_le_bytes());
    buf[20..24].copy_from_slice(&offset.to_le_bytes());
    buf[24..28].copy_from_slice(&size.to_le_bytes());
    buf[28..30].copy_from_slice(&0i16.to_le_bytes()); // vertical padding
    buf[30..32].copy_from_slice(&0i16.to_le_bytes()); // horizontal padding
    buf[32..34].copy_from_slice(&height.to_le_bytes());
    buf[34..36].copy_from_slice(&width.to_le_bytes());
    buf[36..40].copy_from_slice(&0u32.to_le_bytes());
    buf[40..44].copy_from_slice(&size.to_le_bytes()); // image data length

    let mut out = Vec::with_capacity(total_len as usize);
    out.extend_from_slice(&buf);
    out.extend_from_slice(&mhod3);
    out
}

fn build_mhod_type2(mhni: &[u8]) -> Vec<u8> {
    let header_len = 24u32;
    let total_len = header_len + mhni.len() as u32;

    let mut buf = vec![0u8; header_len as usize];
    buf[0..4].copy_from_slice(b"mhod");
    buf[4..8].copy_from_slice(&header_len.to_le_bytes());
    buf[8..12].copy_from_slice(&total_len.to_le_bytes());
    buf[12..16].copy_from_slice(&2u32.to_le_bytes()); // mhod type 2

    let mut out = Vec::with_capacity(total_len as usize);
    out.extend_from_slice(&buf);
    out.extend_from_slice(mhni);
    out
}

fn build_mhii(
    image_id: u32,
    song_id: u64,
    orig_size: u32,
    formats: &[ArtworkFormatDescriptor],
) -> Vec<u8> {
    let mut child_mhods = Vec::with_capacity(formats.len());
    for fmt in formats {
        let mhni = build_mhni(
            fmt.format_id,
            fmt.offset,
            fmt.frame_size,
            fmt.width,
            fmt.height,
            fmt.ithmb_colon_path,
        );
        child_mhods.push(build_mhod_type2(&mhni));
    }

    let child_len: usize = child_mhods.iter().map(|m| m.len()).sum();
    let header_len = 152u32; // 0x98
    let total_len = header_len + child_len as u32;

    let mut buf = vec![0u8; header_len as usize];
    buf[0..4].copy_from_slice(b"mhii");
    buf[4..8].copy_from_slice(&header_len.to_le_bytes());
    buf[8..12].copy_from_slice(&total_len.to_le_bytes());
    buf[12..16].copy_from_slice(&(formats.len() as u32).to_le_bytes());
    buf[16..20].copy_from_slice(&image_id.to_le_bytes());
    buf[20..28].copy_from_slice(&song_id.to_le_bytes());
    buf[28..32].copy_from_slice(&0u32.to_le_bytes()); // rating
    buf[32..36].copy_from_slice(&orig_size.to_le_bytes());

    let mut out = Vec::with_capacity(total_len as usize);
    out.extend_from_slice(&buf);
    for m in child_mhods {
        out.extend_from_slice(&m);
    }
    out
}

fn build_artwork_mhli(mhiis: &[Vec<u8>]) -> Vec<u8> {
    let header_len = 92u32; // 0x5C
    let total_mhiis_len: usize = mhiis.iter().map(|m| m.len()).sum();
    let total_len = header_len + total_mhiis_len as u32;

    let mut buf = vec![0u8; header_len as usize];
    buf[0..4].copy_from_slice(b"mhli");
    buf[4..8].copy_from_slice(&header_len.to_le_bytes());
    buf[8..12].copy_from_slice(&total_len.to_le_bytes());
    buf[12..16].copy_from_slice(&(mhiis.len() as u32).to_le_bytes());

    let mut out = Vec::with_capacity(total_len as usize);
    out.extend_from_slice(&buf);
    for m in mhiis {
        out.extend_from_slice(m);
    }
    out
}

fn build_artwork_mhsd(mhli: &[u8]) -> Vec<u8> {
    let header_len = 96u32; // 0x60
    let total_len = header_len + mhli.len() as u32;

    let mut buf = vec![0u8; header_len as usize];
    buf[0..4].copy_from_slice(b"mhsd");
    buf[4..8].copy_from_slice(&header_len.to_le_bytes());
    buf[8..12].copy_from_slice(&total_len.to_le_bytes());
    buf[12..16].copy_from_slice(&1u32.to_le_bytes()); // section type 1

    let mut out = Vec::with_capacity(total_len as usize);
    out.extend_from_slice(&buf);
    out.extend_from_slice(mhli);
    out
}

fn build_artwork_mhfd(mhsd: &[u8], num_images: u32) -> Vec<u8> {
    let header_len = 132u32; // 0x84
    let total_len = header_len + mhsd.len() as u32;

    let mut buf = vec![0u8; header_len as usize];
    buf[0..4].copy_from_slice(b"mhfd");
    buf[4..8].copy_from_slice(&header_len.to_le_bytes());
    buf[8..12].copy_from_slice(&total_len.to_le_bytes());
    buf[12..16].copy_from_slice(&0u32.to_le_bytes());
    buf[16..20].copy_from_slice(&2u32.to_le_bytes()); // version = 2
    buf[20..24].copy_from_slice(&1u32.to_le_bytes()); // 1 child (mhsd)
    buf[24..28].copy_from_slice(&0u32.to_le_bytes());
    buf[28..32].copy_from_slice(&(num_images + 1).to_le_bytes()); // next mhii id
    buf[48..52].copy_from_slice(&2u32.to_le_bytes()); // minor version = 2

    let mut out = Vec::with_capacity(total_len as usize);
    out.extend_from_slice(&buf);
    out.extend_from_slice(mhsd);
    out
}

fn generate_and_write_artwork_db(
    mount_point: &Path,
    tracks: &[IpodTrackEntry],
) -> Vec<IpodTrackEntry> {
    let mut updated_tracks = tracks.to_vec();
    let mut f1024_stream: Vec<u8> = Vec::new();
    let mut f1031_stream: Vec<u8> = Vec::new();

    // Cache: raw image hash -> (offset_1024, offset_1031, orig_size)
    let mut art_cache: HashMap<u64, (u32, u32, u32)> = HashMap::new();
    let mut mhiis: Vec<Vec<u8>> = Vec::new();

    for (i, track) in updated_tracks.iter_mut().enumerate() {
        let track_id = (i + 1) as u32;
        let song_id = (track_id as u64) | 0x80000000_00000000;

        let raw_cover = extract_raw_cover_bytes(track);
        if let Some(cover_bytes) = raw_cover {
            let orig_len = cover_bytes.len() as u32;
            let hash = hash_bytes(&cover_bytes);

            let (off_1024, off_1031, orig_size) = if let Some(&(o1024, o1031, osz)) = art_cache.get(&hash) {
                (o1024, o1031, osz)
            } else {
                let rgb_1024 = convert_image_to_rgb565(&cover_bytes, 100, 100);
                let rgb_1031 = convert_image_to_rgb565(&cover_bytes, 128, 128);

                match (rgb_1024, rgb_1031) {
                    (Some(b1024), Some(b1031)) => {
                        let cur_off_1024 = f1024_stream.len() as u32;
                        f1024_stream.extend_from_slice(&b1024);

                        let cur_off_1031 = f1031_stream.len() as u32;
                        f1031_stream.extend_from_slice(&b1031);

                        art_cache.insert(hash, (cur_off_1024, cur_off_1031, orig_len));
                        (cur_off_1024, cur_off_1031, orig_len)
                    }
                    _ => {
                        track.has_artwork = false;
                        continue;
                    }
                }
            };

            let image_item_id = (mhiis.len() + 1) as u32;
            let formats = [
                ArtworkFormatDescriptor {
                    format_id: 1024,
                    ithmb_colon_path: ":iPod_Control:Artwork:F1024_1.ithmb",
                    width: 100,
                    height: 100,
                    frame_size: 20000,
                    offset: off_1024,
                },
                ArtworkFormatDescriptor {
                    format_id: 1031,
                    ithmb_colon_path: ":iPod_Control:Artwork:F1031_1.ithmb",
                    width: 128,
                    height: 128,
                    frame_size: 32768,
                    offset: off_1031,
                },
            ];

            let mhii = build_mhii(image_item_id, song_id, orig_size, &formats);
            mhiis.push(mhii);
            track.has_artwork = true;
        } else {
            track.has_artwork = false;
        }
    }

    let artwork_dir = mount_point.join("iPod_Control").join("Artwork");
    if !mhiis.is_empty() {
        let _ = fs::create_dir_all(&artwork_dir);
        let _ = fs::write(artwork_dir.join("F1024_1.ithmb"), &f1024_stream);
        let _ = fs::write(artwork_dir.join("F1031_1.ithmb"), &f1031_stream);

        let mhli = build_artwork_mhli(&mhiis);
        let mhsd = build_artwork_mhsd(&mhli);
        let mhfd = build_artwork_mhfd(&mhsd, mhiis.len() as u32);
        let _ = fs::write(artwork_dir.join("ArtworkDB"), &mhfd);
    } else if artwork_dir.exists() {
        let mhli = build_artwork_mhli(&[]);
        let mhsd = build_artwork_mhsd(&mhli);
        let mhfd = build_artwork_mhfd(&mhsd, 0);
        let _ = fs::write(artwork_dir.join("ArtworkDB"), &mhfd);
        let _ = fs::write(artwork_dir.join("F1024_1.ithmb"), &[]);
        let _ = fs::write(artwork_dir.join("F1031_1.ithmb"), &[]);
    }

    updated_tracks
}

/// Writes iTunesDB and iTunesSD to an iPod's iPod_Control/iTunes directory,
/// and ArtworkDB + .ithmb files to iPod_Control/Artwork for color iPods.
pub fn generate_and_write_ipod_db(
    mount_point: &Path,
    tracks: &[IpodTrackEntry],
    user_playlist_name: Option<&str>,
) -> Result<(), String> {
    let itunes_dir = mount_point.join("iPod_Control").join("iTunes");
    if let Err(e) = fs::create_dir_all(&itunes_dir) {
        return Err(format!("Could not create iPod iTunes directory: {e}"));
    }

    // 1. Process and generate ArtworkDB and .ithmb files for color iPods
    let tracks_with_artwork = generate_and_write_artwork_db(mount_point, tracks);

    // 2. Build mhits for all tracks with verified artwork flags
    let mut mhits = Vec::with_capacity(tracks_with_artwork.len());
    let mut track_ids = Vec::with_capacity(tracks_with_artwork.len());

    for (i, t) in tracks_with_artwork.iter().enumerate() {
        let tid = (i + 1) as u32;
        track_ids.push(tid);
        mhits.push(build_mhit(tid, t));
    }

    // 3. Build mhlt (Tracklist) and mhsd (Section 1)
    let mhlt = build_mhlt(&mhits);
    let mhsd_tracks = build_mhsd(1, &mhlt);

    // 4. Build playlists
    let mut playlists = Vec::new();

    // Master Playlist (contains all tracks)
    let master_playlist = build_mhyp("iPod", true, &track_ids, 0x1000000000000001);
    playlists.push(master_playlist);

    // User playlist (if requested)
    if let Some(pl_name) = user_playlist_name {
        if !pl_name.trim().is_empty() && !track_ids.is_empty() {
            let user_pl = build_mhyp(pl_name.trim(), false, &track_ids, 0x1000000000000002);
            playlists.push(user_pl);
        }
    }

    let mhlp = build_mhlp(&playlists);
    let mhsd_playlists = build_mhsd(2, &mhlp);

    // 5. Build root mhbd
    let mut mhbd = build_mhbd(&mhsd_tracks, &mhsd_playlists);

    // 6. Sign with hash58 if device has a FireWire GUID (iPod Classic 6G/6.5G/7G, Nano 3G/4G)
    // This HMAC-SHA1 signature is required by Apple's stock firmware to prevent "0 Songs" rejection.
    if let Some(guid) = read_ipod_firewire_guid(mount_point) {
        sign_itunes_db_hash58(&mut mhbd, guid);
    }

    // Write iTunesDB
    let itunes_db_path = itunes_dir.join("iTunesDB");
    if let Err(e) = fs::write(&itunes_db_path, &mhbd) {
        return Err(format!("Failed to write iTunesDB at {}: {e}", itunes_db_path.display()));
    }

    // Also write iTunesSD for iPod Shuffle compatibility
    let itunes_sd = build_itunes_sd(&tracks_with_artwork);
    let itunes_sd_path = itunes_dir.join("iTunesSD");
    let _ = fs::write(&itunes_sd_path, &itunes_sd);

    Ok(())
}

/// Scans all audio files on an iPod and rebuilds its iTunesDB database.
pub fn rebuild_ipod_db_from_device(
    mount_point: &Path,
    user_playlist_name: Option<&str>,
) -> Result<(), String> {
    if !mount_point.join("iPod_Control").exists() {
        return Ok(());
    }

    let items = crate::mp3_device::list_device_contents_native(&mount_point.to_string_lossy());
    let mut entries = Vec::with_capacity(items.len());

    for item in items {
        let p = Path::new(&item.full_path);
        let rel = match p.strip_prefix(mount_point) {
            Ok(r) => r,
            Err(_) => continue,
        };

        // Format relative path with colons: :iPod_Control:Music:F00:track.mp3
        let colon_path = format!(":{}", rel.to_string_lossy().replace(['/', '\\'], ":"));

        let title = item.title.unwrap_or_else(|| item.file_name.clone());
        let artist = item.artist.unwrap_or_else(|| "Unknown Artist".to_string());
        let album = item.album.unwrap_or_else(|| "Unknown Album".to_string());
        let ext = Path::new(&item.file_name)
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("mp3")
            .to_string();

        entries.push(IpodTrackEntry {
            file_path_colon: colon_path,
            title,
            artist,
            album_artist: None,
            album,
            genre: item.genre,
            format_ext: ext,
            duration_secs: item.duration_secs.unwrap_or(0.0),
            size_bytes: item.size_bytes,
            bitrate_kbps: item.bitrate.unwrap_or(256),
            sample_rate: item.sample_rate.unwrap_or(44100),
            year: item.year.unwrap_or(0),
            track_num: item.track_number.unwrap_or(1),
            has_artwork: item.cover_url.is_some(),
            local_full_path: Some(item.full_path.clone()),
            cover_url: item.cover_url.clone(),
        });
    }

    generate_and_write_ipod_db(mount_point, &entries, user_playlist_name)
}

// ============================================================================
// iPod Classic (6G/6.5G/7G) & Nano (3G/4G) Checksum Signature (hash58)
// ============================================================================

/// Reads the device's hardware FireWire GUID from iPod_Control/Device/SysInfo or SysInfoExtended.
/// Returns the 64-bit GUID integer if present.
pub fn read_ipod_firewire_guid(mount_point: &Path) -> Option<u64> {
    let device_dir = mount_point.join("iPod_Control").join("Device");
    let candidates = [
        device_dir.join("SysInfo"),
        device_dir.join("SysInfoExtended"),
        device_dir.join("sysinfo"),
    ];

    for path in &candidates {
        if let Ok(content) = fs::read_to_string(path) {
            for line in content.lines() {
                let trimmed = line.trim();
                let lower = trimmed.to_lowercase();
                if lower.starts_with("firewireguid:")
                    || lower.starts_with("firewire_guid:")
                    || lower.starts_with("guid:")
                {
                    if let Some(pos) = trimmed.find(':') {
                        let val_part = trimmed[pos + 1..].trim();
                        let clean_hex = val_part
                            .strip_prefix("0x")
                            .or_else(|| val_part.strip_prefix("0X"))
                            .unwrap_or(val_part)
                            .trim();
                        let hex_digits: String =
                            clean_hex.chars().filter(|c| c.is_ascii_hexdigit()).collect();
                        if !hex_digits.is_empty() {
                            if let Ok(guid) = u64::from_str_radix(&hex_digits, 16) {
                                if guid != 0 {
                                    return Some(guid);
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    None
}

/// Computes the HMAC-SHA1 `hash58` signature for an iTunesDB buffer and embeds it
/// at offset 0x58 (88 decimal) of the `mhbd` header, setting hash indicator at 0x50.
pub fn sign_itunes_db_hash58(itunes_db: &mut [u8], firewire_guid: u64) {
    if itunes_db.len() < 0xBC {
        return;
    }
    // Verify root chunk magic
    if &itunes_db[0..4] != b"mhbd" {
        return;
    }

    // Set hash scheme indicator at offset 0x50 (80 decimal) to 1
    itunes_db[0x50..0x54].copy_from_slice(&1u32.to_le_bytes());

    // Zero out the 20-byte hash field at offset 0x58 (88 decimal) prior to computing HMAC
    itunes_db[0x58..0x6C].fill(0);

    // Key is the 8-byte FireWire GUID in Big-Endian (EUI-64 standard order)
    let key = firewire_guid.to_be_bytes();

    // Compute HMAC-SHA1 over the entire iTunesDB buffer
    let digest = hmac_sha1(&key, itunes_db);

    // Write the 20-byte digest back into offset 0x58..0x6C
    itunes_db[0x58..0x6C].copy_from_slice(&digest);
}

/// Pure-Rust implementation of FIPS 180-1 / RFC 3174 SHA-1 digest.
fn sha1_digest(data: &[u8]) -> [u8; 20] {
    let mut h0: u32 = 0x67452301;
    let mut h1: u32 = 0xEFCDAB89;
    let mut h2: u32 = 0x98BADCFE;
    let mut h3: u32 = 0x10325476;
    let mut h4: u32 = 0xC3D2E1F0;

    let bit_len = (data.len() as u64).wrapping_mul(8);
    let mut msg = data.to_vec();
    msg.push(0x80);
    while (msg.len() % 64) != 56 {
        msg.push(0x00);
    }
    msg.extend_from_slice(&bit_len.to_be_bytes());

    for chunk in msg.chunks_exact(64) {
        let mut w = [0u32; 80];
        for i in 0..16 {
            w[i] = u32::from_be_bytes([
                chunk[i * 4],
                chunk[i * 4 + 1],
                chunk[i * 4 + 2],
                chunk[i * 4 + 3],
            ]);
        }
        for i in 16..80 {
            w[i] = (w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]).rotate_left(1);
        }

        let mut a = h0;
        let mut b = h1;
        let mut c = h2;
        let mut d = h3;
        let mut e = h4;

        for i in 0..80 {
            let (f, k) = match i {
                0..=19 => ((b & c) | ((!b) & d), 0x5A827999),
                20..=39 => (b ^ c ^ d, 0x6ED9EBA1),
                40..=59 => ((b & c) | (b & d) | (c & d), 0x8F1BBCDC),
                _ => (b ^ c ^ d, 0xCA62C1D6),
            };

            let temp = a
                .rotate_left(5)
                .wrapping_add(f)
                .wrapping_add(e)
                .wrapping_add(k)
                .wrapping_add(w[i]);
            e = d;
            d = c;
            c = b.rotate_left(30);
            b = a;
            a = temp;
        }

        h0 = h0.wrapping_add(a);
        h1 = h1.wrapping_add(b);
        h2 = h2.wrapping_add(c);
        h3 = h3.wrapping_add(d);
        h4 = h4.wrapping_add(e);
    }

    let mut out = [0u8; 20];
    out[0..4].copy_from_slice(&h0.to_be_bytes());
    out[4..8].copy_from_slice(&h1.to_be_bytes());
    out[8..12].copy_from_slice(&h2.to_be_bytes());
    out[12..16].copy_from_slice(&h3.to_be_bytes());
    out[16..20].copy_from_slice(&h4.to_be_bytes());
    out
}

/// Pure-Rust implementation of RFC 2104 HMAC-SHA1.
fn hmac_sha1(key: &[u8], message: &[u8]) -> [u8; 20] {
    let block_size = 64;
    let mut key_block = [0u8; 64];

    if key.len() > block_size {
        let hashed_key = sha1_digest(key);
        key_block[..20].copy_from_slice(&hashed_key);
    } else {
        key_block[..key.len()].copy_from_slice(key);
    }

    let mut ipad = [0x36u8; 64];
    let mut opad = [0x5cu8; 64];

    for i in 0..64 {
        ipad[i] ^= key_block[i];
        opad[i] ^= key_block[i];
    }

    // Inner hash: H(ipad || message)
    let mut inner_input = Vec::with_capacity(64 + message.len());
    inner_input.extend_from_slice(&ipad);
    inner_input.extend_from_slice(message);
    let inner_hash = sha1_digest(&inner_input);

    // Outer hash: H(opad || inner_hash)
    let mut outer_input = Vec::with_capacity(64 + 20);
    outer_input.extend_from_slice(&opad);
    outer_input.extend_from_slice(&inner_hash);
    sha1_digest(&outer_input)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sha1_standard_vectors() {
        // Test vector 1: "abc"
        let digest1 = sha1_digest(b"abc");
        assert_eq!(
            digest1,
            [
                0xa9, 0x99, 0x3e, 0x36, 0x47, 0x06, 0x81, 0x6a, 0xba, 0x3e,
                0x25, 0x71, 0x78, 0x50, 0xc2, 0x6c, 0x9c, 0xd0, 0xd8, 0x9d
            ]
        );

        // Test vector 2: "" (empty string)
        let digest_empty = sha1_digest(b"");
        assert_eq!(
            digest_empty,
            [
                0xda, 0x39, 0xa3, 0xee, 0x5e, 0x6b, 0x4b, 0x0d, 0x32, 0x55,
                0xbf, 0xef, 0x95, 0x60, 0x18, 0x90, 0xaf, 0xd8, 0x07, 0x09
            ]
        );
    }

    #[test]
    fn test_hmac_sha1_rfc2202_vectors() {
        // RFC 2202 Test Case 1
        let key1 = [0x0bu8; 20];
        let data1 = b"Hi There";
        let hmac1 = hmac_sha1(&key1, data1);
        assert_eq!(
            hmac1,
            [
                0xb6, 0x17, 0x31, 0x86, 0x55, 0x05, 0x72, 0x64, 0xe2, 0x8b,
                0xc0, 0xb6, 0xfb, 0x37, 0x8c, 0x8e, 0xf1, 0x46, 0xbe, 0x00
            ]
        );

        // RFC 2202 Test Case 2: key = "Jefe", data = "what do ya want for nothing?"
        let key2 = b"Jefe";
        let data2 = b"what do ya want for nothing?";
        let hmac2 = hmac_sha1(key2, data2);
        assert_eq!(
            hmac2,
            [
                0xef, 0xfc, 0xdf, 0x6a, 0xe5, 0xeb, 0x2f, 0xa2, 0xd2, 0x74,
                0x16, 0xd5, 0xf1, 0x84, 0xdf, 0x9c, 0x25, 0x9a, 0x7c, 0x79
            ]
        );
    }

    #[test]
    fn test_hash58_signing() {
        let tracks = vec![IpodTrackEntry {
            file_path_colon: ":iPod_Control:Music:F00:test.mp3".to_string(),
            title: "Test Track".to_string(),
            artist: "Test Artist".to_string(),
            album_artist: None,
            album: "Test Album".to_string(),
            genre: None,
            format_ext: "mp3".to_string(),
            duration_secs: 180.0,
            size_bytes: 5000000,
            bitrate_kbps: 320,
            sample_rate: 44100,
            year: 2026,
            track_num: 1,
            has_artwork: false,
            local_full_path: None,
            cover_url: None,
        }];

        let mhits = vec![build_mhit(1, &tracks[0])];
        let mhlt = build_mhlt(&mhits);
        let mhsd_tracks = build_mhsd(1, &mhlt);
        let master_playlist = build_mhyp("iPod", true, &[1], 0x1000000000000001);
        let mhlp = build_mhlp(&[master_playlist]);
        let mhsd_playlists = build_mhsd(2, &mhlp);

        let mut mhbd = build_mhbd(&mhsd_tracks, &mhsd_playlists);
        assert_eq!(&mhbd[0..4], b"mhbd");
        assert_eq!(u32::from_le_bytes(mhbd[4..8].try_into().unwrap()), 0xBC);

        // Sign with a sample FireWire GUID (e.g. 0x000A2700147FDCA9)
        let guid = 0x000A2700147FDCA9u64;
        sign_itunes_db_hash58(&mut mhbd, guid);

        // Indicator at 0x50 should be 1
        assert_eq!(u32::from_le_bytes(mhbd[0x50..0x54].try_into().unwrap()), 1);

        // Digest at 0x58..0x6C must NOT be all zeros
        let digest = &mhbd[0x58..0x6C];
        assert_ne!(digest, &[0u8; 20]);
    }
}

