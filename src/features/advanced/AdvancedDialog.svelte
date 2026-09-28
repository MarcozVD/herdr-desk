<!-- T4.6 — Avanzado: vista de agentes de herdr, metadata y agentes reportados,
     título de la ventana, gráficos kitty, cierre de popup, live handoff,
     notificación de prueba y copiar el skill de agente. Todo por RPC directo
     (misma vía que la consola, pero con botones para los flujos comunes). -->
<script lang="ts">
  import { writeText } from '@tauri-apps/plugin-clipboard-manager';

  import { callRaw } from '../../lib/herdr/client';
  import { errorText } from '../../lib/herdr/errors';
  import { cliRun, notificationShow } from '../../lib/herdr/f4';
  import { es } from '../../lib/i18n/es';
  import { session } from '../../lib/stores/session.svelte';
  import { ui } from '../../lib/stores/ui.svelte';
  import { visible } from '../../lib/stores/visible.svelte';
  import Dialog from '../../lib/ui/Dialog.svelte';

  let error = $state<string | null>(null);
  let busy = $state(false);
  let source = $state('custom:herdr-desk');

  function paneId(): string | null {
    return visible.actionPaneId;
  }

  async function run(label: string, method: string, params: unknown): Promise<void> {
    busy = true;
    error = null;
    try {
      const result = await callRaw(method, params);
      ui.notify(`${label}: ${es.advanced.done}`, 'info');
      return void result;
    } catch (raw) {
      error = es.advanced.failed.replace('{error}', errorText(raw as never));
    } finally {
      busy = false;
    }
  }

  async function runViewer(label: string, method: string, params: unknown): Promise<void> {
    busy = true;
    error = null;
    try {
      const result = await callRaw(method, params);
      ui.openViewer({ title: label, text: JSON.stringify(result, null, 2), kind: 'json' });
    } catch (raw) {
      error = es.advanced.failed.replace('{error}', errorText(raw as never));
    } finally {
      busy = false;
    }
  }

  async function promptPair(
    title: string,
    firstLabel: string,
    secondLabel: string,
  ): Promise<[string, string] | null> {
    const first = await ui.prompt({ title, label: firstLabel, submitLabel: es.dialog.accept });
    if (first === null || first.trim().length === 0) return null;
    const second = await ui.prompt({ title, label: secondLabel, submitLabel: es.dialog.accept });
    if (second === null || second.trim().length === 0) return null;
    return [first.trim(), second.trim()];
  }

  async function setAgentView(): Promise<void> {
    const pair = await promptPair(
      es.advanced.agentViewSet,
      es.advanced.agentViewFilter,
      es.advanced.agentViewSort,
    );
    if (!pair) return;
    const [filterText, sortField] = pair;
    const filter = filterText
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    await run(es.advanced.agentViewSet, 'agent.view.set', {
      source,
      filter: filter.length > 0 ? filter : null,
      sort: sortField.length > 0 ? [{ field: sortField, order: 'desc' }] : [],
    });
  }

  async function clearAgentView(): Promise<void> {
    await run(es.advanced.agentViewClear, 'agent.view.clear', { source });
  }

  async function reportPaneMetadata(): Promise<void> {
    const id = paneId();
    if (!id) return;
    const pair = await promptPair(es.advanced.paneMetadata, 'clave', 'valor');
    if (!pair) return;
    const [key, value] = pair;
    await run(es.advanced.paneMetadata, 'pane.report_metadata', {
      pane_id: id,
      source,
      tokens: { [key]: value },
    });
  }

  async function reportWorkspaceMetadata(): Promise<void> {
    const workspaceId = visible.workspaceId;
    if (!workspaceId) return;
    const pair = await promptPair(es.advanced.workspaceMetadata, 'clave', 'valor');
    if (!pair) return;
    const [key, value] = pair;
    await run(es.advanced.workspaceMetadata, 'workspace.report_metadata', {
      workspace_id: workspaceId,
      source,
      tokens: { [key]: value },
    });
  }

  async function reportAgent(): Promise<void> {
    const id = paneId();
    if (!id) return;
    const pair = await promptPair(
      es.advanced.reportAgent,
      'agente',
      'estado (working/idle/blocked/done)',
    );
    if (!pair) return;
    const [agent, state] = pair;
    await run(es.advanced.reportAgent, 'pane.report_agent', {
      pane_id: id,
      source,
      agent,
      state,
    });
  }

  async function reportAgentSession(): Promise<void> {
    const id = paneId();
    if (!id) return;
    const pair = await promptPair(es.advanced.reportAgent, 'agente', 'session id');
    if (!pair) return;
    const [agent, sessionId] = pair;
    await run(es.advanced.reportAgent, 'pane.report_agent_session', {
      pane_id: id,
      source,
      agent,
      agent_session_id: sessionId,
    });
  }

  async function releaseAgent(): Promise<void> {
    const id = paneId();
    if (!id) return;
    const agent = session.agents.find((item) => item.pane_id === id)?.agent ?? '';
    const value = await ui.prompt({
      title: es.advanced.releaseAgent,
      label: 'agente',
      value: agent,
      submitLabel: es.dialog.accept,
    });
    if (value === null || value.trim().length === 0) return;
    await run(es.advanced.releaseAgent, 'pane.release_agent', {
      pane_id: id,
      source,
      agent: value.trim(),
    });
  }

  async function clearAuthority(): Promise<void> {
    const id = paneId();
    if (!id) return;
    await run(es.advanced.clearAuthority, 'pane.clear_agent_authority', {
      pane_id: id,
      source,
    });
  }

  async function setWindowTitle(): Promise<void> {
    const title = await ui.prompt({
      title: es.advanced.windowTitleSet,
      label: es.advanced.windowTitle,
      value: 'herdr',
      submitLabel: es.dialog.accept,
    });
    if (title === null) return;
    await run(es.advanced.windowTitleSet, 'client.window_title.set', { title });
  }

  async function graphicsInfo(): Promise<void> {
    const id = paneId();
    if (!id) return;
    await runViewer(es.advanced.graphicsInfo, 'pane.graphics.info', { pane_id: id });
  }

  async function graphicsSet(): Promise<void> {
    const id = paneId();
    if (!id) return;
    const data = await ui.prompt({
      title: es.advanced.graphicsSet,
      label: 'PNG en base64',
      submitLabel: es.dialog.accept,
    });
    if (data === null || data.trim().length === 0) return;
    await run(es.advanced.graphicsSet, 'pane.graphics.set', {
      pane_id: id,
      format: 'png',
      image_width: 16,
      image_height: 16,
      data_base64: data.trim(),
    });
  }

  async function graphicsClear(): Promise<void> {
    const id = paneId();
    if (!id) return;
    await run(es.advanced.graphicsClear, 'pane.graphics.clear', { pane_id: id });
  }

  async function processInfo(): Promise<void> {
    const id = paneId();
    if (!id) return;
    await runViewer('pane.process_info', 'pane.process_info', { pane_id: id });
  }

  async function closePopup(): Promise<void> {
    await run(es.advanced.popupClose, 'popup.close', {});
  }

  async function liveHandoff(): Promise<void> {
    const accepted = await ui.confirm({
      title: es.advanced.liveHandoff,
      message: es.server.stopConfirmAgain,
      confirmLabel: es.advanced.liveHandoff,
      danger: true,
    });
    if (!accepted) return;
    await run(es.advanced.liveHandoff, 'server.live_handoff', {});
  }

  async function notifyTest(): Promise<void> {
    const outcome = await notificationShow();
    if (!outcome.ok) {
      error = errorText(outcome.error);
      return;
    }
    ui.notify(
      outcome.value?.delivered === false
        ? (outcome.value.reason ?? es.advanced.failed.replace('{error}', 'sin registro'))
        : es.advanced.notifySent,
      outcome.value?.delivered === false ? 'warn' : 'info',
    );
  }

  async function copySkill(): Promise<void> {
    const outcome = await cliRun(['herdr', '--skill']);
    if (!outcome.ok || outcome.value?.exit_code !== 0) {
      error = !outcome.ok
        ? errorText(outcome.error)
        : (outcome.value?.stderr.trim() ?? es.advanced.failed);
      return;
    }
    await writeText(outcome.value.stdout);
    ui.notify(es.advanced.skillCopied, 'info');
  }
</script>

{#if ui.advancedOpen}
  <Dialog
    title={es.advanced.title}
    onclose={() => ui.closeAdvanced()}
    width="44rem"
    testId="advanced-dialog"
  >
    {#if error}
      <p class="advanced__error" data-testid="advanced-error">{error}</p>
    {/if}

    <label class="advanced__source">
      <span>source</span>
      <input bind:value={source} data-testid="advanced-source" spellcheck="false" />
    </label>

    <section class="advanced__card">
      <h3 class="advanced__title">{es.advanced.agentView}</h3>
      <div class="advanced__actions">
        <button
          type="button"
          class="btn btn--small"
          data-testid="advanced-view-set"
          disabled={busy}
          onclick={() => void setAgentView()}
        >
          {es.advanced.agentViewSet}
        </button>
        <button
          type="button"
          class="btn btn--small"
          data-testid="advanced-view-clear"
          disabled={busy}
          onclick={() => void clearAgentView()}
        >
          {es.advanced.agentViewClear}
        </button>
      </div>
    </section>

    <section class="advanced__card">
      <h3 class="advanced__title">{es.advanced.metadata}</h3>
      <div class="advanced__actions">
        <button
          type="button"
          class="btn btn--small"
          data-testid="advanced-pane-metadata"
          disabled={busy}
          onclick={() => void reportPaneMetadata()}
        >
          {es.advanced.paneMetadata}
        </button>
        <button
          type="button"
          class="btn btn--small"
          data-testid="advanced-workspace-metadata"
          disabled={busy}
          onclick={() => void reportWorkspaceMetadata()}
        >
          {es.advanced.workspaceMetadata}
        </button>
        <button
          type="button"
          class="btn btn--small"
          data-testid="advanced-report-agent"
          disabled={busy}
          onclick={() => void reportAgent()}
        >
          {es.advanced.reportAgent}
        </button>
        <button
          type="button"
          class="btn btn--small"
          data-testid="advanced-report-agent-session"
          disabled={busy}
          onclick={() => void reportAgentSession()}
        >
          {es.advanced.reportAgent} (session)
        </button>
        <button
          type="button"
          class="btn btn--small"
          data-testid="advanced-release-agent"
          disabled={busy}
          onclick={() => void releaseAgent()}
        >
          {es.advanced.releaseAgent}
        </button>
        <button
          type="button"
          class="btn btn--small"
          data-testid="advanced-clear-authority"
          disabled={busy}
          onclick={() => void clearAuthority()}
        >
          {es.advanced.clearAuthority}
        </button>
        <button
          type="button"
          class="btn btn--small"
          data-testid="advanced-process-info"
          disabled={busy}
          onclick={() => void processInfo()}
        >
          pane.process_info
        </button>
      </div>
    </section>

    <section class="advanced__card">
      <h3 class="advanced__title">{es.advanced.windowTitle}</h3>
      <div class="advanced__actions">
        <button
          type="button"
          class="btn btn--small"
          data-testid="advanced-title-set"
          disabled={busy}
          onclick={() => void setWindowTitle()}
        >
          {es.advanced.windowTitleSet}
        </button>
        <button
          type="button"
          class="btn btn--small"
          data-testid="advanced-title-clear"
          disabled={busy}
          onclick={() => void run(es.advanced.windowTitleClear, 'client.window_title.clear', {})}
        >
          {es.advanced.windowTitleClear}
        </button>
      </div>
    </section>

    <section class="advanced__card">
      <h3 class="advanced__title">{es.advanced.graphics}</h3>
      <div class="advanced__actions">
        <button
          type="button"
          class="btn btn--small"
          data-testid="advanced-graphics-info"
          disabled={busy}
          onclick={() => void graphicsInfo()}
        >
          {es.advanced.graphicsInfo}
        </button>
        <button
          type="button"
          class="btn btn--small"
          data-testid="advanced-graphics-set"
          disabled={busy}
          onclick={() => void graphicsSet()}
        >
          {es.advanced.graphicsSet}
        </button>
        <button
          type="button"
          class="btn btn--small"
          data-testid="advanced-graphics-clear"
          disabled={busy}
          onclick={() => void graphicsClear()}
        >
          {es.advanced.graphicsClear}
        </button>
        <button
          type="button"
          class="btn btn--small"
          data-testid="advanced-popup-close"
          disabled={busy}
          onclick={() => void closePopup()}
        >
          {es.advanced.popupClose}
        </button>
      </div>
    </section>

    <section class="advanced__card">
      <h3 class="advanced__title">{es.server.title}</h3>
      <div class="advanced__actions">
        <button
          type="button"
          class="btn btn--small"
          data-testid="advanced-live-handoff"
          disabled={busy}
          onclick={() => void liveHandoff()}
        >
          {es.advanced.liveHandoff}
        </button>
        <button
          type="button"
          class="btn btn--small"
          data-testid="advanced-notify"
          disabled={busy}
          onclick={() => void notifyTest()}
        >
          {es.advanced.notifyTest}
        </button>
        <button
          type="button"
          class="btn btn--small"
          data-testid="advanced-skill"
          onclick={() => void copySkill()}
        >
          {es.advanced.skill}
        </button>
      </div>
    </section>

    {#snippet footer()}
      <button
        type="button"
        class="btn"
        data-testid="advanced-reload"
        onclick={() => (error = null)}
      >
        Actualizar
      </button>
      <button
        type="button"
        class="btn btn--primary"
        data-testid="advanced-close"
        onclick={() => ui.closeAdvanced()}
      >
        {es.dialog.close}
      </button>
    {/snippet}
  </Dialog>
{/if}

<style>
  .advanced__card {
    display: grid;
    gap: 4px;
    padding: var(--space-2);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-sm);
    background: var(--row-subtle-bg);
  }

  .advanced__title {
    margin: 0;
    font-size: 12px;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .advanced__actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }

  .advanced__source {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: 12px;
  }

  .advanced__source input {
    inline-size: 16rem;
    padding: 4px 8px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--glass-border);
    background: var(--control-bg-strong);
    color: var(--text);
    font: inherit;
    font-size: 12px;
  }

  .advanced__error {
    margin: 0;
    font-size: 12px;
    color: var(--red);
  }
</style>
