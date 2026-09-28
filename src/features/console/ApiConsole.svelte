<!-- T4.5 — Consola API: selector de los 90 métodos (catálogo del schema real),
     formulario generado por params (string/bool/int/enum/array/objeto),
     visor de respuesta, historial y visor de eventos en vivo (events.subscribe
     de los 24 tipos globales por el command events_watch). Cubre el 100 % del
     API por diseño: todo método sin UI dedicada sale de aquí (T4.7). -->
<script lang="ts">
  import { writeText } from '@tauri-apps/plugin-clipboard-manager';
  import { Channel } from '@tauri-apps/api/core';
  import { invoke } from '@tauri-apps/api/core';

  import { callRaw } from '../../lib/herdr/client';
  import { errorText } from '../../lib/herdr/errors';
  import {
    apiCatalog,
    type ApiCatalog,
    type ApiMethodSpec,
    type ApiParamSpec,
  } from '../../lib/herdr/f4';
  import { es } from '../../lib/i18n/es';
  import { ui } from '../../lib/stores/ui.svelte';
  import Dialog from '../../lib/ui/Dialog.svelte';

  /** 24 tipos globales (herdr_core::events::GLOBAL_EVENT_TYPES). */
  const GLOBAL_EVENTS = [
    'workspace.created',
    'workspace.updated',
    'workspace.metadata_updated',
    'workspace.renamed',
    'workspace.moved',
    'workspace.reordered',
    'workspace.closed',
    'workspace.focused',
    'worktree.created',
    'worktree.opened',
    'worktree.removed',
    'tab.created',
    'tab.closed',
    'tab.focused',
    'tab.renamed',
    'tab.moved',
    'pane.created',
    'pane.closed',
    'pane.updated',
    'pane.focused',
    'pane.moved',
    'pane.exited',
    'pane.agent_detected',
    'layout.updated',
  ] as const;

  interface HistoryEntry {
    method: string;
    params: string;
    response: string;
    ok: boolean;
    at: number;
  }

  let catalog = $state<ApiCatalog | null>(null);
  let error = $state<string | null>(null);
  let query = $state('');
  let selected = $state<string | null>(null);
  let values = $state<Record<string, string>>({});
  let response = $state('');
  let running = $state(false);
  let history = $state<HistoryEntry[]>([]);
  let eventsOn = $state(false);
  let eventsText = $state('');
  let eventsChannel: Channel<string> | null = null;

  const filtered = $derived(
    (catalog?.methods ?? []).filter((method) => {
      const needle = query.trim().toLowerCase();
      if (needle.length === 0) return true;
      return (
        method.method.toLowerCase().includes(needle) || method.group.toLowerCase().includes(needle)
      );
    }),
  );

  const methodSpec = $derived(
    (catalog?.methods ?? []).find((method) => method.method === selected) ?? null,
  );

  async function load(): Promise<void> {
    error = null;
    const outcome = await apiCatalog();
    if (!outcome.ok) {
      error =
        outcome.kind === 'missing'
          ? es.connection.unavailable.replace('{command}', 'api_catalog')
          : errorText(outcome.error);
      return;
    }
    catalog = outcome.value;
    if (catalog && !selected) selectMethod(catalog.methods[0] ?? null);
  }

  $effect(() => {
    if (ui.consoleOpen) void load();
  });

  function selectMethod(method: ApiMethodSpec | null): void {
    selected = method?.method ?? null;
    values = {};
    response = '';
    if (!method) return;
    for (const param of method.params) {
      values[param.name] = '';
    }
  }

  function kindOf(param: ApiParamSpec): string {
    return param.kind;
  }

  function parseParam(param: ApiParamSpec, raw: string): unknown {
    const text = raw.trim();
    switch (kindOf(param)) {
      case 'bool':
        return text === 'true';
      case 'integer':
        return Number.parseInt(text, 10);
      case 'number':
        return Number.parseFloat(text);
      case 'array':
      case 'object':
      case 'ref':
      case 'unknown':
        return text.length === 0 ? null : (JSON.parse(text) as unknown);
      default:
        return raw;
    }
  }

  function buildParams(method: ApiMethodSpec): Record<string, unknown> {
    const params: Record<string, unknown> = {};
    for (const param of method.params) {
      const raw = values[param.name] ?? '';
      if (raw.trim().length === 0) {
        if (param.required && raw !== 'false') {
          throw new Error(`falta el parámetro obligatorio ${param.name}`);
        }
        continue;
      }
      params[param.name] = parseParam(param, raw);
    }
    return params;
  }

  async function run(): Promise<void> {
    if (!methodSpec) return;
    running = true;
    error = null;
    try {
      const params = buildParams(methodSpec);
      const paramsText = JSON.stringify(params, null, 2);
      const result = await callRaw(methodSpec.method, params);
      response = JSON.stringify(result, null, 2);
      history = [
        { method: methodSpec.method, params: paramsText, response, ok: true, at: Date.now() },
        ...history,
      ].slice(0, 30);
    } catch (raw) {
      const message = raw instanceof Error ? raw.message : errorText(raw as never);
      error = message;
      if (methodSpec) {
        response = '';
        history = [
          {
            method: methodSpec.method,
            params: JSON.stringify(values, null, 2),
            response: message,
            ok: false,
            at: Date.now(),
          },
          ...history,
        ].slice(0, 30);
      }
    } finally {
      running = false;
    }
  }

  function loadHistory(entry: HistoryEntry): void {
    selected = entry.method;
    response = entry.response;
  }

  async function copyResponse(): Promise<void> {
    await writeText(response).catch(() => undefined);
    ui.notify(es.viewer.copied, 'info');
  }

  async function toggleEvents(): Promise<void> {
    if (eventsOn) {
      // Soltar el callback deja de pintar; el backend cierra al fallar el envío.
      if (eventsChannel) eventsChannel.onmessage = () => undefined;
      eventsChannel = null;
      eventsOn = false;
      return;
    }
    const channel = new Channel<string>();
    eventsChannel = channel;
    channel.onmessage = (line) => {
      if (!eventsOn) return;
      eventsText = `${eventsText}${line}\n`.split('\n').slice(-200).join('\n');
    };
    eventsOn = true;
    eventsText = '';
    try {
      await invoke('events_watch', { types: [...GLOBAL_EVENTS], onEvt: channel });
    } catch (raw) {
      eventsOn = false;
      error = errorText(raw as never);
    }
  }

  const paramHint = (param: ApiParamSpec): string =>
    `${param.name}: ${param.kind}${param.required ? ` · ${es.apiConsole.required}` : ''}${param.nullable ? ' · null' : ''}`;
</script>

{#if ui.consoleOpen}
  <Dialog
    title={es.apiConsole.title}
    onclose={() => ui.closeConsole()}
    width="56rem"
    testId="console-dialog"
  >
    <div class="console">
      <div class="console__left">
        <input
          class="console__search"
          type="search"
          placeholder={es.apiConsole.search}
          bind:value={query}
          data-testid="console-search"
        />
        <div class="console__count">
          {catalog ? `${catalog.total} · protocol ${catalog.protocol}` : '—'}
        </div>
        <ul class="console__methods" data-testid="console-methods">
          {#each filtered as method (method.method)}
            <li>
              <button
                type="button"
                class="console__method"
                class:active={selected === method.method}
                data-testid="console-method"
                data-method={method.method}
                onclick={() => selectMethod(method)}
              >
                {method.method}
              </button>
            </li>
          {/each}
        </ul>
      </div>

      <div class="console__right">
        {#if error}
          <p class="console__error" data-testid="console-error">{error}</p>
        {/if}
        {#if methodSpec}
          <h3 class="console__title">{methodSpec.method}</h3>
          {#if methodSpec.description}
            <p class="console__doc">{methodSpec.description}</p>
          {/if}
          <div class="console__params" data-testid="console-params">
            {#if methodSpec.params.length === 0}
              <p class="console__doc">{es.apiConsole.noParams}</p>
            {/if}
            {#each methodSpec.params as param (param.name)}
              <label class="console__param">
                <span class="console__param-label" title={paramHint(param)}>
                  {param.name}
                  {#if param.required}<em>{es.apiConsole.required}</em>{/if}
                </span>
                {#if kindOf(param) === 'bool'}
                  <select
                    class="console__input"
                    data-testid="console-param"
                    data-param={param.name}
                    value={values[param.name] ?? ''}
                    onchange={(event) =>
                      (values = { ...values, [param.name]: event.currentTarget.value })}
                  >
                    <option value="">—</option>
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </select>
                {:else if kindOf(param) === 'enum'}
                  <select
                    class="console__input"
                    data-testid="console-param"
                    data-param={param.name}
                    value={values[param.name] ?? ''}
                    onchange={(event) =>
                      (values = { ...values, [param.name]: event.currentTarget.value })}
                  >
                    <option value="">—</option>
                    {#each param.enum_values ?? [] as option (option)}
                      <option value={option}>{option}</option>
                    {/each}
                  </select>
                {:else if kindOf(param) === 'array' || kindOf(param) === 'object' || kindOf(param) === 'ref'}
                  <textarea
                    class="console__input console__input--code"
                    rows="2"
                    spellcheck="false"
                    data-testid="console-param"
                    data-param={param.name}
                    value={values[param.name] ?? ''}
                    oninput={(event) =>
                      (values = { ...values, [param.name]: event.currentTarget.value })}></textarea>
                {:else}
                  <input
                    class="console__input"
                    spellcheck="false"
                    data-testid="console-param"
                    data-param={param.name}
                    value={values[param.name] ?? ''}
                    oninput={(event) =>
                      (values = { ...values, [param.name]: event.currentTarget.value })}
                  />
                {/if}
              </label>
            {/each}
          </div>
          <div class="console__actions">
            <button
              type="button"
              class="btn btn--primary btn--small"
              data-testid="console-run"
              disabled={running}
              onclick={() => void run()}
            >
              {running ? es.apiConsole.running : es.apiConsole.run}
            </button>
            <button
              type="button"
              class="btn btn--small"
              data-testid="console-copy"
              disabled={response.length === 0}
              onclick={() => void copyResponse()}
            >
              {es.apiConsole.copy}
            </button>
            <button
              type="button"
              class="btn btn--small"
              data-testid="console-events-toggle"
              onclick={() => void toggleEvents()}
            >
              {eventsOn ? es.apiConsole.events : es.apiConsole.eventSubscribe}
            </button>
          </div>
          <pre class="console__response" data-testid="console-response">{response}</pre>
          {#if eventsOn}
            <p class="console__doc">{es.apiConsole.eventHint}</p>
            <pre class="console__events" data-testid="console-events">{eventsText}</pre>
          {/if}
        {/if}

        {#if history.length > 0}
          <h4 class="console__title">{es.apiConsole.history}</h4>
          <ul class="console__history" data-testid="console-history">
            {#each history as entry, index (entry.at + index)}
              <li>
                <button
                  type="button"
                  class="console__history-item"
                  data-ok={entry.ok}
                  onclick={() => loadHistory(entry)}
                >
                  {entry.method}
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>

    {#snippet footer()}
      <button
        type="button"
        class="btn btn--primary"
        data-testid="console-close"
        onclick={() => ui.closeConsole()}
      >
        {es.dialog.close}
      </button>
    {/snippet}
  </Dialog>
{/if}

<style>
  .console {
    display: grid;
    grid-template-columns: minmax(0, 14rem) minmax(0, 1fr);
    gap: var(--space-3);
    min-block-size: 24rem;
  }

  .console__left {
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr);
    gap: var(--space-1);
    min-block-size: 0;
  }

  .console__search,
  .console__input {
    inline-size: 100%;
    padding: 5px 8px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--glass-border);
    background: var(--control-bg-strong);
    color: var(--text);
    font: inherit;
    font-size: 12px;
  }

  .console__input--code {
    font-family: var(--font-mono);
    resize: vertical;
  }

  .console__count {
    font-size: 10px;
    color: var(--text-dim);
  }

  .console__methods {
    list-style: none;
    margin: 0;
    padding: 0;
    overflow: auto;
    max-block-size: 24rem;
    display: grid;
    gap: 1px;
    align-content: start;
  }

  .console__method {
    inline-size: 100%;
    text-align: start;
    border: none;
    background: transparent;
    color: var(--text-dim);
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 3px 6px;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .console__method:hover {
    background: var(--control-hover-bg);
    color: var(--text);
  }

  .console__method.active {
    background: var(--row-current-bg);
    color: var(--text);
  }

  .console__right {
    display: grid;
    gap: var(--space-2);
    align-content: start;
    min-inline-size: 0;
  }

  .console__title {
    margin: 0;
    font-size: 13px;
  }

  .console__doc {
    margin: 0;
    font-size: 11px;
    color: var(--text-dim);
    white-space: pre-line;
  }

  .console__params {
    display: grid;
    gap: 4px;
  }

  .console__param {
    display: grid;
    grid-template-columns: minmax(0, 10rem) minmax(0, 1fr);
    align-items: center;
    gap: var(--space-2);
  }

  .console__param-label {
    font-family: var(--font-mono);
    font-size: 11px;
  }

  .console__param-label em {
    font-style: normal;
    color: var(--yellow);
    font-size: 10px;
  }

  .console__actions {
    display: flex;
    gap: var(--space-1);
  }

  .console__response,
  .console__events {
    margin: 0;
    padding: var(--space-2);
    border-radius: var(--radius-sm);
    background: var(--control-bg-inset);
    font-family: var(--font-mono);
    font-size: 11px;
    max-block-size: 12rem;
    overflow: auto;
    white-space: pre-wrap;
  }

  .console__events {
    max-block-size: 8rem;
  }

  .console__history {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
  }

  .console__history-item {
    border: 1px solid var(--glass-border);
    border-radius: 999px;
    background: transparent;
    color: var(--text-dim);
    font-family: var(--font-mono);
    font-size: 10px;
    padding: 1px 8px;
    cursor: pointer;
  }

  .console__history-item[data-ok='false'] {
    color: var(--red);
    border-color: color-mix(in oklab, var(--red) 40%, var(--glass-border));
  }

  .console__error {
    margin: 0;
    font-size: 12px;
    color: var(--red);
  }
</style>
