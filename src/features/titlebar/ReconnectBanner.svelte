<!-- T1.5 — Franja de reconexión: estado, backoff visible, el error REAL del backend
     y el botón para arrancar el servidor de la sesión activa. -->
<script lang="ts">
  import { flows } from '../../lib/actions/flows';
  import { errorText } from '../../lib/herdr/errors';
  import { es } from '../../lib/i18n/es';
  import { session } from '../../lib/stores/session.svelte';
  import { ui } from '../../lib/stores/ui.svelte';

  const attempt = $derived(session.retryAttempt);
  const detail = $derived(
    attempt > 0
      ? `${es.connection.retrying} · intento ${attempt} · ${((session.nextRetryInMs ?? 0) / 1000).toFixed(1)} s`
      : es.connection.connecting,
  );
  const sessionLabel = $derived(
    session.sessionName
      ? es.connection.sessionLabel.replace('{name}', session.sessionName)
      : es.connection.noSession,
  );
  // El error de la acción manual manda; si no, el último error de conexión.
  const error = $derived(session.startError ?? session.lastError);
</script>

{#if session.connection !== 'online'}
  <div class="reconnect glass" data-testid="reconnect-banner" data-state={session.connection}>
    <span class="reconnect__dot" aria-hidden="true"></span>
    <span data-testid="reconnect-text">{detail}</span>
    <span class="reconnect__session" data-testid="reconnect-session">{sessionLabel}</span>
    {#if error}
      <span class="reconnect__error" data-testid="reconnect-error" title={errorText(error)}>
        {errorText(error)}
      </span>
    {/if}
    <span class="reconnect__spacer"></span>
    {#if session.sessionName}
      <button
        type="button"
        class="reconnect__action"
        data-testid="reconnect-start-server"
        onclick={() => void flows.startServer()}
      >
        {es.connection.startServer}
      </button>
    {:else}
      <button
        type="button"
        class="reconnect__action"
        data-testid="reconnect-choose-session"
        onclick={() => ui.openSessions()}
      >
        {es.connection.chooseSession}
      </button>
    {/if}
    <button
      type="button"
      class="reconnect__action"
      data-testid="reconnect-retry"
      onclick={() => void session.connect()}
    >
      Reintentar ahora
    </button>
  </div>
{/if}

<style>
  .reconnect {
    display: flex;
    align-items: center;
    /* Banda propia: nunca debe llevarse el espacio del cuerpo. */
    flex: 0 0 auto;
    gap: var(--space-2);
    margin: var(--space-2) var(--space-2) 0;
    padding: 6px var(--space-3);
    border-radius: var(--radius-sm);
    font-size: 12px;
    color: var(--text-dim);
  }

  .reconnect__dot {
    inline-size: 8px;
    block-size: 8px;
    border-radius: 50%;
    background: var(--yellow);
  }

  .reconnect[data-state='offline'] .reconnect__dot {
    background: var(--red);
  }

  .reconnect__session {
    padding: 1px 8px;
    border-radius: 999px;
    background: var(--control-bg-inset);
    color: var(--text);
    font-size: 11px;
    white-space: nowrap;
  }

  .reconnect__error {
    min-inline-size: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--red);
  }

  .reconnect__spacer {
    flex: 1 1 auto;
  }

  .reconnect__action {
    padding: 2px 10px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--glass-border);
    background: var(--accent-bg-soft);
    color: var(--text);
    font: inherit;
    font-size: 11px;
    cursor: pointer;
    transition:
      background var(--t-fast) var(--ease),
      border-color var(--t-fast) var(--ease);
  }

  .reconnect__action:hover {
    background: var(--control-active-bg);
    border-color: var(--control-hover-border);
  }
</style>
