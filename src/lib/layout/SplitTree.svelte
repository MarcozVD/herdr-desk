<!-- T1.7 — Render del árbol de splits con flex y los ratios del árbol. Los
     divisores son visuales en F1 (el arrastre llega en T3.1 con
     layout.set_split_ratio). -->
<script lang="ts">
  import PaneFrame from '../../features/panes/PaneFrame.svelte';
  import { settings } from '../stores/settings.svelte';
  import type { TreeNode } from './tree';
  import SplitTree from './SplitTree.svelte';

  interface Props {
    node: TreeNode;
  }

  let { node }: Props = $props();

  const ratio = $derived(Math.min(0.95, Math.max(0.05, node.ratio ?? 0.5)));
  const pathKey = $derived(node.path.map((branch) => (branch ? '1' : '0')).join('.') || 'root');
</script>

{#if node.kind === 'pane' && node.paneId}
  <PaneFrame paneId={node.paneId} />
{:else if node.first && node.second}
  <div
    class="split"
    data-direction={node.direction}
    data-path={pathKey}
    data-testid="split"
    data-gaps={settings.values.pane_gaps}
  >
    <div class="split__side" style="--ratio:{ratio}">
      <SplitTree node={node.first} />
    </div>
    <div
      class="split__divider"
      data-testid="split-divider"
      data-direction={node.direction}
      data-path={pathKey}
      aria-hidden="true"
    ></div>
    <div class="split__side" style="--ratio:{1 - ratio}">
      <SplitTree node={node.second} />
    </div>
  </div>
{/if}

<style>
  .split {
    display: flex;
    block-size: 100%;
    inline-size: 100%;
    min-block-size: 0;
    min-inline-size: 0;
  }

  .split[data-direction='down'] {
    flex-direction: column;
  }

  .split__side {
    flex: var(--ratio) 1 0;
    min-block-size: 0;
    min-inline-size: 0;
    display: flex;
  }

  .split__divider {
    flex: 0 0 auto;
    background: var(--glass-border);
  }

  .split[data-direction='right'] > .split__divider {
    inline-size: 2px;
    cursor: col-resize;
  }

  .split[data-direction='down'] > .split__divider {
    block-size: 2px;
    cursor: row-resize;
  }

  .split[data-gaps='true'] {
    gap: 2px;
  }

  .split[data-gaps='true'] > .split__divider {
    background: transparent;
  }
</style>
