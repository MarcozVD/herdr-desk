<!-- T1.11 — Selector de sesiones: listar, conectar, iniciar, detener y borrar.
     `session_list` es del CLI; conectar/arrancar/detener/borrar son commands del §5
     que el backend aún no expone: si faltan se avisa y no se rompe nada. -->
<script lang="ts">
  import {
    sessionConnect,
    sessionDelete,
    sessionList,
    sessionStart,
    sessionStop,
  } from '../../lib/herdr/client';
  import { describeApiError } from '../../lib/herdr/errors';
  import type { SessionInfo } from '../../lib/herdr/types';
  import { es } from '../../lib/i18n/es';
  import { session } from '../../lib/stores/session.svelte';
  import { ui } from '../../lib/stores/ui.svelte';
  import Dialog from '../../lib/ui/Dialog.svelte';

  let sessions = $state<SessionInfo[]>([]);
  let loadError = $state<string | null>(null);
  let busy = $state<string | null>(null);

  async function load(): Promise<void> {
    try {
      sessions = await sessionList();
      loadError = null;
    } catch (raw) {
      loadError = describeApiError(raw, { session: session.sessionName ?? '' });
    }
  }

  $effect(() => {
    if (ui.sessionsOpen) void load();
  });

  async function start(target: SessionInfo): Promise<boolean> {
    busy = target.name;
    const started = await sessionStart(target.name);
    busy = null;
    if (!started) {
      ui.notify(es.connection.unavailable.replace('{command}', 'session_start'), 'warn');
      return false;
    }
    await load();
    return true;
  }

  async function connect(target: SessionInfo): Promise<void> {
    if (!target.running) {
      const started = await start(target);
      if (!started) return;
    }
    busy = target.name;
    const connected = await sessionConnect(target.name);
    busy = null;
    if (!connected) {
      ui.notify(es.connection.unavailable.replace('{command}', 'session_connect'), 'warn');
      return;
    }
    await session.setSessionName(target.name);
    await session.connect();
    ui.notify(`${es.app.session}: ${target.name}`, 'info');
    ui.closeSessions();
  }

  async function stop(target: SessionInfo): Promise<void> {
    const accepted = await ui.confirm({
      title: es.sessions.stop,
      message: es.sessions.stopConfirm.replace('{name}', target.name),
      confirmLabel: es.sessions.stop,
      danger: true,
    });
    if (!accepted) return;
    const stopped = await sessionStop(target.name);
    if (!stopped) {
      ui.notify(es.connection.unavailable.replace('{command}', 'session_stop'), 'warn');
      return;
    }
    await load();
  }

  async function remove(target: SessionInfo): Promise<void> {
    const accepted = await ui.confirm({
      title: es.sessions.delete,
      message: es.sessions.deleteConfirm.replace('{name}', target.name),
      confirmLabel: es.sessions.delete,
      requireText: target.name,
      danger: true,
    });
    if (!accepted) return;
    const deleted = await sessionDelete(target.name);
    if (!deleted) {
      ui.notify(es.connection.unavailable.replace('{command}', 'session_delete'), 'warn');
      return;
    }
    await load();
  }

  async function createSession(): Promise<void> {
    const name = await ui.prompt({
      title: es.sessions.newSession,
      label: es.sessions.newSessionHint,
      validate: (value) =>
        /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/.test(value) ? null : es.sessions.invalidName,
      submitLabel: es.sessions.start,
    });
    if (name === null) return;
    const started = await sessionStart(name);
    if (!started) {
      ui.notify(es.connection.unavailable.replace('{command}', 'session_start'), 'warn');
      return;
    }
    await load();
  }
</script>

{#if ui.sessionsOpen}
  <Dialog
    title={es.sessions.list}
    onclose={() => ui.closeSessions()}
    width="34rem"
    testId="sessions-dialog"
  >
    {#if loadError}
      <p class="sessions__error" data-testid="sessions-error">
        {es.sessions.unreachable} · {loadError}
      </p>
    {:else}
      <ul class="sessions" data-testid="session-list">
        {#each sessions as item (item.name)}
          <li class="sessions__row" data-testid="session-row" data-name={item.name}>
            <span class="sessions__dot" data-state={item.running ? 'online' : 'offline'}></span>
            <span class="sessions__name">{item.name}</span>
            {#if item.default}<span class="sessions__tag">default</span>{/if}
            {#if item.name === session.sessionName}
              <span class="sessions__tag" data-testid="session-current">{es.sessions.current}</span>
            {/if}
            <span class="sessions__state">
              {item.running ? es.sessions.running : es.sessions.stopped}
            </span>
            <span class="sessions__actions">
              <button
                type="button"
                class="btn btn--small"
                data-testid="session-connect"
                disabled={busy !== null}
                onclick={() => void connect(item)}
              >
                {es.sessions.connect}
              </button>
              {#if item.running}
                <button
                  type="button"
                  class="btn btn--small"
                  data-testid="session-stop"
                  disabled={busy !== null}
                  onclick={() => void stop(item)}
                >
                  {es.sessions.stop}
                </button>
              {:else}
                <button
                  type="button"
                  class="btn btn--small"
                  data-testid="session-start"
                  disabled={busy !== null}
                  onclick={() => void start(item)}
                >
                  {es.sessions.start}
                </button>
                <button
                  type="button"
                  class="btn btn--small btn--danger"
                  data-testid="session-delete"
                  disabled={busy !== null}
                  onclick={() => void remove(item)}
                >
                  {es.sessions.delete}
                </button>
              {/if}
            </span>
          </li>
        {/each}
      </ul>
      <p class="sessions__note">{es.sessions.switchNote}</p>
    {/if}

    {#snippet footer()}
      <button
        type="button"
        class="btn"
        data-testid="sessions-new"
        onclick={() => void createSession()}
      >
        + {es.sessions.newSession}
      </button>
      <button type="button" class="btn" data-testid="sessions-reload" onclick={() => void load()}>
        Actualizar
      </button>
      <button
        type="button"
        class="btn btn--primary"
        data-testid="sessions-close"
        onclick={() => ui.closeSessions()}
      >
        {es.dialog.close}
      </button>
    {/snippet}
  </Dialog>
{/if}

<style>
  .sessions {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-1);
  }

  .sessions__row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 5px var(--space-2);
    border-radius: var(--radius-sm);
    background: color-mix(in oklab, var(--panel-bg) 35%, transparent);
    font-size: 13px;
  }

  .sessions__dot {
    inline-size: 8px;
    block-size: 8px;
    border-radius: 50%;
    background: var(--surface-dim);
  }

  .sessions__dot[data-state='online'] {
    background: var(--green);
  }

  .sessions__name {
    font-family: var(--font-mono);
  }

  .sessions__tag {
    padding: 0 6px;
    border-radius: 999px;
    border: 1px solid var(--glass-border);
    font-size: 10px;
    color: var(--text-dim);
  }

  .sessions__state {
    font-size: 11px;
    color: var(--text-dim);
  }

  .sessions__actions {
    margin-inline-start: auto;
    display: flex;
    gap: var(--space-1);
  }

  .sessions__note,
  .sessions__error {
    margin: 0;
    font-size: 11px;
    color: var(--text-dim);
  }

  .sessions__error {
    color: var(--red);
  }
</style>
