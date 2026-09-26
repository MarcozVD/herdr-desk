<!-- T2.4 — Rollup de estado de un contenedor (espacio, pestaña o sesión): el
     punto de estado y, si hay agentes bloqueados, su conteo. Sin
     `backdrop-filter`: son filas de lista (§4, máximo de superficies glass). -->
<script lang="ts">
  import { rollupAgents } from '../agents/agentPanel';
  import { es } from '../i18n/es';
  import type { AgentInfo, AgentStatus } from '../herdr/types';
  import AgentDot from './AgentDot.svelte';

  interface Props {
    /** Agentes que cuelgan del contenedor (para el conteo). */
    agents: AgentInfo[];
    /** Estado que ya da el backend para el contenedor; si falta, se calcula. */
    status?: AgentStatus | null;
  }

  let { agents, status = null }: Props = $props();

  const rollup = $derived(rollupAgents(agents));
  const shown = $derived<AgentStatus>(status ?? rollup.status);
</script>

<span
  class="rollup"
  data-testid="status-rollup"
  data-status={shown}
  data-blocked={rollup.blocked}
  title={es.agentStatus[shown]}
>
  <AgentDot status={shown} label={es.agentStatus[shown]} />
  {#if rollup.blocked > 0}
    <span
      class="rollup__blocked"
      data-testid="rollup-blocked"
      title={es.sidebar.blockedCount.replace('{n}', String(rollup.blocked))}>{rollup.blocked}</span
    >
  {/if}
</span>

<style>
  .rollup {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    flex: 0 0 auto;
  }

  .rollup__blocked {
    color: var(--yellow);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    line-height: 1;
  }
</style>
