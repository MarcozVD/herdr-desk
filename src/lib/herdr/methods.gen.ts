/* eslint-disable */
/**
 * Métodos y respuestas del API de herdr — GENERADO por scripts/gen-types.mjs. NO EDITAR A MANO.
 * Origen: schema/herdr-api.schema.json (0.8.0-preview.2026-08-04-d78e3d3b5126 protocol=19)
 * Regenerar: pnpm gen  (o: node scripts/gen-types.mjs)
 * 90 métodos · 57 tipos de respuesta
 * Los tipos referenciados viven en src/lib/herdr/types.gen.ts (se re-exportan aquí).
 */
import type * as Api from './types.gen';

export * from './types.gen';

/** Params de cada uno de los 90 métodos del API. */
export interface MethodParams {
  ping: Api.PingParams;
  'server.stop': Api.EmptyParams;
  'server.live_handoff': Api.ServerLiveHandoffParams;
  'server.reload_config': Api.EmptyParams;
  'server.agent_manifests': Api.EmptyParams;
  'server.reload_agent_manifests': Api.EmptyParams;
  'notification.show': Api.NotificationShowParams;
  'client.window_title.set': Api.ClientWindowTitleSetParams;
  'client.window_title.clear': Api.EmptyParams;
  'session.snapshot': Api.EmptyParams;
  'workspace.create': Api.WorkspaceCreateParams;
  'workspace.list': Api.EmptyParams;
  'workspace.get': Api.WorkspaceTarget;
  'workspace.focus': Api.WorkspaceTarget;
  'workspace.rename': Api.WorkspaceRenameParams;
  'workspace.move': Api.WorkspaceMoveParams;
  'workspace.move_block': Api.WorkspaceMoveBlockParams;
  'workspace.report_metadata': Api.WorkspaceReportMetadataParams;
  'workspace.close': Api.WorkspaceTarget;
  'worktree.list': Api.WorktreeListParams;
  'worktree.create': Api.WorktreeCreateParams;
  'worktree.open': Api.WorktreeOpenParams;
  'worktree.remove': Api.WorktreeRemoveParams;
  'tab.create': Api.TabCreateParams;
  'tab.list': Api.TabListParams;
  'tab.get': Api.TabTarget;
  'tab.focus': Api.TabTarget;
  'tab.rename': Api.TabRenameParams;
  'tab.move': Api.TabMoveParams;
  'tab.close': Api.TabTarget;
  'agent.list': Api.EmptyParams;
  'agent.get': Api.AgentTarget;
  'agent.read': Api.AgentReadParams;
  'agent.explain': Api.AgentTarget;
  'agent.send_keys': Api.AgentSendKeysParams;
  'agent.rename': Api.AgentRenameParams;
  'agent.view.set': Api.AgentViewSetParams;
  'agent.view.clear': Api.AgentViewClearParams;
  'agent.focus': Api.AgentTarget;
  'agent.start': Api.AgentStartParams;
  'agent.prompt': Api.AgentPromptParams;
  'agent.wait': Api.AgentWaitParams;
  'pane.split': Api.PaneSplitParams;
  'pane.swap': Api.PaneSwapParams;
  'pane.move': Api.PaneMoveParams;
  'pane.zoom': Api.PaneZoomParams;
  'pane.layout': Api.PaneLayoutParams;
  'pane.process_info': Api.PaneProcessInfoParams;
  'layout.export': Api.LayoutExportParams;
  'layout.apply': Api.LayoutApplyParams;
  'layout.set_split_ratio': Api.LayoutSetSplitRatioParams;
  'pane.neighbor': Api.PaneNeighborParams;
  'pane.edges': Api.PaneEdgesParams;
  'pane.focus_direction': Api.PaneFocusDirectionParams;
  'pane.resize': Api.PaneResizeParams;
  'pane.list': Api.PaneListParams;
  'pane.current': Api.PaneCurrentParams;
  'pane.get': Api.PaneTarget;
  'pane.focus': Api.PaneTarget;
  'pane.rename': Api.PaneRenameParams;
  'pane.send_text': Api.PaneSendTextParams;
  'pane.send_keys': Api.PaneSendKeysParams;
  'pane.send_input': Api.PaneSendInputParams;
  'pane.read': Api.PaneReadParams;
  'pane.graphics.set': Api.PaneGraphicsSetParams;
  'pane.graphics.clear': Api.PaneGraphicsClearParams;
  'pane.graphics.info': Api.PaneTarget;
  'pane.report_agent': Api.PaneReportAgentParams;
  'pane.report_agent_session': Api.PaneReportAgentSessionParams;
  'pane.report_metadata': Api.PaneReportMetadataParams;
  'pane.clear_agent_authority': Api.PaneClearAgentAuthorityParams;
  'pane.release_agent': Api.PaneReleaseAgentParams;
  'pane.close': Api.PaneTarget;
  'popup.close': Api.EmptyParams;
  'events.subscribe': Api.EventsSubscribeParams;
  'events.wait': Api.EventsWaitParams;
  'pane.wait_for_output': Api.PaneWaitForOutputParams;
  'integration.install': Api.IntegrationInstallParams;
  'integration.uninstall': Api.IntegrationUninstallParams;
  'plugin.link': Api.PluginLinkParams;
  'plugin.list': Api.PluginListParams;
  'plugin.unlink': Api.PluginUnlinkParams;
  'plugin.enable': Api.PluginSetEnabledParams;
  'plugin.disable': Api.PluginSetEnabledParams;
  'plugin.action.list': Api.PluginActionListParams;
  'plugin.action.invoke': Api.PluginActionInvokeParams;
  'plugin.log.list': Api.PluginLogListParams;
  'plugin.pane.open': Api.PluginPaneOpenParams;
  'plugin.pane.focus': Api.PluginPaneFocusParams;
  'plugin.pane.close': Api.PluginPaneCloseParams;
}

export type MethodName = keyof MethodParams;

/** Nombres de método en runtime (tests de cobertura, paleta y consola del API). */
export const METHOD_NAMES = [
  'ping',
  'server.stop',
  'server.live_handoff',
  'server.reload_config',
  'server.agent_manifests',
  'server.reload_agent_manifests',
  'notification.show',
  'client.window_title.set',
  'client.window_title.clear',
  'session.snapshot',
  'workspace.create',
  'workspace.list',
  'workspace.get',
  'workspace.focus',
  'workspace.rename',
  'workspace.move',
  'workspace.move_block',
  'workspace.report_metadata',
  'workspace.close',
  'worktree.list',
  'worktree.create',
  'worktree.open',
  'worktree.remove',
  'tab.create',
  'tab.list',
  'tab.get',
  'tab.focus',
  'tab.rename',
  'tab.move',
  'tab.close',
  'agent.list',
  'agent.get',
  'agent.read',
  'agent.explain',
  'agent.send_keys',
  'agent.rename',
  'agent.view.set',
  'agent.view.clear',
  'agent.focus',
  'agent.start',
  'agent.prompt',
  'agent.wait',
  'pane.split',
  'pane.swap',
  'pane.move',
  'pane.zoom',
  'pane.layout',
  'pane.process_info',
  'layout.export',
  'layout.apply',
  'layout.set_split_ratio',
  'pane.neighbor',
  'pane.edges',
  'pane.focus_direction',
  'pane.resize',
  'pane.list',
  'pane.current',
  'pane.get',
  'pane.focus',
  'pane.rename',
  'pane.send_text',
  'pane.send_keys',
  'pane.send_input',
  'pane.read',
  'pane.graphics.set',
  'pane.graphics.clear',
  'pane.graphics.info',
  'pane.report_agent',
  'pane.report_agent_session',
  'pane.report_metadata',
  'pane.clear_agent_authority',
  'pane.release_agent',
  'pane.close',
  'popup.close',
  'events.subscribe',
  'events.wait',
  'pane.wait_for_output',
  'integration.install',
  'integration.uninstall',
  'plugin.link',
  'plugin.list',
  'plugin.unlink',
  'plugin.enable',
  'plugin.disable',
  'plugin.action.list',
  'plugin.action.invoke',
  'plugin.log.list',
  'plugin.pane.open',
  'plugin.pane.focus',
  'plugin.pane.close',
] as const satisfies readonly MethodName[];

/** Tipo de resultado según el campo `type` de la respuesta. */
export interface ResponseByType {
  pong: Api.ResponsePong;
  session_snapshot: Api.ResponseSessionSnapshot;
  workspace_info: Api.ResponseWorkspaceInfo;
  workspace_created: Api.ResponseWorkspaceCreated;
  workspace_list: Api.ResponseWorkspaceList;
  worktree_list: Api.ResponseWorktreeList;
  worktree_created: Api.ResponseWorktreeCreated;
  worktree_opened: Api.ResponseWorktreeOpened;
  worktree_removed: Api.ResponseWorktreeRemoved;
  tab_info: Api.ResponseTabInfo;
  tab_created: Api.ResponseTabCreated;
  tab_list: Api.ResponseTabList;
  agent_info: Api.ResponseAgentInfo;
  agent_started: Api.ResponseAgentStarted;
  agent_prompted: Api.ResponseAgentPrompted;
  agent_list: Api.ResponseAgentList;
  agent_view: Api.ResponseAgentView;
  pane_info: Api.ResponsePaneInfo;
  pane_list: Api.ResponsePaneList;
  pane_current: Api.ResponsePaneCurrent;
  pane_swap: Api.ResponsePaneSwap;
  pane_move: Api.ResponsePaneMove;
  pane_zoom: Api.ResponsePaneZoom;
  pane_layout: Api.ResponsePaneLayout;
  pane_process_info: Api.ResponsePaneProcessInfo;
  layout_export: Api.ResponseLayoutExport;
  layout_apply: Api.ResponseLayoutApply;
  layout_split_ratio_set: Api.ResponseLayoutSplitRatioSet;
  pane_neighbor: Api.ResponsePaneNeighbor;
  pane_edges: Api.ResponsePaneEdges;
  pane_focus_direction: Api.ResponsePaneFocusDirection;
  pane_resize: Api.ResponsePaneResize;
  pane_read: Api.ResponsePaneRead;
  pane_graphics_info: Api.ResponsePaneGraphicsInfo;
  agent_explain: Api.ResponseAgentExplain;
  subscription_started: Api.ResponseSubscriptionStarted;
  wait_matched: Api.ResponseWaitMatched;
  output_matched: Api.ResponseOutputMatched;
  notification_show: Api.ResponseNotificationShow;
  client_window_title: Api.ResponseClientWindowTitle;
  integration_install: Api.ResponseIntegrationInstall;
  integration_uninstall: Api.ResponseIntegrationUninstall;
  agent_manifest_reload: Api.ResponseAgentManifestReload;
  agent_manifest_status: Api.ResponseAgentManifestStatus;
  plugin_linked: Api.ResponsePluginLinked;
  plugin_list: Api.ResponsePluginList;
  plugin_unlinked: Api.ResponsePluginUnlinked;
  plugin_enabled: Api.ResponsePluginEnabled;
  plugin_disabled: Api.ResponsePluginDisabled;
  plugin_action_list: Api.ResponsePluginActionList;
  plugin_action_invoked: Api.ResponsePluginActionInvoked;
  plugin_log_list: Api.ResponsePluginLogList;
  plugin_pane_opened: Api.ResponsePluginPaneOpened;
  plugin_pane_focused: Api.ResponsePluginPaneFocused;
  plugin_pane_closed: Api.ResponsePluginPaneClosed;
  config_reload: Api.ResponseConfigReload;
  ok: Api.ResponseOk;
}

export type ResponseTypeName = keyof ResponseByType;

/** Nombres de tipo de respuesta en runtime. */
export const RESPONSE_TYPE_NAMES = [
  'pong',
  'session_snapshot',
  'workspace_info',
  'workspace_created',
  'workspace_list',
  'worktree_list',
  'worktree_created',
  'worktree_opened',
  'worktree_removed',
  'tab_info',
  'tab_created',
  'tab_list',
  'agent_info',
  'agent_started',
  'agent_prompted',
  'agent_list',
  'agent_view',
  'pane_info',
  'pane_list',
  'pane_current',
  'pane_swap',
  'pane_move',
  'pane_zoom',
  'pane_layout',
  'pane_process_info',
  'layout_export',
  'layout_apply',
  'layout_split_ratio_set',
  'pane_neighbor',
  'pane_edges',
  'pane_focus_direction',
  'pane_resize',
  'pane_read',
  'pane_graphics_info',
  'agent_explain',
  'subscription_started',
  'wait_matched',
  'output_matched',
  'notification_show',
  'client_window_title',
  'integration_install',
  'integration_uninstall',
  'agent_manifest_reload',
  'agent_manifest_status',
  'plugin_linked',
  'plugin_list',
  'plugin_unlinked',
  'plugin_enabled',
  'plugin_disabled',
  'plugin_action_list',
  'plugin_action_invoked',
  'plugin_log_list',
  'plugin_pane_opened',
  'plugin_pane_focused',
  'plugin_pane_closed',
  'config_reload',
  'ok',
] as const satisfies readonly ResponseTypeName[];

/** Unión de todas las respuestas posibles. */
export type ResponseResult =
  | Api.ResponsePong
  | Api.ResponseSessionSnapshot
  | Api.ResponseWorkspaceInfo
  | Api.ResponseWorkspaceCreated
  | Api.ResponseWorkspaceList
  | Api.ResponseWorktreeList
  | Api.ResponseWorktreeCreated
  | Api.ResponseWorktreeOpened
  | Api.ResponseWorktreeRemoved
  | Api.ResponseTabInfo
  | Api.ResponseTabCreated
  | Api.ResponseTabList
  | Api.ResponseAgentInfo
  | Api.ResponseAgentStarted
  | Api.ResponseAgentPrompted
  | Api.ResponseAgentList
  | Api.ResponseAgentView
  | Api.ResponsePaneInfo
  | Api.ResponsePaneList
  | Api.ResponsePaneCurrent
  | Api.ResponsePaneSwap
  | Api.ResponsePaneMove
  | Api.ResponsePaneZoom
  | Api.ResponsePaneLayout
  | Api.ResponsePaneProcessInfo
  | Api.ResponseLayoutExport
  | Api.ResponseLayoutApply
  | Api.ResponseLayoutSplitRatioSet
  | Api.ResponsePaneNeighbor
  | Api.ResponsePaneEdges
  | Api.ResponsePaneFocusDirection
  | Api.ResponsePaneResize
  | Api.ResponsePaneRead
  | Api.ResponsePaneGraphicsInfo
  | Api.ResponseAgentExplain
  | Api.ResponseSubscriptionStarted
  | Api.ResponseWaitMatched
  | Api.ResponseOutputMatched
  | Api.ResponseNotificationShow
  | Api.ResponseClientWindowTitle
  | Api.ResponseIntegrationInstall
  | Api.ResponseIntegrationUninstall
  | Api.ResponseAgentManifestReload
  | Api.ResponseAgentManifestStatus
  | Api.ResponsePluginLinked
  | Api.ResponsePluginList
  | Api.ResponsePluginUnlinked
  | Api.ResponsePluginEnabled
  | Api.ResponsePluginDisabled
  | Api.ResponsePluginActionList
  | Api.ResponsePluginActionInvoked
  | Api.ResponsePluginLogList
  | Api.ResponsePluginPaneOpened
  | Api.ResponsePluginPaneFocused
  | Api.ResponsePluginPaneClosed
  | Api.ResponseConfigReload
  | Api.ResponseOk;

export type { Api };
