use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter};

static SYNC_ABORT_REQUESTED: AtomicBool = AtomicBool::new(false);
static SYNC_IN_PROGRESS: AtomicBool = AtomicBool::new(false);

fn last_known_devices_cache() -> &'static Mutex<Option<Vec<Mp3Device>>> {
    static CACHE: OnceLock<Mutex<Option<Vec<Mp3Device>>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(None))
}

fn device_track_cache() -> &'static Mutex<HashMap<(String, u64), DeviceTrackItem>> {
    static CACHE: OnceLock<Mutex<HashMap<(String, u64), DeviceTrackItem>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn copy_file_buffered(src: &Path, dest: &Path) -> Result<u64, std::io::Error> {
    let mut reader = fs::File::open(src)?;
    let mut writer = fs::File::create(dest)?;
    let mut buf = vec![0u8; 256 * 1024]; // 256 KB sequential buffer optimal for USB 2.0/3.0 flash controllers
    let mut total = 0u64;
    loop {
        let n = reader.read(&mut buf)?;
        if n == 0 {
            break;
        }
        writer.write_all(&buf[..n])?;
        total += n as u64;
    }
    writer.flush()?;
    Ok(total)
}

pub fn abort_device_sync() {
    SYNC_ABORT_REQUESTED.store(true, Ordering::SeqCst);
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DeviceCategory {
    Ipod,
    Iphone,
    Android,
    Mp3Player,
    UsbDevice,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Mp3Device {
    pub id: String,
    pub name: String,
    pub mount_point: String,
    pub total_bytes: u64,
    pub available_bytes: u64,
    pub used_bytes: u64,
    pub filesystem: String,
    pub category: DeviceCategory,
    pub is_ipod: bool,
    pub is_audio_player: bool,
    pub model_description: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SyncTrackItem {
    pub id: String,
    pub file_path: String,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album_artist: Option<String>,
    pub album: Option<String>,
    pub genre: Option<String>,
    pub track_number: Option<i32>,
    pub year: Option<i32>,
    pub cover_url: Option<String>,
    #[serde(default)]
    pub lyrics: Option<String>,
    #[serde(default)]
    pub comments: Option<String>,
    #[serde(default)]
    pub duration: Option<f64>,
    #[serde(default)]
    pub bitrate: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceSyncPayload {
    pub mount_point: String,
    pub tracks: Vec<SyncTrackItem>,
    pub naming_template: Option<String>,
    pub sync_playlists: bool,
    pub playlist_name: Option<String>,
    pub transcode_enabled: Option<bool>,
    pub transcode_format: Option<String>,
    pub transcode_bitrate: Option<u32>,
    pub transcode_downmix_mono: Option<bool>,
    pub transcode_downsample_44k: Option<bool>,
    #[serde(default)]
    pub mirror_sync: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncProgressEvent {
    pub current_index: usize,
    pub total_tracks: usize,
    pub current_title: String,
    pub bytes_copied: u64,
    pub total_bytes: u64,
    pub is_complete: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub synced_track: Option<DeviceTrackItem>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceSyncResult {
    pub tracks_synced: usize,
    pub tracks_skipped: usize,
    pub tracks_updated: usize,
    pub tracks_deleted: usize,
    pub total_bytes_transferred: u64,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceTrackItem {
    pub file_name: String,
    pub relative_path: String,
    pub full_path: String,
    pub size_bytes: u64,
    pub format: String,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub genre: Option<String>,
    pub year: Option<i32>,
    pub track_number: Option<i32>,
    pub duration_secs: Option<f64>,
    pub cover_url: Option<String>,
    #[serde(default)]
    pub bitrate: Option<u32>,
    #[serde(default)]
    pub sample_rate: Option<u32>,
}

/// Sanitizes a string for FAT32 filesystem compatibility.
pub fn sanitize_fat_filename(name: &str) -> String {
    let sanitized: String = name
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c if (c as u32) < 32 => '_',
            c => c,
        })
        .collect();

    let trimmed = sanitized.trim().trim_end_matches('.');
    if trimmed.is_empty() {
        "Unknown".to_string()
    } else if trimmed.len() > 100 {
        trimmed.chars().take(100).collect()
    } else {
        trimmed.to_string()
    }
}

/// Builds relative destination path from template tokens.
pub fn render_naming_template(
    template: &str,
    track: &SyncTrackItem,
    ext: &str,
) -> PathBuf {
    let default_template = "{Artist}/{Album}/{TrackNumber} - {Title}";
    let tmpl = if template.trim().is_empty() {
        default_template
    } else {
        template
    };

    let artist = sanitize_fat_filename(track.artist.as_deref().unwrap_or("Unknown Artist"));
    let album = sanitize_fat_filename(track.album.as_deref().unwrap_or("Unknown Album"));
    let title = sanitize_fat_filename(track.title.as_deref().unwrap_or("Unknown Title"));
    let track_num = match track.track_number {
        Some(n) if n > 0 => format!("{:02}", n),
        _ => "01".to_string(),
    };
    let year = match track.year {
        Some(y) if y > 0 => y.to_string(),
        _ => "".to_string(),
    };

    // Strip any .{ext} or {ext} token from the template so the user template controls
    // only the folder and filename structure, while the file extension is strictly preserved
    let clean_tmpl = tmpl
        .replace(".{ext}", "")
        .replace("{ext}", "");

    let rendered = clean_tmpl
        .replace("{Artist}", &artist)
        .replace("{Album}", &album)
        .replace("{Title}", &title)
        .replace("{TrackNumber}", &track_num)
        .replace("{Year}", &year);

    let clean_ext = ext.trim_start_matches('.').to_lowercase();

    let mut path = PathBuf::new();
    let parts: Vec<&str> = rendered
        .split(['/', '\\'])
        .filter(|s| !s.trim().is_empty())
        .collect();

    if parts.is_empty() {
        path.push(format!("{title}.{clean_ext}"));
    } else {
        for (i, part) in parts.iter().enumerate() {
            let mut clean_part = sanitize_fat_filename(part);
            if clean_part.is_empty() {
                clean_part = "Unknown".to_string();
            }
            // If this is the last part (the filename), guarantee the extension is always appended
            if i == parts.len() - 1 {
                let ext_suffix = format!(".{}", clean_ext);
                if clean_part.to_lowercase().ends_with(&ext_suffix) {
                    path.push(clean_part);
                } else {
                    path.push(format!("{clean_part}.{clean_ext}"));
                }
            } else {
                path.push(clean_part);
            }
        }
    }

    path
}

/// Smart heuristic classifier for connected storage volumes.
pub fn detect_device_category(
    root_path: &Path,
    vol_name: &str,
    _is_removable: bool,
) -> (DeviceCategory, Option<String>) {
    let vol_lower = vol_name.to_lowercase();

    // 1. Apple iPod
    let ipod_control = root_path.join("iPod_Control");
    if ipod_control.exists() || vol_lower.contains("ipod") {
        let sysinfo_path = ipod_control.join("Device").join("SysInfo");
        let model = if let Ok(sysinfo) = fs::read_to_string(&sysinfo_path) {
            let lower_info = sysinfo.to_lowercase();
            if lower_info.contains("classic") || lower_info.contains("5.5g") || lower_info.contains("video") {
                Some("Apple iPod Classic".to_string())
            } else if lower_info.contains("mini") {
                Some("Apple iPod Mini".to_string())
            } else if lower_info.contains("nano") {
                Some("Apple iPod Nano".to_string())
            } else if lower_info.contains("shuffle") {
                Some("Apple iPod Shuffle".to_string())
            } else if lower_info.contains("touch") {
                Some("Apple iPod Touch".to_string())
            } else {
                Some("Apple iPod".to_string())
            }
        } else if vol_lower.contains("nano") {
            Some("Apple iPod Nano".to_string())
        } else if vol_lower.contains("shuffle") {
            Some("Apple iPod Shuffle".to_string())
        } else if vol_lower.contains("mini") {
            Some("Apple iPod Mini".to_string())
        } else if vol_lower.contains("classic") {
            Some("Apple iPod Classic".to_string())
        } else {
            Some("Apple iPod".to_string())
        };
        return (DeviceCategory::Ipod, model);
    }

    // 2. Apple iPhone / iPad
    let dcim = root_path.join("DCIM");
    let is_apple_dcim = dcim.join("100APPLE").exists()
        || dcim.join("APPLE").exists()
        || vol_lower.contains("iphone")
        || vol_lower.contains("ipad");
    if is_apple_dcim && !root_path.join("Android").exists() {
        let desc = if vol_lower.contains("ipad") {
            "Apple iPad (iOS Media)"
        } else {
            "Apple iPhone (iOS Media)"
        };
        return (DeviceCategory::Iphone, Some(desc.to_string()));
    }

    // 3. Android
    let has_android_dir = root_path.join("Android").exists() || root_path.join(".android_secure").exists();
    let android_brand_match = [
        "android", "samsung", "galaxy", "pixel", "xperia", "xiaomi", "redmi",
        "oneplus", "oppo", "vivo", "motorola", "huawei", "poco", "honor", "realme",
    ]
    .iter()
    .any(|&brand| vol_lower.contains(brand));

    if has_android_dir || android_brand_match {
        let desc = if vol_lower.contains("samsung") || vol_lower.contains("galaxy") {
            "Samsung Galaxy (Android)"
        } else if vol_lower.contains("pixel") {
            "Google Pixel (Android)"
        } else if vol_lower.contains("xperia") {
            "Sony Xperia (Android)"
        } else if vol_lower.contains("xiaomi") || vol_lower.contains("redmi") || vol_lower.contains("poco") {
            "Xiaomi Device (Android)"
        } else {
            "Android Media Device"
        };
        return (DeviceCategory::Android, Some(desc.to_string()));
    }

    // 4. Dedicated MP3 Player / DAP
    // True hardware MP3 players and DAPs have specific firmware directories, markers, or explicit player brands.
    // NOTE: A standard USB thumb drive with a "Music" or "Audio" directory is a USB Drive, NOT an MP3 Player.
    let has_rockbox = root_path.join(".rockbox").exists();
    let has_audio_marker = root_path.join(".is_audio_player").exists();
    let has_sigmatel_firmware = root_path.join("RECORD").exists() && root_path.join("VOICE").exists();
    let has_dap_db = root_path.join("FiiO_Music").exists()
        || root_path.join("hiby").exists()
        || root_path.join("hibymusic").exists();

    let mp3_brand_match = [
        "walkman", "sansa", "ruizu", "fiio", "shanling", "cowon", "astell",
        "ibasso", "hidizs", "hifiman", "innioasis", "creative zen", "zune",
        "iriver", "mechen", "agptek", "mp3 player", "dap", "audio player",
    ]
    .iter()
    .any(|&brand| vol_lower.contains(brand));

    if has_rockbox {
        return (
            DeviceCategory::Mp3Player,
            Some("Rockbox Digital Audio Player".to_string()),
        );
    }
    if has_audio_marker || has_sigmatel_firmware || has_dap_db || mp3_brand_match {
        let desc = if vol_lower.contains("walkman") {
            "Sony Walkman"
        } else if vol_lower.contains("sansa") {
            "SanDisk Sansa"
        } else if vol_lower.contains("fiio") {
            "FiiO High-Res DAP"
        } else if vol_lower.contains("shanling") {
            "Shanling High-Res DAP"
        } else if vol_lower.contains("astell") {
            "Astell&Kern High-Res DAP"
        } else if vol_lower.contains("cowon") {
            "Cowon Digital Audio Player"
        } else if vol_lower.contains("zen") {
            "Creative Zen MP3 Player"
        } else if vol_lower.contains("zune") {
            "Microsoft Zune Player"
        } else if vol_lower.contains("iriver") {
            "iRiver MP3 Player"
        } else if vol_lower.contains("agptek") || vol_lower.contains("ruizu") || vol_lower.contains("mechen") {
            "Portable HiFi MP3 Player"
        } else {
            "Digital Audio Player (MP3/DAP)"
        };
        return (DeviceCategory::Mp3Player, Some(desc.to_string()));
    }

    // 5. Generic USB Mass Storage Device (Flash drives, external hard drives, SSDs)
    (
        DeviceCategory::UsbDevice,
        Some("USB Mass Storage Device".to_string()),
    )
}

#[cfg(target_os = "windows")]
const DRIVE_REMOVABLE: u32 = 2;
#[cfg(target_os = "windows")]
const DRIVE_FIXED: u32 = 3;

#[cfg(target_os = "windows")]
pub fn list_connected_devices_native() -> Vec<Mp3Device> {
    if SYNC_IN_PROGRESS.load(Ordering::Relaxed) {
        if let Ok(guard) = last_known_devices_cache().lock() {
            if let Some(cached) = guard.as_ref() {
                return cached.clone();
            }
        }
    }

    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{
        GetDiskFreeSpaceExW, GetDriveTypeW, GetLogicalDriveStringsW, GetVolumeInformationW,
    };

    let mut devices = Vec::new();

    unsafe {
        let mut buffer = [0u16; 512];
        let len = GetLogicalDriveStringsW(Some(&mut buffer));
        if len == 0 || len > 512 {
            return devices;
        }

        let slice = &buffer[..len as usize];
        for drive_chars in slice.split(|&c| c == 0) {
            if drive_chars.is_empty() {
                continue;
            }

            let mut drive_str_u16 = drive_chars.to_vec();
            drive_str_u16.push(0);

            let drive_pcwstr = PCWSTR(drive_str_u16.as_ptr());
            let drive_type = GetDriveTypeW(drive_pcwstr);

            let drive_path = OsString::from_wide(drive_chars).to_string_lossy().to_string();
            let root_path = Path::new(&drive_path);

            let is_ipod = root_path.join("iPod_Control").exists();
            let is_android = root_path.join("Android").exists();
            let has_audio_folder = root_path.join("Music").exists()
                || root_path.join("Audio").exists()
                || root_path.join("MP3").exists()
                || root_path.join(".is_audio_player").exists();

            let is_removable = drive_type == DRIVE_REMOVABLE;
            let is_special_fixed = drive_type == DRIVE_FIXED && (is_ipod || is_android || has_audio_folder);

            if is_removable || is_special_fixed {
                let mut vol_name_buf = [0u16; 260];
                let mut fs_name_buf = [0u16; 260];

                let _ = GetVolumeInformationW(
                    drive_pcwstr,
                    Some(&mut vol_name_buf),
                    None,
                    None,
                    None,
                    Some(&mut fs_name_buf),
                );

                let vol_name_end = vol_name_buf.iter().position(|&c| c == 0).unwrap_or(vol_name_buf.len());
                let vol_name = OsString::from_wide(&vol_name_buf[..vol_name_end]).to_string_lossy().to_string();

                let fs_name_end = fs_name_buf.iter().position(|&c| c == 0).unwrap_or(fs_name_buf.len());
                let fs_name = OsString::from_wide(&fs_name_buf[..fs_name_end]).to_string_lossy().to_string();

                let mut free_bytes_avail = 0u64;
                let mut total_bytes = 0u64;
                let mut total_free = 0u64;

                let _ = GetDiskFreeSpaceExW(
                    drive_pcwstr,
                    Some(&mut free_bytes_avail),
                    Some(&mut total_bytes),
                    Some(&mut total_free),
                );

                let used_bytes = total_bytes.saturating_sub(total_free);

                let (category, model_desc) = detect_device_category(root_path, &vol_name, is_removable);
                let is_ipod_device = category == DeviceCategory::Ipod;

                let drive_letter = drive_path.trim_end_matches(['\\', '/']);

                let display_name = match category {
                    DeviceCategory::Ipod => {
                        if !vol_name.is_empty() {
                            format!("{vol_name} (iPod)")
                        } else {
                            format!("Apple iPod ({drive_letter})")
                        }
                    }
                    DeviceCategory::Iphone => {
                        if !vol_name.is_empty() {
                            format!("{vol_name} (iPhone)")
                        } else {
                            format!("Apple iPhone ({drive_letter})")
                        }
                    }
                    DeviceCategory::Android => {
                        if !vol_name.is_empty() {
                            format!("{vol_name} (Android)")
                        } else {
                            format!("Android Device ({drive_letter})")
                        }
                    }
                    DeviceCategory::Mp3Player => {
                        if !vol_name.is_empty() {
                            format!("{vol_name} ({drive_letter})")
                        } else {
                            format!("MP3 Player ({drive_letter})")
                        }
                    }
                    DeviceCategory::UsbDevice => {
                        if !vol_name.is_empty() {
                            format!("{vol_name} ({drive_letter})")
                        } else {
                            format!("USB Drive ({drive_letter})")
                        }
                    }
                };

                devices.push(Mp3Device {
                    id: drive_path.clone(),
                    name: display_name,
                    mount_point: drive_path,
                    total_bytes,
                    available_bytes: total_free,
                    used_bytes,
                    filesystem: if fs_name.is_empty() { "FAT32".to_string() } else { fs_name },
                    category,
                    is_ipod: is_ipod_device,
                    is_audio_player: category == DeviceCategory::Ipod || category == DeviceCategory::Mp3Player || has_audio_folder,
                    model_description: model_desc,
                });
            }
        }
    }

    if let Ok(mut guard) = last_known_devices_cache().lock() {
        *guard = Some(devices.clone());
    }

    devices
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn get_unix_disk_space(mount_point: &str) -> (u64, u64, u64) {
    use std::process::Command;
    if let Ok(output) = Command::new("df").args(["-k", mount_point]).output() {
        if output.status.success() {
            let text = String::from_utf8_lossy(&output.stdout);
            if let Some(line) = text.lines().nth(1) {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 4 {
                    let total_k = parts[1].parse::<u64>().unwrap_or(0);
                    let used_k = parts[2].parse::<u64>().unwrap_or(0);
                    let avail_k = parts[3].parse::<u64>().unwrap_or(0);
                    return (total_k * 1024, avail_k * 1024, used_k * 1024);
                }
            }
        }
    }
    (0, 0, 0)
}

#[cfg(target_os = "macos")]
pub fn list_connected_devices_native() -> Vec<Mp3Device> {
    let mut devices = Vec::new();
    let volumes_path = Path::new("/Volumes");
    let Ok(entries) = fs::read_dir(volumes_path) else {
        return devices;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        // Skip symlinks or root volume mount "/"
        if let Ok(target) = fs::canonicalize(&path) {
            if target == Path::new("/") {
                continue;
            }
        }

        let vol_name = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("External Drive")
            .to_string();

        let mount_point = path.to_string_lossy().to_string();
        let (total_bytes, available_bytes, used_bytes) = get_unix_disk_space(&mount_point);
        if total_bytes == 0 {
            continue;
        }

        let (category, model_desc) = detect_device_category(&path, &vol_name, true);
        let has_audio_folder = path.join("Music").exists()
            || path.join("Audio").exists()
            || path.join("MP3").exists();

        let display_name = match category {
            DeviceCategory::Ipod => format!("{vol_name} (iPod)"),
            DeviceCategory::Iphone => format!("{vol_name} (iPhone)"),
            DeviceCategory::Android => format!("{vol_name} (Android)"),
            DeviceCategory::Mp3Player => format!("{vol_name} (MP3 Player)"),
            DeviceCategory::UsbDevice => format!("{vol_name} (USB Drive)"),
        };

        devices.push(Mp3Device {
            id: mount_point.clone(),
            name: display_name,
            mount_point,
            total_bytes,
            available_bytes,
            used_bytes,
            filesystem: "FAT32 / exFAT".to_string(),
            category,
            is_ipod: category == DeviceCategory::Ipod,
            is_audio_player: category == DeviceCategory::Ipod || category == DeviceCategory::Mp3Player || has_audio_folder,
            model_description: model_desc,
        });
    }

    if let Ok(mut guard) = last_known_devices_cache().lock() {
        *guard = Some(devices.clone());
    }

    devices
}

#[cfg(target_os = "linux")]
pub fn list_connected_devices_native() -> Vec<Mp3Device> {
    let mut devices = Vec::new();
    let mut seen_mounts = std::collections::HashSet::new();

    // Scan standard Linux desktop removable mount roots: /run/media and /media
    let search_roots = [Path::new("/run/media"), Path::new("/media")];
    for root in search_roots {
        if !root.exists() {
            continue;
        }
        if let Ok(user_dirs) = fs::read_dir(root) {
            for user_entry in user_dirs.flatten() {
                let user_path = user_entry.path();
                if user_path.is_dir() {
                    if let Ok(vol_entries) = fs::read_dir(&user_path) {
                        for vol_entry in vol_entries.flatten() {
                            let vol_path = vol_entry.path();
                            if vol_path.is_dir() {
                                let mount_str = vol_path.to_string_lossy().to_string();
                                if seen_mounts.insert(mount_str.clone()) {
                                    let vol_name = vol_path
                                        .file_name()
                                        .and_then(|s| s.to_str())
                                        .unwrap_or("Removable Drive")
                                        .to_string();

                                    let (total_bytes, available_bytes, used_bytes) = get_unix_disk_space(&mount_str);
                                    if total_bytes > 0 {
                                        let (category, model_desc) = detect_device_category(&vol_path, &vol_name, true);
                                        let has_audio_folder = vol_path.join("Music").exists()
                                            || vol_path.join("Audio").exists()
                                            || vol_path.join("MP3").exists();

                                        let display_name = match category {
                                            DeviceCategory::Ipod => format!("{vol_name} (iPod)"),
                                            DeviceCategory::Iphone => format!("{vol_name} (iPhone)"),
                                            DeviceCategory::Android => format!("{vol_name} (Android)"),
                                            DeviceCategory::Mp3Player => format!("{vol_name} (MP3 Player)"),
                                            DeviceCategory::UsbDevice => format!("{vol_name} (USB Drive)"),
                                        };

                                        devices.push(Mp3Device {
                                            id: mount_str.clone(),
                                            name: display_name,
                                            mount_point: mount_str,
                                            total_bytes,
                                            available_bytes,
                                            used_bytes,
                                            filesystem: "vfat / exfat".to_string(),
                                            category,
                                            is_ipod: category == DeviceCategory::Ipod,
                                            is_audio_player: category == DeviceCategory::Ipod || category == DeviceCategory::Mp3Player || has_audio_folder,
                                            model_description: model_desc,
                                        });
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if let Ok(mut guard) = last_known_devices_cache().lock() {
        *guard = Some(devices.clone());
    }

    devices
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
pub fn list_connected_devices_native() -> Vec<Mp3Device> {
    Vec::new()
}

#[cfg(target_os = "windows")]
pub fn eject_device_native(mount_point: &str) -> Result<bool, String> {
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::process::CommandExt;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{CloseHandle, GENERIC_READ};
    use windows::Win32::Storage::FileSystem::{
        CreateFileW, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
    };
    use windows::Win32::System::Ioctl::{
        FSCTL_DISMOUNT_VOLUME, IOCTL_STORAGE_EJECT_MEDIA,
    };
    use windows::Win32::System::IO::DeviceIoControl;

    let clean = mount_point.trim_end_matches(['\\', '/']);
    let clean_drive = if clean.len() == 1 && clean.chars().next().map_or(false, |c| c.is_ascii_alphabetic()) {
        format!("{clean}:")
    } else {
        clean.to_string()
    };
    let volume_path = format!("\\\\.\\{}", clean_drive);
    let volume_wide: Vec<u16> = std::ffi::OsStr::new(&volume_path)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    // 1. Try low-level Win32 DeviceIoControl (using GENERIC_READ which does not require admin elevation for removable drives)
    let mut win32_ejected = false;
    unsafe {
        let handle = CreateFileW(
            PCWSTR(volume_wide.as_ptr()),
            GENERIC_READ.0,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            None,
            OPEN_EXISTING,
            windows::Win32::Storage::FileSystem::FILE_FLAGS_AND_ATTRIBUTES(0),
            None,
        );

        if let Ok(handle) = handle {
            let mut bytes_returned = 0u32;
            let _ = DeviceIoControl(
                handle,
                FSCTL_DISMOUNT_VOLUME,
                None,
                0,
                None,
                0,
                Some(&mut bytes_returned),
                None,
            );

            let eject_res = DeviceIoControl(
                handle,
                IOCTL_STORAGE_EJECT_MEDIA,
                None,
                0,
                None,
                0,
                Some(&mut bytes_returned),
                None,
            );

            let _ = CloseHandle(handle);
            if eject_res.is_ok() {
                win32_ejected = true;
            }
        }
    }

    if win32_ejected {
        return Ok(true);
    }

    // 2. Shell.Application Eject via background PowerShell (native Windows Explorer eject mechanism,
    // safe for all standard non-elevated user accounts, flushes write buffers and dismounts cleanly)
    let ps_script = format!(
        r#"$sh = New-Object -ComObject Shell.Application; $d = $sh.Namespace(17).ParseName('{clean_drive}'); if ($d) {{ $v = $d.Verbs() | Where-Object {{ ($_.Name -replace '&', '').Trim().ToLower() -match '^(eject|auswerfen|éjecter|ejectar|expulsar|espelli|wysuń|uitwerpen|odpojit|извлечь|拿出|弹出|꺼내기|取り出し)' }}; if ($v) {{ $v.DoIt() }} else {{ $d.InvokeVerb('Eject') }} }}"#
    );

    let output = std::process::Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", &ps_script])
        .creation_flags(0x08000000) // CREATE_NO_WINDOW
        .output();

    match output {
        Ok(out) if out.status.success() => Ok(true),
        Ok(_) => Ok(true),
        Err(e) => Err(format!("Could not eject {clean_drive}: {e}")),
    }
}

#[cfg(target_os = "macos")]
pub fn eject_device_native(mount_point: &str) -> Result<bool, String> {
    use std::process::Command;
    let res = Command::new("diskutil")
        .args(["eject", mount_point])
        .output();

    match res {
        Ok(out) if out.status.success() => Ok(true),
        _ => {
            let unmount_res = Command::new("diskutil")
                .args(["unmount", mount_point])
                .output();
            if unmount_res.map(|o| o.status.success()).unwrap_or(false) {
                Ok(true)
            } else {
                Err(format!("Could not eject {mount_point} via diskutil"))
            }
        }
    }
}

#[cfg(target_os = "linux")]
pub fn eject_device_native(mount_point: &str) -> Result<bool, String> {
    use std::process::Command;
    // Try udisksctl unmount
    if let Ok(out) = Command::new("udisksctl").args(["unmount", "-p", mount_point]).output() {
        if out.status.success() {
            return Ok(true);
        }
    }
    // Fallback to umount
    if let Ok(out) = Command::new("umount").arg(mount_point).output() {
        if out.status.success() {
            return Ok(true);
        }
    }
    Ok(true)
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
pub fn eject_device_native(_mount_point: &str) -> Result<bool, String> {
    Ok(true)
}

/// Recursively scans for audio tracks on the device for the "Contents" tab.
pub fn list_device_contents_native(mount_point: &str) -> Vec<DeviceTrackItem> {
    let root = Path::new(mount_point);
    if !root.exists() {
        return Vec::new();
    }

    let priority_roots = [
        root.join("Music"),
        root.join("Audio"),
        root.join("MP3"),
        root.join("iPod_Control"),
    ];

    let valid_exts = ["mp3", "m4a", "flac", "wav", "aac", "ogg", "wma", "aiff", "alac"];

    fn scan_dir(
        dir: &Path,
        base_root: &Path,
        valid_exts: &[&str],
        results: &mut Vec<(PathBuf, String, String, u64, String)>,
        skip_dirs: &std::collections::HashSet<PathBuf>,
        depth: usize,
    ) {
        if depth > 7 {
            return;
        }
        let Ok(entries) = fs::read_dir(dir) else {
            return;
        };

        for entry in entries.flatten() {
            let Ok(ft) = entry.file_type() else {
                continue;
            };
            let path = entry.path();
            if ft.is_dir() {
                if skip_dirs.contains(&path) {
                    continue;
                }
                // Avoid scanning Windows system or recycle bins
                let dir_name = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
                if dir_name.starts_with('$') || dir_name == "System Volume Information" {
                    continue;
                }
                scan_dir(&path, base_root, valid_exts, results, skip_dirs, depth + 1);
            } else if ft.is_file() {
                let ext = path
                    .extension()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_lowercase();

                if valid_exts.contains(&ext.as_str()) {
                    let file_name = path.file_name().and_then(|s| s.to_str()).unwrap_or("Track").to_string();
                    let relative_path = path
                        .strip_prefix(base_root)
                        .map(|p| p.to_string_lossy().to_string())
                        .unwrap_or_else(|_| file_name.clone());

                    let size_bytes = entry.metadata().map(|m| m.len()).unwrap_or(0);
                    results.push((path, file_name, relative_path, size_bytes, ext));
                }
            }
        }
    }

    let mut scanned_seen = std::collections::HashSet::new();
    let mut scanned_dirs = std::collections::HashSet::new();
    let mut collected_files: Vec<(PathBuf, String, String, u64, String)> = Vec::new();

    for sr in &priority_roots {
        if sr.exists() {
            scanned_dirs.insert(sr.clone());
            let mut sub_results = Vec::new();
            scan_dir(sr, root, &valid_exts, &mut sub_results, &scanned_dirs, 0);
            for item in sub_results {
                if scanned_seen.insert(item.0.clone()) {
                    collected_files.push(item);
                }
            }
        }
    }

    // Finally scan root for any loose tracks or other folders, skipping already scanned directories
    let mut root_results = Vec::new();
    scan_dir(root, root, &valid_exts, &mut root_results, &scanned_dirs, 0);
    for item in root_results {
        if scanned_seen.insert(item.0.clone()) {
            collected_files.push(item);
        }
    }

    use rayon::prelude::*;

    let tracks: Vec<DeviceTrackItem> = collected_files
        .into_par_iter()
        .with_max_len(16)
        .map(|(path, file_name, relative_path, size_bytes, ext)| {
            let path_str = path.to_string_lossy().to_string();
            let cache_key = (path_str.clone(), size_bytes);
            if let Ok(guard) = device_track_cache().lock() {
                if let Some(cached) = guard.get(&cache_key) {
                    return cached.clone();
                }
            }

            let meta = crate::read_music_metadata_internal(&path_str).ok();

            let mut tit_fallback = file_name.clone();
            if let Some(dot_idx) = tit_fallback.rfind('.') {
                tit_fallback.truncate(dot_idx);
            }

            let components: Vec<_> = path
                .strip_prefix(root)
                .map(|p| p.components().map(|c| c.as_os_str().to_string_lossy().to_string()).collect())
                .unwrap_or_default();

            let (folder_artist, folder_album) = if components.len() >= 3 {
                (
                    Some(components[components.len() - 3].clone()),
                    Some(components[components.len() - 2].clone()),
                )
            } else {
                (None, None)
            };

            let title = meta
                .as_ref()
                .and_then(|m| m.title.clone())
                .filter(|s| !s.trim().is_empty())
                .unwrap_or(tit_fallback);

            let artist = meta
                .as_ref()
                .and_then(|m| m.artist.clone())
                .filter(|s| !s.trim().is_empty())
                .or(folder_artist);

            let album = meta
                .as_ref()
                .and_then(|m| m.album.clone())
                .filter(|s| !s.trim().is_empty())
                .or(folder_album);

            let genre = meta
                .as_ref()
                .and_then(|m| m.genre.clone())
                .filter(|s| !s.trim().is_empty());

            let year = meta.as_ref().and_then(|m| m.year);
            let track_number = meta.as_ref().and_then(|m| m.track_number);
            let duration_secs = meta.as_ref().and_then(|m| m.duration);
            let cover_url = meta.as_ref().and_then(|m| m.cover_url.clone());
            let bitrate = meta.as_ref().and_then(|m| m.bitrate);
            let sample_rate = meta.as_ref().and_then(|m| m.sample_rate);
            let format = meta
                .as_ref()
                .and_then(|m| m.format.clone())
                .unwrap_or_else(|| ext.to_uppercase());

            let item = DeviceTrackItem {
                file_name,
                relative_path,
                full_path: path_str,
                size_bytes,
                format,
                title: Some(title),
                artist,
                album,
                genre,
                year,
                track_number,
                duration_secs,
                cover_url,
                bitrate,
                sample_rate,
            };

            if let Ok(mut guard) = device_track_cache().lock() {
                guard.insert(cache_key, item.clone());
            }

            item
        })
        .collect();

    tracks
}

fn decode_percent_path(s: &str) -> String {
    let mut bytes = Vec::new();
    let chars = s.as_bytes();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == b'%' && i + 2 < chars.len() {
            if let Ok(val) = u8::from_str_radix(std::str::from_utf8(&chars[i + 1..i + 3]).unwrap_or(""), 16) {
                bytes.push(val);
                i += 3;
                continue;
            }
        }
        bytes.push(chars[i]);
        i += 1;
    }
    String::from_utf8_lossy(&bytes).into_owned()
}

pub fn delete_device_file_native(file_path: &str) -> Result<bool, String> {
    let clean = file_path.trim().trim_matches('"');
    let unfile = if let Some(stripped) = clean.strip_prefix("file:///") {
        stripped
    } else if let Some(stripped) = clean.strip_prefix("file://") {
        stripped
    } else {
        clean
    };

    let target_str = if Path::new(unfile).exists() {
        unfile.to_string()
    } else {
        let dec = decode_percent_path(unfile);
        if Path::new(&dec).exists() {
            dec
        } else {
            unfile.to_string()
        }
    };

    #[cfg(target_os = "windows")]
    let normalized = target_str.replace('/', "\\");
    #[cfg(not(target_os = "windows"))]
    let normalized = target_str.clone();

    let p = Path::new(&normalized);
    if !p.exists() {
        return Err(format!("File does not exist on device: {normalized}"));
    }

    #[cfg(target_os = "windows")]
    {
        // On Windows, read-only permissions prevent DeleteFileW with Access Denied (os error 5).
        // Strip read-only attribute if present.
        if let Ok(meta) = fs::metadata(p) {
            let mut perms = meta.permissions();
            if perms.readonly() {
                perms.set_readonly(false);
                let _ = fs::set_permissions(p, perms);
            }
        }
    }

    let remove_res = fs::remove_file(p);
    if let Err(e) = remove_res {
        #[cfg(target_os = "windows")]
        {
            use std::process::Command;
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;

            // Attempt cmd /C del /F /Q /A "<path>"
            let _ = Command::new("cmd")
                .args(["/C", "del", "/F", "/Q", "/A", &normalized])
                .creation_flags(CREATE_NO_WINDOW)
                .output();

            if p.exists() {
                let escaped = normalized.replace('\'', "''");
                let ps_cmd = format!("Remove-Item -LiteralPath '{}' -Force", escaped);
                let _ = Command::new("powershell")
                    .args(["-NoProfile", "-Command", &ps_cmd])
                    .creation_flags(CREATE_NO_WINDOW)
                    .output();
            }

            if p.exists() {
                return Err(format!("Failed to delete file on device: {e}"));
            }
        }
        #[cfg(not(target_os = "windows"))]
        {
            return Err(format!("Failed to delete file on device: {e}"));
        }
    }

    // Remove deleted track from in-memory device metadata cache
    if let Ok(mut guard) = device_track_cache().lock() {
        guard.retain(|(k_path, _), _| {
            !k_path.eq_ignore_ascii_case(&normalized) && !k_path.eq_ignore_ascii_case(&target_str)
        });
    }

    // If deleted file belonged to an iPod, refresh its native iTunesDB
    let mut ancestor = p.parent();
    while let Some(parent) = ancestor {
        if parent.join("iPod_Control").exists() {
            let _ = crate::itunes_db::rebuild_ipod_db_from_device(parent, None);
            break;
        }
        ancestor = parent.parent();
    }

    Ok(true)
}

struct SyncActiveGuard;
impl Drop for SyncActiveGuard {
    fn drop(&mut self) {
        SYNC_IN_PROGRESS.store(false, Ordering::SeqCst);
    }
}

fn normalize_device_path_key(p: &Path) -> String {
    p.to_string_lossy().replace('\\', "/").to_lowercase()
}

fn str_tag_matches(file_val: &Option<String>, expected_val: &Option<String>) -> bool {
    match expected_val.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        None => true,
        Some(exp) => match file_val.as_deref().map(str::trim) {
            Some(actual) => actual == exp,
            None => false,
        },
    }
}

fn file_metadata_is_complete(
    file_meta: &crate::ReadMetadataResult,
    track: &SyncTrackItem,
    has_artwork: bool,
    file_path: &Path,
) -> bool {
    if has_artwork && file_meta.cover_url.is_none() {
        return false;
    }
    if !str_tag_matches(&file_meta.title, &track.title) {
        return false;
    }
    if !str_tag_matches(&file_meta.artist, &track.artist) {
        return false;
    }
    if !str_tag_matches(&file_meta.album, &track.album) {
        return false;
    }
    if !str_tag_matches(&file_meta.genre, &track.genre) {
        return false;
    }
    if !str_tag_matches(&file_meta.comments, &track.comments) {
        return false;
    }
    if track.year.is_some() && file_meta.year != track.year {
        return false;
    }
    if track.track_number.is_some() && file_meta.track_number != track.track_number {
        return false;
    }
    if crate::file_has_technical_comment(file_path) {
        return false;
    }
    true
}

fn remove_empty_dirs_recursive(dir: &Path, root_stop: &Path) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                remove_empty_dirs_recursive(&p, root_stop);
            }
        }
    }
    if dir != root_stop {
        if let Ok(mut entries) = fs::read_dir(dir) {
            if entries.next().is_none() {
                let _ = fs::remove_dir(dir);
            }
        }
    }
}

fn collect_device_audio_files(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
    if depth > 7 {
        return;
    }
    let valid_exts = ["mp3", "m4a", "flac", "wav", "aac", "ogg", "wma", "aiff", "alac"];
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let Ok(ft) = entry.file_type() else {
                continue;
            };
            let path = entry.path();
            if ft.is_dir() {
                let dir_name = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
                if dir_name.starts_with('$') || dir_name == "System Volume Information" {
                    continue;
                }
                collect_device_audio_files(&path, depth + 1, out);
            } else if ft.is_file() {
                let ext = path
                    .extension()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_lowercase();
                if valid_exts.contains(&ext.as_str()) {
                    out.push(path);
                }
            }
        }
    }
}

fn resolve_track_artwork_data_url(
    enriched_track: &SyncTrackItem,
    src_path: &Path,
    artwork_cache: &Mutex<HashMap<String, Option<String>>>,
) -> Option<String> {
    let cache_key = enriched_track
        .cover_url
        .clone()
        .unwrap_or_else(|| format!("src:{}", src_path.to_string_lossy()));

    if let Ok(guard) = artwork_cache.lock() {
        if let Some(cached) = guard.get(&cache_key) {
            return cached.clone();
        }
    }

    let resolved_art = enriched_track
        .cover_url
        .as_deref()
        .and_then(crate::load_artwork_bytes)
        .or_else(|| crate::extract_artwork_bytes_from_file_or_folder(src_path));

    let encoded = resolved_art.map(|(mime, bytes)| {
        format!("data:{mime};base64,{}", crate::encode_base64(&bytes))
    });

    if let Ok(mut guard) = artwork_cache.lock() {
        guard.insert(cache_key, encoded.clone());
    }
    encoded
}

fn build_sync_tag_payload(
    enriched_track: &SyncTrackItem,
    dest_path: &Path,
    artwork_data_url: Option<String>,
) -> crate::Id3TagPayload {
    crate::Id3TagPayload {
        title: enriched_track
            .title
            .clone()
            .or_else(|| dest_path.file_stem().map(|s| s.to_string_lossy().to_string())),
        artist: enriched_track.artist.clone(),
        album_artist: enriched_track.album_artist.clone(),
        album: enriched_track.album.clone(),
        composer: None,
        publisher: None,
        lyrics: enriched_track.lyrics.clone(),
        genre: enriched_track.genre.clone(),
        year: enriched_track.year,
        track_number: enriched_track.track_number,
        track_total: None,
        disc_number: None,
        disc_total: None,
        bpm: None,
        comments: Some(enriched_track.comments.clone().unwrap_or_default()),
        media_kind: Some("Music".to_string()),
        artwork_data_url,
        artwork_mime_type: None,
    }
}

pub fn sync_tracks_to_device_impl(
    app: &AppHandle,
    payload: DeviceSyncPayload,
) -> Result<DeviceSyncResult, String> {
    SYNC_ABORT_REQUESTED.store(false, Ordering::SeqCst);
    SYNC_IN_PROGRESS.store(true, Ordering::SeqCst);
    let _sync_guard = SyncActiveGuard;

    let clean_mount = payload.mount_point.trim_end_matches(['\\', '/']);
    let mount_dir_buf = if clean_mount.len() == 1 && clean_mount.chars().next().map_or(false, |c| c.is_ascii_alphabetic()) {
        PathBuf::from(format!("{clean_mount}:\\"))
    } else if clean_mount.ends_with(':') {
        PathBuf::from(format!("{clean_mount}\\"))
    } else {
        PathBuf::from(&payload.mount_point)
    };
    let mount_dir = mount_dir_buf.as_path();
    if !mount_dir.exists() {
        return Err(format!("Mount point not accessible: {}", payload.mount_point));
    }

    let is_ipod = mount_dir.join("iPod_Control").exists()
        || detect_device_category(mount_dir, "", false).0 == DeviceCategory::Ipod;

    let music_root = if is_ipod {
        mount_dir.join("iPod_Control").join("Music")
    } else {
        mount_dir.join("Music")
    };
    if let Err(e) = fs::create_dir_all(&music_root) {
        return Err(format!("Failed to create destination music directory on device: {e}"));
    }

    let stage_dir = std::env::temp_dir().join("classitunes_sync_stage");
    let _ = fs::create_dir_all(&stage_dir);

    let mut tracks_synced = 0;
    let mut tracks_skipped = 0;
    let mut tracks_updated = 0;
    let mut tracks_deleted = 0;
    let mut total_bytes_transferred = 0u64;
    let mut errors = Vec::new();

    let total_tracks = payload.tracks.len();
    let naming_tmpl = payload
        .naming_template
        .as_deref()
        .unwrap_or("{Artist}/{Album}/{TrackNumber} - {Title}.{ext}");

    let should_transcode = payload.transcode_enabled.unwrap_or(false);
    let mirror_sync = payload.mirror_sync.unwrap_or(false);
    let transcode_target_format = crate::transcoder::TranscodeTargetFormat::from_str(
        payload.transcode_format.as_deref().unwrap_or("MP3"),
    );
    let transcode_opts = crate::transcoder::TranscodeOptions {
        format: transcode_target_format,
        bitrate_kbps: payload.transcode_bitrate.unwrap_or(256),
        downmix_mono: payload.transcode_downmix_mono.unwrap_or(false),
        downsample_44k: payload.transcode_downsample_44k.unwrap_or(true),
    };

    let artwork_cache: Mutex<HashMap<String, Option<String>>> = Mutex::new(HashMap::new());
    let mut created_dirs: std::collections::HashSet<PathBuf> = std::collections::HashSet::new();
    let mut synced_relative_paths: Vec<PathBuf> = Vec::new();

    use rayon::prelude::*;

    // Pre-pass: When mirror_sync is true (Sync button pressed), determine all target paths on the device
    // and delete any obsolete audio files on the device that are no longer in the sync selection!
    if mirror_sync && !SYNC_ABORT_REQUESTED.load(Ordering::SeqCst) {
        let expected_keys: std::collections::HashSet<String> = payload
            .tracks
            .par_iter()
            .enumerate()
            .filter_map(|(index, track)| {
                let src_path = Path::new(&track.file_path);
                if !src_path.exists() {
                    return None;
                }
                let ext = if should_transcode {
                    transcode_target_format.extension().to_string()
                } else {
                    src_path
                        .extension()
                        .and_then(|s| s.to_str())
                        .unwrap_or("mp3")
                        .to_lowercase()
                };
                let mut enriched = track.clone();
                if enriched.title.is_none() || enriched.artist.is_none() || enriched.album.is_none() {
                    if let Ok(m) = crate::read_music_metadata_internal(&src_path.to_string_lossy()) {
                        if enriched.title.is_none() {
                            enriched.title = m.title;
                        }
                        if enriched.artist.is_none() {
                            enriched.artist = m.artist;
                        }
                        if enriched.album.is_none() {
                            enriched.album = m.album;
                        }
                    }
                }
                let dest_path = if is_ipod {
                    let f_dir = format!("F{:02}", index % 20);
                    music_root
                        .join(&f_dir)
                        .join(format!("ITUN_{:04}.{}", index + 1, ext))
                } else {
                    let rel = render_naming_template(naming_tmpl, &enriched, &ext);
                    music_root.join(&rel)
                };
                Some(normalize_device_path_key(&dest_path))
            })
            .collect();

        let priority_roots = [
            mount_dir.join("Music"),
            mount_dir.join("Audio"),
            mount_dir.join("MP3"),
            mount_dir.join("iPod_Control"),
        ];
        let mut existing_device_files: Vec<PathBuf> = Vec::new();
        for p_root in &priority_roots {
            if p_root.exists() {
                collect_device_audio_files(p_root, 0, &mut existing_device_files);
            }
        }
        for existing_path in existing_device_files {
            if SYNC_ABORT_REQUESTED.load(Ordering::SeqCst) {
                break;
            }
            let key = normalize_device_path_key(&existing_path);
            if !expected_keys.contains(&key) {
                if delete_device_file_native(&existing_path.to_string_lossy()).is_ok() {
                    tracks_deleted += 1;
                }
            }
        }
        remove_empty_dirs_recursive(&music_root, &music_root);
    }

    enum SyncItemAction {
        /// File already exists on device with valid audio and complete tags/artwork.
        Skip,
        /// File already exists on device with valid audio, only missing artwork or updated tags need in-place patching.
        UpdateTagsInPlace(crate::Id3TagPayload),
        /// Transcoding is disabled and source file already has complete tags/artwork -> direct unmodified byte-for-byte copy.
        DirectCopyUnmodified(PathBuf),
        /// Staged file in local SSD temp folder (either transcoded, or untranscoded with injected library tags/artwork).
        CopyStaged(PathBuf),
    }

    struct PreparedStageItem {
        global_index: usize,
        enriched_track: SyncTrackItem,
        track_title: String,
        ext: String,
        src_size: u64,
        dest_path: PathBuf,
        rel_path_for_list: PathBuf,
        action: SyncItemAction,
        stage_error: Option<String>,
    }

    for (chunk_idx, chunk) in payload.tracks.chunks(4).enumerate() {
        if SYNC_ABORT_REQUESTED.load(Ordering::SeqCst) {
            errors.push("Sync stopped by user".to_string());
            break;
        }

        let base_idx = chunk_idx * 4;

        // Inspect device files FIRST in parallel, and only stage/transcode files that actually need it!
        let staged_batch: Vec<Result<PreparedStageItem, String>> = chunk
            .par_iter()
            .enumerate()
            .map(|(offset, track)| {
                let index = base_idx + offset;
                if SYNC_ABORT_REQUESTED.load(Ordering::SeqCst) {
                    return Err("Sync stopped by user".to_string());
                }

                let src_path = Path::new(&track.file_path);
                if !src_path.exists() {
                    return Err(format!("Source track not found: {}", track.file_path));
                }

                let src_ext = src_path
                    .extension()
                    .and_then(|s| s.to_str())
                    .unwrap_or("mp3")
                    .to_lowercase();

                let ext = if should_transcode {
                    transcode_target_format.extension().to_string()
                } else {
                    src_ext.clone()
                };

                let src_meta_opt = crate::read_music_metadata_internal(&src_path.to_string_lossy()).ok();

                let mut enriched_track = track.clone();
                if let Some(ref src_meta) = src_meta_opt {
                    if enriched_track.title.is_none() {
                        enriched_track.title = src_meta.title.clone();
                    }
                    if enriched_track.artist.is_none() {
                        enriched_track.artist = src_meta.artist.clone();
                    }
                    if enriched_track.album_artist.is_none() {
                        enriched_track.album_artist = src_meta.album_artist.clone();
                    }
                    if enriched_track.album.is_none() {
                        enriched_track.album = src_meta.album.clone();
                    }
                    if enriched_track.genre.is_none() {
                        enriched_track.genre = src_meta.genre.clone();
                    }
                    if enriched_track.year.is_none() {
                        enriched_track.year = src_meta.year;
                    }
                    if enriched_track.track_number.is_none() {
                        enriched_track.track_number = src_meta.track_number;
                    }
                    if enriched_track.cover_url.is_none() {
                        enriched_track.cover_url = src_meta.cover_url.clone();
                    }
                    if enriched_track.lyrics.is_none() {
                        enriched_track.lyrics = src_meta.lyrics.clone();
                    }
                    if enriched_track.comments.is_none() {
                        enriched_track.comments = src_meta.comments.clone();
                    }
                    if enriched_track.duration.is_none() {
                        enriched_track.duration = src_meta.duration;
                    }
                    if enriched_track.bitrate.is_none() {
                        enriched_track.bitrate = src_meta.bitrate;
                    }
                }
                if let Some(ref cmt) = enriched_track.comments {
                    if crate::is_technical_comment("", cmt) {
                        enriched_track.comments = None;
                    }
                }

                let (dest_path, rel_path_for_list) = if is_ipod {
                    let f_dir = format!("F{:02}", index % 20);
                    let f_folder = music_root.join(&f_dir);
                    let file_name = format!("ITUN_{:04}.{}", index + 1, ext);
                    let full_p = f_folder.join(&file_name);
                    let rel_p = PathBuf::from("iPod_Control").join("Music").join(&f_dir).join(&file_name);
                    (full_p, rel_p)
                } else {
                    let rel = render_naming_template(naming_tmpl, &enriched_track, &ext);
                    let full_p = music_root.join(&rel);
                    let rel_p = Path::new("Music").join(&rel);
                    (full_p, rel_p)
                };

                let src_size = fs::metadata(src_path).map(|m| m.len()).unwrap_or(0);
                let track_title = enriched_track.title.clone().unwrap_or_else(|| "Track".to_string());
                let artwork_data_url = resolve_track_artwork_data_url(&enriched_track, src_path, &artwork_cache);
                let has_artwork = artwork_data_url.as_ref().map_or(false, |s| !s.trim().is_empty());

                // 1. CHECK EXISTING FILE ON DEVICE FIRST (WMP pre-inspection before touching or transcoding)
                if dest_path.exists() {
                    if let Ok(dest_meta) = fs::metadata(&dest_path) {
                        let dest_len = dest_meta.len();
                        if dest_len > 0 {
                            let dev_meta_opt = crate::read_music_metadata_internal(&dest_path.to_string_lossy()).ok();

                            let audio_already_valid = if !should_transcode {
                                if dest_len == src_size {
                                    true
                                } else if let (Some(ref dm), Some(src_dur)) = (&dev_meta_opt, enriched_track.duration) {
                                    dm.duration.map_or(true, |dev_dur| (dev_dur - src_dur).abs() < 2.5)
                                } else {
                                    dev_meta_opt.is_some()
                                }
                            } else {
                                // Transcoding enabled: check if the file on the device is ALREADY transcoded
                                if ext == "wav" {
                                    dest_len > 1024
                                } else if let Some(ref dm) = dev_meta_opt {
                                    let target_br = transcode_opts.bitrate_kbps as i32;
                                    let br_matches = dm
                                        .bitrate
                                        .map_or(false, |b| (b as i32 - target_br).abs() <= 48);
                                    br_matches || src_ext != ext || dest_len != src_size
                                } else {
                                    false
                                }
                            };

                            if audio_already_valid {
                                if let Some(ref dev_meta) = dev_meta_opt {
                                    if file_metadata_is_complete(dev_meta, &enriched_track, has_artwork, &dest_path) {
                                        // Device file has valid audio AND complete tags/artwork -> SKIP completely!
                                        return Ok(PreparedStageItem {
                                            global_index: index,
                                            enriched_track,
                                            track_title,
                                            ext,
                                            src_size,
                                            dest_path,
                                            rel_path_for_list,
                                            action: SyncItemAction::Skip,
                                            stage_error: None,
                                        });
                                    } else {
                                        // Device file has valid audio, only missing artwork or updated tags -> Update in-place!
                                        let payload = build_sync_tag_payload(&enriched_track, &dest_path, artwork_data_url);
                                        return Ok(PreparedStageItem {
                                            global_index: index,
                                            enriched_track,
                                            track_title,
                                            ext,
                                            src_size,
                                            dest_path,
                                            rel_path_for_list,
                                            action: SyncItemAction::UpdateTagsInPlace(payload),
                                            stage_error: None,
                                        });
                                    }
                                }
                            }
                        }
                    }
                }

                // 2. FILE IS NOT ON DEVICE YET (OR NEEDS AUDIO TRANSFER)
                // If transcoding is DISABLED and source file already has complete tags & artwork,
                // copy the source file directly byte-for-byte without modifying it!
                if !should_transcode {
                    if let Some(ref src_meta) = src_meta_opt {
                        if file_metadata_is_complete(src_meta, &enriched_track, has_artwork, src_path) {
                            return Ok(PreparedStageItem {
                                global_index: index,
                                enriched_track,
                                track_title,
                                ext,
                                src_size,
                                dest_path,
                                rel_path_for_list,
                                action: SyncItemAction::DirectCopyUnmodified(src_path.to_path_buf()),
                                stage_error: None,
                            });
                        }
                    }
                }

                // 3. Stage in local SSD temp directory (either transcoding, or injecting missing library artwork/tags)
                let temp_file = stage_dir.join(format!(
                    "stage_{}_{}.{}",
                    std::process::id(),
                    index,
                    ext
                ));
                let mut stage_error = None;

                let stage_ok = if should_transcode {
                    match crate::transcoder::transcode_audio_file(src_path, &temp_file, &transcode_opts) {
                        Ok(()) => true,
                        Err(err) => match fs::copy(src_path, &temp_file) {
                            Ok(_) => true,
                            Err(e) => {
                                stage_error = Some(format!(
                                    "Failed to sync {}: transcode ({err}), copy ({e})",
                                    track_title
                                ));
                                false
                            }
                        },
                    }
                } else {
                    match fs::copy(src_path, &temp_file) {
                        Ok(_) => true,
                        Err(e) => {
                            stage_error = Some(format!("Failed to stage {}: {e}", track_title));
                            false
                        }
                    }
                };

                if stage_ok && temp_file.exists() {
                    #[cfg(windows)]
                    {
                        if let Ok(m) = fs::metadata(&temp_file) {
                            let mut perms = m.permissions();
                            if perms.readonly() {
                                perms.set_readonly(false);
                                let _ = fs::set_permissions(&temp_file, perms);
                            }
                        }
                    }

                    let tag_payload = build_sync_tag_payload(&enriched_track, &dest_path, artwork_data_url);
                    let _ = crate::write_music_metadata_internal(&temp_file.to_string_lossy(), tag_payload);
                }

                Ok(PreparedStageItem {
                    global_index: index,
                    enriched_track,
                    track_title,
                    ext,
                    src_size,
                    dest_path,
                    rel_path_for_list,
                    action: SyncItemAction::CopyStaged(temp_file),
                    stage_error,
                })
            })
            .collect();

        // Execute the planned action for each item sequentially onto the USB device and emit progress
        for item_res in staged_batch {
            if SYNC_ABORT_REQUESTED.load(Ordering::SeqCst) {
                errors.push("Sync stopped by user".to_string());
                break;
            }

            let item = match item_res {
                Ok(it) => it,
                Err(e) => {
                    if e != "Sync stopped by user" {
                        errors.push(e);
                    }
                    continue;
                }
            };

            if let Some(err) = item.stage_error {
                errors.push(err);
                continue;
            }

            if let Some(parent) = item.dest_path.parent() {
                if !created_dirs.contains(parent) {
                    let _ = fs::create_dir_all(parent);
                    created_dirs.insert(parent.to_path_buf());
                }
            }

            let item_size: u64;

            match item.action {
                SyncItemAction::Skip => {
                    tracks_skipped += 1;
                    item_size = fs::metadata(&item.dest_path).map(|m| m.len()).unwrap_or(item.src_size);
                }
                SyncItemAction::UpdateTagsInPlace(tag_payload) => {
                    #[cfg(windows)]
                    {
                        if let Ok(m) = fs::metadata(&item.dest_path) {
                            let mut perms = m.permissions();
                            if perms.readonly() {
                                perms.set_readonly(false);
                                let _ = fs::set_permissions(&item.dest_path, perms);
                            }
                        }
                    }
                    match crate::write_music_metadata_internal(&item.dest_path.to_string_lossy(), tag_payload) {
                        Ok(_) => {
                            tracks_updated += 1;
                        }
                        Err(e) => {
                            errors.push(format!("Failed to update tags on {}: {e}", item.track_title));
                        }
                    }
                    item_size = fs::metadata(&item.dest_path).map(|m| m.len()).unwrap_or(item.src_size);
                }
                SyncItemAction::DirectCopyUnmodified(ref src_file) => {
                    match copy_file_buffered(src_file, &item.dest_path) {
                        Ok(bytes) => {
                            tracks_synced += 1;
                            total_bytes_transferred += bytes;
                            item_size = bytes;
                        }
                        Err(e) => {
                            errors.push(format!("Failed to write {} to device: {e}", item.track_title));
                            continue;
                        }
                    }
                }
                SyncItemAction::CopyStaged(ref temp_file) => {
                    match copy_file_buffered(temp_file, &item.dest_path) {
                        Ok(bytes) => {
                            tracks_synced += 1;
                            total_bytes_transferred += bytes;
                            item_size = bytes;
                        }
                        Err(e) => {
                            errors.push(format!("Failed to write {} to device: {e}", item.track_title));
                            let _ = fs::remove_file(temp_file);
                            continue;
                        }
                    }
                    let _ = fs::remove_file(temp_file);
                }
            }

            synced_relative_paths.push(item.rel_path_for_list.clone());

            let full_path_str = item.dest_path.to_string_lossy().to_string();
            let synced_item = DeviceTrackItem {
                file_name: item
                    .dest_path
                    .file_name()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_else(|| item.track_title.clone()),
                relative_path: item.rel_path_for_list.to_string_lossy().to_string(),
                full_path: full_path_str.clone(),
                size_bytes: item_size,
                format: item.ext.to_uppercase(),
                title: item.enriched_track.title.clone(),
                artist: item.enriched_track.artist.clone(),
                album: item.enriched_track.album.clone(),
                genre: item.enriched_track.genre.clone(),
                year: item.enriched_track.year,
                track_number: item.enriched_track.track_number,
                duration_secs: item.enriched_track.duration,
                cover_url: item.enriched_track.cover_url.clone(),
                bitrate: if should_transcode && item.ext != "wav" {
                    Some(transcode_opts.bitrate_kbps)
                } else {
                    item.enriched_track.bitrate
                },
                sample_rate: None,
            };

            if let Ok(mut guard) = device_track_cache().lock() {
                guard.insert((full_path_str, item_size), synced_item.clone());
            }

            let _ = app.emit(
                "device-sync-progress",
                SyncProgressEvent {
                    current_index: item.global_index + 1,
                    total_tracks,
                    current_title: item.track_title,
                    bytes_copied: total_bytes_transferred,
                    total_bytes: total_bytes_transferred,
                    is_complete: false,
                    synced_track: Some(synced_item),
                },
            );
        }
    }

    let _ = fs::remove_dir_all(&stage_dir);

    if payload.sync_playlists && !synced_relative_paths.is_empty() {
        let playlist_name = payload
            .playlist_name
            .as_deref()
            .unwrap_or("ClassiTunes Playlist");
        let safe_pl_name = sanitize_fat_filename(playlist_name);

        let pl_dir = mount_dir.join("Playlists");
        let _ = fs::create_dir_all(&pl_dir);
        let pl_file = pl_dir.join(format!("{safe_pl_name}.m3u8"));

        let mut content = String::from("#EXTM3U\n");
        for rel in synced_relative_paths {
            let m3u_path = format!("..\\{}", rel.to_string_lossy());
            content.push_str(&m3u_path);
            content.push('\n');
        }
        let _ = fs::write(pl_file, content);
    }

    // If target device is an iPod, regenerate the Apple iTunesDB and iTunesSD binary databases
    // so all songs immediately populate the Click Wheel / Apple OS Music library!
    if is_ipod || mount_dir.join("iPod_Control").exists() {
        let _ = crate::itunes_db::rebuild_ipod_db_from_device(mount_dir, payload.playlist_name.as_deref());
    }

    let _ = app.emit(
        "device-sync-progress",
        SyncProgressEvent {
            current_index: total_tracks,
            total_tracks,
            current_title: "Sync completed".to_string(),
            bytes_copied: total_bytes_transferred,
            total_bytes: total_bytes_transferred,
            is_complete: true,
            synced_track: None,
        },
    );

    Ok(DeviceSyncResult {
        tracks_synced,
        tracks_skipped,
        tracks_updated,
        tracks_deleted,
        total_bytes_transferred,
        errors,
    })
}
