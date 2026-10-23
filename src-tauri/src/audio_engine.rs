// Native Rust Audio & DSP Engine (Symphonia + CPAL + 10-band Biquad EQ + RustFFT Visualizer)
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use rustfft::{num_complex::Complex, FftPlanner};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::f32::consts::PI;
use std::fs::File;
use std::path::Path;
use std::sync::{Arc, Mutex, OnceLock};
use symphonia::core::audio::conv::FromSample;
use symphonia::core::codecs::audio::{AudioDecoder, AudioDecoderOptions};
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, FormatReader, SeekMode, SeekTo, TrackType};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::units::{Time, TimeBase};

pub const EQ_FREQUENCIES: [f32; 10] = [
    32.0, 64.0, 125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0, 16000.0,
];

#[derive(Clone, Copy, Debug)]
pub enum FilterKind {
    LowShelf,
    Peaking,
    HighShelf,
}

/// Direct Form II Transposed Biquad Filter (per-channel state for stereo)
#[derive(Clone, Copy, Debug)]
pub struct BiquadFilter {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    z1_l: f32,
    z2_l: f32,
    z1_r: f32,
    z2_r: f32,
}

impl BiquadFilter {
    pub fn bypass() -> Self {
        Self {
            b0: 1.0,
            b1: 0.0,
            b2: 0.0,
            a1: 0.0,
            a2: 0.0,
            z1_l: 0.0,
            z2_l: 0.0,
            z1_r: 0.0,
            z2_r: 0.0,
        }
    }

    pub fn update_coefficients(&mut self, kind: FilterKind, freq: f32, sample_rate: f32, db_gain: f32) {
        if db_gain.abs() < 0.001 || sample_rate <= 0.0 {
            self.b0 = 1.0;
            self.b1 = 0.0;
            self.b2 = 0.0;
            self.a1 = 0.0;
            self.a2 = 0.0;
            return;
        }

        let nyquist = sample_rate * 0.49;
        let f0 = freq.clamp(10.0, nyquist);
        let a = 10.0_f32.powf(db_gain / 40.0);
        let w0 = 2.0 * PI * f0 / sample_rate;
        let cos_w0 = w0.cos();
        let sin_w0 = w0.sin();

        let (b0, b1, b2, a0, a1, a2) = match kind {
            FilterKind::Peaking => {
                let q = 1.4_f32;
                let alpha = sin_w0 / (2.0 * q);
                let b0 = 1.0 + alpha * a;
                let b1 = -2.0 * cos_w0;
                let b2 = 1.0 - alpha * a;
                let a0 = 1.0 + alpha / a;
                let a1 = -2.0 * cos_w0;
                let a2 = 1.0 - alpha / a;
                (b0, b1, b2, a0, a1, a2)
            }
            FilterKind::LowShelf => {
                let sqrt_a = a.sqrt();
                let alpha = sin_w0 / 2.0 * std::f32::consts::SQRT_2;
                let two_sqrt_a_alpha = 2.0 * sqrt_a * alpha;
                let b0 = a * ((a + 1.0) - (a - 1.0) * cos_w0 + two_sqrt_a_alpha);
                let b1 = 2.0 * a * ((a - 1.0) - (a + 1.0) * cos_w0);
                let b2 = a * ((a + 1.0) - (a - 1.0) * cos_w0 - two_sqrt_a_alpha);
                let a0 = (a + 1.0) + (a - 1.0) * cos_w0 + two_sqrt_a_alpha;
                let a1 = -2.0 * ((a - 1.0) + (a + 1.0) * cos_w0);
                let a2 = (a + 1.0) + (a - 1.0) * cos_w0 - two_sqrt_a_alpha;
                (b0, b1, b2, a0, a1, a2)
            }
            FilterKind::HighShelf => {
                let sqrt_a = a.sqrt();
                let alpha = sin_w0 / 2.0 * std::f32::consts::SQRT_2;
                let two_sqrt_a_alpha = 2.0 * sqrt_a * alpha;
                let b0 = a * ((a + 1.0) + (a - 1.0) * cos_w0 + two_sqrt_a_alpha);
                let b1 = -2.0 * a * ((a - 1.0) + (a + 1.0) * cos_w0);
                let b2 = a * ((a + 1.0) + (a - 1.0) * cos_w0 - two_sqrt_a_alpha);
                let a0 = (a + 1.0) - (a - 1.0) * cos_w0 + two_sqrt_a_alpha;
                let a1 = 2.0 * ((a - 1.0) - (a + 1.0) * cos_w0);
                let a2 = (a + 1.0) - (a - 1.0) * cos_w0 - two_sqrt_a_alpha;
                (b0, b1, b2, a0, a1, a2)
            }
        };

        let inv_a0 = 1.0 / a0;
        self.b0 = b0 * inv_a0;
        self.b1 = b1 * inv_a0;
        self.b2 = b2 * inv_a0;
        self.a1 = a1 * inv_a0;
        self.a2 = a2 * inv_a0;
    }

    #[inline]
    pub fn process_stereo(&mut self, left: f32, right: f32) -> (f32, f32) {
        let out_l = self.b0 * left + self.z1_l;
        self.z1_l = self.b1 * left - self.a1 * out_l + self.z2_l;
        self.z2_l = self.b2 * left - self.a2 * out_l;

        let out_r = self.b0 * right + self.z1_r;
        self.z1_r = self.b1 * right - self.a1 * out_r + self.z2_r;
        self.z2_r = self.b2 * right - self.a2 * out_r;

        (out_l, out_r)
    }

    pub fn reset_state(&mut self) {
        self.z1_l = 0.0;
        self.z2_l = 0.0;
        self.z1_r = 0.0;
        self.z2_r = 0.0;
    }
}

pub struct EqChain {
    filters: [BiquadFilter; 10],
    gains_db: [f32; 10],
    sample_rate: f32,
}

impl EqChain {
    pub fn new(sample_rate: f32) -> Self {
        let mut chain = Self {
            filters: [BiquadFilter::bypass(); 10],
            gains_db: [0.0; 10],
            sample_rate,
        };
        chain.recompute();
        chain
    }

    pub fn set_sample_rate(&mut self, sample_rate: f32) {
        if (self.sample_rate - sample_rate).abs() > 1.0 {
            self.sample_rate = sample_rate;
            self.recompute();
        }
    }

    pub fn set_gains(&mut self, gains_db: [f32; 10]) {
        if self.gains_db != gains_db {
            self.gains_db = gains_db;
            self.recompute();
        }
    }

    fn recompute(&mut self) {
        for (i, &freq) in EQ_FREQUENCIES.iter().enumerate() {
            let kind = if i == 0 {
                FilterKind::LowShelf
            } else if i == 9 {
                FilterKind::HighShelf
            } else {
                FilterKind::Peaking
            };
            self.filters[i].update_coefficients(kind, freq, self.sample_rate, self.gains_db[i]);
        }
    }

    #[inline]
    pub fn process_stereo(&mut self, mut l: f32, mut r: f32) -> (f32, f32) {
        for f in &mut self.filters {
            let (nl, nr) = f.process_stereo(l, r);
            l = nl;
            r = nr;
        }
        (l, r)
    }
}

struct DeckDecoder {
    format: Box<dyn FormatReader>,
    decoder: Box<dyn AudioDecoder>,
    track_id: u32,
    sample_rate: u32,
    time_base: Option<TimeBase>,
    duration_secs: f64,
    current_time_secs: f64,
    fifo: VecDeque<(f32, f32)>,
    interleaved_scratch: Vec<f32>,
    prev_src_sample: Option<(f32, f32)>,
    curr_src_sample: Option<(f32, f32)>,
    resample_pos: f64,
    eof: bool,
    normalization_gain: f32,
}

impl DeckDecoder {
    fn open(file_path: &str, replay_gain_db: Option<f64>, normalization_enabled: bool) -> Result<Self, String> {
        let path = Path::new(file_path);
        let file = File::open(path).map_err(|e| format!("Failed to open audio file: {e}"))?;
        let mss = MediaSourceStream::new(Box::new(file), Default::default());

        let mut hint = Hint::new();
        if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            hint.with_extension(ext);
        }

        let fmt_opts = FormatOptions::default().seek_index_fill_period_ms(500);
        let meta_opts: MetadataOptions = Default::default();

        let format = symphonia::default::get_probe()
            .probe(&hint, mss, fmt_opts, meta_opts)
            .map_err(|e| format!("Unsupported container/format: {e}"))?;

        let track = format
            .default_track(TrackType::Audio)
            .ok_or_else(|| "No audio track found in file".to_string())?;

        let track_id = track.id;
        let time_base = track.time_base;

        let audio_params = track
            .codec_params
            .as_ref()
            .and_then(|cp| cp.audio())
            .ok_or_else(|| "Missing audio codec parameters".to_string())?
            .clone();

        let sample_rate = audio_params.sample_rate.unwrap_or(44100);

        let duration_secs = track
            .duration
            .and_then(|dur| time_base.and_then(|tb| tb.calc_duration(dur)))
            .map(|t| t.as_secs_f64())
            .or_else(|| {
                track
                    .num_frames
                    .map(|frames| frames as f64 / sample_rate.max(1) as f64)
            })
            .unwrap_or(0.0);

        let dec_opts = AudioDecoderOptions::default();
        let decoder = symphonia::default::get_codecs()
            .make_audio_decoder(&audio_params, &dec_opts)
            .map_err(|e| format!("Unsupported audio codec: {e}"))?;

        let normalization_gain = if normalization_enabled {
            if let Some(rg) = replay_gain_db {
                if rg.is_finite() {
                    let clamped = rg.clamp(-12.0, 12.0) as f32;
                    10.0_f32.powf(clamped / 20.0)
                } else {
                    1.0
                }
            } else {
                1.0
            }
        } else {
            1.0
        };

        let mut deck = Self {
            format,
            decoder,
            track_id,
            sample_rate,
            time_base,
            duration_secs,
            current_time_secs: 0.0,
            fifo: VecDeque::with_capacity(16384),
            interleaved_scratch: Vec::with_capacity(8192),
            prev_src_sample: None,
            curr_src_sample: None,
            resample_pos: 0.0,
            eof: false,
            normalization_gain,
        };

        // Pre-decode first packet so we verify codec works and prime playback buffer immediately
        deck.refill_fifo(4096)?;
        Ok(deck)
    }

    fn seek(&mut self, seconds: f64) {
        let clamped = if self.duration_secs > 0.0 {
            seconds.clamp(0.0, self.duration_secs)
        } else {
            seconds.max(0.0)
        };
        let target_time = Time::try_from_secs_f64(clamped).unwrap_or(Time::ZERO);
        if self
            .format
            .seek(
                SeekMode::Accurate,
                SeekTo::Time {
                    time: target_time,
                    track_id: Some(self.track_id),
                },
            )
            .is_ok()
        {
            self.decoder.reset();
            self.fifo.clear();
            self.prev_src_sample = None;
            self.curr_src_sample = None;
            self.resample_pos = 0.0;
            self.eof = false;
            self.current_time_secs = clamped;
        }
    }

    fn refill_fifo(&mut self, min_frames: usize) -> Result<(), String> {
        while self.fifo.len() < min_frames && !self.eof {
            match self.format.next_packet() {
                Ok(Some(packet)) => {
                    if packet.track_id != self.track_id {
                        continue;
                    }
                    if let Some(tb) = self.time_base {
                        if let Some(t) = tb.calc_time(packet.pts) {
                            let pkt_secs = t.as_secs_f64();
                            if pkt_secs >= 0.0 {
                                // Account for frames still sitting in the FIFO
                                let fifo_secs =
                                    self.fifo.len() as f64 / self.sample_rate.max(1) as f64;
                                self.current_time_secs = (pkt_secs - fifo_secs).max(0.0);
                            }
                        }
                    }

                    match self.decoder.decode(&packet) {
                        Ok(decoded) => {
                            let frames = decoded.frames();
                            let planes = decoded.num_planes();
                            if frames == 0 || planes == 0 {
                                continue;
                            }
                            self.sample_rate = decoded.spec().rate();
                            let total_samples = decoded.samples_interleaved();
                            self.interleaved_scratch.resize(total_samples, 0.0);
                            decoded.copy_to_slice_interleaved(&mut self.interleaved_scratch);

                            if planes == 1 {
                                for &s in &self.interleaved_scratch[..frames] {
                                    self.fifo.push_back((s, s));
                                }
                            } else {
                                for chunk in self.interleaved_scratch.chunks_exact(planes) {
                                    self.fifo.push_back((chunk[0], chunk[1]));
                                }
                            }
                        }
                        Err(SymphoniaError::DecodeError(_)) | Err(SymphoniaError::IoError(_)) => {
                            continue;
                        }
                        Err(SymphoniaError::ResetRequired) => {
                            self.decoder.reset();
                            continue;
                        }
                        Err(e) => {
                            return Err(format!("Decode error: {e}"));
                        }
                    }
                }
                Ok(None) => {
                    self.eof = true;
                    break;
                }
                Err(SymphoniaError::IoError(ref err))
                    if err.kind() == std::io::ErrorKind::UnexpectedEof =>
                {
                    self.eof = true;
                    break;
                }
                Err(_) => {
                    self.eof = true;
                    break;
                }
            }
        }
        Ok(())
    }

    /// Pull next stereo frame at output_sample_rate using fractional linear interpolation if rates differ
    fn next_frame(&mut self, output_sample_rate: u32) -> Option<(f32, f32)> {
        if self.fifo.len() < 2048 && !self.eof {
            let _ = self.refill_fifo(4096);
        }

        if self.sample_rate == output_sample_rate || output_sample_rate == 0 {
            let sample = self.fifo.pop_front()?;
            let dt = 1.0 / output_sample_rate.max(1) as f64;
            self.current_time_secs += dt;
            return Some(sample);
        }

        // Fractional linear interpolation between source sample rate (e.g. 44100 Hz)
        // and device output sample rate (e.g. 48000 Hz) so pitch and speed remain exact.
        let step = self.sample_rate as f64 / output_sample_rate as f64;

        if self.prev_src_sample.is_none() {
            self.prev_src_sample = self.fifo.pop_front();
        }
        if self.curr_src_sample.is_none() {
            self.curr_src_sample = self.fifo.pop_front().or(self.prev_src_sample);
        }

        let prev = self.prev_src_sample?;
        let curr = self.curr_src_sample.unwrap_or(prev);

        let frac = self.resample_pos.clamp(0.0, 1.0) as f32;
        let out_l = prev.0 + (curr.0 - prev.0) * frac;
        let out_r = prev.1 + (curr.1 - prev.1) * frac;

        let dt = 1.0 / output_sample_rate.max(1) as f64;
        self.current_time_secs += dt;

        self.resample_pos += step;
        while self.resample_pos >= 1.0 {
            self.resample_pos -= 1.0;
            self.prev_src_sample = self.curr_src_sample;
            if self.fifo.len() < 512 && !self.eof {
                let _ = self.refill_fifo(4096);
            }
            if let Some(next_s) = self.fifo.pop_front() {
                self.curr_src_sample = Some(next_s);
            } else {
                self.prev_src_sample = None;
                self.curr_src_sample = None;
                break;
            }
        }

        Some((out_l, out_r))
    }

    fn is_finished(&self) -> bool {
        self.eof && self.fifo.is_empty() && self.prev_src_sample.is_none()
    }
}

struct CrossfadeState {
    outgoing_deck: DeckDecoder,
    elapsed_frames: u64,
    total_frames: u64,
}

pub struct EngineSharedState {
    active_deck: Option<DeckDecoder>,
    crossfade: Option<CrossfadeState>,
    eq_chain: EqChain,
    volume: f32,
    normalization_enabled: bool,
    paused: bool,
    ended_flag: bool,
    output_sample_rate: u32,
    output_channels: usize,
    visualizer_ring: VecDeque<f32>,
    prev_fft_bins: [f32; 128],
}

impl EngineSharedState {
    fn new(output_sample_rate: u32, output_channels: usize) -> Self {
        Self {
            active_deck: None,
            crossfade: None,
            eq_chain: EqChain::new(output_sample_rate as f32),
            volume: 0.8,
            normalization_enabled: false,
            paused: true,
            ended_flag: false,
            output_sample_rate,
            output_channels,
            visualizer_ring: VecDeque::with_capacity(512),
            prev_fft_bins: [0.0; 128],
        }
    }

    fn render_interleaved_f32(&mut self, out: &mut [f32]) {
        let channels = self.output_channels.max(1);
        if self.paused || self.active_deck.is_none() {
            out.fill(0.0);
            return;
        }

        let sr = self.output_sample_rate;
        self.eq_chain.set_sample_rate(sr as f32);

        for frame in out.chunks_mut(channels) {
            let mut l_mix = 0.0_f32;
            let mut r_mix = 0.0_f32;
            let mut got_sample = false;

            let mut fade_in_gain = 1.0_f32;
            if let Some(ref mut xf) = self.crossfade {
                let progress = (xf.elapsed_frames as f32 / xf.total_frames.max(1) as f32).clamp(0.0, 1.0);
                fade_in_gain = progress;
                let fade_out_gain = 1.0 - progress;
                xf.elapsed_frames += 1;

                if let Some((ol, or)) = xf.outgoing_deck.next_frame(sr) {
                    let og = xf.outgoing_deck.normalization_gain * fade_out_gain;
                    l_mix += ol * og;
                    r_mix += or * og;
                    got_sample = true;
                }
            }

            if let Some(ref mut deck) = self.active_deck {
                if let Some((al, ar)) = deck.next_frame(sr) {
                    let ag = deck.normalization_gain * fade_in_gain;
                    l_mix += al * ag;
                    r_mix += ar * ag;
                    got_sample = true;
                }
            }

            if let Some(ref xf) = self.crossfade {
                if xf.elapsed_frames >= xf.total_frames || xf.outgoing_deck.is_finished() {
                    self.crossfade = None;
                }
            }

            if !got_sample {
                if let Some(ref deck) = self.active_deck {
                    if deck.is_finished() {
                        self.paused = true;
                        self.ended_flag = true;
                        self.crossfade = None;
                    }
                }
                frame.fill(0.0);
                continue;
            }

            let (eq_l, eq_r) = self.eq_chain.process_stereo(l_mix, r_mix);
            let final_l = (eq_l * self.volume).clamp(-1.0, 1.0);
            let final_r = (eq_r * self.volume).clamp(-1.0, 1.0);

            let mono = 0.5 * (final_l + final_r);
            if self.visualizer_ring.len() >= 256 {
                self.visualizer_ring.pop_front();
            }
            self.visualizer_ring.push_back(mono);

            if channels == 1 {
                frame[0] = mono;
            } else {
                frame[0] = final_l;
                frame[1] = final_r;
                for ch in &mut frame[2..] {
                    *ch = mono;
                }
            }
        }
    }
}

static ENGINE_STATE: OnceLock<Arc<Mutex<EngineSharedState>>> = OnceLock::new();
static STREAM_INIT: OnceLock<bool> = OnceLock::new();

fn get_engine_state() -> Result<&'static Arc<Mutex<EngineSharedState>>, String> {
    if STREAM_INIT.get().is_none() {
        let host = cpal::default_host();
        let device = host
            .default_output_device()
            .ok_or_else(|| "No default audio output device available".to_string())?;
        let supported_config = device
            .default_output_config()
            .map_err(|e| format!("Failed to query default output config: {e}"))?;

        let sample_rate = supported_config.sample_rate().0;
        let channels = supported_config.channels() as usize;
        let sample_format = supported_config.sample_format();
        let config: cpal::StreamConfig = supported_config.into();

        let shared = Arc::new(Mutex::new(EngineSharedState::new(sample_rate, channels)));
        let _ = ENGINE_STATE.set(shared.clone());

        let (tx_ready, rx_ready) = std::sync::mpsc::channel::<Result<(), String>>();

        std::thread::Builder::new()
            .name("classitunes-cpal-audio".to_string())
            .spawn(move || {
                let err_fn = |err| eprintln!("[NativeAudioEngine] stream error: {err}");
                let stream_res = match sample_format {
                    cpal::SampleFormat::F32 => device.build_output_stream(
                        &config,
                        move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                            if let Ok(mut guard) = shared.lock() {
                                guard.render_interleaved_f32(data);
                            } else {
                                data.fill(0.0);
                            }
                        },
                        err_fn,
                        None,
                    ),
                    cpal::SampleFormat::I16 => {
                        let mut scratch = Vec::<f32>::new();
                        device.build_output_stream(
                            &config,
                            move |data: &mut [i16], _: &cpal::OutputCallbackInfo| {
                                scratch.resize(data.len(), 0.0);
                                if let Ok(mut guard) = shared.lock() {
                                    guard.render_interleaved_f32(&mut scratch);
                                } else {
                                    scratch.fill(0.0);
                                }
                                for (dst, &src) in data.iter_mut().zip(scratch.iter()) {
                                    *dst = i16::from_sample(src);
                                }
                            },
                            err_fn,
                            None,
                        )
                    }
                    cpal::SampleFormat::U16 => {
                        let mut scratch = Vec::<f32>::new();
                        device.build_output_stream(
                            &config,
                            move |data: &mut [u16], _: &cpal::OutputCallbackInfo| {
                                scratch.resize(data.len(), 0.0);
                                if let Ok(mut guard) = shared.lock() {
                                    guard.render_interleaved_f32(&mut scratch);
                                } else {
                                    scratch.fill(0.0);
                                }
                                for (dst, &src) in data.iter_mut().zip(scratch.iter()) {
                                    *dst = u16::from_sample(src);
                                }
                            },
                            err_fn,
                            None,
                        )
                    }
                    _ => Err(cpal::BuildStreamError::StreamConfigNotSupported),
                };

                match stream_res {
                    Ok(stream) => {
                        if let Err(e) = stream.play() {
                            let _ = tx_ready.send(Err(format!("Failed to start output stream: {e}")));
                            return;
                        }
                        let _ = tx_ready.send(Ok(()));
                        // Keep stream alive for the lifetime of the application
                        loop {
                            std::thread::park();
                        }
                    }
                    Err(e) => {
                        let _ = tx_ready.send(Err(format!("Failed to build output stream: {e}")));
                    }
                }
            })
            .map_err(|e| format!("Failed to spawn audio thread: {e}"))?;

        match rx_ready.recv() {
            Ok(Ok(())) => {
                let _ = STREAM_INIT.set(true);
            }
            Ok(Err(e)) => return Err(e),
            Err(e) => return Err(format!("Audio stream startup channel closed: {e}")),
        }
    }

    ENGINE_STATE
        .get()
        .ok_or_else(|| "Audio engine state not initialized".to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeAudioState {
    pub current_time: f64,
    pub duration: f64,
    pub paused: bool,
    pub ended: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeVisualizerFrame {
    pub frequency_bins: Vec<u8>,
    pub waveform_bins: Vec<u8>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EqBandsPayload {
    pub b32: f32,
    pub b64: f32,
    pub b125: f32,
    pub b250: f32,
    pub b500: f32,
    pub b1k: f32,
    pub b2k: f32,
    pub b4k: f32,
    pub b8k: f32,
    pub b16k: f32,
}

#[tauri::command]
pub fn native_audio_play(file_path: String, replay_gain_db: Option<f64>) -> Result<NativeAudioState, String> {
    let state_arc = get_engine_state()?;
    let norm_enabled = {
        let guard = state_arc.lock().map_err(|_| "Mutex poisoned")?;
        guard.normalization_enabled
    };

    let deck = DeckDecoder::open(&file_path, replay_gain_db, norm_enabled)?;
    let duration = deck.duration_secs;

    let mut guard = state_arc.lock().map_err(|_| "Mutex poisoned")?;
    guard.crossfade = None;
    guard.active_deck = Some(deck);
    guard.paused = false;
    guard.ended_flag = false;

    Ok(NativeAudioState {
        current_time: 0.0,
        duration,
        paused: false,
        ended: false,
    })
}

#[tauri::command]
pub fn native_audio_crossfade(
    file_path: String,
    duration_secs: f64,
    replay_gain_db: Option<f64>,
) -> Result<NativeAudioState, String> {
    let state_arc = get_engine_state()?;
    let (norm_enabled, sr) = {
        let guard = state_arc.lock().map_err(|_| "Mutex poisoned")?;
        (guard.normalization_enabled, guard.output_sample_rate)
    };

    let next_deck = DeckDecoder::open(&file_path, replay_gain_db, norm_enabled)?;
    let duration = next_deck.duration_secs;
    let total_frames = ((duration_secs.max(0.25)) * sr.max(1) as f64) as u64;

    let mut guard = state_arc.lock().map_err(|_| "Mutex poisoned")?;
    if let Some(prev_deck) = guard.active_deck.take() {
        guard.crossfade = Some(CrossfadeState {
            outgoing_deck: prev_deck,
            elapsed_frames: 0,
            total_frames,
        });
    }
    guard.active_deck = Some(next_deck);
    guard.paused = false;
    guard.ended_flag = false;

    Ok(NativeAudioState {
        current_time: 0.0,
        duration,
        paused: false,
        ended: false,
    })
}

#[tauri::command]
pub fn native_audio_pause() -> Result<(), String> {
    if let Some(state_arc) = ENGINE_STATE.get() {
        if let Ok(mut guard) = state_arc.lock() {
            guard.paused = true;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn native_audio_resume() -> Result<(), String> {
    if let Some(state_arc) = ENGINE_STATE.get() {
        if let Ok(mut guard) = state_arc.lock() {
            if guard.active_deck.is_some() {
                guard.paused = false;
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn native_audio_stop() -> Result<(), String> {
    if let Some(state_arc) = ENGINE_STATE.get() {
        if let Ok(mut guard) = state_arc.lock() {
            guard.paused = true;
            guard.active_deck = None;
            guard.crossfade = None;
            guard.ended_flag = false;
            guard.visualizer_ring.clear();
        }
    }
    Ok(())
}

#[tauri::command]
pub fn native_audio_seek(seconds: f64) -> Result<(), String> {
    if let Some(state_arc) = ENGINE_STATE.get() {
        if let Ok(mut guard) = state_arc.lock() {
            guard.crossfade = None;
            if let Some(ref mut deck) = guard.active_deck {
                deck.seek(seconds);
                guard.ended_flag = false;
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn native_audio_set_volume(volume: f32) -> Result<(), String> {
    if let Some(state_arc) = ENGINE_STATE.get() {
        if let Ok(mut guard) = state_arc.lock() {
            guard.volume = volume.clamp(0.0, 1.0);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn native_audio_set_normalization(enabled: bool) -> Result<(), String> {
    if let Some(state_arc) = ENGINE_STATE.get() {
        if let Ok(mut guard) = state_arc.lock() {
            guard.normalization_enabled = enabled;
            if !enabled {
                if let Some(ref mut deck) = guard.active_deck {
                    deck.normalization_gain = 1.0;
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn native_audio_set_eq(gains: Option<Vec<f32>>, bands: Option<EqBandsPayload>) -> Result<(), String> {
    if let Some(state_arc) = ENGINE_STATE.get() {
        if let Ok(mut guard) = state_arc.lock() {
            if let Some(g) = gains {
                let mut arr = [0.0_f32; 10];
                for (i, &val) in g.iter().take(10).enumerate() {
                    arr[i] = val;
                }
                guard.eq_chain.set_gains(arr);
            } else if let Some(b) = bands {
                guard.eq_chain.set_gains([
                    b.b32, b.b64, b.b125, b.b250, b.b500, b.b1k, b.b2k, b.b4k, b.b8k, b.b16k,
                ]);
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn native_audio_get_state() -> NativeAudioState {
    if let Some(state_arc) = ENGINE_STATE.get() {
        if let Ok(mut guard) = state_arc.lock() {
            let (current_time, duration) = guard
                .active_deck
                .as_ref()
                .map(|d| (d.current_time_secs, d.duration_secs))
                .unwrap_or((0.0, 0.0));
            let ended = guard.ended_flag;
            if ended {
                guard.ended_flag = false;
            }
            return NativeAudioState {
                current_time,
                duration,
                paused: guard.paused,
                ended,
            };
        }
    }
    NativeAudioState {
        current_time: 0.0,
        duration: 0.0,
        paused: true,
        ended: false,
    }
}

#[tauri::command]
pub fn native_audio_get_visualizer() -> NativeVisualizerFrame {
    let mut frequency_bins = vec![0u8; 128];
    let mut waveform_bins = vec![128u8; 256];

    if let Some(state_arc) = ENGINE_STATE.get() {
        if let Ok(mut guard) = state_arc.lock() {
            if guard.paused || guard.visualizer_ring.is_empty() {
                // Smoothly decay bins when paused
                for i in 0..128 {
                    guard.prev_fft_bins[i] *= 0.8;
                    frequency_bins[i] = guard.prev_fft_bins[i] as u8;
                }
                return NativeVisualizerFrame {
                    frequency_bins,
                    waveform_bins,
                };
            }

            let mut samples = [0.0_f32; 256];
            for (i, &s) in guard.visualizer_ring.iter().take(256).enumerate() {
                samples[i] = s;
                let byte_val = ((s * 0.5 + 0.5) * 255.0).clamp(0.0, 255.0) as u8;
                waveform_bins[i] = byte_val;
            }

            // Apply Hann window and run 256-point FFT
            let mut buffer = [Complex { re: 0.0_f32, im: 0.0_f32 }; 256];
            for i in 0..256 {
                let window = 0.5 * (1.0 - (2.0 * PI * i as f32 / 255.0).cos());
                buffer[i].re = samples[i] * window;
            }

            let mut planner = FftPlanner::<f32>::new();
            let fft = planner.plan_fft_forward(256);
            fft.process(&mut buffer);

            // Convert first 128 bins to dB scale matching WebAudio AnalyserNode [-100dB .. -30dB] -> [0..255]
            for i in 0..128 {
                let mag = (buffer[i].re * buffer[i].re + buffer[i].im * buffer[i].im).sqrt() / 128.0;
                let db = 20.0 * mag.max(1e-6).log10();
                let normalized = ((db - (-100.0)) / ((-30.0) - (-100.0))).clamp(0.0, 1.0) * 255.0;
                let smoothed = guard.prev_fft_bins[i] * 0.65 + normalized * 0.35;
                guard.prev_fft_bins[i] = smoothed;
                frequency_bins[i] = smoothed as u8;
            }
        }
    }

    NativeVisualizerFrame {
        frequency_bins,
        waveform_bins,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_biquad_eq_chain_flat_and_boosted() {
        let mut chain = EqChain::new(44100.0);
        // Flat EQ should pass signal through unchanged
        let (l, r) = chain.process_stereo(0.5, -0.25);
        assert!((l - 0.5).abs() < 1e-5);
        assert!((r - (-0.25)).abs() < 1e-5);

        // Boost 1kHz and 32Hz and ensure output remains finite
        chain.set_gains([6.0, 4.0, 2.0, 0.0, -2.0, 3.0, 4.0, 2.0, 1.0, 5.0]);
        for i in 0..512 {
            let phase = (i as f32 * 0.1).sin() * 0.5;
            let (ol, or) = chain.process_stereo(phase, phase);
            assert!(ol.is_finite());
            assert!(or.is_finite());
        }
    }
}
