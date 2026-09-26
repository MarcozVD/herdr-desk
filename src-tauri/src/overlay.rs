use serde::Serialize;
use tauri::{AppHandle, Manager};

use herdr_core::error::ApiError;

const OVERLAY_SIZE: u32 = 32;
const OVERLAY_RADIUS: f32 = 14.5;

/// Bitmap 3x5 para digitos 0-9 (1 = pixel encendido).
const DIGITS: [[u8; 15]; 10] = [
    [1, 1, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 1, 1], // 0
    [0, 1, 0, 1, 1, 0, 0, 1, 0, 0, 1, 0, 1, 1, 1], // 1
    [1, 1, 1, 0, 0, 1, 1, 1, 1, 1, 0, 0, 1, 1, 1], // 2
    [1, 1, 1, 0, 0, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1], // 3
    [1, 0, 1, 1, 0, 1, 1, 1, 1, 0, 0, 1, 0, 0, 1], // 4
    [1, 1, 1, 1, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 1], // 5
    [1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 0, 1, 1, 1, 1], // 6
    [1, 1, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], // 7
    [1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1], // 8
    [1, 1, 1, 1, 0, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1], // 9
];

/// Genera el overlay RGBA 32x32: disco rojo con el conteo en blanco.
pub fn overlay_rgba(count: u32) -> Vec<u8> {
    let size = OVERLAY_SIZE;
    let mut rgba = vec![0u8; (size * size * 4) as usize];
    let center = (size as f32 - 1.0) / 2.0;
    let radius = OVERLAY_RADIUS;

    let shown = count.min(99);
    let text = shown.to_string();
    let scale = 2u32;
    let glyph_w = 3 * scale;
    let glyph_gap = scale;
    let text_w = (text.len() as u32) * glyph_w + (text.len() as u32 - 1) * glyph_gap;
    let text_h = 5 * scale;
    let text_x = (size.saturating_sub(text_w)) / 2;
    let text_y = (size.saturating_sub(text_h)) / 2;

    for y in 0..size {
        for x in 0..size {
            let dx = x as f32 - center;
            let dy = y as f32 - center;
            let idx = ((y * size + x) * 4) as usize;
            if dx * dx + dy * dy <= radius * radius {
                // disco rojo con borde ligeramente mas claro
                let edge = dx * dx + dy * dy > (radius - 1.5) * (radius - 1.5);
                rgba[idx] = if edge { 255 } else { 220 };
                rgba[idx + 1] = 30;
                rgba[idx + 2] = 40;
                rgba[idx + 3] = 255;
            }
        }
    }

    // digitos blancos encima
    let mut cursor = text_x;
    for ch in text.chars() {
        let digit = ch.to_digit(10).unwrap_or(0) as usize;
        let glyph = &DIGITS[digit];
        for gy in 0..5u32 {
            for gx in 0..3u32 {
                if glyph[(gy * 3 + gx) as usize] == 1 {
                    for sy in 0..scale {
                        for sx in 0..scale {
                            let px = cursor + gx * scale + sx;
                            let py = text_y + gy * scale + sy;
                            let idx = ((py * size + px) * 4) as usize;
                            rgba[idx] = 255;
                            rgba[idx + 1] = 255;
                            rgba[idx + 2] = 255;
                            rgba[idx + 3] = 255;
                        }
                    }
                }
            }
        }
        cursor += glyph_w + glyph_gap;
    }
    rgba
}

#[derive(Serialize, Clone, Debug)]
pub struct OverlayApplied {
    pub count: Option<u32>,
    pub applied: bool,
}

/// Pone (o quita con None) el overlay del conteo de agentes bloqueados en la
/// barra de tareas. Solo Windows: en otras plataformas es no-op.
#[tauri::command]
pub async fn taskbar_overlay(
    app: AppHandle,
    count: Option<u32>,
) -> Result<OverlayApplied, ApiError> {
    #[cfg(windows)]
    {
        let image = count.map(overlay_rgba);
        let image =
            image.map(|rgba| tauri::image::Image::new_owned(rgba, OVERLAY_SIZE, OVERLAY_SIZE));
        let window = app.get_webview_window("main").ok_or_else(|| ApiError {
            code: "not_found".to_string(),
            message: "ventana principal no encontrada".to_string(),
        })?;
        window.set_overlay_icon(image).map_err(|e| ApiError {
            code: "cli_failed".to_string(),
            message: format!("no se pudo aplicar el overlay: {e}"),
        })?;
        Ok(OverlayApplied {
            count,
            applied: true,
        })
    }
    #[cfg(not(windows))]
    {
        let _ = (app, count);
        Ok(OverlayApplied {
            count: None,
            applied: false,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn overlay_image_has_right_size_and_colors() {
        let rgba = overlay_rgba(0);
        assert_eq!(rgba.len(), (OVERLAY_SIZE * OVERLAY_SIZE * 4) as usize);
        // centro del disco: rojo
        let center = ((OVERLAY_SIZE / 2 * OVERLAY_SIZE + OVERLAY_SIZE / 2) * 4) as usize;
        assert!(rgba[center] > 150 && rgba[center + 1] < 80);
        // esquina: transparente
        assert_eq!(rgba[0], 0);
        assert_eq!(rgba[3], 0);
    }

    #[test]
    fn overlay_digit_pixels_are_white() {
        let rgba = overlay_rgba(1);
        // el "1" esta centrado: buscamos al menos un pixel blanco puro
        let whites = rgba
            .chunks(4)
            .filter(|c| c[0] == 255 && c[1] == 255 && c[2] == 255 && c[3] == 255)
            .count();
        assert!(whites > 0, "el digito debe pintarse en blanco");
        let _ = rgba.len();
    }

    #[test]
    fn overlay_caps_at_99() {
        // no debe paniquear con conteos grandes
        let rgba = overlay_rgba(123456);
        assert_eq!(rgba.len(), (OVERLAY_SIZE * OVERLAY_SIZE * 4) as usize);
    }
}
