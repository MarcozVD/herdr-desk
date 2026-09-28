<!-- T3.4 — Worktrees del espacio visible: listar, crear, abrir y quitar (doble
     aviso). Los commands del backend (worktree_*) ya hablan con `worktree.*`
     del server; aquí solo hay formulario y confirmaciones. -->
<script lang="ts">
  import {
    worktreeCreate,
    worktreeList,
    worktreeOpen,
    worktreeRemove,
    type WorktreeInfo,
    type WorktreeListResult,
  } from '../../lib/herdr/client';
  import { errorText } from '../../lib/herdr/errors';
  import { es } from '../../lib/i18n/es';
  import { session } from '../../lib/stores/session.svelte';
  import { ui } from '../../lib/stores/ui.svelte';
  import { visible } from '../../lib/stores/visible.svelte';
  import Dialog from '../../lib/ui/Dialog.svelte';

  let result = $state<WorktreeListResult | null>(null);
  let error = $state<string | null>(null);
  let loading = $state(false);
  let busy = $state(false);
  let creating = $state(false);

  let branch = $state('');
  let base = $state('');
  let path = $state('');
  let label = $state('');
  let focus = $state(true);

  async function load(): Promise<void> {
    error = null;
    loading = true;
    const outcome = await worktreeList(visible.workspaceId);
    loading = false;
    if (!outcome.ok) {
      result = null;
      error =
        outcome.kind === 'missing'
          ? es.connection.unavailable.replace('{command}', 'worktree_list')
          : errorText(outcome.error);
      return;
    }
    result = outcome.value;
  }

  $effect(() => {
    if (ui.worktreesOpen) void load();
  });

  async function create(): Promise<void> {
    if (branch.trim().length === 0) {
      error = es.worktrees.invalidBranch;
      return;
    }
    busy = true;
    const outcome = await worktreeCreate({
      workspace_id: visible.workspaceId,
      branch: branch.trim(),
      base: base.trim() || null,
      path: path.trim() || null,
      label: label.trim() || null,
      focus,
    });
    busy = false;
    if (!outcome.ok) {
      error = errorText(outcome.error);
      return;
    }
    ui.notify(es.worktrees.created.replace('{branch}', branch.trim()), 'info');
    branch = '';
    base = '';
    path = '';
    label = '';
    creating = false;
    await load();
  }

  async function open(item: WorktreeInfo): Promise<void> {
    if (item.open_workspace_id) {
      ui.notify(es.worktrees.alreadyOpen, 'info');
      return;
    }
    busy = true;
    const outcome = await worktreeOpen({
      workspace_id: visible.workspaceId,
      branch: item.branch,
      path: item.path,
      label: item.label,
      focus: true,
    });
    busy = false;
    if (!outcome.ok) {
      error = errorText(outcome.error);
      return;
    }
    ui.notify(es.worktrees.opened, 'info');
    ui.closeWorktrees();
  }

  async function remove(item: WorktreeInfo): Promise<void> {
    const workspaceId = item.open_workspace_id;
    if (!workspaceId) return;
    const accepted = await ui.confirm({
      title: es.worktrees.removeAction,
      message: es.worktrees.removeConfirm.replace('{label}', item.label),
      confirmLabel: es.worktrees.removeAction,
      danger: true,
    });
    if (!accepted) return;
    busy = true;
    let outcome = await worktreeRemove(workspaceId, false);
    busy = false;
    if (!outcome.ok) {
      const forced = await ui.confirm({
        title: es.worktrees.removeAction,
        message: es.worktrees.removeConfirmForce,
        confirmLabel: es.worktrees.removeAction,
        danger: true,
      });
      if (!forced) return;
      busy = true;
      outcome = await worktreeRemove(workspaceId, true);
      busy = false;
      if (!outcome.ok) {
        error = errorText(outcome.error);
        return;
      }
    }
    ui.notify(es.worktrees.removed.replace('{label}', item.label), 'info');
    await load();
  }

  function flags(item: WorktreeInfo): string[] {
    const out: string[] = [];
    if (item.is_bare) out.push(es.worktrees.bare);
    if (item.is_detached) out.push(es.worktrees.detached);
    if (item.is_prunable) out.push(es.worktrees.prunable);
    if (item.is_linked_worktree) out.push(es.worktrees.linked);
    return out;
  }

  const workspaceLabel = $derived(
    session.workspaces.find((item) => item.workspace_id === visible.workspaceId)?.label ?? '',
  );
</script>

{#if ui.worktreesOpen}
  <Dialog
    title="{es.worktrees.title} · {workspaceLabel}"
    onclose={() => ui.closeWorktrees()}
    width="42rem"
    testId="worktrees-dialog"
  >
    {#if error}
      <p class="worktrees__error" data-testid="worktrees-error">{error}</p>
    {:else if loading}
      <p class="worktrees__empty" data-testid="worktrees-loading">{es.dialog.loading}</p>
    {:else if result}
      <p class="worktrees__repo" data-testid="worktrees-repo">
        {es.worktrees.repo
          .replace('{name}', result.source.repo_name)
          .replace('{path}', result.source.repo_root)}
      </p>
      {#if result.worktrees.length === 0}
        <p class="worktrees__empty" data-testid="worktrees-empty">{es.worktrees.empty}</p>
      {:else}
        <ul class="worktrees" data-testid="worktrees-list">
          {#each result.worktrees as item (item.path)}
            <li class="worktrees__row" data-testid="worktree-row" data-branch={item.branch ?? ''}>
              <div class="worktrees__info">
                <span class="worktrees__label">{item.label}</span>
                {#if item.branch}<span class="worktrees__branch">{item.branch}</span>{/if}
                {#each flags(item) as flag (flag)}
                  <span class="worktrees__flag">{flag}</span>
                {/each}
                {#if item.open_workspace_id}
                  <span class="worktrees__flag worktrees__flag--open">
                    {es.worktrees.alreadyOpen}
                  </span>
                {/if}
                <span class="worktrees__path" title={item.path}>{item.path}</span>
              </div>
              <div class="worktrees__actions">
                <button
                  type="button"
                  class="btn btn--small"
                  data-testid="worktree-open"
                  disabled={busy}
                  onclick={() => void open(item)}
                >
                  {es.worktrees.openAction}
                </button>
                {#if item.open_workspace_id}
                  <button
                    type="button"
                    class="btn btn--small btn--danger"
                    data-testid="worktree-remove"
                    disabled={busy}
                    onclick={() => void remove(item)}
                  >
                    {es.worktrees.removeAction}
                  </button>
                {/if}
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    {/if}

    {#if creating}
      <div class="worktrees__form" data-testid="worktree-form">
        <label class="worktrees__field">
          <span>{es.worktrees.createBranch}</span>
          <input bind:value={branch} data-testid="worktree-branch" spellcheck="false" />
        </label>
        <label class="worktrees__field">
          <span>{es.worktrees.createBase}</span>
          <input bind:value={base} data-testid="worktree-base" spellcheck="false" />
        </label>
        <label class="worktrees__field">
          <span>{es.worktrees.createPath}</span>
          <input bind:value={path} data-testid="worktree-path" spellcheck="false" />
        </label>
        <label class="worktrees__field">
          <span>{es.worktrees.createLabel}</span>
          <input bind:value={label} data-testid="worktree-label" spellcheck="false" />
        </label>
        <label class="worktrees__check">
          <input type="checkbox" bind:checked={focus} data-testid="worktree-focus" />
          <span>{es.worktrees.createFocus}</span>
        </label>
      </div>
    {/if}

    {#snippet footer()}
      {#if creating}
        <button
          type="button"
          class="btn"
          data-testid="worktree-cancel"
          onclick={() => (creating = false)}
        >
          {es.dialog.cancel}
        </button>
        <button
          type="button"
          class="btn btn--primary"
          data-testid="worktree-create"
          disabled={busy}
          onclick={() => void create()}
        >
          {es.worktrees.create}
        </button>
      {:else}
        <button
          type="button"
          class="btn"
          data-testid="worktree-new"
          onclick={() => (creating = true)}
        >
          + {es.worktrees.createTitle}
        </button>
        <button type="button" class="btn" data-testid="worktree-reload" onclick={() => void load()}>
          Actualizar
        </button>
        <button
          type="button"
          class="btn btn--primary"
          data-testid="worktrees-close"
          onclick={() => ui.closeWorktrees()}
        >
          {es.dialog.close}
        </button>
      {/if}
    {/snippet}
  </Dialog>
{/if}

<style>
  .worktrees {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-1);
  }

  .worktrees__row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 5px var(--space-2);
    border-radius: var(--radius-sm);
    background: var(--row-subtle-bg);
    font-size: 13px;
  }

  .worktrees__info {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-inline-size: 0;
    flex: 1 1 auto;
  }

  .worktrees__label {
    font-weight: 500;
  }

  .worktrees__branch {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-dim);
  }

  .worktrees__flag {
    padding: 0 6px;
    border-radius: 999px;
    border: 1px solid var(--glass-border);
    font-size: 10px;
    color: var(--text-dim);
  }

  .worktrees__flag--open {
    color: var(--green);
    border-color: color-mix(in oklab, var(--green) 40%, var(--glass-border));
  }

  .worktrees__path {
    font-size: 11px;
    color: var(--text-dim);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .worktrees__actions {
    display: flex;
    gap: var(--space-1);
  }

  .worktrees__form {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-3);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-sm);
    background: var(--row-subtle-bg);
  }

  .worktrees__field {
    display: grid;
    gap: 3px;
    font-size: 11px;
    color: var(--text-dim);
  }

  .worktrees__field input {
    padding: 6px 8px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--glass-border);
    background: var(--control-bg-strong);
    color: var(--text);
    font: inherit;
    font-size: 12px;
  }

  .worktrees__check {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
  }

  .worktrees__repo,
  .worktrees__empty {
    margin: 0;
    font-size: 12px;
    color: var(--text-dim);
  }

  .worktrees__error {
    margin: 0;
    font-size: 12px;
    color: var(--red);
  }
</style>
