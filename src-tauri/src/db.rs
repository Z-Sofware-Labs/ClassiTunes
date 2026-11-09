use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum JournalMutation {
    Playback {
        id: String,
        play_count: u32,
        last_played: Option<String>,
    },
    Rating {
        id: String,
        rating: u8,
    },
    Cover {
        id: String,
        cover_url: String,
    },
    Duration {
        id: String,
        duration: f64,
    },
    DurationBatch {
        updates: Vec<(String, f64)>,
    },
    Delete {
        ids: Vec<String>,
    },
}

pub struct LibraryDb {
    db_path: PathBuf,
    tracks_by_id: HashMap<String, TrackRecord>,
    ordered_ids: Vec<String>,
    journal_entry_count: usize,
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
            journal_entry_count: 0,
        };
        db.load_from_disk();
        db
    }

    fn journal_path(&self) -> PathBuf {
        self.db_path.with_extension("journal")
    }

    fn load_from_disk(&mut self) {
        let paths_to_try = [
            self.db_path.clone(),
            self.db_path.with_extension("bin.bak"),
            self.db_path.with_extension("bin.tmp"),
        ];

        let mut loaded = false;
        for p in &paths_to_try {
            if !p.exists() {
                continue;
            }
            if let Ok(bytes) = fs::read(p) {
                let config = bincode::config::standard();
                if let Ok((snapshot, _)) = bincode::serde::decode_from_slice::<LibrarySnapshot, _>(&bytes, config) {
                    if !snapshot.tracks.is_empty() {
                        self.tracks_by_id.clear();
                        self.ordered_ids.clear();
                        for track in snapshot.tracks {
                            self.ordered_ids.push(track.id.clone());
                            self.tracks_by_id.insert(track.id.clone(), track);
                        }
                        eprintln!("Successfully loaded {} tracks from snapshot {:?}", self.ordered_ids.len(), p);
                        loaded = true;
                        break;
                    }
                }
            }
        }

        if !loaded {
            self.tracks_by_id.clear();
            self.ordered_ids.clear();
        }

        // Replay mutation journal if present
        self.replay_journal();
    }

    fn apply_mutation_in_memory(&mut self, mutation: JournalMutation) {
        match mutation {
            JournalMutation::Playback { id, play_count, last_played } => {
                if let Some(track) = self.tracks_by_id.get_mut(&id) {
                    track.play_count = play_count;
                    track.last_played = last_played;
                }
            }
            JournalMutation::Rating { id, rating } => {
                if let Some(track) = self.tracks_by_id.get_mut(&id) {
                    track.rating = rating;
                }
            }
            JournalMutation::Cover { id, cover_url } => {
                if cover_url.is_empty() {
                    return;
                }
                let mut target_album = None;
                if let Some(track) = self.tracks_by_id.get_mut(&id) {
                    track.cover_url = Some(cover_url.clone());
                    let alb = track.album.trim().to_ascii_lowercase();
                    if !alb.is_empty() && alb != "unknown album" {
                        target_album = Some(alb);
                    }
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
            }
            JournalMutation::Duration { id, duration } => {
                if let Some(track) = self.tracks_by_id.get_mut(&id) {
                    if duration > 0.0 {
                        track.duration = duration;
                    }
                }
            }
            JournalMutation::DurationBatch { updates } => {
                for (id, duration) in updates {
                    if let Some(track) = self.tracks_by_id.get_mut(&id) {
                        if duration > 0.0 {
                            track.duration = duration;
                        }
                    }
                }
            }
            JournalMutation::Delete { ids } => {
                let mut removed = false;
                for id in ids {
                    if self.tracks_by_id.remove(&id).is_some() {
                        removed = true;
                    }
                }
                if removed {
                    self.ordered_ids.retain(|id| self.tracks_by_id.contains_key(id));
                }
            }
        }
    }

    fn replay_journal(&mut self) {
        let jpath = self.journal_path();
        if !jpath.exists() {
            self.journal_entry_count = 0;
            return;
        }

        let file = match File::open(&jpath) {
            Ok(f) => f,
            Err(_) => return,
        };

        let reader = BufReader::new(file);
        let mut count = 0;
        let mut valid_lines = Vec::new();
        let mut has_corruption = false;

        for line_res in reader.lines() {
            match line_res {
                Ok(line) => {
                    let trimmed = line.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    match serde_json::from_str::<JournalMutation>(trimmed) {
                        Ok(mutation) => {
                            self.apply_mutation_in_memory(mutation);
                            valid_lines.push(line);
                            count += 1;
                        }
                        Err(e) => {
                            eprintln!("Corrupt or truncated journal line encountered: {e} -> '{trimmed}'");
                            has_corruption = true;
                            // Truncate replay up to the last known good line for safety
                            break;
                        }
                    }
                }
                Err(e) => {
                    eprintln!("I/O error reading journal: {e}");
                    has_corruption = true;
                    break;
                }
            }
        }

        self.journal_entry_count = count;
        eprintln!("Replayed {} mutations from journal {:?}", count, jpath);

        // If corruption was detected, rewrite the journal with valid lines or compact immediately
        if has_corruption || self.journal_entry_count >= 100 {
            if let Err(e) = self.compact_journal() {
                eprintln!("Failed to compact journal after replay: {e}");
            }
        }
    }

    fn append_mutation(&mut self, mutation: JournalMutation) -> Result<(), String> {
        self.apply_mutation_in_memory(mutation.clone());

        let json = serde_json::to_string(&mutation)
            .map_err(|e| format!("Failed to serialize journal entry: {e}"))?;

        if let Some(parent) = self.db_path.parent() {
            let _ = fs::create_dir_all(parent);
        }

        let jpath = self.journal_path();
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&jpath)
            .map_err(|e| format!("Failed to open journal for append: {e}"))?;

        writeln!(file, "{}", json)
            .map_err(|e| format!("Failed to write to journal: {e}"))?;
        file.sync_data()
            .or_else(|_| file.sync_all())
            .map_err(|e| format!("Failed to flush journal to disk: {e}"))?;

        self.journal_entry_count += 1;

        if self.journal_entry_count >= 100 {
            let _ = self.compact_journal();
        }

        Ok(())
    }

    pub fn compact_journal(&mut self) -> Result<(), String> {
        self.flush_to_disk()?;
        let jpath = self.journal_path();
        if jpath.exists() {
            let _ = fs::remove_file(&jpath);
        }
        self.journal_entry_count = 0;
        Ok(())
    }

    fn flush_to_disk(&self) -> Result<(), String> {
        if let Some(parent) = self.db_path.parent() {
            let _ = fs::create_dir_all(parent);
        }

        // Backup existing valid file before rewriting
        if self.db_path.exists() && !self.tracks_by_id.is_empty() {
            let backup_path = self.db_path.with_extension("bin.bak");
            let _ = fs::copy(&self.db_path, &backup_path);
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
        // SAFETY GUARD: If caller passes an empty vector, but we currently have existing tracks,
        // NEVER wipe the database! An empty library replacement must only happen if explicitly requested.
        // In practice, this prevents frontend startup race conditions from wiping the library.
        if tracks.is_empty() && !self.tracks_by_id.is_empty() {
            eprintln!("Prevented wiping {} tracks with empty batch in replace_all_tracks", self.tracks_by_id.len());
            return Ok(());
        }

        self.tracks_by_id.clear();
        self.ordered_ids.clear();
        for track in tracks {
            if !self.tracks_by_id.contains_key(&track.id) {
                self.ordered_ids.push(track.id.clone());
            }
            self.tracks_by_id.insert(track.id.clone(), track);
        }
        self.compact_journal()
    }

    pub fn upsert_tracks_batch(&mut self, tracks: Vec<TrackRecord>) -> Result<(), String> {
        for track in tracks {
            if !self.tracks_by_id.contains_key(&track.id) {
                self.ordered_ids.push(track.id.clone());
            }
            self.tracks_by_id.insert(track.id.clone(), track);
        }
        self.compact_journal()
    }

    pub fn update_track_playback(
        &mut self,
        id: &str,
        play_count: u32,
        last_played: Option<String>,
    ) -> Result<bool, String> {
        if !self.tracks_by_id.contains_key(id) {
            return Ok(false);
        }
        self.append_mutation(JournalMutation::Playback {
            id: id.to_string(),
            play_count,
            last_played,
        })?;
        Ok(true)
    }

    pub fn update_track_rating(&mut self, id: &str, rating: u8) -> Result<bool, String> {
        if !self.tracks_by_id.contains_key(id) {
            return Ok(false);
        }
        self.append_mutation(JournalMutation::Rating {
            id: id.to_string(),
            rating,
        })?;
        Ok(true)
    }

    pub fn update_track_cover(&mut self, id: &str, cover_url: String) -> Result<bool, String> {
        if cover_url.is_empty() || !self.tracks_by_id.contains_key(id) {
            return Ok(false);
        }
        self.append_mutation(JournalMutation::Cover {
            id: id.to_string(),
            cover_url,
        })?;
        Ok(true)
    }

    pub fn update_track_duration(&mut self, id: &str, duration: f64) -> Result<bool, String> {
        if duration <= 0.0 || !self.tracks_by_id.contains_key(id) {
            return Ok(false);
        }
        self.append_mutation(JournalMutation::Duration {
            id: id.to_string(),
            duration,
        })?;
        Ok(true)
    }

    pub fn update_tracks_duration_batch(&mut self, updates: Vec<(String, f64)>) -> Result<usize, String> {
        let valid_updates: Vec<(String, f64)> = updates
            .into_iter()
            .filter(|(id, d)| *d > 0.0 && self.tracks_by_id.contains_key(id))
            .collect();
        if valid_updates.is_empty() {
            return Ok(0);
        }
        let count = valid_updates.len();
        self.append_mutation(JournalMutation::DurationBatch {
            updates: valid_updates,
        })?;
        Ok(count)
    }

    pub fn delete_tracks(&mut self, ids: &[String]) -> Result<usize, String> {
        let to_remove: Vec<String> = ids
            .iter()
            .filter(|id| self.tracks_by_id.contains_key(*id))
            .cloned()
            .collect();
        if to_remove.is_empty() {
            return Ok(0);
        }
        let count = to_remove.len();
        self.append_mutation(JournalMutation::Delete { ids: to_remove })?;
        Ok(count)
    }

    pub fn clear(&mut self) -> Result<(), String> {
        self.tracks_by_id.clear();
        self.ordered_ids.clear();
        self.journal_entry_count = 0;
        if self.db_path.exists() {
            let _ = fs::remove_file(&self.db_path);
        }
        let jpath = self.journal_path();
        if jpath.exists() {
            let _ = fs::remove_file(&jpath);
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
pub fn db_update_track_duration(track_id: String, duration: f64) -> Result<bool, String> {
    with_db(|db| db.update_track_duration(&track_id, duration))
}

#[tauri::command]
pub fn db_update_tracks_duration_batch(updates: Vec<(String, f64)>) -> Result<usize, String> {
    with_db(|db| db.update_tracks_duration_batch(updates))
}

#[tauri::command]
pub fn db_compact_journal() -> Result<bool, String> {
    with_db(|db| {
        db.compact_journal()?;
        Ok(true)
    })
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
        let _ = fs::remove_file(temp_file.with_extension("journal"));

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

        // Reopen from disk and verify binary persistence + journal replay
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
        let _ = fs::remove_file(temp_file.with_extension("journal"));
    }

    #[test]
    fn test_journal_replay_and_compaction() {
        let temp_file = std::env::temp_dir().join(format!("classitunes_test_journal_{}.bin", std::process::id()));
        let jpath = temp_file.with_extension("journal");
        let _ = fs::remove_file(&temp_file);
        let _ = fs::remove_file(&jpath);

        let track1 = TrackRecord {
            id: "t1".to_string(),
            title: "Track 1".to_string(),
            artist: "Artist 1".to_string(),
            album: "Album 1".to_string(),
            genre: "Pop".to_string(),
            duration: 180.0,
            year: Some(2023),
            track_number: Some(1),
            track_total: Some(2),
            disc_number: None,
            disc_total: None,
            composer: None,
            album_artist: None,
            publisher: None,
            lyrics: None,
            replay_gain_db: None,
            comments: None,
            rating: 0,
            play_count: 0,
            last_played: None,
            cover_url: None,
            audio_url: "music/t1.mp3".to_string(),
            format: None,
            bpm: None,
            media_kind: None,
            bitrate: None,
            sample_rate: None,
            size_bytes: None,
            date_added: "2026-01-01".to_string(),
            file_path: Some("music/t1.mp3".to_string()),
        };

        {
            let mut db = LibraryDb::open_at(temp_file.clone());
            db.replace_all_tracks(vec![track1]).unwrap();
            // Snapshot written, journal empty
            assert!(!jpath.exists() || fs::read_to_string(&jpath).unwrap().is_empty());

            // Apply mutations
            db.update_track_rating("t1", 4).unwrap();
            db.update_track_playback("t1", 5, Some("2026-11-09T00:00:00Z".to_string())).unwrap();
            db.update_track_duration("t1", 195.2).unwrap();
            db.update_track_cover("t1", "cover.jpg".to_string()).unwrap();

            // Journal must exist and contain mutations
            assert!(jpath.exists());
            assert_eq!(db.journal_entry_count, 4);
        }

        // Reopen without compacting - should replay journal faithfully
        {
            let mut db = LibraryDb::open_at(temp_file.clone());
            let all = db.get_all_tracks();
            assert_eq!(all.len(), 1);
            let t = &all[0];
            assert_eq!(t.rating, 4);
            assert_eq!(t.play_count, 5);
            assert_eq!(t.duration, 195.2);
            assert_eq!(t.cover_url.as_deref(), Some("cover.jpg"));

            // Compact journal
            db.compact_journal().unwrap();
            assert!(!jpath.exists());
            assert_eq!(db.journal_entry_count, 0);
        }

        // Reopen after compaction
        {
            let db = LibraryDb::open_at(temp_file.clone());
            let all = db.get_all_tracks();
            assert_eq!(all.len(), 1);
            let t = &all[0];
            assert_eq!(t.rating, 4);
            assert_eq!(t.play_count, 5);
            assert_eq!(t.duration, 195.2);
            assert_eq!(t.cover_url.as_deref(), Some("cover.jpg"));
        }

        let _ = fs::remove_file(&temp_file);
        let _ = fs::remove_file(&jpath);
    }

    #[test]
    fn test_interrupted_corrupt_journal_recovery() {
        let temp_file = std::env::temp_dir().join(format!("classitunes_test_corrupt_{}.bin", std::process::id()));
        let jpath = temp_file.with_extension("journal");
        let _ = fs::remove_file(&temp_file);
        let _ = fs::remove_file(&jpath);

        let track = TrackRecord {
            id: "t_rec".to_string(),
            title: "Safe Track".to_string(),
            artist: "Safe Artist".to_string(),
            album: "Safe Album".to_string(),
            genre: "Jazz".to_string(),
            duration: 100.0,
            year: None,
            track_number: None,
            track_total: None,
            disc_number: None,
            disc_total: None,
            composer: None,
            album_artist: None,
            publisher: None,
            lyrics: None,
            replay_gain_db: None,
            comments: None,
            rating: 1,
            play_count: 0,
            last_played: None,
            cover_url: None,
            audio_url: "music/safe.mp3".to_string(),
            format: None,
            bpm: None,
            media_kind: None,
            bitrate: None,
            sample_rate: None,
            size_bytes: None,
            date_added: "2026-01-01".to_string(),
            file_path: Some("music/safe.mp3".to_string()),
        };

        {
            let mut db = LibraryDb::open_at(temp_file.clone());
            db.replace_all_tracks(vec![track]).unwrap();
            db.update_track_rating("t_rec", 5).unwrap();
        }

        // Simulate an interrupted write / partial power loss by appending garbage to journal
        {
            let mut file = OpenOptions::new().append(true).open(&jpath).unwrap();
            writeln!(file, "{{\"op\":\"rating\",\"id\":\"t_rec\",\"rating\":").unwrap(); // Incomplete JSON
        }

        // Reopening should not crash; it should replay up to the last good line and recover
        {
            let db = LibraryDb::open_at(temp_file.clone());
            let all = db.get_all_tracks();
            assert_eq!(all.len(), 1);
            assert_eq!(all[0].rating, 5);
        }

        let _ = fs::remove_file(&temp_file);
        let _ = fs::remove_file(&jpath);
    }
}
