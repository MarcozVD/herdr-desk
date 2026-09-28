<!-- T3.6 — Editor de atajos: tabla de acciones (prefix/directo/navegar), captura
     de combinación, detección de conflictos y "Restablecer" con
     `herdr config reset-keys`. Escribe en [keys] de config.toml con
     `config_write` y recarga el motor de atajos en caliente. -->
<script lang="ts">
  import { configRead, configResetKeys, configWrite } from '../../lib/herdr/client';
  import { errorText } from '../../lib/herdr/errors';
  import { es } from '../../lib/i18n/es';
  import { ACTION_LABELS } from '../../lib/keys/actions';
  import { keymapOverridesFromEntries } from '../../lib/keys/config';
  import {
    DEFAULT_KEYBINDINGS,
    DEFAULT_PREFIX_KEY,
    Keymap,
    NAVIGATE_SCOPED,
    keymap,
    type KeymapOverrides,
  } from '../../lib/keys/keymap';
  import {
    bindingFromEvent,
    bindingLabel,
    chordFromEvent,
    chordId,
    parseBinding,
  } from '../../lib/keys/parse';
  import { ui } from '../../lib/stores/ui.svelte';
  import { hasBlockingError, type ConfigChange } from '../../lib/settings/spec';

  const ACTIONS = Object.keys(DEFAULT_KEYBINDINGS);
  const INDEXED_KINDS = ['tabs', 'workspaces', 'agents'] as const;
  type IndexedKind = (typeof INDEXED_KINDS)[number];

  let error = $state<string | null>(null);
  let originals = $state<Record<string, string>>({});
  let bindings = $state<Record<string, string>>({});
  let originalPrefix = $state(DEFAULT_PREFIX_KEY);
  let prefix = $state(DEFAULT_PREFIX_KEY);
  let originalIndexed = $state<Record<IndexedKind, string>>({
    tabs: '',
    workspaces: '',
    agents: '',
  });
  let indexed = $state<Record<IndexedKind, string>>({ tabs: '', workspaces: '', agents: '' });
  let capturing = $state<string | null>(null);
  let captureArmed = $state(false);
  let saving = $state(false);
  /** `[[keys.command]]` cargados: se conservan al guardar [keys] (T3.8). */
  let loadedCommands = $state<KeymapOverrides['commands']>([]);

  async function load(): Promise<void> {
    error = null;
    const outcome = await configRead();
    if (!outcome.ok || !outcome.value) {
      if (!outcome.ok && outcome.kind === 'missing') return; // sin backend F3: se ve igual
      error = !outcome.ok ? errorText(outcome.error) : null;
      originals = { ...DEFAULT_KEYBINDINGS };
      bindings = { ...DEFAULT_KEYBINDINGS };
      return;
    }
    const overrides = keymapOverridesFromEntries(outcome.value.entries);
    loadedCommands = overrides.commands ?? [];
    const effective = { ...DEFAULT_KEYBINDINGS, ...(overrides.bindings ?? {}) };
    originals = effective;
    bindings = { ...effective };
    originalPrefix = overrides.prefix ?? DEFAULT_PREFIX_KEY;
    prefix = originalPrefix;
    originalIndexed = {
      tabs: overrides.indexed?.tabs ?? '',
      workspaces: overrides.indexed?.workspaces ?? '',
      agents: overrides.indexed?.agents ?? '',
    };
    indexed = { ...originalIndexed };
    if (hasBlockingError(outcome.value.diagnostics)) {
      error = outcome.value.diagnostics.map((item) => item.message).join('\n');
    }
  }

  $effect(() => {
    void load();
  });

  const scopeOf = $derived.by((): Record<string, 'prefix' | 'direct' | 'navigate'> => {
    const map = new Keymap();
    map.load(currentOverrides());
    const out: Record<string, 'prefix' | 'direct' | 'navigate'> = {};
    for (const action of ACTIONS) out[action] = 'direct';
    for (const entry of map.entries) out[entry.action] = entry.scope;
    return out;
  });

  const conflicts = $derived.by((): Record<string, string[]> => {
    const map = new Keymap();
    map.load(currentOverrides());
    const byAction: Record<string, string[]> = {};
    for (const conflict of map.conflicts()) {
      const visible = conflict.actions.filter((action) => action in DEFAULT_KEYBINDINGS);
      if (visible.length < 2) continue;
      for (const action of visible) {
        byAction[action] = visible.filter((item) => item !== action);
      }
    }
    return byAction;
  });

  const dirtyCount = $derived(
    ACTIONS.filter((action) => bindings[action] !== originals[action]).length +
      (prefix !== originalPrefix ? 1 : 0) +
      INDEXED_KINDS.filter((kind) => indexed[kind] !== originalIndexed[kind]).length,
  );

  function currentOverrides(): KeymapOverrides {
    return { prefix, bindings, indexed, commands: loadedCommands };
  }

  function isCapturingAction(action: string): boolean {
    return capturing === action;
  }

  function startCapture(action: string): void {
    capturing = action;
    captureArmed = false;
  }

  function stopCapture(): void {
    capturing = null;
    captureArmed = false;
  }

  $effect(() => {
    const target = capturing;
    if (target === null) return;
    const onKey = (event: KeyboardEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') {
        stopCapture();
        return;
      }
      const chord = chordFromEvent(event);
      if (!chord) return;
      const navigateAction = NAVIGATE_SCOPED.has(target);
      const prefixParsed = parseBinding(prefix);
      const isPrefixKey = prefixParsed !== null && chordId(chord) === chordId(prefixParsed.chord);
      if (!navigateAction && isPrefixKey) {
        captureArmed = true;
        return;
      }
      const binding = bindingFromEvent(event, captureArmed);
      if (binding === null) return;
      if (target === '__prefix__') prefix = binding;
      else bindings = { ...bindings, [target]: binding };
      stopCapture();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  function clearBinding(action: string): void {
    bindings = { ...bindings, [action]: '' };
  }

  function scopeLabel(action: string): string {
    const scope = scopeOf[action];
    if (scope === 'prefix') return es.settings.scopePrefix;
    if (scope === 'navigate') return es.settings.scopeNavigate;
    return es.settings.scopeDirect;
  }

  function labelOf(action: string): string {
    return ACTION_LABELS[action] ?? action;
  }

  function tomlString(value: string): string {
    return JSON.stringify(value);
  }

  async function save(): Promise<void> {
    const changes: ConfigChange[] = [];
    for (const action of ACTIONS) {
      if (bindings[action] !== originals[action]) {
        changes.push({ path: `keys.${action}`, value: tomlString(bindings[action]) });
      }
    }
    if (prefix !== originalPrefix) {
      changes.push({ path: 'keys.prefix', value: tomlString(prefix) });
    }
    for (const kind of INDEXED_KINDS) {
      if (indexed[kind] !== originalIndexed[kind]) {
        changes.push({ path: `keys.indexed.${kind}`, value: tomlString(indexed[kind]) });
      }
    }
    if (changes.length === 0) return;
    saving = true;
    const outcome = await configWrite(changes);
    saving = false;
    if (!outcome.ok) {
      error = outcome.kind === 'missing' ? es.settings.backendMissing : errorText(outcome.error);
      return;
    }
    error = null;
    if (outcome.value?.rejected || outcome.value?.rolled_back) {
      error =
        outcome.value.diagnostics.map((item) => item.message).join('\n') || es.settings.rejected;
      return;
    }
    keymap.load(currentOverrides());
    originals = { ...bindings };
    originalPrefix = prefix;
    originalIndexed = { ...indexed };
    ui.notify(es.settings.keysSaved.replace('{n}', String(changes.length)), 'info');
  }

  async function resetAll(): Promise<void> {
    const accepted = await ui.confirm({
      title: es.settings.resetKeys,
      message: es.settings.resetKeysConfirm,
      confirmLabel: es.settings.resetKeys,
      danger: true,
    });
    if (!accepted) return;
    const outcome = await configResetKeys();
    if (!outcome.ok) {
      error = outcome.kind === 'missing' ? es.settings.backendMissing : errorText(outcome.error);
      return;
    }
    const stdout = outcome.value?.output.stdout ?? '';
    if (outcome.value && outcome.value.output.exit_code !== 0) {
      error = stdout.trim() || outcome.value.output.stderr.trim() || es.settings.rejected;
      return;
    }
    keymap.load();
    await load();
    ui.notify(es.settings.resetKeys, 'info');
  }

  /** Valor legible: el binding editado o "—" si está vacío. */
  function prettyBinding(action: string): string {
    const raw = bindings[action];
    if (!raw) return es.settings.noBinding;
    return bindingLabel(raw, prefix);
  }
</script>

<div class="keymap">
  {#if error}
    <p class="keymap__error" data-testid="keymap-error">{error}</p>
  {/if}
  <p class="keymap__hint">{es.settings.keysHint}</p>

  <div class="row" data-testid="keymap-prefix">
    <div class="row__info"><code>{es.settings.prefixKey}</code></div>
    <div class="row__editor">
      <code class="keymap__binding">{bindingLabel(prefix, prefix)}</code>
      <button
        type="button"
        class="btn btn--small"
        data-testid="keymap-capture-prefix"
        onclick={() => startCapture('__prefix__')}
      >
        {isCapturingAction('__prefix__') ? es.settings.capturing : es.settings.capture}
      </button>
    </div>
  </div>

  <table class="keymap__table" data-testid="keymap-table">
    <thead>
      <tr>
        <th>{es.settings.action}</th>
        <th>Ámbito</th>
        <th>{es.settings.binding}</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      {#each ACTIONS as action (action)}
        <tr
          class="keymap__row"
          data-testid="keymap-row"
          data-action={action}
          data-conflict={conflicts[action] ? 'true' : 'false'}
        >
          <td>
            {labelOf(action)}
            {#if conflicts[action]}
              <span class="tag tag--conflict" data-testid="keymap-conflict">
                {es.settings.conflict}
              </span>
            {/if}
          </td>
          <td class="keymap__scope">{scopeLabel(action)}</td>
          <td>
            <code class="keymap__binding" data-testid="keymap-binding">
              {prettyBinding(action)}
            </code>
          </td>
          <td class="keymap__actions">
            <button
              type="button"
              class="btn btn--small"
              data-testid="keymap-capture"
              onclick={() => startCapture(action)}
            >
              {isCapturingAction(action) ? es.settings.capturing : es.settings.capture}
            </button>
            <button
              type="button"
              class="btn btn--small"
              data-testid="keymap-clear"
              title={es.settings.clearBinding}
              onclick={() => clearBinding(action)}
            >
              ×
            </button>
          </td>
        </tr>
      {/each}
    </tbody>
  </table>

  <section class="keymap__indexed">
    <h4 class="keymap__title">{es.settings.indexedTitle}</h4>
    {#each INDEXED_KINDS as kind (kind)}
      <div class="row" data-testid="keymap-indexed" data-kind={kind}>
        <div class="row__info">
          <code
            >{kind === 'tabs'
              ? es.settings.indexedTabs
              : kind === 'workspaces'
                ? es.settings.indexedWorkspaces
                : es.settings.indexedAgents}</code
          >
        </div>
        <div class="row__editor">
          <input
            class="keymap__input"
            type="text"
            spellcheck="false"
            value={indexed[kind]}
            placeholder="ctrl+shift"
            oninput={(event) => (indexed = { ...indexed, [kind]: event.currentTarget.value })}
          />
        </div>
      </div>
    {/each}
  </section>

  {#if captureArmed}
    <p class="keymap__armed" data-testid="keymap-armed">{es.settings.prefixArmed}</p>
  {/if}

  <div class="keymap__foot">
    {#if dirtyCount > 0}
      <span class="keymap__dirty" data-testid="keymap-dirty">
        {es.settings.changed.replace('{n}', String(dirtyCount))}
      </span>
    {/if}
    <button type="button" class="btn" data-testid="keymap-reset" onclick={() => void resetAll()}>
      {es.settings.resetKeys}
    </button>
    <button
      type="button"
      class="btn btn--primary"
      data-testid="keymap-save"
      disabled={saving || dirtyCount === 0}
      onclick={() => void save()}
    >
      {saving ? es.settings.saving : es.settings.save}
    </button>
  </div>
</div>

<style>
  .keymap {
    display: grid;
    gap: var(--space-2);
    min-inline-size: 0;
  }

  .keymap__hint,
  .keymap__error,
  .keymap__armed {
    margin: 0;
    font-size: 11px;
    color: var(--text-dim);
  }

  .keymap__error {
    color: var(--red);
  }

  .keymap__armed {
    color: var(--yellow);
  }

  .keymap__table {
    inline-size: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }

  .keymap__table th {
    text-align: start;
    font-weight: 600;
    color: var(--text-dim);
    font-size: 11px;
    padding: 4px 6px;
  }

  .keymap__row td {
    padding: 3px 6px;
    border-block-start: 1px solid var(--control-border);
  }

  .keymap__row[data-conflict='true'] {
    background: color-mix(in oklab, var(--yellow) 8%, transparent);
  }

  .keymap__scope {
    color: var(--text-dim);
    font-size: 11px;
  }

  .keymap__binding {
    font-family: var(--font-mono);
  }

  .keymap__actions {
    text-align: end;
    white-space: nowrap;
  }

  .keymap__indexed {
    display: grid;
    gap: 4px;
    padding: var(--space-2);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-sm);
    background: var(--row-subtle-bg);
  }

  .keymap__title {
    margin: 0;
    font-size: 12px;
    color: var(--text-dim);
  }

  .keymap__input {
    inline-size: 100%;
    padding: 5px 8px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--glass-border);
    background: var(--control-bg-strong);
    color: var(--text);
    font: inherit;
    font-size: 12px;
  }

  .row {
    display: grid;
    grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
    gap: var(--space-2);
    align-items: center;
    padding: 3px 0;
  }

  .row__info {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
  }

  .row__editor {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .tag {
    padding: 0 6px;
    border-radius: 999px;
    border: 1px solid var(--glass-border);
    font-size: 10px;
    color: var(--text-dim);
  }

  .tag--conflict {
    color: var(--yellow);
    border-color: color-mix(in oklab, var(--yellow) 40%, var(--glass-border));
  }

  .keymap__foot {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    justify-content: flex-end;
    padding-block-start: var(--space-2);
    border-block-start: 1px solid var(--glass-border);
  }

  .keymap__dirty {
    margin-inline-end: auto;
    font-size: 11px;
    color: var(--yellow);
  }
</style>
