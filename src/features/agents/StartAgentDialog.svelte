<!-- T2.3 — Diálogo de iniciar agente: tipos desde `agent_kinds` (con caché del
     backend y su motivo), entrada libre cuando la lista llega vacía, nombre
     validado y timeout acotado. Al arrancar, el flujo reporta el agente. -->
<script lang="ts">
  import {
    clampAgentStartTimeout,
    DEFAULT_AGENT_START_TIMEOUT_MS,
    defaultAgentName,
    parseAgentArgs,
    validAgentStartTimeout,
    validateAgentName,
  } from '../../lib/agents/agentActions';
  import { flows } from '../../lib/actions/flows';
  import { agentKinds, type AgentKindsResult } from '../../lib/herdr/client';
  import type { CommandOutcome } from '../../lib/herdr/client';
  import { es } from '../../lib/i18n/es';
  import { session } from '../../lib/stores/session.svelte';
  import { ui } from '../../lib/stores/ui.svelte';
  import Dialog from '../../lib/ui/Dialog.svelte';

  const target = $derived(ui.startAgentTarget);

  let kinds = $state<string[]>([]);
  let reason = $state<string | null>(null);
  let loading = $state(false);
  let kind = $state('');
  let freeKind = $state(false);
  let name = $state('');
  let nameTouched = $state(false);
  let argsText = $state('');
  let timeoutMs = $state(DEFAULT_AGENT_START_TIMEOUT_MS);
  let busy = $state(false);

  async function load(refresh: boolean): Promise<void> {
    loading = true;
    const outcome: CommandOutcome<AgentKindsResult> = await agentKinds(refresh);
    loading = false;
    if (outcome.ok) {
      kinds = outcome.value?.kinds ?? [];
      reason = outcome.value?.reason ?? null;
    } else {
      // Sin command (backend viejo): entrada libre y el motivo del error.
      kinds = [];
      reason = es.agents.kindUnavailable;
    }
    if (kinds.length === 0) {
      freeKind = true;
    } else if (kind === '') {
      kind = kinds[0] ?? '';
    }
  }

  $effect(() => {
    if (target && kinds.length === 0 && reason === null && !loading) void load(false);
  });

  // El nombre sigue al tipo mientras el usuario no lo escriba a mano.
  $effect(() => {
    if (nameTouched) return;
    const taken = session.agents.map((agent) => agent.name ?? '').filter((entry) => entry !== '');
    name = kind.trim().length > 0 ? defaultAgentName(kind, taken) : '';
  });

  const nameError = $derived(name.length === 0 ? null : validateAgentName(name));
  const timeoutOk = $derived(validAgentStartTimeout(timeoutMs));
  const canStart = $derived(
    target !== null && kind.trim().length > 0 && nameError === null && timeoutOk && !busy,
  );

  async function start(): Promise<void> {
    if (!target || !canStart) return;
    busy = true;
    const started = await flows.startAgent(target.paneId, {
      kind: kind.trim(),
      name,
      args: parseAgentArgs(argsText),
      timeoutMs: clampAgentStartTimeout(timeoutMs),
    });
    busy = false;
    if (started) ui.closeStartAgent();
  }
</script>

{#if target}
  <Dialog
    title={es.agents.startTitle.replace('{name}', target.name)}
    testId="start-agent"
    width="34rem"
    onclose={() => ui.closeStartAgent()}
  >
    <form
      class="start-agent"
      onsubmit={(event) => {
        event.preventDefault();
        void start();
      }}
    >
      <label class="start-agent__field">
        <span>{es.agents.kindLabel}</span>
        {#if freeKind || kinds.length === 0}
          <input
            type="text"
            data-testid="start-agent-kind"
            placeholder="claude"
            bind:value={kind}
            disabled={busy}
          />
        {:else}
          <select data-testid="start-agent-kind" bind:value={kind} disabled={busy}>
            {#each kinds as option (option)}
              <option value={option}>{option}</option>
            {/each}
          </select>
        {/if}
      </label>

      {#if loading}
        <p class="start-agent__note" data-testid="start-agent-loading">{es.agents.kindLoading}</p>
      {:else if kinds.length === 0}
        <p class="start-agent__note" data-testid="start-agent-reason">
          {reason ?? es.agents.kindFreeHint}
        </p>
      {:else}
        <p class="start-agent__note">
          {es.agents.kindHint}
          {#if reason}— {reason}{/if}
        </p>
      {/if}

      <label class="start-agent__field">
        <span>{es.agents.nameLabel}</span>
        <input
          type="text"
          data-testid="start-agent-name"
          placeholder={es.agents.namePlaceholder}
          bind:value={name}
          oninput={() => (nameTouched = true)}
          disabled={busy}
        />
      </label>
      {#if nameError}
        <p class="start-agent__error" data-testid="start-agent-name-error">{nameError}</p>
      {/if}

      <label class="start-agent__field">
        <span>{es.agents.argsLabel}</span>
        <input
          type="text"
          data-testid="start-agent-args"
          placeholder="--flag valor"
          bind:value={argsText}
          disabled={busy}
        />
      </label>
      <p class="start-agent__note">{es.agents.argsHint}</p>

      <label class="start-agent__field">
        <span>{es.agents.timeoutLabel}</span>
        <input
          type="number"
          min="3001"
          max="300000"
          step="1000"
          data-testid="start-agent-timeout"
          bind:value={timeoutMs}
          disabled={busy}
        />
      </label>
    </form>

    {#snippet footer()}
      <button
        type="button"
        class="btn"
        data-testid="start-agent-refresh"
        disabled={busy || loading}
        onclick={() => void load(true)}
      >
        {es.agents.kindLoading}
      </button>
      <button type="button" class="btn" onclick={() => ui.closeStartAgent()}>
        {es.dialog.cancel}
      </button>
      <button
        type="button"
        class="btn btn--primary"
        data-testid="start-agent-submit"
        disabled={!canStart}
        onclick={() => void start()}
      >
        {es.agents.startSubmit}
      </button>
    {/snippet}
  </Dialog>
{/if}

<style>
  .start-agent {
    display: grid;
    gap: var(--space-2);
  }

  .start-agent__field {
    display: grid;
    gap: 4px;
  }

  .start-agent__field input,
  .start-agent__field select {
    padding: 4px var(--space-2);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-sm);
    background: color-mix(in oklab, var(--surface-dim) 45%, transparent);
    color: var(--text);
    font: inherit;
    font-size: 13px;
  }

  .start-agent__note {
    margin: 0;
    color: var(--text-dim);
    font-size: 11px;
  }

  .start-agent__error {
    margin: 0;
    color: var(--red);
    font-size: 11px;
  }
</style>
