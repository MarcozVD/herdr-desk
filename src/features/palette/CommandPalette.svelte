<!-- T2.6/T2.7 — Paleta de acciones: Ctrl+Shift+P en cualquier estado. Busca con
     fuzzy (sin acentos), agrupa por tipo, ejecuta con Enter y navega con ↑↓ y
     Esc. Los últimos comandos usados salen arriba, en «Recientes». -->
<script lang="ts">
  import { noticeSound } from '../../lib/agents/noticeSound';
  import { es } from '../../lib/i18n/es';
  import {
    buildCommands,
    groupForDisplay,
    rankCommands,
    withShortcuts,
    type PaletteCommand,
    type PaletteGroup,
  } from '../../lib/palette/commands';
  import { pushRecent } from '../../lib/palette/fuzzy';
  import { session } from '../../lib/stores/session.svelte';
  import { settings } from '../../lib/stores/settings.svelte';
  import { ui } from '../../lib/stores/ui.svelte';

  let query = $state('');
  let activeIndex = $state(0);
  let listEl = $state<HTMLDivElement | undefined>(undefined);
  let inputEl = $state<HTMLInputElement | undefined>(undefined);

  const commands = $derived(
    withShortcuts(
      buildCommands({
        workspaces: session.workspaces,
        tabs: session.tabs,
        panes: session.panes,
        agents: session.agents,
        focusedPaneId: session.focusedPaneId,
        focusedTabId: session.focusedTabId,
        focusedWorkspaceId: session.focusedWorkspaceId,
      }),
    ),
  );
  const recent = $derived(settings.values.palette_recent);
  const searching = $derived(query.trim().length > 0);
  const visible = $derived(rankCommands(commands, query, recent));
  const groups = $derived(groupForDisplay(visible, searching ? [] : recent));
  const flat = $derived(groups.flatMap((group) => group.items));
  const activeId = $derived(flat[activeIndex]?.id ?? '');

  const GROUP_LABEL: Record<PaletteGroup, string> = {
    recent: es.palette.groupRecent,
    session: es.palette.groupSession,
    workspaces: es.palette.groupWorkspaces,
    tabs: es.palette.groupTabs,
    panes: es.palette.groupPanes,
    agents: es.palette.groupAgents,
    settings: es.palette.groupSettings,
    system: es.palette.groupSystem,
  };

  // Cada cambio de consulta vuelve a empezar por el primero. Se hace en el
  // propio manejador (no en un efecto) para que escribir y pulsar Enter seguido
  // ejecute el primero de la lista NUEVA y no el que estaba seleccionado.
  function onQueryInput(): void {
    activeIndex = 0;
  }

  // Al abrir, el foco va al campo. La consulta arranca vacía porque la paleta se
  // monta de cero en cada apertura (`{#key ui.paletteSession}`): limpiarla en un
  // efecto después de montar borraba lo que el usuario ya había escrito.
  $effect(() => {
    if (!ui.paletteOpen) return;
    // El foco se insiste un par de veces: el panel de terminal también pide foco
    // al montarse y, si llega después, la paleta se quedaría sin escribir.
    const focus = (): void => inputEl?.focus();
    focus();
    const later = setTimeout(focus, 40);
    const last = setTimeout(focus, 160);
    return () => {
      clearTimeout(later);
      clearTimeout(last);
    };
  });

  function move(delta: number): void {
    if (flat.length === 0) return;
    activeIndex = (activeIndex + delta + flat.length) % flat.length;
    void listEl
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
  }

  async function run(command: PaletteCommand | undefined): Promise<void> {
    if (!command) return;
    settings.set('palette_recent', pushRecent(settings.values.palette_recent, command.id));
    ui.closePalette();
    // El primer gesto con la paleta abierta arma el audio de los avisos.
    noticeSound.arm();
    try {
      await command.run();
    } catch (raw) {
      ui.notify(raw instanceof Error ? raw.message : String(raw), 'error');
    }
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      move(1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(-1);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      void run(flat[activeIndex]);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      ui.closePalette();
    }
  }
</script>

{#if ui.paletteOpen}
  <div class="overlay" style="--dialog-level:50">
    <button
      type="button"
      class="overlay__scrim"
      data-testid="palette-scrim"
      aria-label={es.palette.close}
      onclick={() => ui.closePalette()}
    ></button>

    <div
      class="palette glass-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={es.palette.title}
      data-testid="palette"
    >
      <header class="palette__head">
        <!-- svelte-ignore a11y_autofocus -->
        <input
          class="palette__input"
          type="text"
          autofocus
          data-testid="palette-input"
          placeholder={es.palette.search}
          aria-label={es.palette.search}
          aria-controls="palette-list"
          aria-activedescendant={activeId}
          role="combobox"
          aria-expanded="true"
          autocomplete="off"
          spellcheck="false"
          bind:this={inputEl}
          bind:value={query}
          oninput={onQueryInput}
          onkeydown={onKeydown}
        />
        <span class="palette__count" data-testid="palette-count">
          {es.palette.count.replace('{n}', String(flat.length))}
        </span>
      </header>

      <div class="palette__list" id="palette-list" role="listbox" bind:this={listEl}>
        {#if flat.length === 0}
          <p class="palette__empty" data-testid="palette-empty">
            {searching ? es.palette.noResults.replace('{query}', query.trim()) : es.palette.empty}
          </p>
        {:else}
          {#each groups as group (group.group)}
            <p class="palette__group" data-testid={`palette-group-${group.group}`}>
              {GROUP_LABEL[group.group]}
            </p>
            {#each group.items as command (command.id)}
              {@const index = flat.indexOf(command)}
              <button
                type="button"
                class="palette__item"
                role="option"
                aria-selected={index === activeIndex}
                data-testid="palette-item"
                data-id={command.id}
                data-group={command.group}
                data-active={index === activeIndex}
                onmouseenter={() => (activeIndex = index)}
                onclick={() => void run(command)}
              >
                <span class="palette__label">{command.label}</span>
                {#if command.hint}
                  <span class="palette__hint">{command.hint}</span>
                {/if}
                {#if command.shortcut}
                  <span class="palette__kbd">{command.shortcut}</span>
                {/if}
              </button>
            {/each}
          {/each}
        {/if}
      </div>

      <footer class="palette__foot">{es.palette.hint}</footer>
    </div>
  </div>
{/if}

<style>
  .palette {
    position: relative;
    inline-size: min(38rem, 92vw);
    max-block-size: 70vh;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    overflow: hidden;
  }

  .palette__head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-block-end: 1px solid var(--glass-border);
  }

  .palette__input {
    flex: 1 1 auto;
    min-inline-size: 0;
    border: 0;
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 14px;
    outline: none;
  }

  .palette__count {
    color: var(--text-dim);
    font-size: 11px;
    white-space: nowrap;
  }

  .palette__list {
    overflow: auto;
    padding: var(--space-1) 0 var(--space-2);
  }

  .palette__group {
    margin: var(--space-2) 0 2px;
    padding: 0 var(--space-3);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-dim);
  }

  .palette__item {
    inline-size: 100%;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 5px var(--space-3);
    border: 0;
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 13px;
    text-align: start;
    cursor: pointer;
  }

  .palette__item[data-active='true'] {
    background: color-mix(in oklab, var(--accent) 26%, transparent);
  }

  .palette__label {
    flex: 1 1 auto;
    min-inline-size: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .palette__hint {
    color: var(--text-dim);
    font-size: 11px;
    max-inline-size: 12rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .palette__kbd,
  .palette__foot {
    color: var(--text-dim);
    font-size: 11px;
  }

  .palette__kbd {
    padding: 1px 5px;
    border: 1px solid var(--glass-border);
    border-radius: 4px;
    font-family: var(--font-mono);
  }

  .palette__foot {
    padding: var(--space-2) var(--space-3);
    border-block-start: 1px solid var(--glass-border);
  }

  .palette__empty {
    margin: 0;
    padding: var(--space-3);
    color: var(--text-dim);
    font-size: 12px;
  }
</style>
