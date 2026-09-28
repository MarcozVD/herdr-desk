// T3.6 — Atajos efectivos de `config.toml` ([keys]) → overrides del motor.

import type { ConfigEntry } from '../settings/spec';
import { parseTomlValue } from '../settings/spec';
import { parseCustomCommands, type CustomCommand } from './customCommands';
import type { KeymapOverrides } from './keymap';

const PREFIX = 'keys.';

/**
 * Traduce las entradas de `config_read` (claves `keys.*`) a `KeymapOverrides`:
 * `keys.prefix`, `keys.<accion>` y `keys.indexed.{tabs,workspaces,agents}`.
 * Las claves de `[[keys.command]]` (`keys.command.key`…) no son atajos y se
 * ignoran. Un valor que no sea string TOML tampoco entra.
 */
export function keymapOverridesFromEntries(entries: readonly ConfigEntry[]): KeymapOverrides {
  const byPath = new Map(entries.map((entry) => [entry.path, entry.value]));
  const readString = (path: string): string | undefined => {
    const raw = byPath.get(path);
    if (raw === undefined) return undefined;
    const parsed = parseTomlValue(raw);
    return typeof parsed === 'string' ? parsed : undefined;
  };

  const bindings: Record<string, string> = {};
  for (const entry of entries) {
    if (!entry.path.startsWith(PREFIX)) continue;
    const rest = entry.path.slice(PREFIX.length);
    if (rest === 'prefix' || rest.startsWith('indexed.')) continue;
    if (rest.includes('.')) continue; // keys.command.* (tabla de comandos)
    const parsed = parseTomlValue(entry.value);
    if (typeof parsed === 'string') bindings[rest] = parsed;
  }

  const indexed: KeymapOverrides['indexed'] = {};
  const tabs = readString('keys.indexed.tabs');
  const workspaces = readString('keys.indexed.workspaces');
  const agents = readString('keys.indexed.agents');
  if (tabs !== undefined) indexed.tabs = tabs;
  if (workspaces !== undefined) indexed.workspaces = workspaces;
  if (agents !== undefined) indexed.agents = agents;

  const overrides: KeymapOverrides = { bindings };

  // T3.8 — la tabla [[keys.command]] llega como texto TOML crudo.
  const commandEntry = entries.find((entry) => entry.path === 'keys.command');
  const commands: CustomCommand[] = parseCustomCommands(commandEntry?.value);
  if (commands.length > 0) overrides.commands = commands;

  const prefix = readString('keys.prefix');
  if (prefix !== undefined) overrides.prefix = prefix;
  if (Object.keys(indexed).length > 0) overrides.indexed = indexed;
  return overrides;
}
