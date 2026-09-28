<!-- T3.5 — Formulario de configuración: secciones y claves generadas desde
     `herdr --default-config` (command `config_default`, copia estática de
     `settings.gen.ts` como respaldo), valores efectivos de `config_read` y
     escritura con `config_write` (backup + check + reload). Abajo del todo, la
     sección GUI que vive en %APPDATA%\herdr-desk\settings.json. -->
<script lang="ts">
  import { configDefault, configRead, configWrite } from '../../lib/herdr/client';
  import { errorText } from '../../lib/herdr/errors';
  import { es } from '../../lib/i18n/es';
  import {
    dedupeSections,
    displayValue,
    entriesByPath,
    isReadOnlySection,
    payloadToSections,
    sectionKeyPath,
    serializeValue,
    type ConfigChange,
    type ConfigDiagnostic,
    type ConfigRead,
  } from '../../lib/settings/spec';
  import {
    SETTINGS_SECTIONS,
    type SettingsKeySpec,
    type SettingsSectionSpec,
  } from '../../lib/settings/settings.gen';
  import { settings, type BackdropMode, type GlassMode } from '../../lib/stores/settings.svelte';
  import { ui } from '../../lib/stores/ui.svelte';
  import { THEME_NAMES } from '../../lib/theme/themes';
  import Dialog from '../../lib/ui/Dialog.svelte';
  import KeymapEditor from './KeymapEditor.svelte';

  /** Pestaña activa del formulario: configuración de herdr o atajos (T3.6). */
  let view = $state<'config' | 'keys'>('config');
  let error = $state<string | null>(null);
  let sections = $state<SettingsSectionSpec[]>(dedupeSections(SETTINGS_SECTIONS));
  let read = $state<ConfigRead | null>(null);
  let query = $state('');
  /** Ediciones pendientes: path → valor TOML (`null` = quitar la clave). */
  let draft = $state<Record<string, string | null>>({});
  let saving = $state(false);
  let diagnostics = $state<ConfigDiagnostic[]>([]);
  let notice = $state<string | null>(null);

  const entries = $derived(read ? entriesByPath(read.entries) : new Map());
  const knownPaths = $derived(
    new Set(sections.flatMap((s) => s.keys.map((k) => sectionKeyPath(s.path, k.key)))),
  );
  const unknownEntries = $derived(
    (read?.entries ?? []).filter((entry) => !knownPaths.has(entry.path)),
  );
  const dirtyCount = $derived(Object.keys(draft).length);

  const needle = $derived(query.trim().toLowerCase());
  const filteredSections = $derived(
    sections
      .map((section) => ({
        ...section,
        keys: section.keys.filter((key) => matches(section.path, key, needle)),
      }))
      .filter((section) => section.keys.length > 0),
  );

  function matches(sectionPath: string, key: SettingsKeySpec, term: string): boolean {
    if (term.length === 0) return true;
    const path = sectionKeyPath(sectionPath, key.key).toLowerCase();
    return path.includes(term) || key.description.toLowerCase().includes(term);
  }

  async function load(): Promise<void> {
    error = null;
    diagnostics = [];
    notice = null;
    draft = {};
    const [def, rd] = await Promise.all([configDefault(), configRead()]);
    if (def.ok && def.value) {
      sections = dedupeSections(payloadToSections(def.value));
    } else {
      sections = dedupeSections(SETTINGS_SECTIONS);
      if (!def.ok && def.kind === 'error') error = errorText(def.error);
    }
    if (rd.ok && rd.value) {
      read = rd.value;
      diagnostics = rd.value.diagnostics;
    } else {
      read = null;
      if (!rd.ok && rd.kind === 'missing') error = es.settings.backendMissing;
      else if (!rd.ok) error = errorText(rd.error);
    }
  }

  $effect(() => {
    if (ui.settingsOpen) void load();
  });

  function originalFor(path: string, fallback: string | null): string | null {
    return entries.get(path)?.value ?? fallback;
  }

  function currentRaw(path: string, fallback: string | null): string | null {
    return path in draft ? draft[path] : originalFor(path, fallback);
  }

  function inputValue(sectionPath: string, key: SettingsKeySpec): string {
    const path = sectionKeyPath(sectionPath, key.key);
    return displayValue(key.type, currentRaw(path, key.value));
  }

  function isDirty(sectionPath: string, key: SettingsKeySpec): boolean {
    const path = sectionKeyPath(sectionPath, key.key);
    return path in draft;
  }

  function setEdit(sectionPath: string, key: SettingsKeySpec, input: string): void {
    const path = sectionKeyPath(sectionPath, key.key);
    const next = serializeValue(key.type, input);
    if (next === originalFor(path, key.value)) delete draft[path];
    else draft[path] = next;
  }

  function resetKey(sectionPath: string, key: SettingsKeySpec): void {
    const path = sectionKeyPath(sectionPath, key.key);
    if (entries.get(path)?.origin === 'file') draft[path] = null;
    else delete draft[path];
  }

  function setRaw(path: string, input: string): void {
    const original = entries.get(path)?.value ?? null;
    if (input === original) delete draft[path];
    else draft[path] = input.length === 0 ? null : input;
  }

  /** Valor visible de una clave desconocida (null en el borrador = quitarla). */
  function unknownValue(path: string, fallback: string): string {
    if (!(path in draft)) return fallback;
    return draft[path] ?? '';
  }

  async function save(): Promise<void> {
    const changes: ConfigChange[] = Object.entries(draft).map(([path, value]) => ({
      path,
      value,
    }));
    if (changes.length === 0) return;
    saving = true;
    notice = null;
    const outcome = await configWrite(changes);
    saving = false;
    if (!outcome.ok) {
      error = outcome.kind === 'missing' ? es.settings.backendMissing : errorText(outcome.error);
      return;
    }
    const result = outcome.value;
    error = null;
    diagnostics = result?.diagnostics ?? [];
    if (result?.rejected) {
      notice = es.settings.rejected;
      return;
    }
    if (result?.rolled_back) {
      notice = es.settings.rolledBack;
      return;
    }
    // Refresca la config efectiva: los valores escritos mandan en la UI ya.
    const rd = await configRead();
    if (rd.ok && rd.value) {
      read = rd.value;
      diagnostics = [...diagnostics, ...rd.value.diagnostics];
      settings.applyConfigEntries(rd.value.entries);
      settings.applyTheme();
    }
    draft = {};
    const reload = result?.reload;
    notice =
      reload && reload.skipped
        ? es.settings.reloadSkipped
        : reload && reload.status === 'failed'
          ? es.settings.reloadFailed.replace('{status}', reload.status)
          : null;
    ui.notify(es.settings.saved.replace('{n}', String(result?.applied ?? changes.length)), 'info');
  }
</script>

{#if ui.settingsOpen}
  <Dialog
    title={es.settings.title}
    onclose={() => ui.closeSettings()}
    width="46rem"
    testId="settings-dialog"
  >
    <nav class="settings__tabs" data-testid="settings-tabs">
      <button
        type="button"
        class="btn btn--small"
        data-testid="settings-tab-config"
        aria-pressed={view === 'config'}
        class:tab--active={view === 'config'}
        onclick={() => (view = 'config')}
      >
        {es.settings.tabConfig}
      </button>
      <button
        type="button"
        class="btn btn--small"
        data-testid="settings-tab-keys"
        aria-pressed={view === 'keys'}
        class:tab--active={view === 'keys'}
        onclick={() => (view = 'keys')}
      >
        {es.settings.tabKeys}
      </button>
    </nav>

    {#if view === 'keys'}
      <KeymapEditor />
    {:else}
      <div class="settings">
        <input
          class="settings__search"
          type="search"
          placeholder={es.settings.search}
          bind:value={query}
          data-testid="settings-search"
        />

        <section class="group" data-testid="settings-theme">
          <h3 class="group__title">{es.settings.themeTitle}</h3>
          <p class="group__doc">{es.settings.themeHint}</p>
          <div class="row">
            <div class="row__info"><code>{es.settings.themeName}</code></div>
            <div class="row__editor">
              <select
                class="row__input"
                data-testid="settings-theme-name"
                value={settings.values.theme_name}
                onchange={(event) => settings.set('theme_name', event.currentTarget.value)}
              >
                {#each THEME_NAMES as name (name)}
                  <option value={name}>{name}</option>
                {/each}
              </select>
            </div>
          </div>
          <div class="row">
            <div class="row__info"><code>{es.settings.themeAuto}</code></div>
            <div class="row__editor">
              <input
                type="checkbox"
                data-testid="settings-theme-auto"
                checked={settings.values.theme_auto_switch}
                onchange={(event) => settings.set('theme_auto_switch', event.currentTarget.checked)}
              />
            </div>
          </div>
          {#if settings.values.theme_auto_switch}
            <div class="row">
              <div class="row__info"><code>{es.settings.themeDark}</code></div>
              <div class="row__editor">
                <select
                  class="row__input"
                  data-testid="settings-theme-dark"
                  value={settings.values.theme_dark_name}
                  onchange={(event) => settings.set('theme_dark_name', event.currentTarget.value)}
                >
                  {#each THEME_NAMES as name (name)}
                    <option value={name}>{name}</option>
                  {/each}
                </select>
              </div>
            </div>
            <div class="row">
              <div class="row__info"><code>{es.settings.themeLight}</code></div>
              <div class="row__editor">
                <select
                  class="row__input"
                  data-testid="settings-theme-light"
                  value={settings.values.theme_light_name}
                  onchange={(event) => settings.set('theme_light_name', event.currentTarget.value)}
                >
                  {#each THEME_NAMES as name (name)}
                    <option value={name}>{name}</option>
                  {/each}
                </select>
              </div>
            </div>
          {/if}
          {#if Object.keys(settings.values.theme_custom).length > 0}
            <p class="group__doc" data-testid="settings-theme-custom">
              {es.settings.themeCustom.replace(
                '{n}',
                String(Object.keys(settings.values.theme_custom).length),
              )}
            </p>
          {/if}
        </section>

        <section class="group" data-testid="settings-gui">
          <h3 class="group__title">{es.settings.gui}</h3>
          <p class="group__doc">{es.settings.guiHint}</p>
          <div class="row">
            <div class="row__info"><code>{es.settings.glass}</code></div>
            <div class="row__editor">
              <select
                class="row__input"
                data-testid="settings-glass"
                value={settings.values.glass}
                onchange={(event) => settings.set('glass', event.currentTarget.value as GlassMode)}
              >
                <option value="auto">{es.settings.glassAuto}</option>
                <option value="full">{es.settings.glassFull}</option>
                <option value="off">{es.settings.glassOff}</option>
              </select>
            </div>
          </div>
          <div class="row">
            <div class="row__info">
              <code>{es.settings.backdrop}</code>
              <p class="row__doc">{es.settings.backdropHint}</p>
            </div>
            <div class="row__editor">
              <select
                class="row__input"
                data-testid="settings-backdrop"
                value={settings.values.backdrop}
                onchange={(event) =>
                  settings.set('backdrop', event.currentTarget.value as BackdropMode)}
              >
                <option value="mica">{es.settings.backdropMica}</option>
                <option value="acrylic">{es.settings.backdropAcrylic}</option>
              </select>
            </div>
          </div>
          <div class="row">
            <div class="row__info">
              <code>{es.settings.glassLevel}</code>
              <p class="row__doc">{es.settings.glassLevelHint}</p>
            </div>
            <div class="row__editor glass-level">
              <input
                type="range"
                min="1"
                max="100"
                step="1"
                data-testid="settings-glass-level"
                aria-label={es.settings.glassLevel}
                value={settings.values.glass_level}
                oninput={(event) => settings.set('glass_level', Number(event.currentTarget.value))}
              />
              <output data-testid="settings-glass-level-value">{settings.values.glass_level}</output
              >
            </div>
          </div>
          <div class="row">
            <div class="row__info">
              <code>{es.settings.syncFocus}</code>
              <p class="row__doc">{es.settings.syncFocusHint}</p>
            </div>
            <div class="row__editor">
              <input
                type="checkbox"
                data-testid="settings-sync-focus"
                checked={settings.values.sync_focus_with_tui}
                onchange={(event) =>
                  settings.set('sync_focus_with_tui', event.currentTarget.checked)}
              />
            </div>
          </div>
          <div class="row">
            <div class="row__info"><code>{es.settings.webgl}</code></div>
            <div class="row__editor">
              <input
                type="checkbox"
                data-testid="settings-webgl"
                checked={settings.values.webgl}
                onchange={(event) => settings.set('webgl', event.currentTarget.checked)}
              />
            </div>
          </div>
          <div class="row">
            <div class="row__info"><code>{es.settings.webglMax}</code></div>
            <div class="row__editor">
              <input
                class="row__input row__input--num"
                type="number"
                min="0"
                max="32"
                data-testid="settings-webgl-max"
                value={settings.values.webgl_max_panes}
                oninput={(event) =>
                  settings.set('webgl_max_panes', Number(event.currentTarget.value))}
              />
            </div>
          </div>
          <div class="row">
            <div class="row__info"><code>{es.settings.terminalLru}</code></div>
            <div class="row__editor">
              <input
                class="row__input row__input--num"
                type="number"
                min="1"
                max="64"
                data-testid="settings-lru"
                value={settings.values.terminal_lru_max}
                oninput={(event) =>
                  settings.set('terminal_lru_max', Number(event.currentTarget.value))}
              />
            </div>
          </div>
          <div class="row">
            <div class="row__info"><code>{es.settings.bridgeGrace}</code></div>
            <div class="row__editor">
              <input
                class="row__input row__input--num"
                type="number"
                min="0"
                step="500"
                data-testid="settings-bridge-grace"
                value={settings.values.bridge_grace_ms}
                oninput={(event) =>
                  settings.set('bridge_grace_ms', Number(event.currentTarget.value))}
              />
            </div>
          </div>
          <div class="row">
            <div class="row__info"><code>{es.settings.bridgeReopen}</code></div>
            <div class="row__editor">
              <input
                class="row__input row__input--num"
                type="number"
                min="500"
                step="500"
                data-testid="settings-bridge-reopen"
                value={settings.values.bridge_reopen_grace_ms}
                oninput={(event) =>
                  settings.set('bridge_reopen_grace_ms', Number(event.currentTarget.value))}
              />
            </div>
          </div>
          <div class="row">
            <div class="row__info"><code>{es.search.lines}</code></div>
            <div class="row__editor">
              <input
                class="row__input row__input--num"
                type="number"
                min="50"
                step="50"
                data-testid="settings-search-lines"
                value={settings.values.search_lines}
                oninput={(event) => settings.set('search_lines', Number(event.currentTarget.value))}
              />
            </div>
          </div>
          <div class="row">
            <div class="row__info"><code>{es.settings.toastMs}</code></div>
            <div class="row__editor">
              <input
                class="row__input row__input--num"
                type="number"
                min="500"
                step="500"
                data-testid="settings-toast-ms"
                value={settings.values.toast_ms}
                oninput={(event) => settings.set('toast_ms', Number(event.currentTarget.value))}
              />
            </div>
          </div>
        </section>

        {#if error}
          <p class="settings__error" data-testid="settings-error">{error}</p>
        {/if}

        <h3 class="group__title">{es.settings.herdr}</h3>
        <p class="group__doc">{es.settings.herdrHint}</p>
        {#if read}
          <p class="group__doc">{es.settings.path}: <code>{read.path}</code></p>
        {/if}

        {#each filteredSections as section (section.path)}
          <section class="group" data-testid="settings-section" data-path={section.path}>
            <h4 class="group__subtitle">
              <code>{section.path === '' ? '(raíz)' : section.path}</code>
              {#if section.tableArray}<span class="tag">[[…]]</span>{/if}
              {#if isReadOnlySection(section.path)}
                <span class="tag" data-testid="settings-readonly">{es.settings.readOnly}</span>
              {/if}
            </h4>
            {#if section.description}
              <p class="group__doc">{section.description}</p>
            {/if}
            {#each section.keys as key (`${section.path}.${key.key}`)}
              <div
                class="row"
                data-testid="settings-key"
                data-path={sectionKeyPath(section.path, key.key)}
              >
                <div class="row__info">
                  <code>{key.key}</code>
                  {#if entries.get(sectionKeyPath(section.path, key.key))}
                    <span
                      class="tag"
                      data-origin={entries.get(sectionKeyPath(section.path, key.key))?.origin}
                    >
                      {entries.get(sectionKeyPath(section.path, key.key))?.origin === 'file'
                        ? es.settings.originFile
                        : es.settings.originDefault}
                    </span>
                  {/if}
                  {#if key.active}<span class="tag tag--active">{es.settings.active}</span>{/if}
                  {#if isDirty(section.path, key)}<span class="tag tag--dirty">•</span>{/if}
                  {#if key.description}<p class="row__doc">{key.description}</p>{/if}
                </div>
                <div class="row__editor">
                  {#if isReadOnlySection(section.path)}
                    <code class="row__value">{inputValue(section.path, key)}</code>
                  {:else if key.type === 'boolean'}
                    <input
                      type="checkbox"
                      data-testid="settings-check"
                      checked={inputValue(section.path, key) === 'true'}
                      onchange={(event) =>
                        setEdit(section.path, key, event.currentTarget.checked ? 'true' : 'false')}
                    />
                  {:else if key.type === 'integer' || key.type === 'float'}
                    <input
                      class="row__input row__input--num"
                      type="number"
                      step={key.type === 'float' ? '0.1' : '1'}
                      data-testid="settings-number"
                      value={inputValue(section.path, key)}
                      oninput={(event) => setEdit(section.path, key, event.currentTarget.value)}
                    />
                  {:else if key.type === 'array' || key.type === 'toml'}
                    <textarea
                      class="row__input row__input--code"
                      rows="2"
                      spellcheck="false"
                      data-testid="settings-raw"
                      value={inputValue(section.path, key)}
                      oninput={(event) => setEdit(section.path, key, event.currentTarget.value)}
                    ></textarea>
                  {:else}
                    <input
                      class="row__input"
                      type="text"
                      spellcheck="false"
                      data-testid="settings-text"
                      value={inputValue(section.path, key)}
                      oninput={(event) => setEdit(section.path, key, event.currentTarget.value)}
                    />
                  {/if}
                  {#if !isReadOnlySection(section.path)}
                    <button
                      type="button"
                      class="btn btn--small"
                      title={es.settings.resetHint}
                      data-testid="settings-reset-key"
                      onclick={() => resetKey(section.path, key)}
                    >
                      {es.settings.reset}
                    </button>
                  {/if}
                </div>
              </div>
            {/each}
          </section>
        {/each}

        {#if unknownEntries.length > 0}
          <section class="group" data-testid="settings-unknown">
            <h4 class="group__subtitle">{es.settings.unknown}</h4>
            {#each unknownEntries as entry (entry.path)}
              <div class="row" data-testid="settings-key" data-path={entry.path}>
                <div class="row__info"><code>{entry.path}</code></div>
                <div class="row__editor">
                  <textarea
                    class="row__input row__input--code"
                    rows="2"
                    spellcheck="false"
                    value={unknownValue(entry.path, entry.value)}
                    oninput={(event) => setRaw(entry.path, event.currentTarget.value)}></textarea>
                </div>
              </div>
            {/each}
          </section>
        {/if}

        {#if filteredSections.length === 0 && needle.length > 0}
          <p class="group__doc" data-testid="settings-empty">{es.settings.empty}</p>
        {/if}

        {#if diagnostics.length > 0}
          <section class="group group--diagnostics" data-testid="settings-diagnostics">
            <h4 class="group__subtitle">{es.settings.diagnostics}</h4>
            <ul class="diagnostics">
              {#each diagnostics as diagnostic, index (index)}
                <li class="diagnostics__item" data-severity={diagnostic.severity}>
                  <strong>{diagnostic.severity}</strong> · {diagnostic.message}
                </li>
              {/each}
            </ul>
          </section>
        {/if}

        {#if notice}
          <p class="settings__notice" data-testid="settings-notice">{notice}</p>
        {/if}
      </div>
    {/if}

    {#snippet footer()}
      {#if view === 'config'}
        {#if dirtyCount > 0}
          <span class="settings__dirty" data-testid="settings-dirty">
            {es.settings.changed.replace('{n}', String(dirtyCount))}
          </span>
        {/if}
        <button
          type="button"
          class="btn"
          data-testid="settings-reset-all"
          disabled={dirtyCount === 0}
          onclick={() => (draft = {})}
        >
          {es.settings.resetAll}
        </button>
        <button
          type="button"
          class="btn btn--primary"
          data-testid="settings-save"
          disabled={saving || dirtyCount === 0}
          onclick={() => void save()}
        >
          {saving ? es.settings.saving : es.settings.save}
        </button>
      {/if}
      <button
        type="button"
        class="btn"
        data-testid="settings-close"
        onclick={() => ui.closeSettings()}
      >
        {es.dialog.close}
      </button>
    {/snippet}
  </Dialog>
{/if}

<style>
  .settings {
    display: grid;
    gap: var(--space-3);
    min-inline-size: 0;
  }

  .settings__tabs {
    display: flex;
    gap: var(--space-1);
    margin-block-end: var(--space-2);
  }

  .settings__tabs button[aria-pressed='true'] {
    border-color: var(--accent);
    color: var(--text);
  }

  .settings__search {
    inline-size: 100%;
    padding: 7px 10px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--glass-border);
    background: var(--control-bg-strong);
    color: var(--text);
    font: inherit;
  }

  .group {
    display: grid;
    gap: 4px;
    padding: var(--space-3);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-sm);
    background: var(--row-subtle-bg);
  }

  .group--diagnostics {
    border-color: color-mix(in oklab, var(--yellow) 40%, var(--glass-border));
  }

  .group__title {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
  }

  .group__subtitle {
    margin: var(--space-1) 0 0;
    font-size: 12px;
    color: var(--text-dim);
  }

  .group__doc {
    margin: 0;
    font-size: 11px;
    color: var(--text-dim);
    white-space: pre-line;
  }

  .row {
    display: grid;
    grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
    gap: var(--space-2);
    align-items: start;
    padding: 4px 0;
    border-block-start: 1px solid var(--control-border);
  }

  .row__info {
    min-inline-size: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    font-size: 12px;
  }

  .row__doc {
    flex-basis: 100%;
    margin: 0;
    font-size: 11px;
    color: var(--text-dim);
    white-space: pre-line;
  }

  .glass-level {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .glass-level input {
    flex: 1;
    accent-color: var(--accent);
  }

  .glass-level output {
    min-inline-size: 3ch;
    text-align: end;
    font-variant-numeric: tabular-nums;
    color: var(--text);
  }

  .row__editor {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-inline-size: 0;
  }

  .row__input {
    min-inline-size: 0;
    inline-size: 100%;
    padding: 5px 8px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--glass-border);
    background: var(--control-bg-strong);
    color: var(--text);
    font: inherit;
    font-size: 12px;
  }

  .row__input--num {
    inline-size: 6rem;
  }

  .row__input--code {
    font-family: var(--font-mono);
    resize: vertical;
  }

  .row__value {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
  }

  .tag {
    padding: 0 6px;
    border-radius: 999px;
    border: 1px solid var(--glass-border);
    font-size: 10px;
    color: var(--text-dim);
  }

  .tag--active {
    color: var(--green);
    border-color: color-mix(in oklab, var(--green) 40%, var(--glass-border));
  }

  .tag--dirty {
    color: var(--yellow);
    border-color: color-mix(in oklab, var(--yellow) 40%, var(--glass-border));
  }

  .diagnostics {
    margin: 0;
    padding-inline-start: 1.2em;
    display: grid;
    gap: 2px;
    font-size: 11px;
  }

  .diagnostics__item[data-severity='error'] {
    color: var(--red);
  }

  .diagnostics__item[data-severity='warning'] {
    color: var(--yellow);
  }

  .settings__error,
  .settings__notice {
    margin: 0;
    font-size: 12px;
  }

  .settings__error {
    color: var(--red);
  }

  .settings__notice {
    color: var(--text-dim);
  }

  .settings__dirty {
    margin-inline-end: auto;
    font-size: 11px;
    color: var(--yellow);
  }
</style>
