use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TranscodeTargetFormat {
    Mp3,
    Aac,
    Wav,
}

impl TranscodeTargetFormat {
    pub fn extension(&self) -> &'static str {
        match self {
            Self::Mp3 => "mp3",
            Self::Aac => "m4a",
            Self::Wav => "wav",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s.to_uppercase().as_str() {
            "AAC" | "M4A" => Self::Aac,
            "WAV" => Self::Wav,
            _ => Self::Mp3,
        }
    }
}

#[derive(Debug, Clone)]
pub struct TranscodeOptions {
    pub format: TranscodeTargetFormat,
    pub bitrate_kbps: u32,
    pub downmix_mono: bool,
    pub downsample_44k: bool,
}

impl Default for TranscodeOptions {
    fn default() -> Self {
        Self {
            format: TranscodeTargetFormat::Mp3,
            bitrate_kbps: 256,
            downmix_mono: false,
            downsample_44k: true,
        }
    }
}

/// Transcodes an audio file from `src` to `dest`.
/// On Windows: utilizes Windows Media Foundation (or pure Rust WAV export).
/// On macOS: utilizes native CoreAudio AudioConverter/afconvert.
/// On Linux: utilizes pure Rust decoding via `symphonia` + WAV/fallback encoding, or system tool if present.
pub fn transcode_audio_file(
    src: &Path,
    dest: &Path,
    options: &TranscodeOptions,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        windows_transcode(src, dest, options)
    }

    #[cfg(target_os = "macos")]
    {
        macos_transcode(src, dest, options)
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        linux_transcode(src, dest, options)
    }
}

// ---------------------------------------------------------------------------
// Windows Implementation (Windows Media Foundation / PCM WAV fallback)
// ---------------------------------------------------------------------------
#[cfg(target_os = "windows")]
fn windows_transcode(
    src: &Path,
    dest: &Path,
    options: &TranscodeOptions,
) -> Result<(), String> {
    // If target is WAV, decode via symphonia and write standard RIFF WAV
    if options.format == TranscodeTargetFormat::Wav {
        return transcode_to_wav_pure_rust(src, dest, options);
    }

    // Try Windows Media Foundation SourceReader -> SinkWriter transcoding
    match windows_mf_transcode(src, dest, options) {
        Ok(()) => Ok(()),
        Err(mf_err) => {
            // If Media Foundation transcoding encountered an issue or specific codec unavailable,
            // fallback gracefully: if destination extension matches source, copy file; otherwise write WAV
            if let Some(src_ext) = src.extension().and_then(|s| s.to_str()) {
                if src_ext.eq_ignore_ascii_case(options.format.extension()) {
                    return std::fs::copy(src, dest)
                        .map(|_| ())
                        .map_err(|e| format!("Copy fallback failed: {e}"));
                }
            }
            Err(format!("Windows Media Foundation transcoding error: {mf_err}"))
        }
    }
}

#[cfg(target_os = "windows")]
fn windows_mf_transcode(
    src: &Path,
    dest: &Path,
    options: &TranscodeOptions,
) -> Result<(), String> {
    let target_bps = options.bitrate_kbps * 1000;
    let src_str = src.to_string_lossy().to_string();
    let dest_str = dest.to_string_lossy().to_string();

    let ps_script = format!(
        r#"[void][Windows.Media.Transcoding.MediaTranscoder, Windows.Media, ContentType = WindowsRuntime]
$source = [Windows.Storage.StorageFile]::GetFileFromPathAsync('{src}').GetAwaiter().GetResult()
$dest = [Windows.Storage.StorageFile]::CreateFileAsync('{dest}', [Windows.Storage.CreationCollisionOption]::ReplaceExisting).GetAwaiter().GetResult()
$transcoder = New-Object Windows.Media.Transcoding.MediaTranscoder
$profile = if ('{ext}' -eq 'm4a') {{ [Windows.Media.MediaProperties.MediaEncodingProfile]::CreateM4a([Windows.Media.MediaProperties.AudioEncodingQuality]::High) }} else {{ [Windows.Media.MediaProperties.MediaEncodingProfile]::CreateMp3([Windows.Media.MediaProperties.AudioEncodingQuality]::High) }}
$profile.Audio.Bitrate = {bps}
$prepared = $transcoder.PrepareFileTranscodeAsync($source, $dest, $profile).GetAwaiter().GetResult()
if ($prepared.CanTranscode) {{
    $prepared.TranscodeAsync().GetAwaiter().GetResult()
}} else {{
    exit 2
}}
"#,
        src = src_str.replace("'", "''"),
        dest = dest_str.replace("'", "''"),
        ext = options.format.extension(),
        bps = target_bps
    );

    let output = std::process::Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &ps_script])
        .output();

    match output {
        Ok(out) if out.status.success() && dest.exists() && dest.metadata().map(|m| m.len() > 0).unwrap_or(false) => {
            Ok(())
        }
        _ => {
            // Fallback: transcode to WAV or copy if PowerShell execution is restricted
            if src.extension() == dest.extension() {
                std::fs::copy(src, dest).map(|_| ()).map_err(|e| e.to_string())
            } else {
                transcode_to_wav_pure_rust(src, dest, options)
            }
        }
    }
}

// ---------------------------------------------------------------------------
// macOS Implementation (CoreAudio / afconvert native utility)
// ---------------------------------------------------------------------------
#[cfg(target_os = "macos")]
fn macos_transcode(
    src: &Path,
    dest: &Path,
    options: &TranscodeOptions,
) -> Result<(), String> {
    let data_format = match options.format {
        TranscodeTargetFormat::Aac => "aac ",
        TranscodeTargetFormat::Mp3 => ".mp3",
        TranscodeTargetFormat::Wav => "LEI16",
    };
    let file_format = match options.format {
        TranscodeTargetFormat::Aac => "m4af",
        TranscodeTargetFormat::Mp3 => "MPG3",
        TranscodeTargetFormat::Wav => "WAVE",
    };

    let bitrate_arg = format!("{}", options.bitrate_kbps * 1000);

    let mut cmd = std::process::Command::new("afconvert");
    cmd.args(["-d", data_format, "-f", file_format, "-b", &bitrate_arg]);

    if options.downsample_44k {
        cmd.args(["--samplerate", "44100"]);
    }
    if options.downmix_mono {
        cmd.args(["-c", "1"]);
    }

    cmd.arg(src).arg(dest);

    let res = cmd.output().map_err(|e| format!("Failed to run afconvert: {e}"))?;
    if res.status.success() && dest.exists() {
        Ok(())
    } else {
        transcode_to_wav_pure_rust(src, dest, options)
    }
}

// ---------------------------------------------------------------------------
// Linux Implementation (ffmpeg / avconv / pure Rust decoding)
// ---------------------------------------------------------------------------
#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn linux_transcode(
    src: &Path,
    dest: &Path,
    options: &TranscodeOptions,
) -> Result<(), String> {
    let mut cmd = std::process::Command::new("ffmpeg");
    cmd.args(["-y", "-i"])
        .arg(src)
        .args(["-b:a", &format!("{}k", options.bitrate_kbps)]);

    if options.downsample_44k {
        cmd.args(["-ar", "44100"]);
    }
    if options.downmix_mono {
        cmd.args(["-ac", "1"]);
    }

    cmd.arg(dest);

    if let Ok(out) = cmd.output() {
        if out.status.success() && dest.exists() {
            return Ok(());
        }
    }

    transcode_to_wav_pure_rust(src, dest, options)
}

// ---------------------------------------------------------------------------
// Pure Rust Audio Decoder (Symphonia) -> 16-bit PCM WAV Writer
// Works universally across ALL operating systems without external libraries.
// ---------------------------------------------------------------------------
pub fn transcode_to_wav_pure_rust(
    src: &Path,
    dest: &Path,
    options: &TranscodeOptions,
) -> Result<(), String> {
    use std::fs::File;
    use std::io::{BufWriter, Write};
    use symphonia::core::codecs::audio::AudioDecoderOptions;
    use symphonia::core::formats::probe::Hint;
    use symphonia::core::formats::{FormatOptions, TrackType};
    use symphonia::core::io::MediaSourceStream;
    use symphonia::core::meta::MetadataOptions;

    let src_file = File::open(src).map_err(|e| format!("Failed to open source file: {e}"))?;
    let mss = MediaSourceStream::new(Box::new(src_file), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = src.extension().and_then(|s| s.to_str()) {
        hint.with_extension(ext);
    }

    let meta_opts: MetadataOptions = Default::default();
    let fmt_opts = FormatOptions::default();

    let mut format = symphonia::default::get_probe()
        .probe(&hint, mss, fmt_opts, meta_opts)
        .map_err(|e| format!("Unsupported container/format: {e}"))?;

    let track = format
        .default_track(TrackType::Audio)
        .ok_or_else(|| "No audio track found in file".to_string())?;

    let track_id = track.id;
    let audio_params = track
        .codec_params
        .as_ref()
        .and_then(|cp| cp.audio())
        .ok_or_else(|| "Missing audio codec parameters".to_string())?
        .clone();

    let sample_rate = audio_params.sample_rate.unwrap_or(44100);
    let channels = audio_params.channels.as_ref().map(|c| c.count()).unwrap_or(2) as u16;

    let dec_opts = AudioDecoderOptions::default();
    let mut decoder = symphonia::default::get_codecs()
        .make_audio_decoder(&audio_params, &dec_opts)
        .map_err(|e| format!("Unsupported audio codec: {e}"))?;

    let target_channels = if options.downmix_mono { 1u16 } else { channels };
    let target_sample_rate = if options.downsample_44k && sample_rate > 44100 { 44100 } else { sample_rate };

    let mut pcm_samples: Vec<i16> = Vec::new();
    let mut interleaved_scratch: Vec<f32> = Vec::new();

    loop {
        let packet = match format.next_packet() {
            Ok(Some(p)) => p,
            Ok(None) => break,
            Err(_) => break,
        };

        if packet.track_id != track_id {
            continue;
        }

        match decoder.decode(&packet) {
            Ok(decoded) => {
                let frames = decoded.frames();
                let planes = decoded.num_planes();
                if frames == 0 || planes == 0 {
                    continue;
                }
                let total_samples = decoded.samples_interleaved();
                interleaved_scratch.resize(total_samples, 0.0);
                decoded.copy_to_slice_interleaved(&mut interleaved_scratch);

                if options.downmix_mono && channels == 2 {
                    for chunk in interleaved_scratch.chunks(2) {
                        if chunk.len() == 2 {
                            let mono_f32 = (chunk[0] + chunk[1]) * 0.5;
                            let mono_i16 = (mono_f32.clamp(-1.0, 1.0) * 32767.0) as i16;
                            pcm_samples.push(mono_i16);
                        } else {
                            let s = (chunk[0].clamp(-1.0, 1.0) * 32767.0) as i16;
                            pcm_samples.push(s);
                        }
                    }
                } else {
                    for &s_f32 in &interleaved_scratch {
                        let s_i16 = (s_f32.clamp(-1.0, 1.0) * 32767.0) as i16;
                        pcm_samples.push(s_i16);
                    }
                }
            }
            Err(_) => continue,
        }
    }

    // Write standard 16-bit PCM RIFF WAV
    let out_file = File::create(dest).map_err(|e| format!("Failed to create destination: {e}"))?;
    let mut writer = BufWriter::new(out_file);

    let data_len = (pcm_samples.len() * 2) as u32;
    let riff_len = 36 + data_len;
    let byte_rate = target_sample_rate * target_channels as u32 * 2;
    let block_align = target_channels * 2;

    writer.write_all(b"RIFF").map_err(|e| e.to_string())?;
    writer.write_all(&riff_len.to_le_bytes()).map_err(|e| e.to_string())?;
    writer.write_all(b"WAVEfmt ").map_err(|e| e.to_string())?;
    writer.write_all(&16u32.to_le_bytes()).map_err(|e| e.to_string())?;
    writer.write_all(&1u16.to_le_bytes()).map_err(|e| e.to_string())?;
    writer.write_all(&target_channels.to_le_bytes()).map_err(|e| e.to_string())?;
    writer.write_all(&target_sample_rate.to_le_bytes()).map_err(|e| e.to_string())?;
    writer.write_all(&byte_rate.to_le_bytes()).map_err(|e| e.to_string())?;
    writer.write_all(&block_align.to_le_bytes()).map_err(|e| e.to_string())?;
    writer.write_all(&16u16.to_le_bytes()).map_err(|e| e.to_string())?;
    writer.write_all(b"data").map_err(|e| e.to_string())?;
    writer.write_all(&data_len.to_le_bytes()).map_err(|e| e.to_string())?;

    for s in pcm_samples {
        writer.write_all(&s.to_le_bytes()).map_err(|e| e.to_string())?;
    }

    writer.flush().map_err(|e| format!("Flush failed: {e}"))?;
    Ok(())
}
