<!-- T2.2 — Caja de prompt de un agente: texto, opción de esperar a un estado
     (`agent.prompt` con `wait`), spinner mientras el RPC está en vuelo y
     cancelación (cancelar deja de esperar; el servidor termina su parte). -->
<script lang="ts">
  import { DEFAULT_AGENT_WAIT_MS } from '../../lib/agents/agentActions';
  import { flows } from '../../lib/actions/flows';
  import { es } from '../../lib/i18n/es';
  import { ui } from '../../lib/stores/ui.svelte';
  import Dialog from '../../lib/ui/Dialog.svelte';
  import type { AgentStatus } from '../../lib/herdr/types';

  const target = $derived(ui.agentPromptTarget);

  let text = $state('');
  let waiting = $state(false);
  let until = $state<AgentStatus | ''>('');
  let timeoutMs = $state(DEFAULT_AGENT_WAIT_MS);
  let busy = $state(false);

  const canSend = $derived(text.trim().length > 0 && !busy);

  function close(): void {
    if (busy) {
      // Cancelar: se deja de esperar al agente y se cierra. El RPC sigue su
      // curso en el servidor, pero la UI no bloquea nada por él.
      busy = false;
    }
    ui.closeAgentPrompt();
  }

  async function send(): Promise<void> {
    if (!target || !canSend) return;
    const paneId = target.paneId;
    const body = text;
    busy = true;
    const sent = await flows.promptAgent(
      paneId,
      body,
      waiting && until !== '' ? { until: [until], timeout_ms: timeoutMs } : null,
    );
    busy = false;
    if (sent) {
      text = '';
      ui.closeAgentPrompt();
    }
  }
</script>

{#if target}
  <Dialog
    title={es.agents.promptTitle.replace('{name}', target.name)}
    testId="agent-prompt"
    width="38rem"
    onclose={close}
  >
    <form
      class="agent-prompt"
      onsubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <label class="agent-prompt__field">
        <span>{es.agents.promptLabel}</span>
        <textarea
          data-testid="agent-prompt-text"
          rows="4"
          placeholder={es.agents.promptPlaceholder}
          bind:value={text}
          disabled={busy}></textarea>
      </label>

      <div class="agent-prompt__row">
        <label class="agent-prompt__check">
          <input type="checkbox" data-testid="agent-prompt-wait" bind:checked={waiting} />
          <span>{es.agents.wait}</span>
        </label>
        <select
          data-testid="agent-prompt-until"
          aria-label={es.agents.wait}
          disabled={!waiting || busy}
          bind:value={until}
        >
          <option value="">{es.agentStatus.idle}</option>
          {#each ['done', 'working', 'blocked'] as state (state)}
            <option value={state}>{es.agentStatus[state as AgentStatus]}</option>
          {/each}
        </select>
        <input
          class="agent-prompt__timeout"
          type="number"
          min="1000"
          step="1000"
          aria-label={es.agents.timeoutLabel}
          data-testid="agent-prompt-timeout"
          disabled={!waiting || busy}
          bind:value={timeoutMs}
        />
      </div>

      {#if busy}
        <p class="agent-prompt__waiting" data-testid="agent-prompt-waiting">
          <span class="agent-prompt__spinner" aria-hidden="true"></span>
          {es.agents.promptWaiting}
        </p>
      {/if}
    </form>

    {#snippet footer()}
      <button type="button" class="btn" data-testid="agent-prompt-cancel" onclick={close}>
        {es.dialog.cancel}
      </button>
      <button
        type="button"
        class="btn btn--primary"
        data-testid="agent-prompt-send"
        disabled={!canSend}
        onclick={() => void send()}
      >
        {es.agents.promptSend}
      </button>
    {/snippet}
  </Dialog>
{/if}

<style>
  .agent-prompt {
    display: grid;
    gap: var(--space-2);
  }

  .agent-prompt__field {
    display: grid;
    gap: 4px;
  }

  .agent-prompt__field textarea {
    padding: var(--space-2);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-sm);
    background: color-mix(in oklab, var(--surface-dim) 45%, transparent);
    color: var(--text);
    font: inherit;
    font-size: 13px;
    resize: vertical;
  }

  .agent-prompt__row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .agent-prompt__check {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .agent-prompt__timeout {
    inline-size: 7rem;
    padding: 3px var(--space-1);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 12px;
  }

  .agent-prompt__waiting {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    color: var(--text-dim);
    font-size: 12px;
  }

  /* Spinner discreto: solo gira un borde (sin animar sombras ni filtros). */
  .agent-prompt__spinner {
    inline-size: 12px;
    block-size: 12px;
    border: 2px solid color-mix(in oklab, var(--accent) 35%, transparent);
    border-block-start-color: var(--accent);
    border-radius: 50%;
    animation: agent-prompt-spin 900ms linear infinite;
  }

  @keyframes agent-prompt-spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .agent-prompt__spinner {
      animation: none;
    }
  }
</style>
