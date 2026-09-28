// T4.7 — Cobertura de los 90 métodos del API.
//
// Cada método de `methods.gen.ts` se clasifica aquí como:
//   - `curated:<ruta UI>` — tiene una superficie propia en la GUI (se indica la
//     feature que lo expone), o
//   - `console` — no tiene UI dedicada y se cubre desde la consola API (T4.5).
//
// `coverage.test.ts` falla si herdr añade un método sin clasificar o si esta
// tabla se queda con métodos que ya no existen. Junto con `schema:check`, evita
// que la GUI se quede atrás del protocolo sin que nadie se entere.

import type { MethodName } from './methods.gen';

export type Coverage = `curated:${string}` | 'console';

/** Ruta de UI (feature) que expone el método. */
export const COVERAGE: Record<MethodName, Coverage> = {
  // Servidor / conexión
  ping: 'curated:titlebar',
  'server.reload_config': 'curated:titlebar',
  'server.stop': 'curated:server',
  'server.live_handoff': 'curated:server',
  'server.agent_manifests': 'curated:server',
  'server.reload_agent_manifests': 'curated:server',
  'notification.show': 'curated:advanced',

  // Cliente / ventana
  'client.window_title.set': 'curated:advanced',
  'client.window_title.clear': 'curated:advanced',

  // Sesión / store
  'session.snapshot': 'curated:session',

  // Espacios (sidebar y diálogos)
  'workspace.create': 'curated:sidebar',
  'workspace.list': 'curated:sidebar',
  'workspace.get': 'console',
  'workspace.focus': 'curated:sidebar',
  'workspace.rename': 'curated:sidebar',
  'workspace.move': 'curated:sidebar',
  'workspace.move_block': 'curated:sidebar',
  'workspace.report_metadata': 'curated:advanced',
  'workspace.close': 'curated:sidebar',

  // Worktrees
  'worktree.list': 'curated:worktrees',
  'worktree.create': 'curated:worktrees',
  'worktree.open': 'curated:worktrees',
  'worktree.remove': 'curated:worktrees',

  // Pestañas
  'tab.create': 'curated:tabs',
  'tab.list': 'curated:tabs',
  'tab.get': 'console',
  'tab.focus': 'curated:tabs',
  'tab.rename': 'curated:tabs',
  'tab.move': 'curated:tabs',
  'tab.close': 'curated:tabs',

  // Agentes
  'agent.list': 'curated:agents',
  'agent.get': 'curated:agents',
  'agent.read': 'curated:agents',
  'agent.explain': 'curated:agents',
  'agent.send_keys': 'curated:agents',
  'agent.rename': 'curated:agents',
  'agent.view.set': 'curated:advanced',
  'agent.view.clear': 'curated:advanced',
  'agent.focus': 'curated:agents',
  'agent.start': 'curated:agents',
  'agent.prompt': 'curated:agents',
  'agent.wait': 'curated:agents',

  // Paneles
  'pane.split': 'curated:panes',
  'pane.swap': 'curated:panes',
  'pane.move': 'curated:panes',
  'pane.zoom': 'curated:panes',
  'pane.layout': 'console',
  'pane.process_info': 'curated:advanced',
  'pane.neighbor': 'console',
  'pane.edges': 'console',
  'pane.focus_direction': 'curated:panes',
  'pane.resize': 'curated:panes',
  'pane.list': 'curated:session',
  'pane.current': 'console',
  'pane.get': 'console',
  'pane.focus': 'curated:panes',
  'pane.rename': 'curated:panes',
  'pane.send_text': 'curated:panes',
  'pane.send_keys': 'curated:panes',
  'pane.send_input': 'curated:panes',
  'pane.read': 'curated:panes',
  'pane.graphics.set': 'curated:advanced',
  'pane.graphics.clear': 'curated:advanced',
  'pane.graphics.info': 'curated:advanced',
  'pane.report_agent': 'curated:agents',
  'pane.report_agent_session': 'curated:advanced',
  'pane.report_metadata': 'curated:advanced',
  'pane.clear_agent_authority': 'curated:advanced',
  'pane.release_agent': 'curated:agents',
  'pane.close': 'curated:panes',
  'pane.wait_for_output': 'curated:panes',

  // Layout / presets
  'layout.export': 'curated:presets',
  'layout.apply': 'curated:presets',
  'layout.set_split_ratio': 'curated:panes',

  // Popups / eventos
  'popup.close': 'curated:advanced',
  'events.subscribe': 'curated:console',
  'events.wait': 'console',

  // Integraciones
  'integration.install': 'curated:integrations',
  'integration.uninstall': 'curated:integrations',

  // Plugins
  'plugin.link': 'curated:plugins',
  'plugin.list': 'curated:plugins',
  'plugin.unlink': 'curated:plugins',
  'plugin.enable': 'curated:plugins',
  'plugin.disable': 'curated:plugins',
  'plugin.action.list': 'curated:plugins',
  'plugin.action.invoke': 'curated:plugins',
  'plugin.log.list': 'curated:plugins',
  'plugin.pane.open': 'curated:plugins',
  'plugin.pane.focus': 'curated:plugins',
  'plugin.pane.close': 'curated:plugins',
};

/** Rutas de UI declaradas (para el test de cobertura y la consola). */
export function curatedRoutes(): string[] {
  const routes = new Set<string>();
  for (const value of Object.values(COVERAGE)) {
    if (value.startsWith('curated:')) routes.add(value.slice('curated:'.length));
  }
  return [...routes].sort();
}
