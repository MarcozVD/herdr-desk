<!-- Diálogo de un solo campo (renombrar espacio/tab/panel, nueva pestaña,
     nueva sesión). Lo abre `ui.prompt(...)` y resuelve con string o null. -->
<script lang="ts">
  import { es } from '../i18n/es';
  import { ui } from '../stores/ui.svelte';
  import Dialog from './Dialog.svelte';
  import Field from './Field.svelte';

  const request = $derived(ui.pendingPrompt);
  let value = $state('');
  let error = $state('');

  $effect(() => {
    value = request?.value ?? '';
    error = '';
  });

  function close(): void {
    ui.resolvePrompt(null);
  }

  function accept(): void {
    if (!request) return;
    const trimmed = value.trim();
    const message =
      request.validate?.(trimmed) ?? (trimmed.length === 0 ? 'Escribe un valor.' : null);
    if (message) {
      error = message;
      return;
    }
    ui.resolvePrompt(trimmed);
  }
</script>

{#if request}
  <Dialog
    title={request.title}
    onclose={close}
    width="26rem"
    testId="prompt-dialog"
    closeLabel={es.dialog.cancel}
  >
    <Field
      label={request.label}
      bind:value
      placeholder={request.placeholder}
      hint={request.hint}
      {error}
      testId="prompt-input"
      autofocus
      onsubmit={accept}
    />

    {#snippet footer()}
      <button type="button" class="btn" data-testid="prompt-cancel" onclick={close}>
        {es.dialog.cancel}
      </button>
      <button type="button" class="btn btn--primary" data-testid="prompt-accept" onclick={accept}>
        {request.submitLabel ?? es.dialog.accept}
      </button>
    {/snippet}
  </Dialog>
{/if}
