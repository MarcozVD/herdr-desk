<!-- Terminal de un panel: instancia de xterm del pool sobre el bridge de herdr.
     Reglas del §4/§7:
     - los frames NO entran en la reactividad: van a xterm por FrameWriter (pool)
     - un frame `full` descarta los frames anteriores en cola
     - el input se reenvía tal cual llega (R3): flechas, Ctrl+C y pegado multilínea
     - el foco es local (R11): el clic enfoca la terminal, no manda IPC a herdr
     - solo los panes VISIBLES tienen bridge (`active`), el resto se libera -->
<script lang="ts">
  import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager';
  import { onMount } from 'svelte';

  import '@xterm/xterm/css/xterm.css';

  import { es } from '../i18n/es';
  import { paneApi } from '../herdr/actions';
  import { session } from '../stores/session.svelte';
  import { settings } from '../stores/settings.svelte';
  import { ui } from '../stores/ui.svelte';
  import {
    agentPane,
    cellAt,
    isLinkClick,
    mouseSequence,
    sgrButton,
    sgrModifiers,
    wantsLocalSelection,
  } from './mouse';
  import { pool } from './pool';
  import type { BridgeState, TerminalEntry, TerminalViewState } from './pool';
  import {
    absolutePoint,
    topAbsoluteRow,
    visibleSelection,
    type ScrollInfo,
    type TextPoint,
  } from './selection';

  interface Props {
    paneId: string;
    /** Panes visibles: solo ellos tienen bridge abierto. */
    active?: boolean;
  }

  let { paneId, active = true }: Props = $props();

  let host = $state<HTMLDivElement | null>(null);
  let ready = $state(false);
  let bridgeState = $state<BridgeState>('idle');
  let closeReason = $state('');
  let errorText = $state('');

  const pane = $derived(session.panes.find((item) => item.pane_id === paneId) ?? null);

  // Fuera de la reactividad: entrada del pool, vista actual y handles.
  let entry: TerminalEntry | null = null;
  let view: TerminalViewState | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let fitFrame: number | null = null;
  /** ¿El host viene de un arrastre del divisor? (para el resize final al soltar). */
  let dragActive = false;
  let frameTotal = 0;
  let settleFrame: number | null = null;

  function syncFromEntry(source: TerminalEntry): void {
    bridgeState = source.state;
    closeReason = source.closeReason;
    errorText = source.errorText;
  }

  // Registro para los e2e (mismo gancho en dev y en el build `--mode e2e`).
  const TEST_HOOKS = import.meta.env.DEV || import.meta.env.MODE === 'e2e';

  function registerTestTerminal(id: string, term: TerminalViewState['terminal']): void {
    if (!TEST_HOOKS) return;
    const registry = window as unknown as { __HD_TERMS__?: Record<string, unknown> };
    registry.__HD_TERMS__ ??= {};
    registry.__HD_TERMS__[id] = term;
  }

  function unregisterTestTerminal(id: string): void {
    if (!TEST_HOOKS) return;
    const registry = window as unknown as { __HD_TERMS__?: Record<string, unknown> };
    if (registry.__HD_TERMS__) delete registry.__HD_TERMS__[id];
  }

  async function copySelection(): Promise<void> {
    // T4k — durante un arrastre con autoscroll la copia la decide el mouseup
    // (con la selección del server); copiar el trozo local pisaría el portapapeles.
    if (selectionDrag) return;
    const text = view?.terminal.getSelection() ?? '';
    if (text.length === 0) return;
    try {
      await writeText(text);
    } catch {
      ui.notify(es.terminal.clipboardUnavailable, 'warn');
    }
  }

  async function pasteFromClipboard(): Promise<void> {
    if (!entry) return;
    try {
      const text = await readText();
      if (!text || text.length === 0) return;
      // `paste` de xterm aplica bracketed paste si la app lo pidió y normaliza
      // los saltos de línea; el resultado sale por onData → pool.send.
      if (view) view.terminal.paste(text);
      else pool.send(paneId, text);
    } catch {
      ui.notify(es.terminal.clipboardUnavailable, 'warn');
    }
  }

  function applyFit(): void {
    if (!view) return;
    // Con el contenedor sin tamaño (pestaña oculta, primer render) el `fit`
    // calcularía 0 columnas y xterm REDIMENSIONA su buffer a ese tamaño: al
    // volver el panel se quedaba en negro. Se espera al próximo evento.
    if (!host || host.clientWidth === 0 || host.clientHeight === 0) return;
    try {
      view.fit.fit();
    } catch {
      // El contenedor todavía no tiene tamaño: se reintenta en el próximo evento.
    }
  }

  /** ¿El host está dentro de un divisor que se está arrastrando? (SplitTree). */
  function splitDragging(): boolean {
    return host?.closest('.split[data-dragging="true"]') !== null;
  }

  /**
   * Ajusta xterm al contenedor y avisa al bridge si el tamaño difiere del que
   * tiene el SERVIDOR (`entry.lastCols/lastRows`), no del de la vista anterior:
   * una vista nueva nace con el tamaño bueno y, comparando con ella, el resize
   * nunca salía y el panel quedaba pintado a medias (hasta mover el divisor).
   */
  function syncSize(): void {
    if (!entry || !view) return;
    // Arrastre del divisor: solo reflow LOCAL por frame (el gesto se ve fluido).
    // No se pide resize al server aquí: cada `terminal_resize` hace que el server
    // redibuje entero y, cambiando la rejilla cada frame, los `full` no cuadran y
    // dispararían reintentos (más tráfico que antes). El resize al server se manda
    // UNA vez al soltar (`onDragRelease`), con el tamaño final.
    if (splitDragging() && host) {
      dragActive = true;
      applyFit();
      return;
    }
    // Con bridge vivo NO se redimensiona xterm aquí: se pide el tamaño al server
    // y xterm cambia de rejilla justo antes de pintar el `full` que llega con
    // ese tamaño (pool.ts). Redimensionar antes reordenaba el contenido viejo y
    // al llegar el full se repintaba otra vez: las terminales «temblaban» al
    // abrir/cerrar la barra lateral.
    if (entry.bridgeId === null || entry.state !== 'open') {
      applyFit();
      return;
    }
    if (!host || host.clientWidth === 0 || host.clientHeight === 0) return;
    const proposed = view.fit.proposeDimensions();
    if (!proposed || !Number.isFinite(proposed.cols) || !Number.isFinite(proposed.rows)) return;
    const cols = Math.max(1, proposed.cols);
    const rows = Math.max(1, proposed.rows);
    if (cols === view.terminal.cols && rows === view.terminal.rows) {
      if (cols !== entry.lastCols || rows !== entry.lastRows) pool.resize(paneId, cols, rows);
      return;
    }
    pool.resizeDeferred(paneId, cols, rows);
  }

  /**
   * Un fit por frame: coalesce los `ResizeObserver` (arrastre del divisor,
   * cambio de ventana) sin el retardo fijo de 60 ms.
   */
  function scheduleFit(): void {
    if (fitFrame !== null) return;
    fitFrame = requestAnimationFrame(() => {
      fitFrame = null;
      syncSize();
    });
  }

  /**
   * Al soltar el divisor: reajuste local con el layout ya asentado y, si hubo
   * arrastre, UN resize al server con el tamaño final (throttle natural: uno por
   * gesto, sin contar reintentos por frame).
   */
  function onDragRelease(): void {
    const wasDragging = dragActive;
    dragActive = false;
    if (wasDragging && entry && view) {
      applyFit();
      if (entry.bridgeId !== null && entry.state === 'open') {
        const cols = view.terminal.cols;
        const rows = view.terminal.rows;
        if (cols !== entry.lastCols || rows !== entry.lastRows) {
          pool.resizeDeferred(paneId, cols, rows);
          return;
        }
      }
    }
    settleSize();
  }

  /** Reajuste tras asentarse el layout (dos frames) y cuando cargan las fuentes. */
  function settleSize(): void {
    if (settleFrame !== null) cancelAnimationFrame(settleFrame);
    settleFrame = requestAnimationFrame(() => {
      settleFrame = requestAnimationFrame(() => {
        settleFrame = null;
        syncSize();
      });
    });
  }

  /** Celda 1-based del puntero sobre la rejilla de la vista (o 1,1 sin host). */
  function pointerCell(event: MouseEvent | WheelEvent): { col: number; row: number } {
    const terminal = view?.terminal;
    if (!terminal || !host) return { col: 1, row: 1 };
    return cellAt(
      host.getBoundingClientRect(),
      terminal.cols,
      terminal.rows,
      event.clientX,
      event.clientY,
    );
  }

  /** Secuencia SGR de rueda del ratón (botones 64/65) en la celda del puntero. */
  function wheelSequence(event: WheelEvent, up: boolean): string {
    const { col, row } = pointerCell(event);
    return `\x1b[<${up ? 64 : 65};${col};${row}M`;
  }

  /** Botón del ratón que se está reenviando a la app (null si no hay arrastre). */
  let dragButton: number | null = null;
  /** Última celda reenviada durante el arrastre (para no spamear motion). */
  let lastDragCell = '';

  /**
   * T4k — Arrastre de selección que puede salir del panel. El scrollback vive en
   * el server, así que al cruzar el borde se pide scroll y se lee la selección
   * con `pane.selection.read` en puntos absolutos.
   */
  interface SelectionDrag {
    anchor: TextPoint;
    cursor: TextPoint;
    col: number;
    offset: number;
    maxOffset: number;
    viewportRows: number;
    direction: 'up' | 'down' | null;
    timer: ReturnType<typeof setInterval> | null;
    readTimer: ReturnType<typeof setTimeout> | null;
    text: string;
    readSeq: number;
    scrolled: boolean;
  }
  let selectionDrag: SelectionDrag | null = null;

  function scrollInfoOf(drag: SelectionDrag): ScrollInfo {
    return {
      offset_from_bottom: drag.offset,
      max_offset_from_bottom: drag.maxOffset,
      viewport_rows: drag.viewportRows,
    };
  }

  function stopSelectionAutoscroll(drag: SelectionDrag): void {
    if (drag.timer !== null) clearInterval(drag.timer);
    drag.timer = null;
    drag.direction = null;
  }

  function clearSelectionReadTimer(drag: SelectionDrag): void {
    if (drag.readTimer !== null) clearTimeout(drag.readTimer);
    drag.readTimer = null;
  }

  /** Aplica a xterm el trozo visible de la selección absoluta (solo tras scroll). */
  function paintServerSelection(drag: SelectionDrag): void {
    const terminal = view?.terminal;
    if (!terminal) return;
    const range = visibleSelection(drag.anchor, drag.cursor, scrollInfoOf(drag), terminal.cols);
    if (!range) return;
    terminal.select(range.column, range.row, range.length);
  }

  async function readServerSelection(drag: SelectionDrag): Promise<void> {
    const seq = (drag.readSeq += 1);
    try {
      const text = await paneApi.selectionText(paneId, drag.anchor, drag.cursor);
      // Una respuesta vieja no puede pisar a la nueva ni a un arrastre cerrado.
      if (selectionDrag === drag && drag.readSeq === seq) drag.text = text;
    } catch {
      // Si el server no soporta la lectura, queda la selección local de xterm.
    }
  }

  function scheduleSelectionRead(drag: SelectionDrag): void {
    clearSelectionReadTimer(drag);
    // El frame del scroll y la respuesta del RPC van por canales distintos: se
    // espera un tick corto para leer el viewport ya movido, no el anterior.
    drag.readTimer = setTimeout(() => {
      drag.readTimer = null;
      if (selectionDrag === drag) void readServerSelection(drag);
    }, 30);
  }

  function stepSelectionScroll(drag: SelectionDrag): void {
    if (selectionDrag !== drag || drag.direction === null) return;
    const direction = drag.direction;
    if (direction === 'up' ? drag.offset >= drag.maxOffset : drag.offset <= 0) {
      stopSelectionAutoscroll(drag);
      return;
    }
    drag.offset += direction === 'up' ? 1 : -1;
    drag.scrolled = true;
    pool.scroll(paneId, direction, 1, true);
    const top = topAbsoluteRow(scrollInfoOf(drag));
    // El punto sigue a la fila visible del borde: al subir, la que acaba de
    // entrar arriba; al bajar, la última visible (no la siguiente, que aún no
    // se ha pintado). Si no, la selección copiada incluía una fila de más.
    drag.cursor = {
      row: direction === 'up' ? top : top + drag.viewportRows - 1,
      col: drag.col,
    };
    scheduleSelectionRead(drag);
  }

  function startSelectionAutoscroll(drag: SelectionDrag, direction: 'up' | 'down'): void {
    drag.direction = direction;
    if (drag.timer !== null) return;
    stepSelectionScroll(drag);
    if (drag.timer === null && drag.direction !== null) {
      drag.timer = setInterval(() => stepSelectionScroll(drag), 90);
    }
  }

  function onSelectionMouseDown(event: MouseEvent): void {
    if (event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey) return;
    if (forwardsMouse(event)) return;
    const scroll = pane?.scroll;
    if (!scroll || scroll.viewport_rows <= 0) return;
    const cell = pointerCell(event);
    const anchor = absolutePoint(scroll, cell.row - 1, cell.col - 1);
    selectionDrag = {
      anchor,
      cursor: anchor,
      col: anchor.col,
      offset: scroll.offset_from_bottom,
      maxOffset: scroll.max_offset_from_bottom,
      viewportRows: scroll.viewport_rows,
      direction: null,
      timer: null,
      readTimer: null,
      text: '',
      readSeq: 0,
      scrolled: false,
    };
    window.addEventListener('mousemove', onSelectionMouseMove, true);
    window.addEventListener('mouseup', onSelectionMouseUp, true);
  }

  function onSelectionMouseMove(event: MouseEvent): void {
    const drag = selectionDrag;
    if (!drag || !host) return;
    const rect = host.getBoundingClientRect();
    const cell = pointerCell(event);
    drag.col = cell.col - 1;
    if (event.clientY < rect.top - 4) {
      startSelectionAutoscroll(drag, 'up');
      return;
    }
    if (event.clientY > rect.bottom + 4) {
      startSelectionAutoscroll(drag, 'down');
      return;
    }
    stopSelectionAutoscroll(drag);
    const top = topAbsoluteRow(scrollInfoOf(drag));
    const row = Math.min(drag.viewportRows - 1, Math.max(0, cell.row - 1));
    drag.cursor = { row: top + row, col: drag.col };
    if (drag.scrolled) {
      paintServerSelection(drag);
      scheduleSelectionRead(drag);
    }
  }

  async function copyText(text: string): Promise<void> {
    if (text.length === 0) return;
    try {
      await writeText(text);
    } catch {
      ui.notify(es.terminal.clipboardUnavailable, 'warn');
    }
  }

  async function onSelectionMouseUp(): Promise<void> {
    const drag = selectionDrag;
    if (!drag) return;
    stopSelectionAutoscroll(drag);
    clearSelectionReadTimer(drag);
    window.removeEventListener('mousemove', onSelectionMouseMove, true);
    window.removeEventListener('mouseup', onSelectionMouseUp, true);
    // La selección que cruzó el borde solo existe en el server: se lee una vez
    // más con el punto final (el último `mousemove` pudo quedar sin respuesta) y
    // se copia al soltar. La local de xterm sigue el camino de copy_on_select.
    if (drag.scrolled) {
      await readServerSelection(drag);
      clearSelectionReadTimer(drag);
      selectionDrag = null;
      if (drag.text.length > 0) {
        await copyText(drag.text);
        return;
      }
    } else {
      selectionDrag = null;
    }
    if (settings.values.copy_on_select) {
      queueMicrotask(() => {
        const text = view?.terminal.getSelection() ?? '';
        if (text.length > 0) void copyText(text);
      });
    }
  }

  /**
   * ¿La GUI debe reenviar el ratón a la app en vez de que xterm seleccione?
   * Solo en panes con agente, sin mouse tracking nativo y sin los modificadores
   * que la GUI se reserva (Shift = selección local, Ctrl/Cmd = link).
   */
  function forwardsMouse(event: MouseEvent): boolean {
    if (!view) return false;
    const terminal = view.terminal;
    if (terminal.modes.mouseTrackingMode !== 'none') return false; // xterm ya lo reporta
    if (!agentPane(pane, terminal)) return false;
    if (wantsLocalSelection(event)) return false;
    if (isLinkClick(event)) return false;
    return event.button === 0 || event.button === 1 || event.button === 2;
  }

  function onSurfaceMouseDown(event: MouseEvent): void {
    if (!forwardsMouse(event)) return;
    const terminal = view?.terminal;
    if (!terminal) return;
    // Se corta la propagación para que xterm no arranque una selección con este
    // gesto: el clic es para la app. El foco de teclado se le da a mano.
    event.preventDefault();
    event.stopPropagation();
    terminal.focus();
    dragButton = event.button;
    lastDragCell = '';
    const { col, row } = pointerCell(event);
    pool.send(
      paneId,
      mouseSequence({ button: sgrButton(event.button), col, row, modifiers: sgrModifiers(event) }),
    );
    window.addEventListener('mousemove', onWindowMouseMove);
    window.addEventListener('mouseup', onWindowMouseUp);
  }

  function onWindowMouseMove(event: MouseEvent): void {
    if (dragButton === null) return;
    const { col, row } = pointerCell(event);
    const key = `${col}:${row}`;
    if (key === lastDragCell) return; // sin cambio de celda no hay motion que mandar
    lastDragCell = key;
    pool.send(paneId, mouseSequence({ button: sgrButton(dragButton), col, row, motion: true }));
  }

  function onWindowMouseUp(event: MouseEvent): void {
    const button = dragButton;
    dragButton = null;
    window.removeEventListener('mousemove', onWindowMouseMove);
    window.removeEventListener('mouseup', onWindowMouseUp);
    if (button === null) return;
    const { col, row } = pointerCell(event);
    pool.send(paneId, mouseSequence({ button: sgrButton(button), col, row, release: true }));
  }

  function stopForwardingMouse(): void {
    dragButton = null;
    lastDragCell = '';
    window.removeEventListener('mousemove', onWindowMouseMove);
    window.removeEventListener('mouseup', onWindowMouseUp);
  }

  /** Enfoca la terminal salvo que el usuario esté escribiendo en un campo
   *  (paleta, diálogo, prompt): abrir un bridge no puede robarle el foco. */
  function focusTerminalIfIdle(): void {
    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')
    ) {
      return; // el usuario está escribiendo en un campo: no se le quita el foco
    }
    const current = pool.entry(paneId);
    if (!current || current.state !== 'open') return;
    current.view?.terminal.focus();
  }

  // T2.7 — El foco de teclado sigue al panel enfocado: al saltar a un panel
  // desde la paleta o la sidebar, sus teclas van a esa terminal (si el bridge ya
  // estaba abierto no hubo cambio de estado que lo enfocara).
  $effect(() => {
    if (ui.localFocusedPaneId !== paneId) return;
    focusTerminalIfIdle();
  });

  function onTerminalEvent(event: Event): void {
    const detail = (event as CustomEvent<{ channel: string; detail: string }>).detail;
    if (!detail) return;
    if (detail.channel === 'input') pool.send(paneId, detail.detail);
    else if (detail.channel === 'copy') void copySelection();
    else if (detail.channel === 'paste') void pasteFromClipboard();
  }

  function openContextMenu(event: MouseEvent): void {
    event.preventDefault();
    ui.openContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: [
        { id: 'copy', label: es.terminal.copy, run: () => copySelection() },
        { id: 'paste', label: es.terminal.paste, run: () => pasteFromClipboard() },
      ],
    });
  }

  onMount(() => {
    if (!host) return;
    // El pool monta la VISTA (instancia nueva + `open()` una sola vez) y
    // conserva/reengancha el bridge por su cuenta.
    const created = pool.mountView(paneId, host);
    entry = created;
    view = created.view;
    if (!view) return;
    pool.attachWebgl(created);
    registerTestTerminal(paneId, view.terminal);
    syncFromEntry(created);

    const unsubscribe = pool.subscribe({
      onStateChange: (changed) => {
        if (changed.paneId !== paneId) return;
        syncFromEntry(changed);
        if (changed.state === 'open') focusTerminalIfIdle();
      },
      onFrame: (changed) => {
        if (changed.paneId !== paneId) return;
        frameTotal += 1;
        if (frameTotal % 16 === 0 && host) host.dataset.frames = String(frameTotal);
        // T4k — el viewport ya trae el scroll pedido: se repinta el trozo visible
        // de la selección absoluta y se relee el texto del server.
        if (selectionDrag?.scrolled) {
          paintServerSelection(selectionDrag);
          scheduleSelectionRead(selectionDrag);
        }
      },
    });

    // R3: el input va tal cual lo produce xterm (flechas de PSReadLine, Ctrl+C,
    // pegado multilínea, secuencias de vim). No se filtra ni se reescribe nada.
    view.disposers.push(view.terminal.onData((data) => pool.send(paneId, data)));
    view.disposers.push(view.terminal.onBinary((data) => pool.sendBinary(paneId, data)));
    view.disposers.push(
      view.terminal.onSelectionChange(() => {
        if (settings.values.copy_on_select) void copySelection();
      }),
    );

    // La rueda no hace scroll local (scrollback: 0): se pide a herdr.
    // Si la app del panel pidió ratón (xterm vio el modo DEC) la rueda va a la
    // app como siempre. Con un agente TUI (opencode, claude…) sin scrollback en
    // el server, los modos DEC no llegan a un controller tardío, así que se le
    // manda la rueda SGR a mano: era el «no puedo hacer scroll en opencode».
    view.terminal.attachCustomWheelEventHandler((event) => {
      const terminal = view?.terminal;
      if (terminal && terminal.modes.mouseTrackingMode !== 'none') return true;
      const up = event.deltaY < 0;
      const lines = Math.max(1, Math.round(settings.values.mouse_scroll_lines));
      const current = pane;
      const hasScrollback = (current?.scroll?.max_offset_from_bottom ?? 0) > 0;
      const agentTui = agentPane(current, terminal);
      if (agentTui && !hasScrollback) {
        event.preventDefault();
        pool.send(paneId, wheelSequence(event, up).repeat(Math.min(lines, 5)));
        return false;
      }
      pool.scroll(paneId, up ? 'up' : 'down', lines);
      return false;
    });

    // Ctrl+V pega el portapapeles (sin esto xterm mandaba ^V y no pegaba nada);
    // Ctrl+C con selección copia, sin selección sigue siendo SIGINT.
    view.terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown' || !event.ctrlKey || event.altKey || event.metaKey) return true;
      const key = event.key.toLowerCase();
      if (key === 'v' && !event.shiftKey) {
        event.preventDefault();
        void pasteFromClipboard();
        return false;
      }
      if (key === 'c' && !event.shiftKey && view?.terminal.hasSelection()) {
        event.preventDefault();
        void copySelection();
        view.terminal.clearSelection();
        return false;
      }
      return true;
    });

    window.addEventListener('herdr-desk:terminal', onTerminalEvent);
    // Ajuste final al soltar el divisor (el gesto hace fits por frame, pero la
    // última posición necesita un sync ya con el layout asentado).
    window.addEventListener('pointerup', onDragRelease);
    window.addEventListener('pointercancel', onDragRelease);
    resizeObserver = new ResizeObserver(() => scheduleFit());
    resizeObserver.observe(host);
    // BUG 5 — ratón sintético para los agentes: en fase de captura para poder
    // cortar el gesto antes de que xterm lo tome como selección.
    host.addEventListener('mousedown', onSurfaceMouseDown, true);
    host.addEventListener('mousedown', onSelectionMouseDown, true);
    void document.fonts?.ready.then(() => settleSize());
    ready = true;

    return () => {
      window.removeEventListener('herdr-desk:terminal', onTerminalEvent);
      window.removeEventListener('pointerup', onDragRelease);
      window.removeEventListener('pointercancel', onDragRelease);
      unsubscribe();
      dragActive = false;
      stopForwardingMouse();
      host?.removeEventListener('mousedown', onSurfaceMouseDown, true);
      host?.removeEventListener('mousedown', onSelectionMouseDown, true);
      if (selectionDrag) {
        stopSelectionAutoscroll(selectionDrag);
        clearSelectionReadTimer(selectionDrag);
        selectionDrag = null;
        window.removeEventListener('mousemove', onSelectionMouseMove, true);
        window.removeEventListener('mouseup', onSelectionMouseUp, true);
      }
      if (fitFrame !== null) cancelAnimationFrame(fitFrame);
      if (settleFrame !== null) cancelAnimationFrame(settleFrame);
      resizeObserver?.disconnect();
      unregisterTestTerminal(paneId);
      // El pool destruye la VISTA (instancia de xterm, writer y addons: xterm no
      // soporta reabrirla) y SUELTA el bridge con `terminal_release` (no lo
      // cierra: cerrarlo mataría el panel). Al volver a montarse, la vista es
      // nueva y el bridge se reengancha con `pool.open`, que recibe el viewport
      // completo del servidor.
      pool.hide(paneId);
      view = null;
      entry = null;
    };
  });

  // Mientras el panel está a la vista, la vista está montada y el bridge se
  // reengancha con `open` (el servidor manda el viewport completo). Al ocultarse,
  // `hide` destruye la vista y suelta el bridge.
  $effect(() => {
    if (!ready || !entry || !view) return;
    const epoch = session.connectionEpoch;
    const connected = session.connection !== 'offline';
    if (!active) {
      pool.hide(paneId);
      return;
    }
    // Primero el tamaño real del contenedor: `show` y `open` repintan con él (con
    // el tamaño viejo el server pintaba a otra rejilla: gráfica de opencode rota
    // y terminal sin llenar el panel al cambiar de espacio).
    applyFit();
    pool.setSize(paneId, view.terminal.cols, view.terminal.rows);
    pool.show(paneId);
    settleSize();
    // Sin server no se insiste: se espera al reintento (evita spam de open), y
    // si el panel está «reconectando» el respawn del backend ya reusa su bridge.
    if (!connected && entry.state !== 'idle') return;
    if (entry.state === 'reconnecting') return;
    applyFit();
    void pool.open(paneId, view.terminal.cols, view.terminal.rows, epoch);
  });
</script>

<div
  class="terminal-host"
  data-testid="terminal-host"
  data-pane-id={paneId}
  data-bridge={bridgeState}
  role="application"
  aria-label="terminal {paneId}"
  oncontextmenu={openContextMenu}
  onpointerdown={(event) => {
    // Si el clic cae en el propio xterm, xterm ya se encarga del foco y del
    // ratón; si cae en el overlay o en el borde, el navegador movería el foco a
    // <body> y la terminal perdería las teclas, así que se enfoca a mano.
    const surface = event.currentTarget.querySelector('.terminal-surface');
    if (surface?.contains(event.target as Node)) return;
    event.preventDefault();
    view?.terminal.focus();
  }}
>
  <div bind:this={host} class="terminal-surface"></div>

  {#if bridgeState === 'opening'}
    <div class="terminal-overlay" data-testid="terminal-overlay" data-kind="opening">
      <span>{es.terminal.connecting}</span>
    </div>
  {:else if bridgeState === 'reconnecting'}
    <!-- El server se cayó: el pool ya tiene su propia temporización de reenganche
         (gracia + reintento automático si el respawn no manda frames, ver
         pool.ts `#scheduleReopen`). Nada que ofrecer aquí: si el bridge vuelve,
         el panel vuelve solo a «open». -->
    <div class="terminal-overlay" data-testid="terminal-overlay" data-kind="reconnecting">
      <!-- Si el pool cerró el bridge por no recibir frames, se dice el motivo
           real; si no, el texto genérico de reconexión. -->
      <span data-testid="terminal-reconnecting">{closeReason || es.terminal.reconnecting}</span>
    </div>
  {:else if bridgeState === 'closed'}
    <!-- Cierre real (no reenganchable desde aquí): se muestra el motivo real,
         sin botón manual — la recuperación es automática y silenciosa o no lo es. -->
    <div class="terminal-overlay" data-testid="terminal-overlay" data-kind="closed">
      <span data-testid="terminal-close-reason">
        {es.terminal.closed.replace('{reason}', closeReason)}
      </span>
    </div>
  {:else if bridgeState === 'error'}
    <div class="terminal-overlay" data-testid="terminal-overlay" data-kind="error">
      <span data-testid="terminal-error">{errorText}</span>
    </div>
  {/if}
</div>

<style>
  .terminal-surface {
    block-size: 100%;
    inline-size: 100%;
    min-inline-size: 0;
    flex: 1 1 auto;
  }
</style>
