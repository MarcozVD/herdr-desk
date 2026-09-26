<!-- T1.7 — Marco de un panel: header con estado, título, cwd y acciones; cuerpo con
     la terminal. El borde y el gap los controlan pane_borders / pane_gaps. -->
<script lang="ts">
  import { flows } from '../../lib/actions/flows';
  import { es } from '../../lib/i18n/es';
  import TerminalView from '../../lib/terminal/TerminalView.svelte';
  import { paneTitle, shortPath } from '../../lib/stores/snapshot';
  import { session } from '../../lib/stores/session.svelte';
  import { settings } from '../../lib/stores/settings.svelte';
  import { visible } from '../../lib/stores/visible.svelte';
  import AgentDot from '../../lib/ui/AgentDot.svelte';

  interface Props {
    paneId: string;
  }

  let { paneId }: Props = $props();

  const pane = $derived(session.panes.find((item) => item.pane_id === paneId) ?? null);
  const status = $derived(pane?.agent_status ?? 'unknown');
  const active = $derived(visible.paneId === paneId);
  const title = $derived(paneTitle(pane) || paneId);

  function focus(): void {
    if (!active) flows.focusPane(paneId);
  }

  /**
   * Foco local del panel desde el pointerdown del marco, ACOTADO: si el
   * pointerdown nace en un control interactivo (los botones del header, la
   * barra de scroll de la terminal…) no se toca el foco. Un cambio de foco
   * disparado desde ahí puede desmontar o re-clavar el nodo entre el
   * pointerdown y el mouseup, y el navegador entonces NO entrega el `click`
   * (mousedown y mouseup deben apuntar al mismo nodo vivo): los botones del
   * panel dejaban de responder. El resto del marco (título, fondo del cuerpo)
   * sigue enfocando como antes.
   */
  function onFramePointerDown(event: PointerEvent): void {
    const target = event.target as Element | null;
    if (target?.closest('button, a, input, textarea, select, [data-no-pane-focus]')) return;
    focus();
  }
</script>

<article
  class="pane-frame"
  class:active
  data-testid="pane-frame"
  data-pane-id={paneId}
  data-status={status}
  data-active={active}
  data-borders={settings.values.pane_borders}
  onpointerdown={onFramePointerDown}
>
  <header
    class="pane-header"
    role="toolbar"
    tabindex="-1"
    aria-label={title}
    oncontextmenu={(event) => flows.openPaneMenu(event, paneId)}
  >
    <AgentDot {status} label={es.agentStatus[status]} />
    <span class="pane-header__title" data-testid="pane-title">{title}</span>
    <span class="pane-header__meta" data-testid="pane-status">{es.agentStatus[status]}</span>
    <span class="pane-header__spacer"></span>
    <span class="pane-header__meta" data-testid="pane-cwd">{shortPath(pane?.cwd)}</span>
    <span class="pane-header__actions">
      <button
        type="button"
        class="pane-header__action"
        data-testid="pane-split-right"
        title={es.panes.splitRight}
        aria-label={es.panes.splitRight}
        onclick={() => void flows.splitPane('right', paneId)}>◫</button
      >
      <button
        type="button"
        class="pane-header__action"
        data-testid="pane-split-down"
        title={es.panes.splitDown}
        aria-label={es.panes.splitDown}
        onclick={() => void flows.splitPane('down', paneId)}>⬓</button
      >
      <button
        type="button"
        class="pane-header__action"
        data-testid="pane-zoom"
        title={es.panes.zoom}
        aria-label={es.panes.zoom}
        onclick={() => void flows.toggleZoom(paneId)}>⤢</button
      >
      <button
        type="button"
        class="pane-header__action"
        data-testid="pane-menu"
        title={es.panes.rename}
        aria-label={es.panes.rename}
        onclick={(event) => flows.openPaneMenu(event, paneId)}>…</button
      >
      <button
        type="button"
        class="pane-header__action"
        data-testid="pane-close"
        title={es.panes.close}
        aria-label={es.panes.close}
        onclick={() => void flows.closePane(paneId)}>×</button
      >
    </span>
  </header>

  <div class="pane-frame__body">
    <!-- Montado == visible: el Pool solo abre bridge para los panes montados (los
         de la pestaña activa). Al ocultarse la pestaña el componente se desmonta
         y el pool libera el bridge con su gracia. -->
    <TerminalView {paneId} />
  </div>
</article>

<style>
  .pane-frame {
    position: relative;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    min-block-size: 0;
    min-inline-size: 0;
    block-size: 100%;
    inline-size: 100%;
    border-radius: var(--radius-sm);
    background: var(--panel-bg-solid);
    overflow: hidden;
  }

  /* T2.4 — Glow de estado del agente en el marco. La sombra es FIJA y solo se
     anima `opacity`: animar `box-shadow` o `filter` obliga a repintar el marco
     entero (guardarraíl del plan §4). Cada estado usa un token de color de
     herdr; `unknown` no pinta nada porque es el estado de un panel SIN agente
     (encendería todos los paneles) y `idle` es un latido apagado. */
  .pane-frame::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    pointer-events: none;
    box-shadow:
      inset 0 0 0 1px color-mix(in oklab, var(--pane-glow, transparent) 60%, transparent),
      0 0 10px color-mix(in oklab, var(--pane-glow, transparent) 35%, transparent);
    opacity: 0;
    transition: opacity 180ms var(--ease);
  }

  .pane-frame[data-status='working'] {
    --pane-glow: var(--blue);
  }

  .pane-frame[data-status='blocked'] {
    --pane-glow: var(--yellow);
  }

  .pane-frame[data-status='done'] {
    --pane-glow: var(--green);
  }

  .pane-frame[data-status='idle'] {
    --pane-glow: var(--text-dim);
  }

  .pane-frame[data-status='working']::after,
  .pane-frame[data-status='blocked']::after,
  .pane-frame[data-status='done']::after {
    opacity: 0.75;
  }

  .pane-frame[data-status='idle']::after {
    opacity: 0.35;
  }

  /* `working` late para que se vea que el agente está vivo (solo opacity). */
  .pane-frame[data-status='working']::after {
    animation: pane-glow-pulse 1.6s var(--ease) infinite;
  }

  @keyframes pane-glow-pulse {
    0%,
    100% {
      opacity: 0.45;
    }

    50% {
      opacity: 0.85;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .pane-frame[data-status='working']::after {
      animation: none;
      opacity: 0.7;
    }
  }

  .pane-frame[data-borders='true'] {
    border: 1px solid var(--glass-border);
  }

  .pane-frame.active {
    border-color: color-mix(in oklab, var(--accent) 45%, transparent);
  }

  .pane-frame__body {
    position: relative;
    min-block-size: 0;
    min-inline-size: 0;
    display: flex;
  }

  .pane-header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 4px var(--space-2);
    background: var(--pane-header-bg);
    border-block-end: 1px solid var(--glass-border);
    font-size: 12px;
    color: var(--text-dim);
    user-select: none;
  }

  .pane-header__title {
    color: var(--text);
    font-weight: 500;
    max-inline-size: 22rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pane-header__meta {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .pane-header__spacer {
    flex: 1 1 auto;
  }

  .pane-header__actions {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .pane-header__action {
    display: grid;
    place-items: center;
    inline-size: 22px;
    block-size: 20px;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: var(--text-dim);
    font-size: 13px;
    line-height: 1;
    cursor: pointer;
  }

  .pane-header__action:hover {
    background: color-mix(in oklab, var(--text) 12%, transparent);
    color: var(--text);
  }
</style>
