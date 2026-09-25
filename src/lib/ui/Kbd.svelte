<!-- Chip de atajo (teclas), estilo del §3. -->
<script lang="ts">
  interface Props {
    keys: string;
  }
  let { keys }: Props = $props();
</script>

<span class="kbd" data-testid="kbd">{keys}</span>
