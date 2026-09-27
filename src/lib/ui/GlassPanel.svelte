<!-- Panel glass reutilizable (superficie de la capa 2 del §3). -->
<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    overlay?: boolean;
    class?: string;
    testId?: string;
    children: Snippet;
  }

  let { overlay = false, class: className = '', testId, children }: Props = $props();
</script>

<section class="{overlay ? 'layer-overlay' : 'layer-surface'} {className}" data-testid={testId}>
  {@render children()}
</section>
