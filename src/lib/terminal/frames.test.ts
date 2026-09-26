import { describe, expect, it, vi } from 'vitest';

import {
  FRAME_HEADER_BYTES,
  FrameWriter,
  binaryStringToBase64,
  bytesToBase64,
  decodeCloseReason,
  decodeFrame,
} from './frames';

function buildFrame(options: {
  seq?: number;
  width?: number;
  height?: number;
  full?: boolean;
  closed?: boolean;
  payload?: string;
}): ArrayBuffer {
  const payload = new TextEncoder().encode(options.payload ?? '');
  const buffer = new ArrayBuffer(FRAME_HEADER_BYTES + payload.length);
  const view = new DataView(buffer);
  view.setBigUint64(0, BigInt(options.seq ?? 1), true);
  view.setUint16(8, options.width ?? 80, true);
  view.setUint16(10, options.height ?? 24, true);
  view.setUint8(12, (options.full ? 1 : 0) | (options.closed ? 2 : 0));
  new Uint8Array(buffer, FRAME_HEADER_BYTES).set(payload);
  return buffer;
}

describe('decodeFrame', () => {
  it('lee la cabecera little-endian de 16 bytes', () => {
    const frame = decodeFrame(
      buildFrame({ seq: 42, width: 100, height: 30, full: true, payload: 'hola' }),
    );
    expect(frame.seq).toBe(42);
    expect(frame.width).toBe(100);
    expect(frame.height).toBe(30);
    expect(frame.full).toBe(true);
    expect(frame.closed).toBe(false);
    expect(new TextDecoder().decode(frame.bytes)).toBe('hola');
  });

  it('acepta seq por encima de 2^32 (u64)', () => {
    const frame = decodeFrame(buildFrame({ seq: 4_294_967_296 }));
    expect(frame.seq).toBe(4_294_967_296);
  });

  it('marca closed y decodifica la razón', () => {
    const frame = decodeFrame(
      buildFrame({ closed: true, payload: 'stream_conflict: otra conexión' }),
    );
    expect(frame.closed).toBe(true);
    expect(frame.full).toBe(false);
    expect(decodeCloseReason(frame)).toBe('stream_conflict: otra conexión');
  });

  it('rechaza un buffer más corto que la cabecera', () => {
    expect(() => decodeFrame(new ArrayBuffer(15))).toThrow(RangeError);
  });
});

describe('FrameWriter', () => {
  it('coalesce una ráfaga en una sola escritura por frame de animación', () => {
    const write = vi.fn();
    const pendingFrames: Array<() => void> = [];
    const writer = new FrameWriter({
      write,
      schedule: (callback) => {
        pendingFrames.push(callback);
        return pendingFrames.length;
      },
      cancel: vi.fn(),
    });

    writer.push(new TextEncoder().encode('a'), false);
    writer.push(new TextEncoder().encode('b'), false);
    writer.push(new TextEncoder().encode('c'), false);
    expect(write).not.toHaveBeenCalled();
    expect(writer.pending).toBe(3);
    // Una ráfaga programa un solo frame de animación.
    expect(pendingFrames).toHaveLength(1);

    pendingFrames.shift()?.();
    expect(write).toHaveBeenCalledTimes(3);
    expect(write.mock.calls.map((call) => new TextDecoder().decode(call[0]))).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(writer.pending).toBe(0);
  });

  it('un frame full descarta los frames anteriores en cola', () => {
    const write = vi.fn();
    const pendingFrames: Array<() => void> = [];
    const writer = new FrameWriter({
      write,
      schedule: (callback) => {
        pendingFrames.push(callback);
        return pendingFrames.length;
      },
      cancel: vi.fn(),
    });

    writer.push(new TextEncoder().encode('viejo-1'), false);
    writer.push(new TextEncoder().encode('viejo-2'), false);
    writer.push(new TextEncoder().encode('viewport-completo'), true);
    pendingFrames.shift()?.();

    expect(write).toHaveBeenCalledTimes(1);
    expect(new TextDecoder().decode(write.mock.calls[0][0])).toBe('viewport-completo');
  });

  it('un frame full se escribe YA, sin esperar al frame de animación', () => {
    // Regresión medida en vivo: si el `full` se quedara en la cola esperando al
    // rAF, una ráfaga de `full`s la vaciaría antes de cada rAF y la terminal no
    // pintaría nada aunque los frames estén llegando.
    const write = vi.fn();
    const writer = new FrameWriter({ write, schedule: () => 7, cancel: vi.fn() });

    writer.push(new TextEncoder().encode('viewport'), true);

    expect(write).toHaveBeenCalledTimes(1);
    expect(new TextDecoder().decode(write.mock.calls[0][0])).toBe('viewport');
  });

  it('una ráfaga de frames full escribe aunque el planificador no dispare', () => {
    const write = vi.fn();
    const writer = new FrameWriter({ write, schedule: () => 7, cancel: vi.fn() });

    for (const text of ['f1', 'f2', 'f3']) {
      writer.push(new TextEncoder().encode(text), true);
    }

    // Ningún rAF: aun así se ha escrito cada viewport (el último manda).
    expect(write).toHaveBeenCalledTimes(3);
    expect(new TextDecoder().decode(write.mock.calls[2][0])).toBe('f3');
    expect(writer.pending).toBe(0);
  });

  it('dispose cancela el frame pendiente y vacía la cola', () => {
    const write = vi.fn();
    const cancel = vi.fn();
    const writer = new FrameWriter({ write, schedule: () => 7, cancel });

    writer.push(new TextEncoder().encode('x'), false);
    expect(writer.scheduled).toBe(true);
    writer.dispose();

    expect(cancel).toHaveBeenCalledWith(7);
    expect(writer.pending).toBe(0);
    expect(write).not.toHaveBeenCalled();
  });

  it('flush escribe lo pendiente sin esperar al frame de animación', () => {
    const write = vi.fn();
    const cancel = vi.fn();
    const writer = new FrameWriter({ write, schedule: () => 3, cancel });

    writer.push(new TextEncoder().encode('y'), false);
    writer.flush();

    expect(write).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledWith(3);
    expect(writer.pending).toBe(0);
  });
});

describe('codificación de bytes para terminal_input_bytes', () => {
  it('codifica bytes arbitrarios en base64', () => {
    expect(bytesToBase64(new Uint8Array([0, 1, 2, 253, 254, 255]))).toBe('AAEC/f7/');
  });

  it('convierte el string de onBinary (charCode = byte) a base64', () => {
    expect(binaryStringToBase64(String.fromCharCode(27, 91, 65))).toBe('G1tB');
  });
});
