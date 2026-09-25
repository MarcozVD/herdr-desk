<!-- T1.5 — Franja de reconexión: backoff visible y botón para arrancar el servidor. -->
<script lang="ts">
  import { flows } from '../../lib/actions/flows';
  import { es } from '../../lib/i18n/es';
  import { session } from '../../lib/stores/session.svelte';

  const attempt = $derived(session.retryAttempt);
  const detail = $derived(
    attempt > 0
      ? `${es.connection.retrying} · intento ${attempt} · ${((session.nextRetryInMs ?? 0) / 1000).toFixed(1)} s`
      : es.connection.connecting,
  );
</script>

{#if session.connection !== 'online'}
  <div class="reconnect glass" data-testid="reconnect-banner" data-state={session.connection}>
    <span class="reconnect__dot" aria-hidden="true"></span>
    <span data-testid="reconnect-text">{detail}</span>
    <span class="reconnect__spacer"></span>
    <button
      type="button"
      class="reconnect__action"
      data-testid="reconnect-start-server"
      onclick={() => void flows.startServer()}
    >
      {es.connection.startServer}
    </button>
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

  .reconnect__spacer {
    flex: 1 1 auto;
  }

  .reconnect__action {
    padding: 2px 10px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--glass-border);
    background: color-mix(in oklab, var(--accent) 20%, transparent);
    color: var(--text);
    font: inherit;
    font-size: 11px;
    cursor: pointer;
  }
</style>
