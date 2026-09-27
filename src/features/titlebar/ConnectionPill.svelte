<!-- Píldora de conexión (T1.5/T1.6): estado, latencia p50 del RPC y botón para
     arrancar el servidor cuando no hay conexión. -->
<script lang="ts">
  import { flows } from '../../lib/actions/flows';
  import { es } from '../../lib/i18n/es';
  import { session } from '../../lib/stores/session.svelte';

  const labels: Record<string, string> = {
    connecting: es.connection.connecting,
    online: es.connection.online,
    offline: es.connection.offline,
  };

  const state = $derived(session.connection);
  const label = $derived(
    state === 'offline' && session.retryAttempt > 0
      ? es.connection.retrying
      : (labels[state] ?? state),
  );
  const text = $derived(
    session.rpcLatency !== null && state === 'online'
      ? `${label} · ${es.connection.latency.replace('{ms}', session.rpcLatency.toFixed(1))}`
      : label,
  );
</script>

<span
  class="pill"
  data-testid="connection-pill"
  data-state={state}
  title={es.connection.offlineDetail}
>
  <span class="pill__dot"></span>
  <span data-testid="connection-text">{text}</span>
  {#if state === 'offline'}
    <button
      type="button"
      class="pill__action"
      data-testid="start-server"
      onclick={() => void flows.startServer()}
    >
      {es.connection.startServer}
    </button>
  {/if}
</span>

<style>
  .pill__action {
    margin-inline-start: 4px;
    padding: 1px 8px;
    border-radius: 999px;
    border: 1px solid var(--control-active-border);
    background: var(--accent-bg-soft);
    color: var(--text);
    font: inherit;
    font-size: 11px;
    cursor: pointer;
    transition:
      background var(--t-fast) var(--ease),
      border-color var(--t-fast) var(--ease);
  }

  .pill__action:hover {
    background: var(--control-active-bg);
    border-color: var(--control-hover-border);
  }
</style>
