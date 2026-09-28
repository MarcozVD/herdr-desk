<!-- T4.2 — Integraciones: estado real de la CLI (`herdr integration status`),
     instalar y desinstalar cada target con confirmación. -->
<script lang="ts">
  import { errorText } from '../../lib/herdr/errors';
  import {
    integrationInstall,
    integrationStatus,
    integrationUninstall,
    type IntegrationStatusEntry,
  } from '../../lib/herdr/f4';
  import { es } from '../../lib/i18n/es';
  import { session } from '../../lib/stores/session.svelte';
  import { ui } from '../../lib/stores/ui.svelte';
  import Dialog from '../../lib/ui/Dialog.svelte';

  let entries = $state<IntegrationStatusEntry[]>([]);
  let error = $state<string | null>(null);
  let loading = $state(false);
  let busy = $state<string | null>(null);

  async function load(): Promise<void> {
    error = null;
    loading = true;
    const outcome = await integrationStatus();
    loading = false;
    if (!outcome.ok) {
      entries = [];
      error =
        outcome.kind === 'missing'
          ? es.connection.unavailable.replace('{command}', 'integration_status')
          : errorText(outcome.error);
      return;
    }
    entries = outcome.value ?? [];
  }

  $effect(() => {
    if (ui.integrationsOpen) void load();
  });

  function stateLabel(state: string): string {
    if (state === 'current') return es.integrations.stateCurrent;
    if (state === 'not_installed') return es.integrations.stateNotInstalled;
    return es.integrations.stateOther;
  }

  async function install(entry: IntegrationStatusEntry): Promise<void> {
    const accepted = await ui.confirm({
      title: es.integrations.install,
      message: es.integrations.installConfirm.replace('{name}', entry.name),
      confirmLabel: es.integrations.install,
    });
    if (!accepted) return;
    busy = entry.name;
    const outcome = await integrationInstall(entry.name);
    busy = null;
    if (!outcome.ok) {
      error = errorText(outcome.error);
      return;
    }
    ui.notify(
      es.integrations.installed.replace('{messages}', (outcome.value?.messages ?? []).join(' ')),
      'info',
    );
    await load();
  }

  async function uninstall(entry: IntegrationStatusEntry): Promise<void> {
    const accepted = await ui.confirm({
      title: es.integrations.uninstall,
      message: es.integrations.uninstallConfirm.replace('{name}', entry.name),
      confirmLabel: es.integrations.uninstall,
      danger: true,
    });
    if (!accepted) return;
    busy = entry.name;
    const outcome = await integrationUninstall(entry.name);
    busy = null;
    if (!outcome.ok) {
      error = errorText(outcome.error);
      return;
    }
    ui.notify(
      es.integrations.uninstalled.replace('{messages}', (outcome.value?.messages ?? []).join(' ')),
      'info',
    );
    await load();
  }
</script>

{#if ui.integrationsOpen}
  <Dialog
    title="{es.integrations.title} · {session.sessionName ?? es.app.sessionUnknown}"
    onclose={() => ui.closeIntegrations()}
    width="40rem"
    testId="integrations-dialog"
  >
    {#if error}
      <p class="integrations__error" data-testid="integrations-error">{error}</p>
    {:else if loading}
      <p class="integrations__empty" data-testid="integrations-loading">{es.dialog.loading}</p>
    {:else if entries.length === 0}
      <p class="integrations__empty" data-testid="integrations-empty">
        {es.integrations.empty}
      </p>
    {:else}
      <ul class="integrations" data-testid="integrations-list">
        {#each entries as entry (entry.name)}
          <li class="integrations__row" data-testid="integration-row" data-name={entry.name}>
            <span class="integrations__name">{entry.name}</span>
            <span class="integrations__state" data-state={entry.state}>
              {stateLabel(entry.state)}
            </span>
            {#if entry.version}<span class="integrations__version">{entry.version}</span>{/if}
            <span class="integrations__path" title={entry.path}>{entry.path}</span>
            <span class="integrations__actions">
              <button
                type="button"
                class="btn btn--small"
                data-testid="integration-install"
                disabled={busy !== null || entry.state === 'current'}
                onclick={() => void install(entry)}
              >
                {es.integrations.install}
              </button>
              <button
                type="button"
                class="btn btn--small btn--danger"
                data-testid="integration-uninstall"
                disabled={busy !== null || entry.state === 'not_installed'}
                onclick={() => void uninstall(entry)}
              >
                {es.integrations.uninstall}
              </button>
            </span>
          </li>
        {/each}
      </ul>
    {/if}

    {#snippet footer()}
      <button
        type="button"
        class="btn"
        data-testid="integrations-reload"
        onclick={() => void load()}
      >
        Actualizar
      </button>
      <button
        type="button"
        class="btn btn--primary"
        data-testid="integrations-close"
        onclick={() => ui.closeIntegrations()}
      >
        {es.dialog.close}
      </button>
    {/snippet}
  </Dialog>
{/if}

<style>
  .integrations {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-1);
  }

  .integrations__row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 5px var(--space-2);
    border-radius: var(--radius-sm);
    background: var(--row-subtle-bg);
    font-size: 13px;
  }

  .integrations__name {
    font-family: var(--font-mono);
    font-size: 12px;
  }

  .integrations__state {
    font-size: 10px;
    padding: 0 6px;
    border-radius: 999px;
    border: 1px solid var(--glass-border);
    color: var(--text-dim);
  }

  .integrations__state[data-state='current'] {
    color: var(--green);
    border-color: color-mix(in oklab, var(--green) 40%, var(--glass-border));
  }

  .integrations__state[data-state='not_installed'] {
    color: var(--yellow);
    border-color: color-mix(in oklab, var(--yellow) 40%, var(--glass-border));
  }

  .integrations__version {
    font-size: 10px;
    color: var(--text-dim);
  }

  .integrations__path {
    flex: 1 1 auto;
    min-inline-size: 0;
    font-size: 10px;
    color: var(--text-dim);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .integrations__actions {
    display: flex;
    gap: var(--space-1);
  }

  .integrations__empty,
  .integrations__error {
    margin: 0;
    font-size: 12px;
  }

  .integrations__error {
    color: var(--red);
  }
</style>
