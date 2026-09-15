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

#[tauri::command]
fn write_music_metadata(file_path: String, tags: Id3TagPayload) -> Result<bool, String> {
    let lower = file_path.to_ascii_lowercase();
    if lower.ends_with(".m4a")
        || lower.ends_with(".m4b")
        || lower.ends_with(".m4p")
        || lower.ends_with(".m4r")
        || lower.ends_with(".mp4")
    {
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            write_id3_tags,
            write_music_metadata,
            organize_music_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
