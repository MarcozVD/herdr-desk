<!-- Diálogo de un solo campo (renombrar espacio/tab/panel, nueva pestaña,
     nueva sesión). Lo abre `ui.prompt(...)` y resuelve con string o null. -->
<script lang="ts">
  import { es } from '../i18n/es';
  import { ui } from '../stores/ui.svelte';
  import Dialog from './Dialog.svelte';
  import Field from './Field.svelte';

  const request = $derived(ui.pendingPrompt);
  // El valor inicial sale del prompt; App.svelte recrea el diálogo con `{#key}`
  // cuando llega otro, así que no hace falta efecto.
  // svelte-ignore state_referenced_locally
  let value = $state(request?.value ?? '');

  const error = $derived(
    request
      ? (request.validate?.(value.trim()) ??
          (value.trim().length === 0 ? es.dialog.required : null) ??
          '')
      : '',
  );

  function close(): void {
    ui.resolvePrompt(null);
  }

  function accept(): void {
    if (!request) return;
    if (error.length > 0) return;
    ui.resolvePrompt(value.trim());
  }
</script>

{#if request}
  <Dialog
    title={request.title}
    onclose={close}
    width="26rem"
    testId="prompt-dialog"
    level={30}
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
      <button
        type="button"
        class="btn btn--primary"
        data-testid="prompt-accept"
        disabled={error.length > 0}
        onclick={accept}
      >
        {request.submitLabel ?? es.dialog.accept}
      </button>
    {/snippet}
  </Dialog>
{/if}
