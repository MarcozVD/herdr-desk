<!-- T4.3/T4.4 — Servidor: estado (CLI + sesión viva), manifiestos de agentes con
     recarga, recargar config, detener con doble confirmación, y update/canal por
     la lista blanca del CLI con la salida visible. -->
<script lang="ts">
  import { call } from '../../lib/herdr/client';
  import { describeApiError, errorText, parseApiError } from '../../lib/herdr/errors';
  import {
    agentManifests,
    agentManifestsReload,
    cliRun,
    serverStatus,
    type AgentManifestStatus,
    type ServerStatusReport,
  } from '../../lib/herdr/f4';
  import { serverApi } from '../../lib/herdr/actions';
  import { es } from '../../lib/i18n/es';
  import { session } from '../../lib/stores/session.svelte';
  import { ui } from '../../lib/stores/ui.svelte';
  import Dialog from '../../lib/ui/Dialog.svelte';

  let status = $state<ServerStatusReport | null>(null);
  let manifests = $state<AgentManifestStatus | null>(null);
  let error = $state<string | null>(null);
  let busy = $state(false);
  let output = $state('');

  async function load(): Promise<void> {
    error = null;
    const [report, manifestReport] = await Promise.all([serverStatus(), agentManifests()]);
    if (!report.ok) {
      status = null;
      error =
        report.kind === 'missing'
          ? es.connection.unavailable.replace('{command}', 'server_status')
          : errorText(report.error);
    } else {
      status = report.value;
    }
    manifests = manifestReport.ok ? manifestReport.value : null;
  }

  $effect(() => {
    if (ui.serverOpen) void load();
  });

  async function reloadConfig(): Promise<void> {
    try {
      await serverApi.reloadConfig();
      ui.notify(es.titlebar.reloaded, 'info');
    } catch (raw) {
      error = describeApiError(parseApiError(raw), { session: session.sessionName ?? '' });
    }
  }

  async function reloadManifests(): Promise<void> {
    busy = true;
    const outcome = await agentManifestsReload();
    busy = false;
    if (!outcome.ok) {
      error = errorText(outcome.error);
      return;
    }
    manifests = outcome.value;
    ui.notify(es.server.manifestsUpdated, 'info');
  }

  /** Detener server: doble confirmación (mata los procesos de los panes). */
  async function stopServer(): Promise<void> {
    const sessionName = session.sessionName ?? es.app.sessionUnknown;
    const first = await ui.confirm({
      title: es.server.stop,
      message: es.server.stopConfirm.replace('{session}', sessionName),
      confirmLabel: es.server.stop,
      danger: true,
    });
    if (!first) return;
    const second = await ui.confirm({
      title: es.server.stop,
      message: es.server.stopConfirmAgain,
      confirmLabel: es.server.stop,
      danger: true,
    });
    if (!second) return;
    try {
      await call('server.stop', {});
      ui.notify(es.server.stopped, 'info');
      await load();
    } catch (raw) {
      error = describeApiError(parseApiError(raw), { session: session.sessionName ?? '' });
    }
  }

  async function runUpdate(handoff: boolean): Promise<void> {
    const argv = handoff ? ['herdr', 'update', '--handoff'] : ['herdr', 'update'];
    busy = true;
    output = es.server.updateRunning;
    const outcome = await cliRun(argv);
    busy = false;
    if (!outcome.ok) {
      output = '';
      error = errorText(outcome.error);
      return;
    }
    output = (outcome.value?.stdout ?? '') + (outcome.value?.stderr ?? '');
    ui.openViewer({
      title: es.server.update,
      text:
        output.trim() ||
        es.server.updateDone.replace('{code}', String(outcome.value?.exit_code ?? 0)),
    });
  }

  async function showChannel(): Promise<void> {
    const outcome = await cliRun(['herdr', 'channel', 'show']);
    if (!outcome.ok) {
      error = errorText(outcome.error);
      return;
    }
    output = outcome.value?.stdout.trim() ?? '';
    ui.openViewer({
      title: es.server.channel,
      text: output || es.server.channelNow.replace('{channel}', '?'),
    });
  }

  async function setChannel(channel: 'stable' | 'preview'): Promise<void> {
    busy = true;
    const outcome = await cliRun(['herdr', 'channel', 'set', channel]);
    busy = false;
    if (!outcome.ok || outcome.value?.exit_code !== 0) {
      error = !outcome.ok ? errorText(outcome.error) : (outcome.value?.stderr.trim() ?? '');
      return;
    }
    ui.notify(es.server.channelSet.replace('{channel}', channel), 'info');
  }

  function capabilityLabel(value: boolean | null | undefined): string {
    if (value === true) return 'sí';
    if (value === false) return 'no';
    return '—';
  }
</script>

{#if ui.serverOpen}
  <Dialog
    title="{es.server.title} · {session.sessionName ?? es.app.sessionUnknown}"
    onclose={() => ui.closeServer()}
    width="44rem"
    testId="server-dialog"
  >
    {#if error}
      <p class="server__error" data-testid="server-error">{error}</p>
    {/if}
    {#if status}
      <section class="server__card" data-testid="server-status">
        <h3 class="server__title">{es.server.live}</h3>
        {#if status.live}
          <p class="server__line" data-testid="server-live">
            {es.server.version}
            {status.live.version} · {es.server.protocol}
            {status.live.protocol} · {es.server.liveHandoff}:
            {capabilityLabel(status.live.capabilities?.live_handoff)} · {es.server.detachedServer}:
            {capabilityLabel(status.live.capabilities?.detached_server_daemon)}
          </p>
        {:else}
          <p class="server__line server__line--warn" data-testid="server-live-error">
            {es.server.liveError.replace('{error}', status.live_error ?? '—')}
          </p>
        {/if}
        <h3 class="server__title">{es.server.cli}</h3>
        {#if status.cli}
          <p class="server__line" data-testid="server-cli">
            {es.server.version}
            {status.cli.client?.version ?? '—'} · {es.server.session}
            {status.cli.server?.session ?? '—'} · {es.server.protocol}
            {status.cli.server?.protocol ?? '—'} · {es.server.socket}
            {status.cli.server?.socket ?? '—'}
          </p>
        {:else}
          <p class="server__line server__line--warn" data-testid="server-cli-error">
            {es.server.cliError.replace('{error}', status.cli_error ?? '—')}
          </p>
        {/if}
      </section>
    {/if}

    <section class="server__card" data-testid="server-manifests">
      <h3 class="server__title">{es.server.manifests}</h3>
      {#if manifests && manifests.manifests.length > 0}
        <ul class="server__manifests">
          {#each manifests.manifests as manifest (manifest.agent)}
            <li class="server__manifest" data-testid="manifest-row" data-agent={manifest.agent}>
              <span class="server__agent">{manifest.agent}</span>
              <span class="server__source">{manifest.source_kind}</span>
              <span class="server__version">{manifest.active_version ?? '—'}</span>
              {#if manifest.warning}
                <span class="server__warn" title={manifest.warning}>⚠</span>
              {/if}
            </li>
          {/each}
        </ul>
      {:else}
        <p class="server__line">{manifests?.last_result ?? '—'}</p>
      {/if}
      <div class="server__actions">
        <button
          type="button"
          class="btn btn--small"
          data-testid="server-reload-config"
          onclick={() => void reloadConfig()}
        >
          {es.server.reloadConfig}
        </button>
        <button
          type="button"
          class="btn btn--small"
          data-testid="server-reload-manifests"
          disabled={busy}
          onclick={() => void reloadManifests()}
        >
          {es.server.reloadManifests}
        </button>
      </div>
    </section>

    <section class="server__card" data-testid="server-update-card">
      <h3 class="server__title">{es.server.update}</h3>
      <div class="server__actions">
        <button
          type="button"
          class="btn btn--small"
          data-testid="server-update"
          disabled={busy}
          onclick={() => void runUpdate(false)}
        >
          {es.server.update}
        </button>
        <button
          type="button"
          class="btn btn--small"
          data-testid="server-update-handoff"
          disabled={busy}
          onclick={() => void runUpdate(true)}
        >
          {es.server.updateHandoff}
        </button>
        <button
          type="button"
          class="btn btn--small"
          data-testid="server-channel-show"
          onclick={() => void showChannel()}
        >
          {es.server.channel}
        </button>
        <button
          type="button"
          class="btn btn--small"
          data-testid="server-channel-stable"
          disabled={busy}
          onclick={() => void setChannel('stable')}
        >
          {es.server.channelStable}
        </button>
        <button
          type="button"
          class="btn btn--small"
          data-testid="server-channel-preview"
          disabled={busy}
          onclick={() => void setChannel('preview')}
        >
          {es.server.channelPreview}
        </button>
      </div>
    </section>

    {#snippet footer()}
      <button
        type="button"
        class="btn btn--danger"
        data-testid="server-stop"
        disabled={busy}
        onclick={() => void stopServer()}
      >
        {es.server.stop}
      </button>
      <button type="button" class="btn" data-testid="server-reload" onclick={() => void load()}>
        Actualizar
      </button>
      <button
        type="button"
        class="btn btn--primary"
        data-testid="server-close"
        onclick={() => ui.closeServer()}
      >
        {es.dialog.close}
      </button>
    {/snippet}
  </Dialog>
{/if}

<style>
  .server__card {
    display: grid;
    gap: 4px;
    padding: var(--space-2);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-sm);
    background: var(--row-subtle-bg);
  }

  .server__title {
    margin: 0;
    font-size: 12px;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .server__line {
    margin: 0;
    font-size: 12px;
  }

  .server__line--warn {
    color: var(--yellow);
  }

  .server__manifests {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 2px;
  }

  .server__manifest {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: 12px;
  }

  .server__agent {
    font-family: var(--font-mono);
  }

  .server__source,
  .server__version {
    font-size: 10px;
    color: var(--text-dim);
  }

  .server__warn {
    color: var(--yellow);
  }

  .server__actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }

  .server__error {
    margin: 0;
    font-size: 12px;
    color: var(--red);
  }
</style>
