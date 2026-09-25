<!-- Status bar glass (T1.6): panel enfocado, cwd, scroll, zoom y versión. -->
<script lang="ts">
  import { es } from '../../lib/i18n/es';
  import { layout } from '../../lib/stores/layout.svelte';
  import { shortPath } from '../../lib/stores/snapshot';
  import { session } from '../../lib/stores/session.svelte';

  const pane = $derived(session.focusedPane);
  const scroll = $derived(pane?.scroll ?? null);
  const scrollLabel = $derived(
    scroll
      ? es.statusbar.scroll
          .replace('{offset}', String(scroll.offset_from_bottom))
          .replace('{max}', String(scroll.max_offset_from_bottom))
      : es.statusbar.scroll.replace('{offset}', '0').replace('{max}', '0'),
  );
  const versionLabel = $derived(
    session.version
      ? es.app.version
          .replace('{version}', session.version)
          .replace('{protocol}', String(session.protocol ?? '?'))
      : '',
  );
</script>

<footer class="statusbar glass" data-testid="statusbar">
  <span class="statusbar__item" data-testid="status-pane">
    {es.statusbar.pane}
    {session.focusedPaneId ?? '—'}
  </span>
  <span class="statusbar__item" data-testid="status-cwd">
    {shortPath(pane?.cwd) || '—'}
  </span>
  <span class="statusbar__item" data-testid="status-scroll">{scrollLabel}</span>
  <span class="statusbar__item" data-testid="status-panes-count">
    {layout.paneCount}
    {es.statusbar.pane}
  </span>
  {#if layout.zoomed}
    <span class="statusbar__item" data-testid="status-zoom">{es.statusbar.zoom}</span>
  {/if}
  <span class="statusbar__spacer"></span>
  {#if session.rpcLatency !== null}
    <span class="statusbar__item" data-testid="status-latency">
      {es.connection.latency.replace('{ms}', session.rpcLatency.toFixed(1))}
    </span>
  {/if}
  <span class="statusbar__item" data-testid="status-version">{versionLabel}</span>
</footer>
