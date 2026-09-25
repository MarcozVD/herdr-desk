<!-- Campo de formulario con etiqueta (diálogos de T1.9 y T1.11). -->
<script lang="ts">
  interface Props {
    label: string;
    value: string;
    placeholder?: string;
    hint?: string;
    error?: string;
    testId?: string;
    autofocus?: boolean;
    oninput?: (value: string) => void;
    onsubmit?: () => void;
  }

  let {
    label,
    value = $bindable(),
    placeholder,
    hint,
    error,
    testId,
    autofocus = false,
    oninput,
    onsubmit,
  }: Props = $props();

  let input = $state<HTMLInputElement | null>(null);

  $effect(() => {
    if (autofocus) input?.focus();
  });

  function handleInput(event: Event): void {
    const next = (event.currentTarget as HTMLInputElement).value;
    value = next;
    oninput?.(next);
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      onsubmit?.();
    }
  }
</script>

<label class="field" data-testid={testId}>
  <span class="field__label">{label}</span>
  <input
    class="field__input"
    bind:this={input}
    {value}
    {placeholder}
    spellcheck="false"
    oninput={handleInput}
    onkeydown={handleKeydown}
  />
  {#if error}
    <span class="field__error" data-testid="field-error">{error}</span>
  {:else if hint}
    <span class="field__hint">{hint}</span>
  {/if}
</label>

<style>
  .field {
    display: grid;
    gap: 4px;
  }

  .field__label {
    font-size: 12px;
    color: var(--text-dim);
  }

  .field__input {
    inline-size: 100%;
    padding: 8px 10px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--glass-border);
    background: color-mix(in oklab, var(--panel-bg) 70%, transparent);
    color: var(--text);
    font: inherit;
  }

  .field__input:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .field__hint {
    font-size: 11px;
    color: var(--text-dim);
  }

  .field__error {
    font-size: 11px;
    color: var(--red);
  }
</style>
