// T3.8 — Comandos personalizados de `[[keys.command]]` de config.toml.
//
// `config_read` entrega la tabla como texto TOML bajo la ruta `keys.command`;
// aquí se parsea al mismo contrato que usa el motor de atajos:
//   { key, type: shell|pane|popup, command, width?, height? }
// (mismo formato que documenta herdr en `--default-config`).

export interface CustomCommand {
  key: string;
  type: 'shell' | 'pane' | 'popup' | string;
  command: string;
  width?: string | null;
  height?: string | null;
}

/** Separa un comentario final ` # …` fuera de comillas. */
function stripComment(value: string): string {
  let inDouble = false;
  let inSingle = false;
  let escaped = false;
  for (let i = 0; i < value.length; i += 1) {
    const c = value[i];
    if (escaped) {
      escaped = false;
    } else if (c === '\\' && inDouble) {
      escaped = true;
    } else if (c === '"' && inDouble) {
      inDouble = false;
    } else if (c === '"' && !inSingle) {
      inDouble = true;
    } else if (c === "'" && inSingle) {
      inSingle = false;
    } else if (c === "'" && !inDouble) {
      inSingle = true;
    } else if (c === '#' && !inDouble && !inSingle && (i === 0 || /\s/.test(value[i - 1]))) {
      return value.slice(0, i).trimEnd();
    }
  }
  return value.trimEnd();
}

/** Valor TOML de una línea simple (string con comillas o escalar crudo). */
function parseTomlScalar(raw: string): string | null {
  const text = stripComment(raw.trim());
  if (text.length === 0) return null;
  if (text.startsWith('"') && text.endsWith('"')) {
    try {
      return JSON.parse(text) as string;
    } catch {
      return text.slice(1, -1);
    }
  }
  if (text.startsWith("'") && text.endsWith("'")) return text.slice(1, -1);
  return text;
}

/**
 * Parsea el texto de la tabla `[[keys.command]]` (una o varias entradas).
 * Devuelve solo las entradas con `key` y `command` no vacíos.
 */
export function parseCustomCommands(raw: string | null | undefined): CustomCommand[] {
  if (!raw || raw.trim().length === 0) return [];
  const chunks = raw
    .split(/\[\[keys\.command\]\]/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0);
  const commands: CustomCommand[] = [];
  for (const chunk of chunks) {
    const fields: Record<string, string> = {};
    for (const line of chunk.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*(.+)$/);
      if (!match) continue;
      const value = parseTomlScalar(match[2]);
      if (value !== null) fields[match[1]] = value;
    }
    const key = fields.key?.trim() ?? '';
    const command = fields.command?.trim() ?? '';
    if (key.length === 0 || command.length === 0) continue;
    commands.push({
      key,
      type: fields.type?.trim() || 'shell',
      command,
      width: fields.width ?? null,
      height: fields.height ?? null,
    });
  }
  return commands;
}
