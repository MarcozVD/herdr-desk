<!-- Confirmación con promesa: un solo diálogo montado en App.svelte atiende a
     todas las llamadas a `ui.confirm()` (T1.9). -->
<script lang="ts">
  import { es } from '../i18n/es';
  import { ui } from '../stores/ui.svelte';
  import Dialog from './Dialog.svelte';
  import Field from './Field.svelte';

  const request = $derived(ui.pendingConfirm);
  let typed = $state('');

  const matches = $derived(request?.requireText ? typed.trim() === request.requireText : true);

  function close(): void {
    typed = '';
    ui.resolveConfirm(false);
  }

  function accept(): void {
    if (!matches) return;
    typed = '';
    ui.resolveConfirm(true);
  }
</script>

{#if request}
  <Dialog
    title={request.title}
    onclose={close}
    width="28rem"
    testId="confirm-dialog"
    closeLabel={es.dialog.cancel}
  >
    <p class="confirm__message">{request.message}</p>
    {#if request.requireText}
      <Field
        label={es.sessions.deleteConfirmHint.replace('{name}', request.requireText)}
        bind:value={typed}
        testId="confirm-text"
        autofocus
        onsubmit={accept}
      />
    {/if}

    {#snippet footer()}
      <button type="button" class="btn" data-testid="confirm-cancel" onclick={close}>
        {request.cancelLabel ?? es.dialog.cancel}
      </button>
      <button
        type="button"
        class="btn btn--primary"
        data-danger={request.danger}
        data-testid="confirm-accept"
        disabled={!matches}
        onclick={accept}
      >
        {request.confirmLabel ?? es.dialog.accept}
      </button>
    {/snippet}
  </Dialog>
{/if}

<style>
  .confirm__message {
    margin: 0;
    font-size: 13px;
    color: var(--text);
    white-space: pre-line;
  }
</style>
