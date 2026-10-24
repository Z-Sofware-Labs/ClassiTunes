use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackRecord {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub genre: String,
    pub duration: f64,
    #[serde(default)]
    pub year: Option<i32>,
    #[serde(default)]
    pub track_number: Option<i32>,
    #[serde(default)]
    pub track_total: Option<i32>,
    #[serde(default)]
    pub disc_number: Option<i32>,
    #[serde(default)]
    pub disc_total: Option<i32>,
    #[serde(default)]
    pub composer: Option<String>,
    #[serde(default)]
    pub album_artist: Option<String>,
    #[serde(default)]
    pub publisher: Option<String>,
    #[serde(default)]
    pub lyrics: Option<String>,
    #[serde(default)]
    pub replay_gain_db: Option<f64>,
    #[serde(default)]
    pub comments: Option<String>,
    #[serde(default)]
    pub rating: u8,
    #[serde(default)]
    pub play_count: u32,
    #[serde(default)]
    pub last_played: Option<String>,
    #[serde(default)]
    pub cover_url: Option<String>,
    #[serde(default)]
    pub audio_url: String,
    #[serde(default)]
    pub format: Option<String>,
    #[serde(default)]
    pub bpm: Option<i32>,
    #[serde(default)]
    pub media_kind: Option<String>,
    #[serde(default)]
    pub bitrate: Option<u32>,
    #[serde(default)]
    pub sample_rate: Option<u32>,
    #[serde(default)]
    pub size_bytes: Option<u64>,
    #[serde(default)]
    pub date_added: String,
    #[serde(default)]
    pub file_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct LibrarySnapshot {
    tracks: Vec<TrackRecord>,
}

pub struct LibraryDb {
    db_path: PathBuf,
    tracks_by_id: HashMap<String, TrackRecord>,
    ordered_ids: Vec<String>,
}

static LIBRARY_DB: OnceLock<Mutex<LibraryDb>> = OnceLock::new();

fn default_data_dir() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
            return PathBuf::from(local_app_data).join("com.classitunes.desktop");
        }
    }
    #[cfg(target_os = "macos")]
    {
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(home)
                .join("Library")
                .join("Application Support")
                .join("com.classitunes.desktop");
        }
    }
    #[cfg(target_os = "linux")]
    {
        if let Ok(xdg) = std::env::var("XDG_DATA_HOME") {
            return PathBuf::from(xdg).join("com.classitunes.desktop");
        }
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(home)
                .join(".local")
                .join("share")
                .join("com.classitunes.desktop");
        }
    }
    std::env::temp_dir().join("classitunes_data")
}

pub fn get_app_data_dir() -> PathBuf {
    let dir = default_data_dir();
    let _ = fs::create_dir_all(&dir);
    dir
}

pub fn get_artwork_cache_dir() -> PathBuf {
    let dir = get_app_data_dir().join("artwork_cache");
    let _ = fs::create_dir_all(&dir);
    dir
}

impl LibraryDb {
    pub fn open_at(db_path: PathBuf) -> Self {
        let mut db = Self {
            db_path,
            tracks_by_id: HashMap::new(),
            ordered_ids: Vec::new(),
        };
        db.load_from_disk();
        db
    }

    fn load_from_disk(&mut self) {
        if !self.db_path.exists() {
            return;
        }
        let Ok(bytes) = fs::read(&self.db_path) else {
            return;
        };
        let config = bincode::config::standard();
        if let Ok((snapshot, _)) = bincode::serde::decode_from_slice::<LibrarySnapshot, _>(&bytes, config) {
            self.tracks_by_id.clear();
            self.ordered_ids.clear();
            for track in snapshot.tracks {
                self.ordered_ids.push(track.id.clone());
                self.tracks_by_id.insert(track.id.clone(), track);
            }
        }
    }

    fn flush_to_disk(&self) -> Result<(), String> {
        if let Some(parent) = self.db_path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let tracks: Vec<TrackRecord> = self
            .ordered_ids
            .iter()
            .filter_map(|id| self.tracks_by_id.get(id).cloned())
            .collect();
        let snapshot = LibrarySnapshot { tracks };
        let config = bincode::config::standard();
        let encoded = bincode::serde::encode_to_vec(&snapshot, config)
            .map_err(|e| format!("Failed to encode library DB: {e}"))?;

        let tmp_path = self.db_path.with_extension("bin.tmp");
        fs::write(&tmp_path, &encoded)
            .map_err(|e| format!("Failed to write temp library DB: {e}"))?;
        fs::rename(&tmp_path, &self.db_path).or_else(|_| {
            fs::copy(&tmp_path, &self.db_path)
                .map(|_| {
                    let _ = fs::remove_file(&tmp_path);
                })
                .map_err(|e| format!("Failed to commit library DB: {e}"))
        })?;
        Ok(())
    }

    pub fn get_all_tracks(&self) -> Vec<TrackRecord> {
        self.ordered_ids
            .iter()
            .filter_map(|id| self.tracks_by_id.get(id).cloned())
            .collect()
    }

    pub fn replace_all_tracks(&mut self, tracks: Vec<TrackRecord>) -> Result<(), String> {
        self.tracks_by_id.clear();
        self.ordered_ids.clear();
        for track in tracks {
            if !self.tracks_by_id.contains_key(&track.id) {
                self.ordered_ids.push(track.id.clone());
            }
            self.tracks_by_id.insert(track.id.clone(), track);
        }
        self.flush_to_disk()
    }

    pub fn upsert_tracks_batch(&mut self, tracks: Vec<TrackRecord>) -> Result<(), String> {
        for track in tracks {
            if !self.tracks_by_id.contains_key(&track.id) {
                self.ordered_ids.push(track.id.clone());
            }
            self.tracks_by_id.insert(track.id.clone(), track);
        }
        self.flush_to_disk()
    }

    pub fn update_track_playback(
        &mut self,
        id: &str,
        play_count: u32,
        last_played: Option<String>,
    ) -> Result<bool, String> {
        if let Some(track) = self.tracks_by_id.get_mut(id) {
            track.play_count = play_count;
            track.last_played = last_played;
            self.flush_to_disk()?;
            return Ok(true);
        }
        Ok(false)
    }

    pub fn update_track_rating(&mut self, id: &str, rating: u8) -> Result<bool, String> {
        if let Some(track) = self.tracks_by_id.get_mut(id) {
            track.rating = rating;
            self.flush_to_disk()?;
            return Ok(true);
        }
        Ok(false)
    }

    pub fn update_track_cover(&mut self, id: &str, cover_url: String) -> Result<bool, String> {
        if cover_url.is_empty() {
            return Ok(false);
        }
        let mut target_album = None;
        if let Some(track) = self.tracks_by_id.get_mut(id) {
            track.cover_url = Some(cover_url.clone());
            let alb = track.album.trim().to_ascii_lowercase();
            if !alb.is_empty() && alb != "unknown album" {
                target_album = Some(alb);
            }
        } else {
            return Ok(false);
        }

        if let Some(alb) = target_album {
            for t in self.tracks_by_id.values_mut() {
                if t.cover_url.as_deref().unwrap_or("").is_empty()
                    && t.album.trim().to_ascii_lowercase() == alb
                {
                    t.cover_url = Some(cover_url.clone());
                }
            }
        }
        self.flush_to_disk()?;
        Ok(true)
    }

    pub fn delete_tracks(&mut self, ids: &[String]) -> Result<usize, String> {
        let mut removed = 0;
        for id in ids {
            if self.tracks_by_id.remove(id).is_some() {
                removed += 1;
            }
        }
        if removed > 0 {
            self.ordered_ids.retain(|id| self.tracks_by_id.contains_key(id));
            self.flush_to_disk()?;
        }
        Ok(removed)
    }

    pub fn clear(&mut self) -> Result<(), String> {
        self.tracks_by_id.clear();
        self.ordered_ids.clear();
        if self.db_path.exists() {
            let _ = fs::remove_file(&self.db_path);
        }
        Ok(())
    }
}

pub fn with_db<F, R>(f: F) -> Result<R, String>
where
    F: FnOnce(&mut LibraryDb) -> Result<R, String>,
{
    let mutex = LIBRARY_DB.get_or_init(|| {
        let path = get_app_data_dir().join("library_db.bin");
        Mutex::new(LibraryDb::open_at(path))
    });
    let mut guard = mutex.lock().unwrap_or_else(|p| p.into_inner());
    f(&mut guard)
}

/// Deterministic 64-bit FNV-1a hash of image bytes for deduplicated disk artwork caching.
pub fn cache_artwork_bytes_in_dir(bytes: &[u8], mime: &str, cache_dir: &Path) -> Option<String> {
    if bytes.is_empty() {
        return None;
    }
    let mut hash: u64 = 0xcbf29ce484222325;
    for &b in bytes {
        hash ^= b as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    let ext = match mime {
        "image/png" => "png",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/bmp" => "bmp",
        _ => "jpg",
    };
    let file_name = format!("cover_{hash:016x}_{}.{}", bytes.len(), ext);
    let file_path = cache_dir.join(file_name);
    if !file_path.exists() {
        let _ = fs::create_dir_all(cache_dir);
        if fs::write(&file_path, bytes).is_err() {
            return None;
        }
    }
    Some(file_path.to_string_lossy().into_owned())
}

pub fn cache_artwork_bytes(bytes: &[u8], mime: &str) -> Option<String> {
    let dir = get_artwork_cache_dir();
    cache_artwork_bytes_in_dir(bytes, mime, &dir)
}

#[tauri::command]
pub fn db_get_all_tracks() -> Result<Vec<TrackRecord>, String> {
    with_db(|db| Ok(db.get_all_tracks()))
}

#[tauri::command]
pub fn db_save_tracks_batch(tracks: Vec<TrackRecord>) -> Result<bool, String> {
    with_db(|db| {
        db.replace_all_tracks(tracks)?;
        Ok(true)
    })
}

#[tauri::command]
pub fn db_update_track_playback(
    track_id: String,
    play_count: u32,
    last_played: Option<String>,
) -> Result<bool, String> {
    with_db(|db| db.update_track_playback(&track_id, play_count, last_played))
}

#[tauri::command]
pub fn db_update_track_rating(track_id: String, rating: u8) -> Result<bool, String> {
    with_db(|db| db.update_track_rating(&track_id, rating))
}

#[tauri::command]
pub fn db_update_track_cover(track_id: String, cover_url: String) -> Result<bool, String> {
    with_db(|db| db.update_track_cover(&track_id, cover_url))
}

#[tauri::command]
pub fn db_delete_tracks(track_ids: Vec<String>) -> Result<bool, String> {
    with_db(|db| {
        db.delete_tracks(&track_ids)?;
        Ok(true)
    })
}

#[tauri::command]
pub fn db_clear_all() -> Result<bool, String> {
    with_db(|db| {
        db.clear()?;
        Ok(true)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_artwork_cache_deduplication() {
        let temp_dir = std::env::temp_dir().join(format!("classitunes_test_art_{}", std::process::id()));
        let _ = fs::remove_dir_all(&temp_dir);

        let sample_jpeg = [0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3, 4, 5];
        let p1 = cache_artwork_bytes_in_dir(&sample_jpeg, "image/jpeg", &temp_dir).expect("should cache");
        let p2 = cache_artwork_bytes_in_dir(&sample_jpeg, "image/jpeg", &temp_dir).expect("should cache again");
        assert_eq!(p1, p2);
        assert!(Path::new(&p1).exists());

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_library_db_crud_and_persistence() {
        let temp_file = std::env::temp_dir().join(format!("classitunes_test_db_{}.bin", std::process::id()));
        let _ = fs::remove_file(&temp_file);

        {
            let mut db = LibraryDb::open_at(temp_file.clone());
            assert_eq!(db.get_all_tracks().len(), 0);

            let track = TrackRecord {
                id: "track_1".to_string(),
                title: "Test Song".to_string(),
                artist: "Test Artist".to_string(),
                album: "Test Album".to_string(),
                genre: "Rock".to_string(),
                duration: 215.5,
                year: Some(2024),
                track_number: Some(1),
                track_total: Some(10),
                disc_number: Some(1),
                disc_total: Some(1),
                composer: None,
                album_artist: None,
                publisher: None,
                lyrics: None,
                replay_gain_db: Some(-5.2),
                comments: None,
                rating: 4,
                play_count: 2,
                last_played: None,
                cover_url: None,
                audio_url: "C:/Music/test.mp3".to_string(),
                format: Some("MPEG audio file".to_string()),
                bpm: None,
                media_kind: Some("Music".to_string()),
                bitrate: Some(320),
                sample_rate: Some(44100),
                size_bytes: Some(5000000),
                date_added: "2026-10-24T00:00:00Z".to_string(),
                file_path: Some("C:/Music/test.mp3".to_string()),
            };

            db.upsert_tracks_batch(vec![track]).unwrap();
            db.update_track_rating("track_1", 5).unwrap();
            db.update_track_playback("track_1", 3, Some("2026-10-24T01:00:00Z".to_string())).unwrap();
        }

        // Reopen from disk and verify binary persistence
        {
            let mut db = LibraryDb::open_at(temp_file.clone());
            let all = db.get_all_tracks();
            assert_eq!(all.len(), 1);
            assert_eq!(all[0].title, "Test Song");
            assert_eq!(all[0].rating, 5);
            assert_eq!(all[0].play_count, 3);
            assert_eq!(all[0].replay_gain_db, Some(-5.2));

            db.delete_tracks(&["track_1".to_string()]).unwrap();
            assert_eq!(db.get_all_tracks().len(), 0);
        }

        let _ = fs::remove_file(&temp_file);
    }
}
