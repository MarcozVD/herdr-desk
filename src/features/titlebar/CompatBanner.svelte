<!-- C1 — Banner PERSISTENTE de incompatibilidad cliente/servidor: el server de la
     sesión usa un protocolo privado viejo, así que sus bridges mueren al nacer.
     No es un toast: se queda hasta reiniciar la sesión (botón con confirmación,
     porque el reinicio mata los procesos de los paneles). -->
<script lang="ts">
  import { flows } from '../../lib/actions/flows';
  import { es } from '../../lib/i18n/es';
  import { session } from '../../lib/stores/session.svelte';

  const compat = $derived(session.compat);
  const message = $derived(
    es.connection.compatBanner
      .replace('{session}', session.sessionName ?? '')
      .replace('{server}', compat?.server_version ?? '?')
      .replace('{protocol}', String(compat?.server_protocol ?? '?'))
      .replace('{client}', compat?.client_version ?? '?'),
  );
</script>

{#if session.compatIncompatible}
  <div class="compat glass" data-testid="compat-banner" role="alert">
    <span class="compat__dot" aria-hidden="true"></span>
    <span class="compat__text" data-testid="compat-text">{message}</span>
    <span class="compat__spacer"></span>
    <button
      type="button"
      class="compat__action"
      data-testid="compat-restart"
      onclick={() => void flows.restartSession()}
    >
      {es.connection.compatRestart}
    </button>
  </div>
{/if}

<style>
  .compat {
    display: flex;
    align-items: center;
    /* Banda propia: nunca debe llevarse el espacio del cuerpo. */
    flex: 0 0 auto;
    gap: var(--space-2);
    margin: var(--space-2) var(--space-2) 0;
    padding: 6px var(--space-3);
    border-radius: var(--radius-sm);
    font-size: 12px;
    color: var(--text);
  }

  .compat__dot {
    inline-size: 8px;
    block-size: 8px;
    border-radius: 50%;
    background: var(--red);
    flex: 0 0 auto;
  }

  .compat__text {
    min-inline-size: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .compat__spacer {
    flex: 1 1 auto;
  }

  .compat__action {
    flex: 0 0 auto;
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

  .compat__action:hover {
    background: var(--control-active-bg);
    border-color: var(--control-hover-border);
  }
</style>
