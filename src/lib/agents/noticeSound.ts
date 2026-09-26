// T2.5 (sonido) — Aviso sonoro corto y discreto cuando un agente se bloquea o
// termina. Sin assets ni dependencias: dos tonos sintetizados con WebAudio.
//
// Interruptores: SOLO la preferencia global `[ui.sound] enabled` (nada por
// agente ni por evento). Además se calla con `prefers-reduced-motion: reduce`,
// la misma preferencia de accesibilidad que respetan las animaciones.
//
// No bloquea nada: el AudioContext se arma en el primer gesto del usuario, si
// el navegador lo tiene suspendido se intenta reanudar sin esperar, y cualquier
// fallo (sin audio, sin permisos, jsdom) termina en silencio sin lanzar.

import { settings } from '../stores/settings.svelte';

export type NoticeTone = 'request' | 'done';

/** Notas de cada tono (Hz y retardos en segundos). */
const TONES: Record<NoticeTone, ReadonlyArray<{ freq: number; at: number; ms: number }>> = {
  // Bloqueado: dos notas que suben, pide atención sin sobresaltar.
  request: [
    { freq: 523.25, at: 0, ms: 90 },
    { freq: 659.25, at: 0.11, ms: 110 },
  ],
  // Terminado: una nota corta y grave.
  done: [{ freq: 784, at: 0, ms: 120 }],
};

/** Volumen bajo a propósito: es un aviso, no una alarma. */
const PEAK = 0.06;

export interface SoundEnvironment {
  /** Crea (o reutiliza) el AudioContext; `null` si no hay audio disponible. */
  context: () => AudioContext | null;
  enabled: () => boolean;
  reducedMotion: () => boolean;
}

export class NoticeSound {
  #context: AudioContext | null = null;

  constructor(private readonly env: SoundEnvironment) {}

  /** ¿Suena ahora mismo? La preferencia global manda; sin audio, no. */
  get allowed(): boolean {
    return this.env.enabled() && !this.env.reducedMotion();
  }

  /**
   * Prepara el audio en el primer gesto del usuario (los navegadores no dejan
   * sonar sin interacción). Se hace en un temporizador: crear el AudioContext
   * cuesta decenas de milisegundos y no puede retrasar el gesto.
   */
  arm(): void {
    if (!this.allowed) return;
    setTimeout(() => {
      const context = this.#ensure();
      if (context && context.state === 'suspended') void context.resume().catch(() => undefined);
    }, 0);
  }

  /**
   * Reproduce el tono del aviso. Devuelve si sonó, pero nadie debería esperar
   * por él (`void noticeSound.play(...)`): la interfaz no se bloquea.
   */
  async play(tone: NoticeTone): Promise<boolean> {
    if (!this.allowed) return false;
    // El contexto SOLO se crea en `arm()` (primer gesto): crearlo aquí metía
    // decenas de milisegundos en el camino del refresco de la UI.
    const context = this.#context;
    if (!context) return false;
    try {
      if (context.state === 'suspended') {
        await Promise.race([context.resume(), new Promise((resolve) => setTimeout(resolve, 250))]);
      }
      let last = 0;
      for (const note of TONES[tone]) {
        this.#note(context, note.freq, note.at, note.ms);
        last = Math.max(last, note.at + note.ms);
      }
      // El contexto no se cierra: se reutiliza para el próximo aviso.
      return last > 0;
    } catch {
      return false;
    }
  }

  #ensure(): AudioContext | null {
    if (this.#context) return this.#context;
    try {
      this.#context = this.env.context();
    } catch {
      this.#context = null;
    }
    return this.#context;
  }

  #note(context: AudioContext, freq: number, at: number, ms: number): void {
    const start = context.currentTime + at;
    const end = start + ms / 1000;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = freq;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(PEAK, start + 0.012);
    gain.gain.linearRampToValueAtTime(0, end);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(end + 0.02);
  }
}

const motionQuery = (): boolean => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
};

const audioContext = (): AudioContext | null => {
  const globals = globalThis as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  const Ctor = globals.AudioContext ?? globals.webkitAudioContext;
  return Ctor ? new Ctor() : null;
};

/** El de la app: preferencia de la GUI + audio del navegador. */
export const noticeSound = new NoticeSound({
  context: audioContext,
  enabled: () => settings.values.sound_enabled,
  reducedMotion: motionQuery,
});
