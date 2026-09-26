<!-- Arnes SOLO para tests unitarios: replica el montaje real del shell
     (`{#if tree} <SplitTree node={tree} />`) y permite cambiar el árbol igual
     que lo hace App.svelte cuando llega un `layout.export` nuevo. Los tests de
     `SplitTree.test.ts` lo montan en jsdom y comprueban qué pasa con los marcos
     cuando un panel desaparece o su hueco lo ocupa otro. -->
<script lang="ts">
  import type { TreeNode } from './tree';
  import SplitTree from './SplitTree.svelte';

  let node = $state<TreeNode | null>(null);

  /** Cambia el árbol (null = sin paneles). */
  export function setTree(next: TreeNode | null): void {
    node = next;
  }

  /** Árbol actual del arnés. */
  export function currentTree(): TreeNode | null {
    return node;
  }
</script>

{#if node}
  <SplitTree {node} />
{/if}
