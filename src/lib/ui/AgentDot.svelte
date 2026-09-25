<!-- Punto de estado de agente (§3): el glow vive en ::after y solo anima opacity. -->
<script lang="ts">
  import type { AgentStatus } from '../herdr/types';

  interface Props {
    status: AgentStatus;
    label?: string;
  }

  let { status, label }: Props = $props();
</script>

<span class="agent-dot" data-state={status} title={label ?? status} aria-label={label ?? status}
></span>
