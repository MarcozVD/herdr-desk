<!-- Píldora de conexión: estado del store y latencia del último ping (§3). -->
<script lang="ts">
  import { es } from '../i18n/es';
  import { session } from '../stores/session.svelte';

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
</span>
