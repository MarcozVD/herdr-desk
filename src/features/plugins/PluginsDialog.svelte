<!-- T4.1 — Plugins: lista (versión, estado, origen, avisos, acciones, panes),
     activar/desactivar, desvincular con confirmación, vincular carpeta local,
     instalar desde GitHub con vista previa + confirmación, invocar acciones con
     contexto, logs, panes de plugin y abrir la carpeta de configuración. -->
<script lang="ts">
  import { open } from '@tauri-apps/plugin-dialog';
  import { openPath } from '@tauri-apps/plugin-opener';

  import { errorText } from '../../lib/herdr/errors';
  import {
    cliRun,
    pluginActionInvoke,
    pluginActionList,
    pluginDisable,
    pluginEnable,
    pluginInstall,
    pluginInstallPreview,
    pluginLink,
    pluginList,
    pluginLogs,
    pluginPaneClose,
    pluginPaneFocus,
    pluginPaneOpen,
    pluginUnlink,
    type PluginActionInfo,
    type PluginInfo,
    type PluginInvocationContext,
    type PluginManifestPane,
  } from '../../lib/herdr/f4';
  import { es } from '../../lib/i18n/es';
  import { session } from '../../lib/stores/session.svelte';
  import { ui } from '../../lib/stores/ui.svelte';
  import { visible } from '../../lib/stores/visible.svelte';
  import Dialog from '../../lib/ui/Dialog.svelte';

  let plugins = $state<PluginInfo[]>([]);
  let error = $state<string | null>(null);
  let busy = $state(false);
  let expanded = $state<string | null>(null);
  let actions = $state<PluginActionInfo[]>([]);
  let lastPluginPane = $state<string | null>(null);
  let installing = $state(false);

  async function load(): Promise<void> {
    error = null;
    const outcome = await pluginList();
    if (!outcome.ok) {
      plugins = [];
      error =
        outcome.kind === 'missing'
          ? es.connection.unavailable.replace('{command}', 'plugin_list')
          : errorText(outcome.error);
      return;
    }
    plugins = outcome.value ?? [];
  }

  $effect(() => {
    if (ui.pluginsOpen) void load();
  });

  async function toggleExpand(plugin: PluginInfo): Promise<void> {
    if (expanded === plugin.plugin_id) {
      expanded = null;
      return;
    }
    expanded = plugin.plugin_id;
    actions = [];
    const outcome = await pluginActionList(plugin.plugin_id);
    if (outcome.ok) actions = outcome.value ?? [];
  }

  async function toggleEnabled(plugin: PluginInfo): Promise<void> {
    busy = true;
    const outcome = plugin.enabled
      ? await pluginDisable(plugin.plugin_id)
      : await pluginEnable(plugin.plugin_id);
    busy = false;
    if (!outcome.ok) {
      error = errorText(outcome.error);
      return;
    }
    await load();
  }

  async function unlink(plugin: PluginInfo): Promise<void> {
    const accepted = await ui.confirm({
      title: es.plugins.unlink,
      message: es.plugins.unlinkConfirm.replace('{name}', plugin.name),
      confirmLabel: es.plugins.unlink,
      danger: true,
    });
    if (!accepted) return;
    busy = true;
    const outcome = await pluginUnlink(plugin.plugin_id);
    busy = false;
    if (!outcome.ok) {
      error = errorText(outcome.error);
      return;
    }
    await load();
  }

  async function linkLocal(): Promise<void> {
    const picked = await open({ directory: true, multiple: false });
    if (typeof picked !== 'string') return;
    busy = true;
    const outcome = await pluginLink(picked, true);
    busy = false;
    if (!outcome.ok) {
      error = errorText(outcome.error);
      return;
    }
    ui.notify(es.plugins.linked.replace('{name}', outcome.value?.name ?? picked), 'info');
    await load();
  }

  async function install(): Promise<void> {
    const spec = await ui.prompt({
      title: es.plugins.install,
      label: es.plugins.installSpec,
      placeholder: 'owner/repo',
      submitLabel: es.dialog.accept,
    });
    if (spec === null || spec.trim().length === 0) return;
    const gitRef = await ui.prompt({
      title: es.plugins.install,
      label: es.plugins.installRef,
      submitLabel: es.dialog.accept,
    });
    if (gitRef === null) return;
    busy = true;
    const preview = await pluginInstallPreview(spec.trim(), gitRef.trim() || null);
    busy = false;
    if (!preview.ok || !preview.value) {
      error = !preview.ok ? errorText(preview.error) : es.plugins.unreachable;
      return;
    }
    const p = preview.value;
    const accepted = await ui.confirm({
      title: es.plugins.preview,
      message: `${es.plugins.previewText
        .replace('{name}', p.manifest.name)
        .replace('{version}', p.manifest.version)
        .replace('{owner}', p.owner)
        .replace('{repo}', p.repo)
        .replace('{commit}', p.resolved_commit ?? '(HEAD)')}\n\n${es.plugins.installConfirm
        .replace('{spec}', p.spec)
        .replace('{commit}', p.resolved_commit ?? '(HEAD)')}`,
      confirmLabel: es.plugins.install,
      danger: true,
    });
    if (!accepted) return;
    busy = true;
    const outcome = await pluginInstall(p.spec, p.requested_ref, p.preview_token);
    busy = false;
    if (!outcome.ok) {
      error = errorText(outcome.error);
      return;
    }
    ui.notify(
      es.plugins.installed.replace('{output}', (outcome.value?.output ?? '').trim().slice(0, 200)),
      'info',
    );
    installing = false;
    await load();
  }

  function context(): PluginInvocationContext {
    const pane = session.panes.find((item) => item.pane_id === visible.actionPaneId);
    return {
      workspace_id: visible.workspaceId,
      workspace_label: session.workspaces.find((w) => w.workspace_id === visible.workspaceId)
        ?.label,
      workspace_cwd: pane?.cwd ?? null,
      tab_id: visible.tabId,
      tab_label: visible.tabs.find((t) => t.tab_id === visible.tabId)?.label,
      focused_pane_id: visible.actionPaneId,
      focused_pane_agent:
        session.agents.find((a) => a.pane_id === visible.actionPaneId)?.agent ?? null,
      focused_pane_status:
        session.agents.find((a) => a.pane_id === visible.actionPaneId)?.agent_status ?? null,
      focused_pane_cwd: pane?.cwd ?? null,
      invocation_source: 'herdr-desk',
    };
  }

  async function invoke(action: PluginActionInfo): Promise<void> {
    busy = true;
    const outcome = await pluginActionInvoke(action.action_id, action.plugin_id, context());
    busy = false;
    if (!outcome.ok) {
      error = errorText(outcome.error);
      return;
    }
    ui.notify(
      es.plugins.invoked
        .replace('{title}', action.title)
        .replace('{status}', outcome.value?.log.status ?? 'ok'),
      'info',
    );
  }

  async function showLogs(plugin: PluginInfo): Promise<void> {
    const outcome = await pluginLogs(plugin.plugin_id, 50);
    if (!outcome.ok) {
      error = errorText(outcome.error);
      return;
    }
    const text = (outcome.value ?? [])
      .map(
        (log) =>
          `[${log.status}] ${log.action_id ?? log.event ?? '—'} · ${log.started_unix_ms}${
            log.exit_code !== null ? ` · exit ${log.exit_code}` : ''
          }\n${log.stdout ?? ''}${log.stderr ?? ''}${log.error ?? ''}`,
      )
      .join('\n\n');
    ui.openViewer({ title: es.plugins.logsTitle.replace('{name}', plugin.name), text });
  }

  /** Extrae un pane_id de la respuesta del server, tolerante a su forma. */
  function extractPaneId(value: unknown): string | null {
    if (value === null || typeof value !== 'object') return null;
    const record = value as Record<string, unknown>;
    for (const key of ['pane_id', 'paneId']) {
      if (typeof record[key] === 'string') return record[key] as string;
    }
    for (const key of ['pane', 'root_pane', 'result']) {
      const nested = extractPaneId(record[key]);
      if (nested) return nested;
    }
    return null;
  }

  async function openPluginPane(plugin: PluginInfo, pane: PluginManifestPane): Promise<void> {
    const popup = pane.placement === 'popup';
    busy = true;
    const outcome = await pluginPaneOpen({
      plugin_id: plugin.plugin_id,
      entrypoint: pane.id,
      workspace_id: visible.workspaceId,
      target_pane_id: visible.actionPaneId,
      focus: true,
      placement: popup ? 'zoomed' : (pane.placement ?? 'split'),
      width: pane.width,
      height: pane.height,
    });
    busy = false;
    if (!outcome.ok) {
      error = errorText(outcome.error);
      return;
    }
    lastPluginPane = extractPaneId(outcome.value);
    ui.notify(popup ? es.plugins.popupFallback : es.plugins.paneOpened, 'info');
  }

  async function focusPluginPane(): Promise<void> {
    if (!lastPluginPane) {
      ui.notify(es.plugins.noPluginPane, 'warn');
      return;
    }
    const outcome = await pluginPaneFocus(lastPluginPane);
    if (!outcome.ok) error = errorText(outcome.error);
  }

  async function closePluginPane(): Promise<void> {
    if (!lastPluginPane) {
      ui.notify(es.plugins.noPluginPane, 'warn');
      return;
    }
    const outcome = await pluginPaneClose(lastPluginPane);
    if (!outcome.ok) {
      error = errorText(outcome.error);
      return;
    }
    lastPluginPane = null;
  }

  async function configDir(): Promise<void> {
    const outcome = await cliRun(['herdr', 'plugin', 'config-dir']);
    if (!outcome.ok || outcome.value?.exit_code !== 0) {
      ui.notify(es.plugins.configDirFailed, 'error');
      return;
    }
    const path = outcome.value.stdout.trim().split(/\r?\n/).pop() ?? '';
    if (path.length === 0) {
      ui.notify(es.plugins.configDirFailed, 'error');
      return;
    }
    await openPath(path).catch(() => ui.notify(es.plugins.configDirFailed, 'error'));
  }
</script>

{#if ui.pluginsOpen}
  <Dialog
    title={es.plugins.title}
    onclose={() => ui.closePlugins()}
    width="46rem"
    testId="plugins-dialog"
  >
    {#if error}
      <p class="plugins__error" data-testid="plugins-error">{error}</p>
    {/if}
    {#if plugins.length === 0 && !error}
      <p class="plugins__empty" data-testid="plugins-empty">{es.plugins.empty}</p>
    {:else}
      <ul class="plugins" data-testid="plugins-list">
        {#each plugins as plugin (plugin.plugin_id)}
          <li
            class="plugins__row"
            data-testid="plugin-row"
            data-plugin-id={plugin.plugin_id}
            data-enabled={plugin.enabled}
          >
            <div class="plugins__head">
              <span class="plugins__name">{plugin.name}</span>
              <span class="plugins__version">{plugin.version}</span>
              <span class="plugins__tag" data-testid="plugin-state">
                {plugin.enabled ? es.plugins.enabled : es.plugins.disabled}
              </span>
              {#if plugin.source?.kind === 'github'}
                <span class="plugins__tag">
                  {plugin.source.owner}/{plugin.source.repo}
                </span>
              {:else if plugin.source?.kind}
                <span class="plugins__tag">{plugin.source.kind}</span>
              {/if}
              {#if plugin.warnings.length > 0}
                <span class="plugins__tag plugins__tag--warn" title={plugin.warnings.join('\n')}>
                  {es.plugins.warnings}: {plugin.warnings.length}
                </span>
              {/if}
            </div>
            {#if plugin.description}
              <p class="plugins__doc">{plugin.description}</p>
            {/if}
            <div class="plugins__actions">
              <button
                type="button"
                class="btn btn--small"
                data-testid="plugin-toggle"
                disabled={busy}
                onclick={() => void toggleEnabled(plugin)}
              >
                {plugin.enabled ? es.plugins.disable : es.plugins.enable}
              </button>
              <button
                type="button"
                class="btn btn--small"
                data-testid="plugin-details"
                onclick={() => void toggleExpand(plugin)}
              >
                {es.plugins.actions} ({plugin.actions.length})
              </button>
              <button
                type="button"
                class="btn btn--small"
                data-testid="plugin-logs"
                onclick={() => void showLogs(plugin)}
              >
                {es.plugins.logs}
              </button>
              <button
                type="button"
                class="btn btn--small"
                data-testid="plugin-unlink"
                disabled={busy}
                onclick={() => void unlink(plugin)}
              >
                {es.plugins.unlink}
              </button>
            </div>
            {#if expanded === plugin.plugin_id}
              <div class="plugins__details" data-testid="plugin-details-panel">
                {#if actions.length === 0}
                  <p class="plugins__doc">{es.plugins.noActions}</p>
                {:else}
                  {#each actions as action (action.action_id)}
                    <div class="plugins__action" data-testid="plugin-action">
                      <span>{action.title}</span>
                      <code>{action.contexts.join(', ') || '—'}</code>
                      <button
                        type="button"
                        class="btn btn--small"
                        data-testid="plugin-invoke"
                        disabled={busy}
                        onclick={() => void invoke(action)}
                      >
                        {es.plugins.invoke}
                      </button>
                    </div>
                  {/each}
                {/if}
                {#if plugin.panes.length > 0}
                  <p class="plugins__doc">{es.plugins.panes}</p>
                  {#each plugin.panes as pane (pane.id)}
                    <div class="plugins__action">
                      <span>{pane.title}</span>
                      <code>{pane.placement ?? 'split'}</code>
                      <button
                        type="button"
                        class="btn btn--small"
                        data-testid="plugin-pane-open"
                        disabled={busy}
                        onclick={() => void openPluginPane(plugin, pane)}
                      >
                        {es.plugins.openPane.replace('{title}', pane.title)}
                      </button>
                    </div>
                  {/each}
                  <div class="plugins__actions">
                    <button
                      type="button"
                      class="btn btn--small"
                      data-testid="plugin-pane-focus"
                      onclick={() => void focusPluginPane()}
                    >
                      {es.plugins.focusPane}
                    </button>
                    <button
                      type="button"
                      class="btn btn--small"
                      data-testid="plugin-pane-close"
                      onclick={() => void closePluginPane()}
                    >
                      {es.plugins.closePane}
                    </button>
                  </div>
                {/if}
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}

    {#snippet footer()}
      {#if installing}
        <button type="button" class="btn" onclick={() => (installing = false)}>
          {es.dialog.cancel}
        </button>
        <button
          type="button"
          class="btn btn--primary"
          data-testid="plugin-install"
          disabled={busy}
          onclick={() => void install()}
        >
          {es.plugins.install}
        </button>
      {:else}
        <button
          type="button"
          class="btn"
          data-testid="plugins-link"
          disabled={busy}
          onclick={() => void linkLocal()}
        >
          + {es.plugins.link}
        </button>
        <button
          type="button"
          class="btn"
          data-testid="plugins-install-open"
          onclick={() => (installing = true)}
        >
          + {es.plugins.install}
        </button>
        <button
          type="button"
          class="btn"
          data-testid="plugins-config-dir"
          onclick={() => void configDir()}
        >
          {es.plugins.configDir}
        </button>
        <button type="button" class="btn" data-testid="plugins-reload" onclick={() => void load()}>
          Actualizar
        </button>
        <button
          type="button"
          class="btn btn--primary"
          data-testid="plugins-close"
          onclick={() => ui.closePlugins()}
        >
          {es.dialog.close}
        </button>
      {/if}
    {/snippet}
  </Dialog>
{/if}

<style>
  .plugins {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-2);
  }

  .plugins__row {
    display: grid;
    gap: 4px;
    padding: var(--space-2);
    border-radius: var(--radius-sm);
    background: var(--row-subtle-bg);
    font-size: 13px;
  }

  .plugins__head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .plugins__name {
    font-weight: 600;
  }

  .plugins__version {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-dim);
  }

  .plugins__tag {
    padding: 0 6px;
    border-radius: 999px;
    border: 1px solid var(--glass-border);
    font-size: 10px;
    color: var(--text-dim);
  }

  .plugins__tag--warn {
    color: var(--yellow);
    border-color: color-mix(in oklab, var(--yellow) 40%, var(--glass-border));
  }

  .plugins__doc {
    margin: 0;
    font-size: 11px;
    color: var(--text-dim);
    white-space: pre-line;
  }

  .plugins__actions {
    display: flex;
    gap: var(--space-1);
    flex-wrap: wrap;
  }

  .plugins__details {
    display: grid;
    gap: 4px;
    margin-block-start: 4px;
    padding: var(--space-2);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-sm);
  }

  .plugins__action {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    align-items: center;
    gap: var(--space-2);
    font-size: 12px;
  }

  .plugins__action code {
    font-size: 10px;
    color: var(--text-dim);
  }

  .plugins__empty,
  .plugins__error {
    margin: 0;
    font-size: 12px;
  }

  .plugins__error {
    color: var(--red);
  }
</style>
