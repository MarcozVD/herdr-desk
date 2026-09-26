// @vitest-environment jsdom
// T2.5 (sonido) — Tonos de aviso: la preferencia global es el único interruptor,
// se calla con «reduce motion», no bloquea y nunca lanza.

import { describe, expect, it, vi } from 'vitest';

import { NoticeSound, type NoticeTone } from './noticeSound';

interface FakeOscillator {
  type: string;
  frequency: { value: number };
  started: number;
}

class FakeParam {
  value = 0;
  setValueAtTime(): void {}
  linearRampToValueAtTime(): void {}
}

class FakeGain {
  gain = new FakeParam();
  connected = false;
  connect(): void {
    this.connected = true;
  }
}

class FakeContext {
  state: AudioContextState = 'running';
  currentTime = 0;
  destination = {};
  oscillators: FakeOscillator[] = [];
  gains: FakeGain[] = [];
  resume = vi.fn(async () => undefined);

  createOscillator(): {
    type: string;
    frequency: FakeParam;
    connect: () => void;
    start: () => void;
    stop: () => void;
  } {
    const record: FakeOscillator = { type: '', frequency: { value: 0 }, started: 0 };
    this.oscillators.push(record);
    const frequency = new FakeParam();
    Object.defineProperty(frequency, 'value', {
      get: () => record.frequency.value,
      set: (value: number) => {
        record.frequency.value = value;
      },
    });
    return {
      get type() {
        return record.type;
      },
      set type(value: string) {
        record.type = value;
      },
      frequency,
      connect: () => undefined,
      start: () => {
        record.started += 1;
      },
      stop: () => undefined,
    };
  }

  createGain(): FakeGain {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }
}

function soundWith(options: {
  enabled?: boolean;
  reduced?: boolean;
  context?: FakeContext | null;
}): { sound: NoticeSound; context: FakeContext } {
  const context = options.context ?? new FakeContext();
  const sound = new NoticeSound({
    context: () => context as unknown as AudioContext,
    enabled: () => options.enabled ?? true,
    reducedMotion: () => options.reduced ?? false,
  });
  return { sound, context };
}

/** Igual que `soundWith` pero con la opción de no tener audio. */
function soundWithoutAudio(): NoticeSound {
  return new NoticeSound({
    context: () => null,
    enabled: () => true,
    reducedMotion: () => false,
  });
}

describe('interruptores del sonido', () => {
  it('con la preferencia apagada no suena nada', async () => {
    const { sound, context } = soundWith({ enabled: false });
    expect(sound.allowed).toBe(false);
    expect(await sound.play('request')).toBe(false);
    expect(context.oscillators).toHaveLength(0);
  });

  it('con «reduce motion» tampoco (misma preferencia que las animaciones)', async () => {
    const { sound, context } = soundWith({ reduced: true });
    expect(sound.allowed).toBe(false);
    expect(await sound.play('done')).toBe(false);
    expect(context.oscillators).toHaveLength(0);
  });

  it('sin audio disponible no lanza y no suena', async () => {
    const sound = soundWithoutAudio();
    expect(sound.allowed).toBe(true);
    expect(await sound.play('request')).toBe(false);
  });
});

describe('tonos', () => {
  it('sin gesto previo no suena (el contexto se crea al armar)', async () => {
    const { sound } = soundWith({});
    expect(await sound.play('request')).toBe(false);
  });

  it('bloqueado suena en dos notas y terminado en una', async () => {
    const { sound, context } = soundWith({});
    sound.arm();
    await vi.waitFor(() => expect(sound.allowed).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 1));
    expect(await sound.play('request')).toBe(true);
    expect(context.oscillators).toHaveLength(2);
    // Suben: la segunda nota es más aguda que la primera.
    expect(context.oscillators[1]!.frequency.value).toBeGreaterThan(
      context.oscillators[0]!.frequency.value,
    );
    expect(context.oscillators.every((oscillator) => oscillator.started === 1)).toBe(true);

    const done = soundWith({});
    done.sound.arm();
    await new Promise((resolve) => setTimeout(resolve, 1));
    expect(await done.sound.play('done')).toBe(true);
    expect(done.context.oscillators).toHaveLength(1);
  });

  it('reanuda un contexto suspendido sin bloquearse', async () => {
    const context = new FakeContext();
    context.state = 'suspended';
    const { sound } = soundWith({ context });
    sound.arm();
    await new Promise((resolve) => setTimeout(resolve, 1));
    expect(await sound.play('done')).toBe(true);
    expect(context.resume).toHaveBeenCalled();
  });

  it('si reanudar falla, se queda en silencio sin lanzar', async () => {
    const context = new FakeContext();
    context.state = 'suspended';
    context.resume = vi.fn(async () => {
      throw new Error('sin permisos');
    });
    const { sound } = soundWith({ context });
    sound.arm();
    await new Promise((resolve) => setTimeout(resolve, 1));
    await expect(sound.play('request')).resolves.toBe(false);
  });

  it('armar no suena: solo prepara el audio para el primer gesto', async () => {
    const { sound, context } = soundWith({});
    sound.arm();
    await new Promise((resolve) => setTimeout(resolve, 1));
    expect(context.oscillators).toHaveLength(0);
  });
});

describe('preferencia real de los ajustes', () => {
  it('el tono por defecto del módulo respeta `sound_enabled`', async () => {
    const { noticeSound } = await import('./noticeSound');
    const { settings } = await import('../stores/settings.svelte');
    settings.values.sound_enabled = false;
    await expect(noticeSound.play('request')).resolves.toBe(false);
    settings.values.sound_enabled = true;
    // En jsdom no hay AudioContext y nadie ha armado el audio: sigue siendo un
    // «no suena» silencioso (y sin crear nada en el camino del aviso).
    await expect(noticeSound.play('done')).resolves.toBe(false);
  });
});

describe('tipos', () => {
  it('solo hay dos tonos', () => {
    const tones: NoticeTone[] = ['request', 'done'];
    expect(tones).toHaveLength(2);
  });
});
