use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Id3TagPayload {
    title: Option<String>,
    artist: Option<String>,
    album_artist: Option<String>,
    album: Option<String>,
    composer: Option<String>,
    publisher: Option<String>,
    lyrics: Option<String>,
    genre: Option<String>,
    year: Option<i32>,
    track_number: Option<i32>,
    track_total: Option<i32>,
    disc_number: Option<i32>,
    disc_total: Option<i32>,
    bpm: Option<i32>,
    comments: Option<String>,
    media_kind: Option<String>,
    artwork_data_url: Option<String>,
    artwork_mime_type: Option<String>,
}

fn decode_base64(input: &str) -> Result<Vec<u8>, String> {
    let mut values = Vec::with_capacity(input.len() * 3 / 4);
    let mut acc: u32 = 0;
    let mut bits: u8 = 0;
    for ch in input.bytes() {
        let value = match ch {
            b'A'..=b'Z' => ch - b'A',
            b'a'..=b'z' => ch - b'a' + 26,
            b'0'..=b'9' => ch - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            b'=' | b'\r' | b'\n' | b'\t' | b' ' => continue,
            _ => return Err("Invalid base64 artwork data".to_string()),
        } as u32;
        acc = (acc << 6) | value;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            values.push(((acc >> bits) & 0xff) as u8);
        }
    }
    Ok(values)
}

fn write_id3_tags_impl(file_path: &str, tags: Id3TagPayload) -> Result<bool, String> {
    use id3::{Content, Frame, Tag, TagLike, Version};

    let mut tag = match Tag::read_from_path(file_path) {
        Ok(tag) => tag,
        Err(_) => Tag::new(),
    };

    if let Some(v) = tags.title {
        tag.remove("TIT2");
        if !v.is_empty() {
            tag.set_title(v);
        }
    }
    if let Some(v) = tags.artist {
        tag.remove("TPE1");
        if !v.is_empty() {
            tag.set_artist(v);
        }
    }
    if let Some(v) = tags.album {
        tag.remove("TALB");
        if !v.is_empty() {
            tag.set_album(v);
        }
    }
    if let Some(v) = tags.album_artist {
        tag.remove("TPE2");
        if !v.is_empty() {
            tag.set_album_artist(v);
        }
    }
    if let Some(v) = tags.composer {
        tag.remove("TCOM");
        if !v.is_empty() {
            tag.set_text("TCOM", v);
        }
    }
    if let Some(v) = tags.publisher {
        tag.remove("TPUB");
        if !v.is_empty() {
            tag.set_text("TPUB", v);
        }
    }
    if let Some(v) = tags.lyrics {
        tag.remove("USLT");
        if !v.is_empty() {
            tag.add_frame(Frame::with_content(
                "USLT",
                Content::Lyrics(id3::frame::Lyrics {
                    lang: "eng".to_string(),
                    description: String::new(),
                    text: v,
                }),
            ));
        }
    }
    if let Some(v) = tags.genre {
        tag.remove("TCON");
        if !v.is_empty() {
            tag.set_genre(v);
        }
    }
    if let Some(v) = tags.year {
        tag.remove("TDRC");
        tag.set_year(v);
    } else {
        tag.remove("TDRC");
    }
    if let Some(v) = tags.bpm {
        tag.remove("TBPM");
        tag.set_text("TBPM", v.to_string());
    } else {
        tag.remove("TBPM");
    }
    // Rebuild compound track/disc frames so clearing either value really clears
    // the old value instead of leaving stale totals in the file.
    tag.remove("TRCK");
    if let Some(v) = tags.track_number {
        tag.set_track(v as u32);
        if let Some(total) = tags.track_total {
            tag.set_total_tracks(total as u32);
        }
    }
    tag.remove("TPOS");
    if let Some(v) = tags.disc_number {
        tag.set_disc(v as u32);
        if let Some(total) = tags.disc_total {
            tag.set_total_discs(total as u32);
        }
    }
    if let Some(v) = tags.comments {
        tag.remove("COMM");
        if !v.is_empty() {
            tag.add_frame(Frame::with_content(
                "COMM",
                Content::Comment(id3::frame::Comment {
                    lang: "eng".to_string(),
                    description: String::new(),
                    text: v,
                }),
            ));
        }
    }

    if let Some(data_url) = tags.artwork_data_url {
        tag.remove("APIC");
        if !data_url.trim().is_empty() {
            let (mime_type, encoded) = data_url
                .split_once(',')
                .ok_or_else(|| "Invalid artwork data URL".to_string())?;
            let mime_type = tags
                .artwork_mime_type
                .filter(|v| !v.trim().is_empty())
                .unwrap_or_else(|| {
                    mime_type
                        .strip_prefix("data:")
                        .and_then(|v| v.split(';').next())
                        .unwrap_or("image/jpeg")
                        .to_string()
                });
            let bytes = decode_base64(encoded)?;
            if bytes.is_empty() {
                return Err("Artwork image is empty".to_string());
            }
            tag.add_frame(Frame::with_content(
                "APIC",
                Content::Picture(id3::frame::Picture {
                    mime_type,
                    picture_type: id3::frame::PictureType::CoverFront,
                    description: String::new(),
                    data: bytes,
                }),
            ));
        }
    }

    tag.write_to_path(file_path, Version::Id3v23)
        .map_err(|e| format!("Could not write ID3 tag: {e}"))?;
    Ok(true)
}

fn write_mp4_tags(file_path: &str, tags: Id3TagPayload) -> Result<bool, String> {
    use mp4ameta::{Data, Fourcc, Img, MediaType, Tag};

    let mut tag = Tag::read_from_path(file_path)
        .map_err(|e| format!("Could not read MP4/M4A metadata: {e}"))?;

    fn set_text(tag: &mut mp4ameta::Tag, ident: Fourcc, value: Option<String>) {
        if let Some(v) = value {
            if v.trim().is_empty() {
                tag.remove_data_of(&ident);
            } else {
                tag.set_data(ident, Data::Utf8(v));
            }
        }
    }

    set_text(&mut tag, Fourcc(*b"\xa9nam"), tags.title);
    set_text(&mut tag, Fourcc(*b"\xa9ART"), tags.artist);
    set_text(&mut tag, Fourcc(*b"aART"), tags.album_artist);
    set_text(&mut tag, Fourcc(*b"\xa9alb"), tags.album);
    set_text(&mut tag, Fourcc(*b"\xa9wrt"), tags.composer);
    set_text(&mut tag, Fourcc(*b"\xa9pub"), tags.publisher);
    set_text(&mut tag, Fourcc(*b"\xa9lyr"), tags.lyrics);
    set_text(&mut tag, Fourcc(*b"\xa9gen"), tags.genre);
    set_text(&mut tag, Fourcc(*b"\xa9cmt"), tags.comments);
    if let Some(year) = tags.year {
        set_text(&mut tag, Fourcc(*b"\xa9day"), Some(year.to_string()));
    }
    if let Some(bpm) = tags.bpm {
        tag.set_bpm(bpm as u16);
    } else {
        tag.remove_data_of(&Fourcc(*b"tmpo"));
    }
    if let Some(kind) = tags.media_kind {
        match kind.to_ascii_lowercase().as_str() {
            "audiobook" => tag.set_media_type(MediaType::AudioBook),
            "podcast" => tag.set_media_type(MediaType::Normal),
            "voice memo" => tag.set_media_type(MediaType::Normal),
            _ => tag.set_media_type(MediaType::Normal),
        }
    }
    // Rebuild MP4 compound atoms so clearing a track/disc field cannot retain
    // an old number/total from the previous file metadata.
    tag.remove_data_of(&Fourcc(*b"trkn"));
    if let Some(n) = tags.track_number {
        tag.set_track_number(n as u16);
        if let Some(total) = tags.track_total {
            tag.set_total_tracks(total as u16);
        }
    }
    tag.remove_data_of(&Fourcc(*b"disk"));
    if let Some(n) = tags.disc_number {
        tag.set_disc_number(n as u16);
        if let Some(total) = tags.disc_total {
            tag.set_total_discs(total as u16);
        }
    }

    if let Some(data_url) = tags.artwork_data_url {
        tag.remove_artworks();
        if !data_url.trim().is_empty() {
            let (_, encoded) = data_url
                .split_once(',')
                .ok_or_else(|| "Invalid artwork data URL".to_string())?;
            let bytes = decode_base64(encoded)?;
            if bytes.is_empty() {
                return Err("Artwork image is empty".to_string());
            }
            let is_png = bytes.len() >= 8 && bytes[..8] == [137, 80, 78, 71, 13, 10, 26, 10];
            let is_jpeg = bytes.len() >= 3 && bytes[0..3] == [0xff, 0xd8, 0xff];
            if is_png {
                tag.set_artwork(Img::png(bytes));
            } else if is_jpeg {
                tag.set_artwork(Img::jpeg(bytes));
            } else {
                return Err("AAC/M4A artwork must be a JPEG or PNG image".to_string());
            }
        }
    }

    tag.write_to_path(file_path)
        .map_err(|e| format!("Could not write MP4/M4A metadata: {e}"))?;
    Ok(true)
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadMetadataResult {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album_artist: Option<String>,
    pub album: Option<String>,
    pub composer: Option<String>,
    pub publisher: Option<String>,
    pub lyrics: Option<String>,
    pub genre: Option<String>,
    pub year: Option<i32>,
    pub track_number: Option<i32>,
    pub track_total: Option<i32>,
    pub disc_number: Option<i32>,
    pub disc_total: Option<i32>,
    pub bpm: Option<i32>,
    pub comments: Option<String>,
    pub media_kind: Option<String>,
    pub cover_url: Option<String>,
    pub duration: Option<f64>,
    pub bitrate: Option<u32>,
    pub sample_rate: Option<u32>,
    pub format: Option<String>,
    pub size_bytes: Option<u64>,
}

fn encode_base64(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((bytes.len() + 2) / 3 * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0];
        let b1 = if chunk.len() > 1 { chunk[1] } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] } else { 0 };
        out.push(TABLE[(b0 >> 2) as usize] as char);
        out.push(TABLE[(((b0 & 3) << 4) | (b1 >> 4)) as usize] as char);
        if chunk.len() > 1 {
            out.push(TABLE[(((b1 & 0xf) << 2) | (b2 >> 6)) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(TABLE[(b2 & 0x3f) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

fn parse_year_string(s: &str) -> Option<i32> {
    let trimmed = s.trim();
    if let Ok(y) = trimmed.parse::<i32>() {
        if (1000..=9999).contains(&y) {
            return Some(y);
        }
    }
    // Extract first contiguous 4 digits (e.g. from 2024-05-17T07:00:00Z)
    let bytes = trimmed.as_bytes();
    for window in bytes.windows(4) {
        if window.iter().all(|b| b.is_ascii_digit()) {
            if let Ok(sub) = std::str::from_utf8(window) {
                if let Ok(y) = sub.parse::<i32>() {
                    if (1000..=9999).contains(&y) {
                        return Some(y);
                    }
                }
            }
        }
    }
    None
}

fn is_mp4_file(path: &std::path::Path, ext: &str) -> bool {
    if matches!(ext, "m4a" | "mp4" | "m4b" | "m4p" | "m4r" | "alac") {
        return true;
    }
    // Inspect first 12 bytes for 'ftyp' box
    if let Ok(mut file) = std::fs::File::open(path) {
        use std::io::Read;
        let mut buf = [0u8; 12];
        if file.read_exact(&mut buf).is_ok() && &buf[4..8] == b"ftyp" {
            return true;
        }
    }
    false
}

#[tauri::command]
fn read_music_metadata(file_path: String) -> Result<ReadMetadataResult, String> {
    use id3::TagLike;
    use std::path::Path;

    let path = Path::new(&file_path);
    if !path.is_file() {
        return Err(format!("File does not exist: {file_path}"));
    }

    let file_meta = std::fs::metadata(path).ok();
    let size_bytes = file_meta.map(|m| m.len());
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();

    let mut res = ReadMetadataResult {
        title: None,
        artist: None,
        album_artist: None,
        album: None,
        composer: None,
        publisher: None,
        lyrics: None,
        genre: None,
        year: None,
        track_number: None,
        track_total: None,
        disc_number: None,
        disc_total: None,
        bpm: None,
        comments: None,
        media_kind: Some("Music".to_string()),
        cover_url: None,
        duration: None,
        bitrate: None,
        sample_rate: None,
        format: match ext.as_str() {
            "mp3" => Some("MPEG audio file".to_string()),
            "m4a" | "aac" | "alac" => Some("AAC audio file".to_string()),
            "flac" => Some("FLAC audio file".to_string()),
            "wav" => Some("WAV audio file".to_string()),
            "ogg" => Some("Ogg Vorbis audio file".to_string()),
            _ => None,
        },
        size_bytes,
    };

    // 1. Try reading MP4/M4A metadata if applicable
    let is_mp4 = is_mp4_file(path, &ext);
    if is_mp4 {
        if let Ok(tag) = mp4ameta::Tag::read_from_path(&file_path) {
            res.title = tag.title().map(|s| s.to_string());
            res.artist = tag.artist().map(|s| s.to_string());
            res.album_artist = tag.album_artist().map(|s| s.to_string());
            res.album = tag.album().map(|s| s.to_string());
            res.composer = tag.composer().map(|s| s.to_string());
            res.genre = tag.genre().map(|s| s.to_string());
            if let Some(yr) = tag.year() {
                res.year = parse_year_string(yr);
            }
            res.publisher = tag.strings().find(|(ident, _)| {
                if let mp4ameta::DataIdent::Fourcc(f) = ident {
                    f.0 == *b"\xa9pub"
                } else {
                    false
                }
            }).map(|(_, s)| s.to_string());
            if let Some(lyr) = tag.lyrics() {
                res.lyrics = Some(lyr.to_string());
            }
            let (trkn_no, trkn_of) = tag.track();
            res.track_number = trkn_no.map(|t| t as i32);
            res.track_total = trkn_of.map(|t| t as i32);

            let (disc_no, disc_of) = tag.disc();
            res.disc_number = disc_no.map(|d| d as i32);
            res.disc_total = disc_of.map(|d| d as i32);

            if let Some(bpm) = tag.bpm() {
                res.bpm = Some(bpm as i32);
            }
            if let Some(cmt) = tag.comment() {
                res.comments = Some(cmt.to_string());
            }
            if let Some(art) = tag.artwork() {
                let mime = match art.fmt {
                    mp4ameta::ImgFmt::Png => "image/png",
                    mp4ameta::ImgFmt::Jpeg => "image/jpeg",
                    _ => "image/jpeg",
                };
                let b64 = encode_base64(art.data);
                res.cover_url = Some(format!("data:{mime};base64,{b64}"));
            }
            let dur = tag.duration();
            if dur.as_secs_f64() > 0.0 {
                res.duration = Some(dur.as_secs_f64());
            }
        }
    }

    // 2. Try ID3 tag (for MP3, FLAC with ID3, AAC, WAV)
    if !is_mp4 || res.title.is_none() {
        if let Ok(tag) = id3::Tag::read_from_path(&file_path) {
            if res.title.is_none() { res.title = tag.title().map(|s| s.to_string()); }
            if res.artist.is_none() { res.artist = tag.artist().map(|s| s.to_string()); }
            if res.album_artist.is_none() { res.album_artist = tag.album_artist().map(|s| s.to_string()); }
            if res.album.is_none() { res.album = tag.album().map(|s| s.to_string()); }
            if res.genre.is_none() { res.genre = tag.genre().map(|s| s.to_string()); }
            if res.year.is_none() {
                res.year = tag.year().or_else(|| {
                    tag.get("TDRC")
                        .and_then(|f| f.content().text())
                        .and_then(parse_year_string)
                });
            }
            if res.composer.is_none() {
                res.composer = tag.get("TCOM").and_then(|f| f.content().text()).map(|s| s.to_string());
            }
            if res.publisher.is_none() {
                res.publisher = tag.get("TPUB").and_then(|f| f.content().text()).map(|s| s.to_string());
            }
            if res.lyrics.is_none() {
                res.lyrics = tag.lyrics().next().map(|l| l.text.clone());
            }
            if res.track_number.is_none() { res.track_number = tag.track().map(|t| t as i32); }
            if res.track_total.is_none() { res.track_total = tag.total_tracks().map(|t| t as i32); }
            if res.disc_number.is_none() { res.disc_number = tag.disc().map(|d| d as i32); }
            if res.disc_total.is_none() { res.disc_total = tag.total_discs().map(|d| d as i32); }
            if res.comments.is_none() {
                res.comments = tag.comments().next().map(|c| c.text.clone());
            }
            if res.cover_url.is_none() {
                let pic_opt = tag
                    .pictures()
                    .find(|p| p.picture_type == id3::frame::PictureType::CoverFront)
                    .or_else(|| tag.pictures().next());
                if let Some(pic) = pic_opt {
                    let mime = if pic.mime_type.is_empty() { "image/jpeg" } else { &pic.mime_type };
                    let b64 = encode_base64(&pic.data);
                    res.cover_url = Some(format!("data:{mime};base64,{b64}"));
                }
            }
            // ID3 TLEN tag for duration
            if res.duration.is_none() {
                if let Some(dur_frame) = tag.get("TLEN").and_then(|f| f.content().text()) {
                    if let Ok(val) = dur_frame.trim().parse::<f64>() {
                        if val > 0.0 {
                            // According to ID3v2 spec, TLEN is in milliseconds.
                            // However, many tags incorrectly write TLEN in seconds (e.g. "230" for 3m50s, "264.61" for 4m24s).
                            // If parsed as milliseconds, 230ms = 0.23s, which renders as 0:00!
                            // Any value < 1000 is almost certainly in seconds, as almost no real song is < 1 second.
                            let secs = if val < 1000.0 { val } else { val / 1000.0 };
                            res.duration = Some(secs);
                        }
                    }
                }
            }
        }
    }

    // 3. Audio file probe via Lofty (supports MP3, M4A, FLAC, WAV, OGG, etc. for accurate duration, properties, and metadata)
    if res.duration.is_none() || res.sample_rate.is_none() || res.title.is_none() || res.year.is_none() || res.cover_url.is_none() {
        use lofty::file::{AudioFile, TaggedFileExt};
        use lofty::probe::Probe;
        use lofty::tag::{Accessor, ItemKey};

        if let Ok(tagged_file) = Probe::open(path).and_then(|p| p.read()) {
            let props = tagged_file.properties();
            if res.duration.is_none() {
                let dur = props.duration().as_secs_f64();
                if dur > 0.0 {
                    res.duration = Some(dur);
                }
            }
            if res.sample_rate.is_none() {
                res.sample_rate = props.sample_rate();
            }
            if res.bitrate.is_none() {
                res.bitrate = props.audio_bitrate();
            }

            // Fallback tags if still missing
            if let Some(tag) = tagged_file.primary_tag().or_else(|| tagged_file.first_tag()) {
                if res.title.is_none() { res.title = tag.title().as_deref().map(|s| s.to_string()); }
                if res.artist.is_none() { res.artist = tag.artist().as_deref().map(|s| s.to_string()); }
                if res.album_artist.is_none() {
                    res.album_artist = tag.get_string(ItemKey::AlbumArtist).map(|s| s.to_string());
                }
                if res.album.is_none() { res.album = tag.album().as_deref().map(|s| s.to_string()); }
                if res.composer.is_none() {
                    res.composer = tag.get_string(ItemKey::Composer).map(|s| s.to_string());
                }
                if res.publisher.is_none() {
                    res.publisher = tag.get_string(ItemKey::Label).or_else(|| tag.get_string(ItemKey::Publisher)).map(|s| s.to_string());
                }
                if res.lyrics.is_none() {
                    res.lyrics = tag.get_string(ItemKey::Lyrics).map(|s| s.to_string());
                }
                if res.genre.is_none() { res.genre = tag.genre().as_deref().map(|s| s.to_string()); }
                if res.year.is_none() {
                    res.year = tag.get_string(ItemKey::RecordingDate)
                        .or_else(|| tag.get_string(ItemKey::Year))
                        .or_else(|| tag.get_string(ItemKey::OriginalReleaseDate))
                        .and_then(parse_year_string);
                }
                if res.track_number.is_none() { res.track_number = tag.track().map(|t| t as i32); }
                if res.track_total.is_none() { res.track_total = tag.track_total().map(|t| t as i32); }
                if res.disc_number.is_none() { res.disc_number = tag.disk().map(|d| d as i32); }
                if res.disc_total.is_none() { res.disc_total = tag.disk_total().map(|d| d as i32); }
                if res.comments.is_none() {
                    res.comments = tag.comment().as_deref().map(|s| s.to_string());
                }
                if res.cover_url.is_none() {
                    let pic_opt = tag
                        .pictures()
                        .iter()
                        .find(|p| p.pic_type() == lofty::picture::PictureType::CoverFront)
                        .or_else(|| tag.pictures().first());
                    if let Some(pic) = pic_opt {
                        let mime_str = pic.mime_type().map(|m| m.as_str()).unwrap_or("image/jpeg");
                        let b64 = encode_base64(pic.data());
                        res.cover_url = Some(format!("data:{mime_str};base64,{b64}"));
                    }
                }
            }
        }
    }

    // 4. Fallback estimation: if duration is still missing, calculate from file size and bitrate
    if res.duration.is_none() {
        if let Some(size) = res.size_bytes {
            let br = res.bitrate.unwrap_or(320); // kbps
            if br > 0 && size > 0 {
                let estimated_secs = (size as f64 * 8.0) / (br as f64 * 1000.0);
                if estimated_secs > 0.0 && estimated_secs.is_finite() {
                    res.duration = Some((estimated_secs * 100.0).round() / 100.0);
                }
            }
        }
    }

    Ok(res)
}

#[derive(serde::Serialize)]
struct BatchMetadataItem {
    path: String,
    metadata: Option<ReadMetadataResult>,
}

#[tauri::command]
fn read_music_metadata_batch(file_paths: Vec<String>) -> Vec<BatchMetadataItem> {
    use rayon::prelude::*;

    file_paths
        .into_par_iter()
        .map(|path| {
            let meta = read_music_metadata(path.clone()).ok();
            BatchMetadataItem {
                path,
                metadata: meta,
            }
        })
        .collect()
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct BatchFileStat {
    path: String,
    exists: bool,
    is_file: bool,
    is_directory: bool,
    size: u64,
    mtime_ms: Option<u64>,
}

#[tauri::command]
fn batch_stat_files(paths: Vec<String>) -> Vec<BatchFileStat> {
    use std::fs;
    use std::time::UNIX_EPOCH;

    paths
        .into_iter()
        .map(|path_str| {
            let p = std::path::Path::new(&path_str);
            match fs::metadata(p) {
                Ok(meta) => {
                    let mtime_ms = meta
                        .modified()
                        .ok()
                        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                        .map(|d| d.as_millis() as u64);

                    BatchFileStat {
                        path: path_str,
                        exists: true,
                        is_file: meta.is_file(),
                        is_directory: meta.is_dir(),
                        size: meta.len(),
                        mtime_ms,
                    }
                }
                Err(_) => BatchFileStat {
                    path: path_str,
                    exists: false,
                    is_file: false,
                    is_directory: false,
                    size: 0,
                    mtime_ms: None,
                },
            }
        })
        .collect()
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanProgressPayload {
    count: usize,
    current_folder: String,
}

#[tauri::command]
fn scan_directory_native(
    app: tauri::AppHandle,
    dir_path: String,
    progress_event: Option<String>,
) -> Result<Vec<String>, String> {
    use std::collections::HashSet;
    use std::fs;
    use std::path::PathBuf;
    use std::time::Instant;
    use tauri::Emitter;

    let root_path = PathBuf::from(&dir_path);
    if !root_path.exists() {
        return Ok(Vec::new());
    }

    let mut audio_paths: Vec<String> = Vec::new();
    let mut visited_dirs: HashSet<PathBuf> = HashSet::new();

    let root_folder_name = root_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(&dir_path)
        .to_string();

    let mut last_progress_emit = Instant::now();

    if let Some(ref ev) = progress_event {
        let _ = app.emit(
            ev,
            ScanProgressPayload {
                count: 0,
                current_folder: root_folder_name.clone(),
            },
        );
    }

    let mut dir_stack: Vec<PathBuf> = vec![root_path];

    while let Some(current_dir) = dir_stack.pop() {
        // Resolve canonical path or symlink target to prevent infinite directory loops
        let canonical_or_path = fs::canonicalize(&current_dir).unwrap_or_else(|_| current_dir.clone());
        if !visited_dirs.insert(canonical_or_path) {
            continue;
        }

        let folder_name = current_dir
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();

        if let Some(ref ev) = progress_event {
            if last_progress_emit.elapsed().as_millis() >= 60 {
                let _ = app.emit(
                    ev,
                    ScanProgressPayload {
                        count: audio_paths.len(),
                        current_folder: if folder_name.is_empty() {
                            root_folder_name.clone()
                        } else {
                            folder_name.clone()
                        },
                    },
                );
                last_progress_emit = Instant::now();
            }
        }

        let entries = match fs::read_dir(&current_dir) {
            Ok(iter) => iter,
            Err(_) => continue,
        };

        for entry_res in entries {
            let entry = match entry_res {
                Ok(e) => e,
                Err(_) => continue,
            };

            let path = entry.path();
            let file_name_os = entry.file_name();
            let name_str = file_name_os.to_string_lossy();

            // Ignore hidden files and dot-folders
            if name_str.starts_with('.') {
                continue;
            }

            // Read file type safely (without unwrap)
            let file_type = match entry.file_type() {
                Ok(ft) => ft,
                Err(_) => continue,
            };

            if file_type.is_dir() {
                let name_lower = name_str.to_ascii_lowercase();
                let should_ignore = match name_lower.as_str() {
                    // Dependency / Dev folders
                    "node_modules" | ".git" | ".cache" | ".npm" | ".vscode" | ".cargo" | ".idea" |
                    ".settings" | ".gradle" | "dist" | "build" | "out" | "target" | "vendor" |
                    "bower_components" | "bin" | "obj" |
                    // System / OS folders
                    "appdata" | "application data" | "system32" | "windows" | "temp" | "tmp" |
                    "program files" | "program files (x86)" | "programdata" | "msocache" | "recovery" |
                    "system volume information" | "$recycle.bin" | "recycle.bin" | "system" |
                    "private" | "usr" | "sbin" | "etc" | "var" | "dev" | "cores" | "opt" |
                    // Cloud / sync folders
                    "onedrive" | "dropbox" | "google drive" | "googledrive" | "icloud" |
                    "icloud drive" | "iclouddrive" | "box" | "creative cloud" | "creativecloud" |
                    "nextcloud" | "owncloud" | "skydrive" => true,
                    _ => false,
                };

                if !should_ignore {
                    dir_stack.push(path);
                }
            } else if file_type.is_file() {
                if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                    let ext_lower = ext.to_ascii_lowercase();
                    let is_audio = match ext_lower.as_str() {
                        "mp3" | "wav" | "flac" | "m4a" | "aac" | "ogg" | "wma" | "aiff" | "alac" => true,
                        _ => false,
                    };
                    if is_audio {
                        if let Some(p_str) = path.to_str() {
                            audio_paths.push(p_str.to_string());
                        }
                    }
                }
            }
        }
    }

    if let Some(ref ev) = progress_event {
        let _ = app.emit(
            ev,
            ScanProgressPayload {
                count: audio_paths.len(),
                current_folder: root_folder_name,
            },
        );
    }

    Ok(audio_paths)
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn stat_music_files_windows(paths: Vec<String>) -> Vec<BatchFileStat> {
    batch_stat_files(paths)
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn scan_windows_music_directory(
    app: tauri::AppHandle,
    dir_path: String,
    progress_event: Option<String>,
) -> Result<Vec<String>, String> {
    use std::collections::HashSet;
    use std::fs;
    use std::os::windows::fs::MetadataExt;
    use std::path::PathBuf;
    use std::time::Instant;
    use tauri::Emitter;

    let root_path = PathBuf::from(&dir_path);
    if !root_path.exists() {
        return Ok(Vec::new());
    }

    let mut audio_paths: Vec<String> = Vec::new();
    let mut visited_dirs: HashSet<PathBuf> = HashSet::new();

    let root_folder_name = root_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(&dir_path)
        .to_string();

    let mut last_progress_emit = Instant::now();

    if let Some(ref ev) = progress_event {
        let _ = app.emit(
            ev,
            ScanProgressPayload {
                count: 0,
                current_folder: root_folder_name.clone(),
            },
        );
    }

    let mut dir_stack: Vec<PathBuf> = vec![root_path];

    while let Some(current_dir) = dir_stack.pop() {
        let canonical_or_path = fs::canonicalize(&current_dir).unwrap_or_else(|_| current_dir.clone());
        if !visited_dirs.insert(canonical_or_path) {
            continue;
        }

        let folder_name = current_dir
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();

        if let Some(ref ev) = progress_event {
            if last_progress_emit.elapsed().as_millis() >= 60 {
                let _ = app.emit(
                    ev,
                    ScanProgressPayload {
                        count: audio_paths.len(),
                        current_folder: if folder_name.is_empty() {
                            root_folder_name.clone()
                        } else {
                            folder_name.clone()
                        },
                    },
                );
                last_progress_emit = Instant::now();
            }
        }

        let entries = match fs::read_dir(&current_dir) {
            Ok(iter) => iter,
            Err(_) => continue,
        };

        for entry_res in entries {
            let entry = match entry_res {
                Ok(e) => e,
                Err(_) => continue,
            };

            let path = entry.path();
            let file_name_os = entry.file_name();
            let name_str = file_name_os.to_string_lossy();

            if name_str.starts_with('.') {
                continue;
            }

            // Check symlink_metadata to avoid following Windows reparse point junction loops (e.g. Application Data)
            let symlink_meta = match fs::symlink_metadata(&path) {
                Ok(m) => m,
                Err(_) => continue,
            };

            // FILE_ATTRIBUTE_REPARSE_POINT = 0x400
            const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
            let is_reparse_point = (symlink_meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT) != 0;

            if symlink_meta.is_dir() {
                // Do not recurse through Windows reparse points / junctions
                if is_reparse_point {
                    continue;
                }

                let name_lower = name_str.to_ascii_lowercase();
                let should_ignore = match name_lower.as_str() {
                    "node_modules" | ".git" | ".cache" | ".npm" | ".vscode" | ".cargo" | ".idea" |
                    ".settings" | ".gradle" | "dist" | "build" | "out" | "target" | "vendor" |
                    "bower_components" | "bin" | "obj" |
                    "appdata" | "application data" | "system32" | "windows" | "temp" | "tmp" |
                    "program files" | "program files (x86)" | "programdata" | "msocache" | "recovery" |
                    "system volume information" | "$recycle.bin" | "recycle.bin" | "system" |
                    "private" | "usr" | "sbin" | "etc" | "var" | "dev" | "cores" | "opt" |
                    "onedrive" | "dropbox" | "google drive" | "googledrive" | "icloud" |
                    "icloud drive" | "iclouddrive" | "box" | "creative cloud" | "creativecloud" |
                    "nextcloud" | "owncloud" | "skydrive" => true,
                    _ => false,
                };

                if !should_ignore {
                    dir_stack.push(path);
                }
            } else if symlink_meta.is_file() {
                if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                    let ext_lower = ext.to_ascii_lowercase();
                    let is_audio = match ext_lower.as_str() {
                        "mp3" | "wav" | "flac" | "m4a" | "aac" | "ogg" | "wma" | "aiff" | "alac" => true,
                        _ => false,
                    };
                    if is_audio {
                        if let Some(p_str) = path.to_str() {
                            audio_paths.push(p_str.to_string());
                        }
                    }
                }
            }
        }
    }

    if let Some(ref ev) = progress_event {
        let _ = app.emit(
            ev,
            ScanProgressPayload {
                count: audio_paths.len(),
                current_folder: root_folder_name,
            },
        );
    }

    Ok(audio_paths)
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn stat_music_files_windows(_paths: Vec<String>) -> Result<Vec<BatchFileStat>, String> {
    Err("stat_music_files_windows is only available on Windows".to_string())
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn scan_windows_music_directory(
    _app: tauri::AppHandle,
    _dir_path: String,
    _progress_event: Option<String>,
) -> Result<Vec<String>, String> {
    Err("scan_windows_music_directory is only available on Windows".to_string())
}

#[tauri::command]
fn get_os() -> &'static str {
    #[cfg(target_os = "linux")]
    { "linux" }
    #[cfg(target_os = "windows")]
    { "windows" }
    #[cfg(target_os = "macos")]
    { "macos" }
    #[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
    { "other" }
}

static AUDIO_SERVER_PORT: std::sync::atomic::AtomicU16 = std::sync::atomic::AtomicU16::new(0);
static AUDIO_SERVER_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn percent_decode_path(input: &str) -> String {
    let mut bytes = Vec::with_capacity(input.len());
    let mut chars = input.bytes();
    while let Some(b) = chars.next() {
        if b == b'%' {
            let h1 = chars.next().unwrap_or(b'0');
            let h2 = chars.next().unwrap_or(b'0');
            let hex_str = [h1, h2];
            if let Ok(s) = std::str::from_utf8(&hex_str) {
                if let Ok(val) = u8::from_str_radix(s, 16) {
                    bytes.push(val);
                    continue;
                }
            }
            bytes.push(b'%');
            bytes.push(h1);
            bytes.push(h2);
        } else if b == b'+' {
            bytes.push(b' ');
        } else {
            bytes.push(b);
        }
    }
    String::from_utf8_lossy(&bytes).to_string()
}

fn start_audio_stream_server_internal() -> u16 {
    let existing = AUDIO_SERVER_PORT.load(std::sync::atomic::Ordering::SeqCst);
    if existing != 0 {
        return existing;
    }

    let _guard = match AUDIO_SERVER_LOCK.lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    };

    let existing = AUDIO_SERVER_PORT.load(std::sync::atomic::Ordering::SeqCst);
    if existing != 0 {
        return existing;
    }

    let server = match tiny_http::Server::http("127.0.0.1:0") {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[AudioStreamServer] Failed to bind local server: {e}");
            return 0;
        }
    };

    let port = server.server_addr().to_ip().map(|addr| addr.port()).unwrap_or(0);
    AUDIO_SERVER_PORT.store(port, std::sync::atomic::Ordering::SeqCst);

    // Use a fixed-size thread pool instead of spawning one OS thread per request.
    // Without this, rapid seeking fires many HTTP Range requests in quick succession,
    // each spawning its own thread — leading to unbounded thread churn and memory pressure
    // on Linux where seek-heavy usage is common due to the stream server workaround.
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(4)
        .thread_name(|i| format!("audio-stream-{i}"))
        .build()
        .unwrap_or_else(|_| rayon::ThreadPoolBuilder::new().num_threads(2).build().unwrap());

    std::thread::spawn(move || {
        for request in server.incoming_requests() {
            pool.spawn(move || {
                let url = request.url().to_string();
                if request.method() == &tiny_http::Method::Options {
                    let resp = tiny_http::Response::empty(204)
                        .with_header(tiny_http::Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap())
                        .with_header(tiny_http::Header::from_bytes(&b"Access-Control-Allow-Methods"[..], &b"GET, HEAD, OPTIONS"[..]).unwrap())
                        .with_header(tiny_http::Header::from_bytes(&b"Access-Control-Allow-Headers"[..], &b"Range, Content-Type, Accept"[..]).unwrap())
                        .with_header(tiny_http::Header::from_bytes(&b"Access-Control-Expose-Headers"[..], &b"Content-Range, Content-Length, Accept-Ranges"[..]).unwrap());
                    let _ = request.respond(resp);
                    return;
                }

                let path_param = if let Some(idx) = url.find("path=") {
                    &url[idx + 5..]
                } else {
                    ""
                };

                let decoded_path = percent_decode_path(path_param);
                let fs_path = decoded_path.as_str();
                // Strip Windows drive letter leading slash if present (/C:/... -> C:/...)
                #[cfg(target_os = "windows")]
                let fs_path = if fs_path.starts_with('/') && fs_path.len() > 3 && fs_path.as_bytes()[2] == b':' {
                    &fs_path[1..]
                } else {
                    fs_path
                };

                let mut file = match std::fs::File::open(fs_path) {
                    Ok(f) => f,
                    Err(_) => {
                        let _ = request.respond(tiny_http::Response::empty(404));
                        return;
                    }
                };

                use std::io::Seek;
                let total_len = match file.seek(std::io::SeekFrom::End(0)) {
                    Ok(l) => l,
                    Err(_) => {
                        let _ = request.respond(tiny_http::Response::empty(500));
                        return;
                    }
                };

                let lower_path = fs_path.to_ascii_lowercase();
                let mime_type = if lower_path.ends_with(".mp3") {
                    "audio/mpeg"
                } else if lower_path.ends_with(".m4a") || lower_path.ends_with(".mp4") || lower_path.ends_with(".aac") {
                    "audio/mp4"
                } else if lower_path.ends_with(".flac") {
                    "audio/flac"
                } else if lower_path.ends_with(".wav") {
                    "audio/wav"
                } else if lower_path.ends_with(".ogg") {
                    "audio/ogg"
                } else {
                    "application/octet-stream"
                };

                let mut range_header = None;
                for h in request.headers() {
                    let field_name = format!("{}", h.field);
                    if field_name.eq_ignore_ascii_case("range") {
                        range_header = Some(format!("{}", h.value));
                        break;
                    }
                }

                if let Some(range_str) = range_header {
                    let mut start = 0u64;
                    let mut end = total_len.saturating_sub(1);

                    if let Some(bytes_part) = range_str.strip_prefix("bytes=") {
                        let parts: Vec<&str> = bytes_part.split('-').collect();
                        if let Ok(s) = parts[0].parse::<u64>() {
                            start = s;
                        }
                        if parts.len() > 1 && !parts[1].is_empty() {
                            if let Ok(e) = parts[1].parse::<u64>() {
                                end = std::cmp::min(e, total_len.saturating_sub(1));
                            }
                        }
                    }

                    if start > end || start >= total_len {
                        let resp = tiny_http::Response::empty(416)
                            .with_header(tiny_http::Header::from_bytes(&b"Content-Range"[..], format!("bytes */{total_len}").as_bytes()).unwrap());
                        let _ = request.respond(resp);
                        return;
                    }

                    if let Err(_) = file.seek(std::io::SeekFrom::Start(start)) {
                        let _ = request.respond(tiny_http::Response::empty(500));
                        return;
                    }

                    let chunk_len = end - start + 1;
                    use std::io::Read;
                    let take_reader = file.take(chunk_len);

                    // Zero-copy streaming HTTP 206 response via tiny_http::Response::new
                    let resp = tiny_http::Response::new(
                        tiny_http::StatusCode(206),
                        vec![
                            tiny_http::Header::from_bytes(&b"Content-Type"[..], mime_type.as_bytes()).unwrap(),
                            tiny_http::Header::from_bytes(&b"Accept-Ranges"[..], &b"bytes"[..]).unwrap(),
                            tiny_http::Header::from_bytes(&b"Content-Range"[..], format!("bytes {start}-{end}/{total_len}").as_bytes()).unwrap(),
                            tiny_http::Header::from_bytes(&b"Content-Length"[..], format!("{chunk_len}").as_bytes()).unwrap(),
                            tiny_http::Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap(),
                            tiny_http::Header::from_bytes(&b"Access-Control-Allow-Methods"[..], &b"GET, HEAD, OPTIONS"[..]).unwrap(),
                            tiny_http::Header::from_bytes(&b"Access-Control-Allow-Headers"[..], &b"Range, Content-Type, Accept"[..]).unwrap(),
                            tiny_http::Header::from_bytes(&b"Access-Control-Expose-Headers"[..], &b"Content-Range, Content-Length, Accept-Ranges"[..]).unwrap(),
                        ],
                        take_reader,
                        Some(chunk_len as usize),
                        None,
                    );

                    let _ = request.respond(resp);
                } else {
                    let _ = file.seek(std::io::SeekFrom::Start(0));
                    let resp = tiny_http::Response::from_file(file)
                        .with_status_code(200)
                        .with_header(tiny_http::Header::from_bytes(&b"Content-Type"[..], mime_type.as_bytes()).unwrap())
                        .with_header(tiny_http::Header::from_bytes(&b"Accept-Ranges"[..], &b"bytes"[..]).unwrap())
                        .with_header(tiny_http::Header::from_bytes(&b"Content-Length"[..], format!("{total_len}").as_bytes()).unwrap())
                        .with_header(tiny_http::Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap())
                        .with_header(tiny_http::Header::from_bytes(&b"Access-Control-Allow-Methods"[..], &b"GET, HEAD, OPTIONS"[..]).unwrap())
                        .with_header(tiny_http::Header::from_bytes(&b"Access-Control-Allow-Headers"[..], &b"Range, Content-Type, Accept"[..]).unwrap())
                        .with_header(tiny_http::Header::from_bytes(&b"Access-Control-Expose-Headers"[..], &b"Content-Range, Content-Length, Accept-Ranges"[..]).unwrap());

                    let _ = request.respond(resp);
                }
            });
        }
    });

    port
}

#[tauri::command]
fn get_audio_stream_port() -> u16 {
    let port = AUDIO_SERVER_PORT.load(std::sync::atomic::Ordering::SeqCst);
    if port != 0 {
        port
    } else {
        start_audio_stream_server_internal()
    }
}

#[tauri::command]
fn write_music_metadata(file_path: String, tags: Id3TagPayload) -> Result<bool, String> {
    use std::path::Path;
    let path = Path::new(&file_path);
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    if is_mp4_file(path, &ext) {
        write_mp4_tags(&file_path, tags)
    } else {
        // Raw AAC/ADTS has no MP4 ilst container. ID3v2 is the interoperable
        // metadata mechanism for ADTS AAC, so use the same writer as MP3.
        write_id3_tags_impl(&file_path, tags)
    }
}

#[tauri::command]
fn write_id3_tags(file_path: String, tags: Id3TagPayload) -> Result<bool, String> {
    write_id3_tags_impl(&file_path, tags)
}

#[tauri::command]
fn organize_music_file(
    source_path: String,
    library_root: String,
    artist: String,
    album: String,
    title: String,
    extension_or_filename: String,
) -> Result<String, String> {
    use std::fs;
    use std::path::{Path, PathBuf};
    fn sanitize(value: &str, fallback: &str) -> String {
        let cleaned: String = value
            .chars()
            .map(|c| {
                if matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*')
                    || c.is_control()
                {
                    '_'
                } else {
                    c
                }
            })
            .collect();
        let cleaned = cleaned.trim_end_matches(['.', ' ']).trim();
        if cleaned.is_empty() {
            fallback.to_string()
        } else {
            cleaned.to_string()
        }
    }
    let source = Path::new(&source_path);
    if !source.is_file() {
        return Err(format!("Source music file does not exist: {source_path}"));
    }
    let root = PathBuf::from(&library_root);
    let safe_artist = sanitize(&artist, "Unknown Artist");
    let safe_album = sanitize(&album, "Unknown Album");
    let safe_title = sanitize(&title, "Unknown Song");
    let album_dir = root.join(&safe_artist).join(&safe_album);
    fs::create_dir_all(&album_dir).map_err(|e| format!("Could not create music directory: {e}"))?;
    let extension = Path::new(&extension_or_filename)
        .extension()
        .and_then(|e| e.to_str())
        .filter(|e| !e.is_empty())
        .map(|e| format!(".{e}"))
        .unwrap_or_default();
    let base = format!("{safe_title} - {safe_artist}{extension}");
    let mut destination = album_dir.join(&base);
    if destination != source {
        let mut n = 1u32;
        while destination.exists() {
            destination = album_dir.join(format!("{safe_title} - {safe_artist} ({n}){extension}"));
            n += 1;
        }
        fs::copy(source, &destination).map_err(|e| format!("Could not copy music file: {e}"))?;
    }
    Ok(destination.to_string_lossy().into_owned())
}

/// Install a downloaded .deb or .rpm package with pkexec elevation (Linux only).
#[tauri::command]
async fn install_linux_package_elevated(pkg_path: String) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        let ext = std::path::Path::new(&pkg_path)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("");

        let status = match ext {
            "deb" => std::process::Command::new("pkexec")
                .args(["dpkg", "--install", &pkg_path])
                .status()
                .map_err(|e| format!("Failed to run pkexec: {e}"))?,
            "rpm" => std::process::Command::new("pkexec")
                .args(["rpm", "-Uvh", &pkg_path])
                .status()
                .map_err(|e| format!("Failed to run pkexec: {e}"))?,
            _ => return Err(format!("Unsupported package type: .{ext}")),
        };

        if status.success() {
            Ok(())
        } else {
            Err(format!("Installer exited with code {:?}", status.code()))
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = pkg_path;
        Err("install_linux_package_elevated is Linux-only".to_string())
    }
}

pub fn run() {
    #[cfg(target_os = "linux")]
    {
        std::env::set_var("WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS", "1");
        // Only disable DMA-BUF renderer if explicitly requested or under software Mesa drivers;
        // completely forcing WEBKIT_DISABLE_DMABUF_RENDERER=1 disables GPU compositing and causes sluggish software rendering on Linux Mint.
        if std::env::var("WEBKIT_DISABLE_DMABUF_RENDERER").is_err() {
            // Check if user has software rendering or requested it; otherwise allow hardware accelerated compositing
            // for smooth 60fps scrolling and responsive window controls
            if std::env::var("LIBGL_ALWAYS_SOFTWARE").as_deref() == Ok("1") {
                std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
            }
        }
        // Force hardware compositing mode on Linux unless in software-rendering mode
        if std::env::var("WEBKIT_FORCE_COMPOSITING_MODE").is_err() && std::env::var("LIBGL_ALWAYS_SOFTWARE").as_deref() != Ok("1") {
            std::env::set_var("WEBKIT_FORCE_COMPOSITING_MODE", "1");
        }
        // Ensure GStreamer discovers plugins on Debian/Ubuntu/Mint (multiarch), Fedora/RHEL, and generic Linux
        let current_gst_path = std::env::var("GST_PLUGIN_SYSTEM_PATH_1_0").unwrap_or_default();
        let standard_paths = "/usr/lib/x86_64-linux-gnu/gstreamer-1.0:/usr/lib/aarch64-linux-gnu/gstreamer-1.0:/usr/lib64/gstreamer-1.0:/usr/lib/gstreamer-1.0";
        if current_gst_path.is_empty() {
            std::env::set_var("GST_PLUGIN_SYSTEM_PATH_1_0", standard_paths);
        } else {
            std::env::set_var("GST_PLUGIN_SYSTEM_PATH_1_0", format!("{standard_paths}:{current_gst_path}"));
        }
        // Audio stream server is started lazily upon first audio playback requirement via get_audio_stream_port()
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|_app| {
            #[cfg(target_os = "linux")]
            {
                use tauri::Manager;
                if let Some(window) = _app.get_webview_window("main") {
                    let _ = window.set_decorations(true);
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_os,
            get_audio_stream_port,
            read_music_metadata,
            read_music_metadata_batch,
            batch_stat_files,
            stat_music_files_windows,
            scan_directory_native,
            scan_windows_music_directory,
            write_id3_tags,
            write_music_metadata,
            organize_music_file,
            install_linux_package_elevated
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_percent_decode_path() {
        assert_eq!(percent_decode_path("Hello%20World"), "Hello World");
        assert_eq!(percent_decode_path("/home/user/Music/song%2Btrack.mp3"), "/home/user/Music/song+track.mp3");
        assert_eq!(percent_decode_path("plain_path.flac"), "plain_path.flac");
    }

    #[test]
    fn test_batch_stat_files_missing_and_existing() {
        let stats = batch_stat_files(vec![
            "non_existent_file_xyz_12345.mp3".to_string(),
            "Cargo.toml".to_string(),
        ]);
        assert_eq!(stats.len(), 2);
        assert!(!stats[0].exists);
        assert_eq!(stats[0].size, 0);

        assert!(stats[1].exists);
        assert!(stats[1].is_file);
        assert!(stats[1].size > 0);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn test_stat_music_files_windows() {
        let stats = stat_music_files_windows(vec!["Cargo.toml".to_string()]);
        assert_eq!(stats.len(), 1);
        assert!(stats[0].exists);
        assert!(stats[0].is_file);
    }
}

