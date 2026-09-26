<!-- Toasts glass in-app (capa 2 del §3). Los nativos de Windows llegan en F2. -->
<script lang="ts">
  import { ui } from '../stores/ui.svelte';
</script>

<div class="toast-host" data-testid="toast-host">
  {#each ui.toasts as toast (toast.id)}
    <div class="toast glass-overlay" data-testid="toast" data-kind={toast.kind} role="status">
      <span>{toast.text}</span>
      <button
        type="button"
        class="toast__close"
        aria-label="Cerrar"
        onclick={() => ui.dismissToast(toast.id)}>×</button
      >
    </div>
  {/each}
</div>

<style>
  .toast-host {
    position: fixed;
    inset-block-end: calc(var(--statusbar-height) + var(--space-3));
    inset-inline-end: var(--space-4);
    z-index: 60;
    display: grid;
    gap: var(--space-2);
    inline-size: min(26rem, 60vw);
    pointer-events: none;
  }

  /* Entrada discreta: opacidad y unos píxeles de desplazamiento (nada de
     sombras ni filtros animados). */
  .toast {
    animation: toast-in 140ms ease-out;
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    font-size: 13px;
    border-radius: var(--radius-sm);
  }

  .toast[data-kind='warn'] {
    border-color: color-mix(in oklab, var(--yellow) 45%, transparent);
  }

  .toast[data-kind='error'] {
    border-color: color-mix(in oklab, var(--red) 55%, transparent);
  }

  .toast__close {
    margin-inline-start: auto;
    border: none;
    background: transparent;
    color: var(--text-dim);
    cursor: pointer;
    font-size: 16px;
    line-height: 1;
  }
  @keyframes toast-in {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .toast {
      animation: none;
    }
  }
</style>
