<!-- T2.2 — Visor de texto/JSON (transcript del agente, `agent.explain`).
     Con búsqueda que marca coincidencias (no filtra: en un transcript quieres
     ver el contexto) y botón de copiar. -->
<script lang="ts">
  import { countMatches, splitByQuery } from '../agents/agentActions';
  import { es } from '../i18n/es';
  import { ui } from '../stores/ui.svelte';
  import Dialog from './Dialog.svelte';
  import { writeText } from '@tauri-apps/plugin-clipboard-manager';

  const view = $derived(ui.viewer);
  let query = $state('');
  let copied = $state(false);

  const matches = $derived(view ? countMatches(view.text, query) : 0);
  const segments = $derived(view ? splitByQuery(view.text, query) : []);

  async function copy(): Promise<void> {
    if (!view) return;
    try {
      await writeText(view.text);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      // Sin portapapeles disponible: el visor sigue siendo de solo lectura.
    }
  }
</script>

{#if view}
  <Dialog title={view.title} testId="viewer" width="46rem" onclose={() => ui.closeViewer()}>
    <div class="viewer">
      <div class="viewer__tools">
        <input
          class="viewer__search"
          type="search"
          data-testid="viewer-search"
          placeholder={es.viewer.search}
          aria-label={es.viewer.search}
          bind:value={query}
        />
        <span class="viewer__count" data-testid="viewer-matches">
          {query.trim().length === 0
            ? ''
            : matches === 0
              ? es.viewer.noMatches
              : es.viewer.matches.replace('{n}', String(matches))}
        </span>
        <button type="button" class="btn" data-testid="viewer-copy" onclick={() => void copy()}>
          {copied ? es.viewer.copied : es.viewer.copy}
        </button>
      </div>

      {#if view.text.length === 0}
        <p class="empty-note" data-testid="viewer-empty">{es.viewer.empty}</p>
      {:else}
        <pre
          class="viewer__body"
          data-testid="viewer-body"
          data-kind={view.kind}>{#each segments as segment, index (index)}<span
              class:viewer__hit={segment.hit}>{segment.text}</span
            >{/each}</pre>
      {/if}
    </div>

    {#snippet footer()}
      <button type="button" class="btn" onclick={() => ui.closeViewer()}>{es.viewer.close}</button>
    {/snippet}
  </Dialog>
{/if}

<style>
  .viewer {
    display: grid;
    gap: var(--space-2);
  }

  .viewer__tools {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .viewer__search {
    flex: 1 1 auto;
    min-inline-size: 0;
    padding: 4px var(--space-2);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-sm);
    background: color-mix(in oklab, var(--surface-dim) 45%, transparent);
    color: var(--text);
    font: inherit;
    font-size: 13px;
  }

  .viewer__count {
    color: var(--text-dim);
    font-size: 11px;
    white-space: nowrap;
  }

  .viewer__body {
    margin: 0;
    max-block-size: 22rem;
    overflow: auto;
    padding: var(--space-2);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-sm);
    background: var(--panel-bg-solid);
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.45;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .viewer__hit {
    background: color-mix(in oklab, var(--yellow) 45%, transparent);
    color: #14151c;
    border-radius: 2px;
  }
</style>
