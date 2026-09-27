<!-- Cheatsheet (acción `help`): todos los atajos activos, agrupados, más los que
     reserva la propia GUI. -->
<script lang="ts">
  import { es } from '../../lib/i18n/es';
  import { ACTION_LABELS } from '../../lib/keys/actions';
  import { GUI_RESERVED, keymap } from '../../lib/keys/keymap';
  import { ui } from '../../lib/stores/ui.svelte';

  const prefixEntries = $derived(
    keymap.activeEntries
      .filter((entry) => entry.scope === 'prefix')
      .sort((a, b) => a.action.localeCompare(b.action)),
  );
  const directEntries = $derived(
    keymap.activeEntries
      .filter((entry) => entry.scope === 'direct')
      .sort((a, b) => a.action.localeCompare(b.action)),
  );
  const conflicts = $derived(keymap.conflicts());

  function label(action: string): string {
    return ACTION_LABELS[action] ?? action;
  }

  function keys(action: string): string {
    return keymap.labelOf(action) ?? '';
  }
</script>

<div class="overlay" style="--dialog-level:40">
  <button
    type="button"
    class="overlay__scrim"
    data-testid="help-scrim"
    aria-label={es.dialog.close}
    onclick={() => ui.toggleHelp()}
  ></button>
  <div
    class="cheatsheet layer-overlay"
    role="dialog"
    aria-modal="true"
    aria-label={es.keys.help}
    tabindex="-1"
    data-testid="cheatsheet"
  >
    <header class="cheatsheet__head">
      <h2>{es.keys.help}</h2>
      <span class="cheatsheet__hint">{es.keys.helpHint}</span>
    </header>

    {#if conflicts.length > 0}
      <p class="cheatsheet__warn" data-testid="cheatsheet-conflicts">
        {es.keys.conflicts}: {conflicts.map((conflict) => conflict.chordId).join(', ')}
      </p>
    {/if}

    <div class="cheatsheet__body">
      <div class="cheatsheet__col">
        <h3>prefix · {keymap.prefixKey}</h3>
        <ul data-testid="cheatsheet-prefix">
          {#each prefixEntries as entry (entry.action)}
            <li>
              <span>{label(entry.action)}</span>
              <span class="kbd">{keys(entry.action)}</span>
            </li>
          {/each}
        </ul>
      </div>
      <div class="cheatsheet__col">
        <h3>{es.keys.section}: {es.keys.reserved} / directos</h3>
        <ul data-testid="cheatsheet-direct">
          {#each GUI_RESERVED as entry (entry.chordId)}
            <li>
              <span>{entry.label}</span>
              <span class="kbd">{entry.chordId}</span>
            </li>
          {/each}
          {#each directEntries as entry (entry.action)}
            <li>
              <span>{label(entry.action)}</span>
              <span class="kbd">{keys(entry.action)}</span>
            </li>
          {/each}
        </ul>
        <p class="cheatsheet__note">{es.keys.prefixHint}</p>
      </div>
    </div>
  </div>
</div>

<style>
  .cheatsheet {
    position: relative;
    inline-size: min(52rem, 92vw);
    max-block-size: 78vh;
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr);
    overflow: hidden;
  }

  .cheatsheet__head {
    display: flex;
    align-items: baseline;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-block-end: 1px solid var(--glass-border);
  }

  .cheatsheet__head h2 {
    margin: 0;
    font-size: 14px;
  }

  .cheatsheet__hint,
  .cheatsheet__note {
    font-size: 11px;
    color: var(--text-dim);
  }

  .cheatsheet__warn {
    margin: 0;
    padding: var(--space-2) var(--space-4);
    font-size: 12px;
    color: var(--yellow);
  }

  .cheatsheet__body {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr));
    gap: var(--space-4);
    padding: var(--space-4);
    overflow: auto;
  }

  .cheatsheet__col h3 {
    margin: 0 0 var(--space-2);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-dim);
  }

  .cheatsheet__col ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 2px;
  }

  .cheatsheet__col li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: 3px var(--space-2);
    border-radius: 6px;
    font-size: 12px;
  }

  .cheatsheet__col li:nth-child(odd) {
    background: var(--row-zebra-bg);
  }
</style>
