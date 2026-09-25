<!-- Alta de espacio (T1.9): nombre + directorio de trabajo. -->
<script lang="ts">
  import { es } from '../i18n/es';
  import { ui } from '../stores/ui.svelte';
  import Dialog from './Dialog.svelte';
  import Field from './Field.svelte';

  const request = $derived(ui.pendingWorkspaceForm);
  let label = $state('');
  let cwd = $state('');

  $effect(() => {
    label = request?.labelValue ?? '';
    cwd = request?.cwdValue ?? '';
  });

  function close(): void {
    ui.resolveWorkspaceForm(null);
  }

  function accept(): void {
    ui.resolveWorkspaceForm({ label: label.trim(), cwd: cwd.trim() });
  }
</script>

{#if request}
  <Dialog
    title={request.title}
    onclose={close}
    width="28rem"
    testId="workspace-dialog"
    closeLabel={es.dialog.cancel}
  >
    <Field
      label={es.workspace.labelLabel}
      bind:value={label}
      placeholder={es.workspace.labelPlaceholder}
      testId="workspace-label"
      autofocus
      onsubmit={accept}
    />
    <Field
      label={es.workspace.cwdLabel}
      bind:value={cwd}
      placeholder="C:\\ruta\\del\\proyecto"
      hint={es.workspace.createHint}
      testId="workspace-cwd"
      onsubmit={accept}
    />

    {#snippet footer()}
      <button type="button" class="btn" data-testid="workspace-cancel" onclick={close}>
        {es.dialog.cancel}
      </button>
      <button
        type="button"
        class="btn btn--primary"
        data-testid="workspace-accept"
        onclick={accept}
      >
        {es.dialog.create}
      </button>
    {/snippet}
  </Dialog>
{/if}
