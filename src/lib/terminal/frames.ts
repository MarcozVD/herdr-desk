// Frame binario de terminal (§5 del plan):
//   [0..8) seq u64 · [8..10) width u16 · [10..12) height u16
//   [12] flags u8 (bit0 = full, bit1 = closed) · [13..16) reservado
//   [16..) bytes ANSI (o la razón UTF-8 si viene closed)
// Los frames NO entran en la reactividad de Svelte (§4/§7): se escriben directo
// en xterm a través de FrameWriter.

export const FRAME_HEADER_BYTES = 16;
export const FLAG_FULL = 1;
export const FLAG_CLOSED = 2;

export interface DecodedFrame {
  seq: number;
  width: number;
  height: number;
  full: boolean;
  closed: boolean;
  bytes: Uint8Array;
}

export function decodeFrame(buffer: ArrayBuffer): DecodedFrame {
  if (buffer.byteLength < FRAME_HEADER_BYTES) {
    throw new RangeError(
      `frame demasiado corto: ${buffer.byteLength} bytes (mínimo ${FRAME_HEADER_BYTES})`,
    );
  }
  const view = new DataView(buffer);
  const flags = view.getUint8(12);
  return {
    seq: Number(view.getBigUint64(0, true)),
    width: view.getUint16(8, true),
    height: view.getUint16(10, true),
    full: (flags & FLAG_FULL) === FLAG_FULL,
    closed: (flags & FLAG_CLOSED) === FLAG_CLOSED,
    bytes: new Uint8Array(buffer, FRAME_HEADER_BYTES),
  };
}

/** Razón legible de un frame `closed` (payload = UTF-8). */
export function decodeCloseReason(frame: DecodedFrame): string {
  return new TextDecoder().decode(frame.bytes).trim();
}

/** Codifica bytes a base64 para `terminal_input_bytes`. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

/** xterm entrega los datos no-UTF8 en `onBinary` como chars con código de byte. */
export function binaryStringToBase64(data: string): string {
  const bytes = new Uint8Array(data.length);
  for (let index = 0; index < data.length; index += 1) {
    bytes[index] = data.charCodeAt(index) & 0xff;
  }
  return bytesToBase64(bytes);
}

export type FrameScheduler = (callback: () => void) => number;
export type FrameCanceller = (handle: number) => void;

const defaultSchedule: FrameScheduler = (callback) => {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(callback);
  return setTimeout(callback, 16) as unknown as number;
};

const defaultCancel: FrameCanceller = (handle) => {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle);
  else clearTimeout(handle);
};

export interface FrameWriterOptions {
  write: (bytes: Uint8Array) => void;
  schedule?: FrameScheduler;
  cancel?: FrameCanceller;
}

/**
 * Cola de frames con escritura por `requestAnimationFrame`. Un frame `full`
 * descarta los frames anteriores en cola (herdr ya manda el viewport completo).
 */
export class FrameWriter {
  readonly #write: (bytes: Uint8Array) => void;
  readonly #schedule: FrameScheduler;
  readonly #cancel: FrameCanceller;
  #queue: Uint8Array[] = [];
  #handle: number | null = null;

  constructor(options: FrameWriterOptions) {
    this.#write = options.write;
    this.#schedule = options.schedule ?? defaultSchedule;
    this.#cancel = options.cancel ?? defaultCancel;
  }

  get pending(): number {
    return this.#queue.length;
  }

  get scheduled(): boolean {
    return this.#handle !== null;
  }

  /**
   * Un frame `full` trae el viewport completo: sustituye a los deltas que
   * estuvieran en cola Y SE ESCRIBE YA, sin esperar al rAF. Si se dejara en la
   * cola, una ráfaga de `full`s (un ciclo de resize, un respawn que reenvía el
   * viewport) la vaciaría antes de cada rAF y la terminal no pintaría nada
   * mientras siguiera llegando el siguiente `full`.
   */
  push(bytes: Uint8Array, full: boolean): void {
    if (full) {
      this.#queue.length = 0;
      this.#queue.push(bytes);
      this.flush();
      return;
    }
    this.#queue.push(bytes);
    this.#scheduleFlush();
  }

  /** Escribe ya lo que haya en cola (se usa al cerrar la terminal). */
  flush(): void {
    if (this.#handle !== null) {
      this.#cancel(this.#handle);
      this.#handle = null;
    }
    this.#drain();
  }

  dispose(): void {
    if (this.#handle !== null) {
      this.#cancel(this.#handle);
      this.#handle = null;
    }
    this.#queue.length = 0;
  }

  #scheduleFlush(): void {
    if (this.#handle !== null) return; // ya hay un rAF en vuelo: se coalescen
    this.#handle = this.#schedule(() => {
      this.#handle = null;
      this.#drain();
    });
  }

  #drain(): void {
    if (this.#queue.length === 0) return;
    const queued = this.#queue;
    this.#queue = [];
    for (const bytes of queued) this.#write(bytes);
  }
}
