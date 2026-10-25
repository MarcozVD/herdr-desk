// BUG 5 — Ratón del terminal.
//
// Los frames del bridge son el viewport YA renderizado, así que las secuencias
// DECSET de mouse tracking de la app (?1000/?1002/?1003/?1006) nunca llegan a
// xterm y éste jamás reporta un clic: los diálogos/approvals de los agentes
// (opencode, claude...) no respondían. Igual que con la rueda, la GUI sintetiza
// a mano el SGR de ratón (modo 1006) y lo manda por el bridge.
//
// Gating (el MISMO que la rueda en TerminalView): solo en panes con agente
// detectado (o buffer alterno). En un shell normal el ratón sigue siendo de
// xterm: selección local. Shift+arrastre fuerza la selección local (no se
// sintetiza nada) y Ctrl/Cmd+clic se reserva para abrir links (`links.ts`).

/** ¿El pane lo ocupa un agente TUI? Mismo criterio que la rueda. */
export function agentPane(
  pane: { agent?: string | null } | null | undefined,
  terminal: { buffer: { active: { type: string } } } | null | undefined,
): boolean {
  return Boolean(pane?.agent) || terminal?.buffer.active.type === 'alternate';
}

/** Código SGR del botón: 0 izquierda, 1 medio, 2 derecha. */
export function sgrButton(button: number): number {
  if (button === 1) return 1;
  if (button === 2) return 2;
  return 0;
}

/** Modificadores SGR (shift 4, alt 8, ctrl 16). */
export function sgrModifiers(event: {
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
}): number {
  return (event.shiftKey ? 4 : 0) + (event.altKey ? 8 : 0) + (event.ctrlKey ? 16 : 0);
}

/** Celda 1-based del puntero sobre la rejilla de xterm. */
export function cellAt(
  rect: { left: number; top: number; width: number; height: number },
  cols: number,
  rows: number,
  clientX: number,
  clientY: number,
): { col: number; row: number } {
  const cellW = rect.width / Math.max(1, cols);
  const cellH = rect.height / Math.max(1, rows);
  const col = Math.min(cols, Math.max(1, Math.floor((clientX - rect.left) / cellW) + 1));
  const row = Math.min(rows, Math.max(1, Math.floor((clientY - rect.top) / cellH) + 1));
  return { col, row };
}

export interface SgrMouseEvent {
  /** Botón SGR (0/1/2), ver `sgrButton`. */
  button: number;
  col: number;
  row: number;
  /** Arrastre con botón pulsado: +32 en el código. */
  motion?: boolean;
  /** Suelta (`m` mayúscula/minúscula según modo): `m` = release. */
  release?: boolean;
  modifiers?: number;
}

/** Secuencia SGR 1006 de un evento de ratón. */
export function mouseSequence(options: SgrMouseEvent): string {
  const code = options.button + (options.motion ? 32 : 0) + (options.modifiers ?? 0);
  const final = options.release ? 'm' : 'M';
  return `\x1b[<${code};${options.col};${options.row}${final}`;
}

/** ¿El evento pide la selección local (shift) y no se reenvía a la app? */
export function wantsLocalSelection(event: { shiftKey: boolean }): boolean {
  return event.shiftKey;
}

/** ¿El evento es el clic de link (Ctrl/Cmd) y no se reenvía a la app? */
export function isLinkClick(event: { ctrlKey: boolean; metaKey: boolean }): boolean {
  return event.ctrlKey || event.metaKey;
}
