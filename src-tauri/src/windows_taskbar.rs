#![cfg(target_os = "windows")]

use std::sync::atomic::{AtomicBool, AtomicIsize, AtomicU32, Ordering};
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter, WebviewWindow};
use windows::core::{w, BOOL};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::Graphics::Gdi::{
    CreateBitmap, CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, BITMAPINFO,
    BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
};
use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_INPROC_SERVER};
use windows::Win32::UI::Shell::{
    ITaskbarList3, TaskbarList, THUMBBUTTON, THBF_ENABLED, THB_FLAGS, THB_ICON, THB_TOOLTIP,
    THBN_CLICKED,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateIconIndirect, RegisterWindowMessageW, HICON, ICONINFO, WM_COMMAND,
};

type SUBCLASSPROC = Option<
    unsafe extern "system" fn(
        h_wnd: HWND,
        u_msg: u32,
        w_param: WPARAM,
        l_param: LPARAM,
        u_id_subclass: usize,
        dw_ref_data: usize,
    ) -> LRESULT,
>;

#[link(name = "comctl32")]
extern "system" {
    fn SetWindowSubclass(
        h_wnd: HWND,
        pfn_subclass: SUBCLASSPROC,
        u_id_subclass: usize,
        dw_ref_data: usize,
    ) -> BOOL;
    fn DefSubclassProc(
        h_wnd: HWND,
        u_msg: u32,
        w_param: WPARAM,
        l_param: LPARAM,
    ) -> LRESULT;
}

const ID_PREV: u32 = 101;
const ID_PLAY_PAUSE: u32 = 102;
const ID_NEXT: u32 = 103;
const SUBCLASS_ID: usize = 9988;

static BUTTONS_ADDED: AtomicBool = AtomicBool::new(false);
static IS_PLAYING: AtomicBool = AtomicBool::new(false);
static WINDOW_HWND: AtomicIsize = AtomicIsize::new(0);
static ICON_PREV: AtomicIsize = AtomicIsize::new(0);
static ICON_PLAY: AtomicIsize = AtomicIsize::new(0);
static ICON_PAUSE: AtomicIsize = AtomicIsize::new(0);
static ICON_NEXT: AtomicIsize = AtomicIsize::new(0);
static TASKBAR_BUTTON_CREATED_MSG: AtomicU32 = AtomicU32::new(0);

static GLOBAL_APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

fn str_to_u16_buf_260(text: &str) -> [u16; 260] {
    let mut buf = [0u16; 260];
    let encoded: Vec<u16> = text.encode_utf16().collect();
    let len = encoded.len().min(259);
    buf[..len].copy_from_slice(&encoded[..len]);
    buf
}

/// Creates a 32-bit ARGB HICON from raw RGBA bytes with premultiplied alpha.
fn create_hicon_from_rgba(width: i32, height: i32, rgba: &[u8]) -> Option<HICON> {
    unsafe {
        let mut bmi: BITMAPINFO = std::mem::zeroed();
        bmi.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
        bmi.bmiHeader.biWidth = width;
        bmi.bmiHeader.biHeight = -height; // top-down
        bmi.bmiHeader.biPlanes = 1;
        bmi.bmiHeader.biBitCount = 32;
        bmi.bmiHeader.biCompression = BI_RGB.0;

        let mut bits_ptr: *mut std::ffi::c_void = std::ptr::null_mut();
        let hdc = CreateCompatibleDC(None);
        let hbm_color = CreateDIBSection(Some(hdc), &bmi, DIB_RGB_COLORS, &mut bits_ptr, None, 0).ok()?;

        let total_pixels = (width * height) as usize;
        let target = std::slice::from_raw_parts_mut(bits_ptr as *mut u8, total_pixels * 4);

        for i in 0..total_pixels {
            let r = rgba[i * 4] as u32;
            let g = rgba[i * 4 + 1] as u32;
            let b = rgba[i * 4 + 2] as u32;
            let a = rgba[i * 4 + 3] as u32;

            // Premultiplied BGRA for Windows 32-bit alpha icons
            let pr = ((r * a) / 255) as u8;
            let pg = ((g * a) / 255) as u8;
            let pb = ((b * a) / 255) as u8;

            target[i * 4] = pb;
            target[i * 4 + 1] = pg;
            target[i * 4 + 2] = pr;
            target[i * 4 + 3] = a as u8;
        }

        // 1-bit monochrome mask (all zeroes for 32-bit alpha icon)
        let hbm_mask = CreateBitmap(width, height, 1, 1, None);

        let icon_info = ICONINFO {
            fIcon: true.into(),
            xHotspot: 0,
            yHotspot: 0,
            hbmMask: hbm_mask,
            hbmColor: hbm_color,
        };

        let icon = CreateIconIndirect(&icon_info).ok();

        let _ = DeleteObject(hbm_mask.into());
        let _ = DeleteObject(hbm_color.into());
        let _ = DeleteDC(hdc);

        icon
    }
}

/// Supersamples a 40x40 shape down to a 20x20 crisp antialiased icon with dark halo outline.
fn render_icon_supersampled<F>(shape_pred: F) -> Option<HICON>
where
    F: Fn(i32, i32) -> bool,
{
    const HI_RES: i32 = 40;
    const LO_RES: i32 = 20;

    let mut hi_grid = [0u8; (HI_RES * HI_RES) as usize];
    for y in 0..HI_RES {
        for x in 0..HI_RES {
            if shape_pred(x, y) {
                hi_grid[(y * HI_RES + x) as usize] = 2; // Foreground (white)
            }
        }
    }

    // Add outline around foreground
    for y in 0..HI_RES {
        for x in 0..HI_RES {
            let idx = (y * HI_RES + x) as usize;
            if hi_grid[idx] == 0 {
                let mut near = false;
                'check: for dy in -2..=2 {
                    for dx in -2..=2 {
                        let nx = x + dx;
                        let ny = y + dy;
                        if nx >= 0 && nx < HI_RES && ny >= 0 && ny < HI_RES {
                            if hi_grid[(ny * HI_RES + nx) as usize] == 2 {
                                near = true;
                                break 'check;
                            }
                        }
                    }
                }
                if near {
                    hi_grid[idx] = 1; // Shadow/outline
                }
            }
        }
    }

    // Downsample 2x2 to LO_RES x LO_RES
    let mut rgba = vec![0u8; (LO_RES * LO_RES * 4) as usize];
    for ly in 0..LO_RES {
        for lx in 0..LO_RES {
            let mut white_count = 0u32;
            let mut shadow_count = 0u32;

            for dy in 0..2 {
                for dx in 0..2 {
                    let hx = lx * 2 + dx;
                    let hy = ly * 2 + dy;
                    match hi_grid[(hy * HI_RES + hx) as usize] {
                        2 => white_count += 1,
                        1 => shadow_count += 1,
                        _ => {}
                    }
                }
            }

            let out_idx = ((ly * LO_RES + lx) * 4) as usize;
            if white_count > 0 {
                let alpha = ((white_count * 255 + shadow_count * 120) / 4).min(255) as u8;
                rgba[out_idx] = 255;
                rgba[out_idx + 1] = 255;
                rgba[out_idx + 2] = 255;
                rgba[out_idx + 3] = alpha;
            } else if shadow_count > 0 {
                let alpha = ((shadow_count * 160) / 4) as u8;
                rgba[out_idx] = 30;
                rgba[out_idx + 1] = 30;
                rgba[out_idx + 2] = 30;
                rgba[out_idx + 3] = alpha;
            }
        }
    }

    create_hicon_from_rgba(LO_RES, LO_RES, &rgba)
}

fn create_icons() {
    // 1. Previous Track Icon (|◄◄)
    let icon_prev = render_icon_supersampled(|x, y| {
        // Vertical bar
        let is_bar = (8..=12).contains(&x) && (9..=31).contains(&y);
        // Triangle pointing left
        let is_tri = (14..=30).contains(&x) && {
            let dy = (y - 20).abs();
            dy <= ((x - 14) * 12) / 16
        };
        is_bar || is_tri
    });
    if let Some(hicon) = icon_prev {
        ICON_PREV.store(hicon.0 as isize, Ordering::SeqCst);
    }

    // 2. Play Icon (►)
    let icon_play = render_icon_supersampled(|x, y| {
        (11..=31).contains(&x) && {
            let dy = (y - 20).abs();
            dy <= 13 - ((x - 11) * 13) / 20
        }
    });
    if let Some(hicon) = icon_play {
        ICON_PLAY.store(hicon.0 as isize, Ordering::SeqCst);
    }

    // 3. Pause Icon (❚❚)
    let icon_pause = render_icon_supersampled(|x, y| {
        let in_y = (9..=31).contains(&y);
        let in_bar1 = (10..=16).contains(&x);
        let in_bar2 = (23..=29).contains(&x);
        in_y && (in_bar1 || in_bar2)
    });
    if let Some(hicon) = icon_pause {
        ICON_PAUSE.store(hicon.0 as isize, Ordering::SeqCst);
    }

    // 4. Next Track Icon (►►|)
    let icon_next = render_icon_supersampled(|x, y| {
        // Triangle pointing right
        let is_tri = (10..=26).contains(&x) && {
            let dy = (y - 20).abs();
            dy <= 12 - ((x - 10) * 12) / 16
        };
        // Vertical bar
        let is_bar = (28..=32).contains(&x) && (9..=31).contains(&y);
        is_tri || is_bar
    });
    if let Some(hicon) = icon_next {
        ICON_NEXT.store(hicon.0 as isize, Ordering::SeqCst);
    }
}

unsafe extern "system" fn taskbar_subclass_proc(
    h_wnd: HWND,
    u_msg: u32,
    w_param: WPARAM,
    l_param: LPARAM,
    _u_id_subclass: usize,
    _dw_ref_data: usize,
) -> LRESULT {
    let taskbar_created = TASKBAR_BUTTON_CREATED_MSG.load(Ordering::SeqCst);
    if taskbar_created != 0 && u_msg == taskbar_created {
        // Explorer restarted; reset buttons flag and reinstall thumbnail toolbar
        BUTTONS_ADDED.store(false, Ordering::SeqCst);
        install_thumbnail_buttons(h_wnd);
        return LRESULT(0);
    }

    if u_msg == WM_COMMAND {
        let hiword = ((w_param.0 >> 16) & 0xffff) as u32;
        let loword = (w_param.0 & 0xffff) as u32;
        if hiword == THBN_CLICKED {
            if let Some(app) = GLOBAL_APP_HANDLE.get() {
                match loword {
                    ID_PREV => {
                        let _ = app.emit("taskbar-prev", ());
                    }
                    ID_PLAY_PAUSE => {
                        let _ = app.emit("taskbar-play-pause", ());
                    }
                    ID_NEXT => {
                        let _ = app.emit("taskbar-next", ());
                    }
                    _ => {}
                }
            }
            return LRESULT(0);
        }
    }

    DefSubclassProc(h_wnd, u_msg, w_param, l_param)
}

fn install_thumbnail_buttons(hwnd: HWND) {
    unsafe {
        let Ok(taskbar) = CoCreateInstance::<_, ITaskbarList3>(&TaskbarList, None, CLSCTX_INPROC_SERVER) else {
            return;
        };
        let _ = taskbar.HrInit();

        let icon_prev = HICON(ICON_PREV.load(Ordering::SeqCst) as *mut _);
        let is_playing = IS_PLAYING.load(Ordering::SeqCst);
        let icon_play_pause = if is_playing {
            HICON(ICON_PAUSE.load(Ordering::SeqCst) as *mut _)
        } else {
            HICON(ICON_PLAY.load(Ordering::SeqCst) as *mut _)
        };
        let icon_next = HICON(ICON_NEXT.load(Ordering::SeqCst) as *mut _) ;

        let tip_play_pause = if is_playing { "Pause" } else { "Play" };

        let buttons = [
            THUMBBUTTON {
                dwMask: THB_ICON | THB_TOOLTIP | THB_FLAGS,
                iId: ID_PREV,
                iBitmap: 0,
                hIcon: icon_prev,
                szTip: str_to_u16_buf_260("Previous Track"),
                dwFlags: THBF_ENABLED,
            },
            THUMBBUTTON {
                dwMask: THB_ICON | THB_TOOLTIP | THB_FLAGS,
                iId: ID_PLAY_PAUSE,
                iBitmap: 0,
                hIcon: icon_play_pause,
                szTip: str_to_u16_buf_260(tip_play_pause),
                dwFlags: THBF_ENABLED,
            },
            THUMBBUTTON {
                dwMask: THB_ICON | THB_TOOLTIP | THB_FLAGS,
                iId: ID_NEXT,
                iBitmap: 0,
                hIcon: icon_next,
                szTip: str_to_u16_buf_260("Next Track"),
                dwFlags: THBF_ENABLED,
            },
        ];

        let res = taskbar.ThumbBarAddButtons(hwnd, &buttons);
        if res.is_ok() {
            BUTTONS_ADDED.store(true, Ordering::SeqCst);
        } else {
            // If already added, update them
            let _ = taskbar.ThumbBarUpdateButtons(hwnd, &buttons);
        }
    }
}

pub fn init_windows_taskbar_thumbnail(window: &WebviewWindow, app_handle: AppHandle) {
    let Ok(raw_hwnd) = window.hwnd() else {
        return;
    };
    let hwnd = HWND(raw_hwnd.0 as _);
    WINDOW_HWND.store(raw_hwnd.0 as isize, Ordering::SeqCst);

    let _ = GLOBAL_APP_HANDLE.set(app_handle);

    unsafe {
        // Register TaskbarButtonCreated message for Explorer restart recovery
        let msg = RegisterWindowMessageW(w!("TaskbarButtonCreated"));
        TASKBAR_BUTTON_CREATED_MSG.store(msg, Ordering::SeqCst);

        // Subclass window to intercept WM_COMMAND with THBN_CLICKED
        let _ = SetWindowSubclass(hwnd, Some(taskbar_subclass_proc), SUBCLASS_ID, 0);

        // Generate high-resolution icons
        create_icons();

        // Install buttons on the taskbar thumbnail
        install_thumbnail_buttons(hwnd);
    }
}

pub fn update_windows_taskbar_thumbnail(is_playing: bool) {
    IS_PLAYING.store(is_playing, Ordering::SeqCst);
    let hwnd_val = WINDOW_HWND.load(Ordering::SeqCst);
    if hwnd_val == 0 {
        return;
    }
    let hwnd = HWND(hwnd_val as *mut _);

    unsafe {
        let Ok(taskbar) = CoCreateInstance::<_, ITaskbarList3>(&TaskbarList, None, CLSCTX_INPROC_SERVER) else {
            return;
        };
        let _ = taskbar.HrInit();

        let icon_h = if is_playing {
            HICON(ICON_PAUSE.load(Ordering::SeqCst) as *mut _)
        } else {
            HICON(ICON_PLAY.load(Ordering::SeqCst) as *mut _)
        };
        let tip = if is_playing { "Pause" } else { "Play" };

        let btn = THUMBBUTTON {
            dwMask: THB_ICON | THB_TOOLTIP | THB_FLAGS,
            iId: ID_PLAY_PAUSE,
            iBitmap: 0,
            hIcon: icon_h,
            szTip: str_to_u16_buf_260(tip),
            dwFlags: THBF_ENABLED,
        };

        if !BUTTONS_ADDED.load(Ordering::SeqCst) {
            install_thumbnail_buttons(hwnd);
        } else {
            let _ = taskbar.ThumbBarUpdateButtons(hwnd, &[btn]);
        }
    }
}
