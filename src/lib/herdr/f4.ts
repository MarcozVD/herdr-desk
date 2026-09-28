// F4 — Cliente de los commands de la fase: plugins, integraciones, estado del
// servidor, catálogo del API y utilidades de la consola/avanzado.
//
// Todos degradan con `CommandOutcome`: un backend viejo sin el command se ve
// como `missing` y la UI avisa en español en vez de romper.

import { optionalCommand, type CommandOutcome } from './client';

/* ---- Plugins (T4.1) ---- */

export interface PluginSourceInfo {
  kind: string;
  owner: string | null;
  repo: string | null;
  subdir: string | null;
  requested_ref: string | null;
  resolved_commit: string | null;
  managed_path: string | null;
  installed_unix_ms: number | null;
}

export interface PluginActionInfo {
  plugin_id: string;
  action_id: string;
  title: string;
  command: string[];
  contexts: string[];
  description: string | null;
  platforms: string[] | null;
}

export interface PluginManifestPane {
  id: string;
  title: string;
  command: string[];
  description: string | null;
  placement: string | null;
  width: unknown;
  height: unknown;
  platforms: string[] | null;
}

export interface PluginManifestEventHook {
  on: string;
  command: string[];
  platforms: string[] | null;
}

export interface PluginInfo {
  plugin_id: string;
  name: string;
  version: string;
  manifest_path: string;
  plugin_root: string;
  enabled: boolean;
  description: string | null;
  warnings: string[];
  min_herdr_version: string;
  source: PluginSourceInfo | null;
  actions: PluginActionInfo[];
  panes: PluginManifestPane[];
  events: PluginManifestEventHook[];
  build: unknown[];
  startup: unknown[];
  link_handlers: unknown[];
  platforms: string[] | null;
}

export interface PluginInvocationContext {
  workspace_id?: string | null;
  workspace_label?: string | null;
  workspace_cwd?: string | null;
  tab_id?: string | null;
  tab_label?: string | null;
  focused_pane_id?: string | null;
  focused_pane_agent?: string | null;
  focused_pane_status?: string | null;
  focused_pane_cwd?: string | null;
  selected_text?: string | null;
  clicked_url?: string | null;
  link_handler_id?: string | null;
  invocation_source?: string | null;
  correlation_id?: string | null;
}

export interface PluginCommandLogInfo {
  log_id: string;
  plugin_id: string;
  status: string;
  started_unix_ms: number;
  finished_unix_ms: number | null;
  exit_code: number | null;
  error: string | null;
  event: string | null;
  action_id: string | null;
  stdout: string | null;
  stderr: string | null;
}

export interface PluginUnlinked {
  plugin_id: string;
  removed: boolean;
}

export interface PluginActionInvoked {
  action: PluginActionInfo;
  context: PluginInvocationContext | null;
  log: PluginCommandLogInfo;
}

export interface PluginPaneOpenRequest {
  plugin_id: string;
  entrypoint: string;
  workspace_id?: string | null;
  target_pane_id?: string | null;
  cwd?: string | null;
  direction?: string | null;
  focus?: boolean | null;
  width?: unknown;
  height?: unknown;
  placement?: string | null;
}

export interface PluginManifestPreview {
  id: string;
  name: string;
  version: string;
  min_herdr_version: string;
  description: string | null;
}

export interface PluginInstallPreview {
  spec: string;
  owner: string;
  repo: string;
  subdir: string | null;
  requested_ref: string | null;
  resolved_commit: string | null;
  manifest: PluginManifestPreview;
  manifest_raw: string;
  preview_token: string;
}

export interface PluginInstallOutcome {
  spec: string;
  requested_ref: string | null;
  exit_code: number;
  output: string;
}

export async function pluginList(pluginId?: string | null): Promise<CommandOutcome<PluginInfo[]>> {
  return optionalCommand<PluginInfo[]>('plugin_list', { pluginId: pluginId ?? null });
}

export async function pluginEnable(pluginId: string): Promise<CommandOutcome<PluginInfo>> {
  return optionalCommand<PluginInfo>('plugin_enable', { pluginId });
}

export async function pluginDisable(pluginId: string): Promise<CommandOutcome<PluginInfo>> {
  return optionalCommand<PluginInfo>('plugin_disable', { pluginId });
}

export async function pluginUnlink(pluginId: string): Promise<CommandOutcome<PluginUnlinked>> {
  return optionalCommand<PluginUnlinked>('plugin_unlink', {
    request: { plugin_id: pluginId, confirm: true },
  });
}

export async function pluginLink(
  path: string,
  enabled = true,
): Promise<CommandOutcome<PluginInfo>> {
  return optionalCommand<PluginInfo>('plugin_link', { request: { path, enabled } });
}

export async function pluginActionList(
  pluginId?: string | null,
): Promise<CommandOutcome<PluginActionInfo[]>> {
  return optionalCommand<PluginActionInfo[]>('plugin_action_list', {
    pluginId: pluginId ?? null,
  });
}

export async function pluginActionInvoke(
  actionId: string,
  pluginId: string | null,
  context: PluginInvocationContext,
): Promise<CommandOutcome<PluginActionInvoked>> {
  return optionalCommand<PluginActionInvoked>('plugin_action_invoke', {
    request: { action_id: actionId, plugin_id: pluginId, context },
  });
}

export async function pluginLogs(
  pluginId: string | null,
  limit = 50,
): Promise<CommandOutcome<PluginCommandLogInfo[]>> {
  return optionalCommand<PluginCommandLogInfo[]>('plugin_logs', {
    pluginId,
    limit,
  });
}

export async function pluginPaneOpen(
  request: PluginPaneOpenRequest,
): Promise<CommandOutcome<unknown>> {
  return optionalCommand<unknown>('plugin_pane_open', { request });
}

export async function pluginPaneFocus(paneId: string): Promise<CommandOutcome<unknown>> {
  return optionalCommand<unknown>('plugin_pane_focus', { paneId });
}

export async function pluginPaneClose(paneId: string): Promise<CommandOutcome<unknown>> {
  return optionalCommand<unknown>('plugin_pane_close', { paneId });
}

export async function pluginInstallPreview(
  spec: string,
  gitRef: string | null,
): Promise<CommandOutcome<PluginInstallPreview>> {
  return optionalCommand<PluginInstallPreview>('plugin_install_preview', { spec, gitRef });
}

export async function pluginInstall(
  spec: string,
  gitRef: string | null,
  previewToken: string,
): Promise<CommandOutcome<PluginInstallOutcome>> {
  return optionalCommand<PluginInstallOutcome>('plugin_install', {
    spec,
    gitRef,
    previewToken,
    confirm: true,
  });
}

/* ---- Integraciones (T4.2) ---- */

export interface IntegrationStatusEntry {
  name: string;
  state: string;
  version: string | null;
  path: string;
  raw: string;
}

export interface IntegrationOpResult {
  target: string;
  messages: string[];
}

export async function integrationStatus(): Promise<CommandOutcome<IntegrationStatusEntry[]>> {
  return optionalCommand<IntegrationStatusEntry[]>('integration_status');
}

export async function integrationInstall(
  target: string,
): Promise<CommandOutcome<IntegrationOpResult>> {
  return optionalCommand<IntegrationOpResult>('integration_install', { target });
}

export async function integrationUninstall(
  target: string,
): Promise<CommandOutcome<IntegrationOpResult>> {
  return optionalCommand<IntegrationOpResult>('integration_uninstall', { target });
}

/* ---- Servidor (T4.3) ---- */

export interface ServerCapabilitiesReport {
  live_handoff: boolean | null;
  detached_server_daemon: boolean | null;
}

export interface CliServerStatus {
  status: string | null;
  running: boolean | null;
  version: string | null;
  protocol: number | null;
  compatible: boolean | null;
  socket: string | null;
  session: string | null;
  restart_needed: boolean | null;
  capabilities: ServerCapabilitiesReport | null;
}

export interface CliClientStatus {
  version: string | null;
  channel: string | null;
  protocol: number | null;
  binary: string | null;
  session: string | null;
}

export interface CliStatusReport {
  client: CliClientStatus | null;
  server: CliServerStatus | null;
  update: unknown;
}

export interface LiveServerStatus {
  version: string;
  protocol: number;
  capabilities: ServerCapabilitiesReport | null;
}

export interface ServerStatusReport {
  cli: CliStatusReport | null;
  cli_error: string | null;
  live: LiveServerStatus | null;
  live_error: string | null;
}

export interface AgentManifestInfo {
  agent: string;
  source: string;
  source_kind: string;
  local_override_shadowing_remote: boolean;
  active_version: string | null;
  cached_remote_version: string | null;
  remote_last_checked_unix: number | null;
  remote_update_error: string | null;
  remote_update_result: string | null;
  warning: string | null;
}

export interface AgentManifestStatus {
  manifests: AgentManifestInfo[];
  last_check_unix: number | null;
  last_result: string | null;
}

export async function serverStatus(): Promise<CommandOutcome<ServerStatusReport>> {
  return optionalCommand<ServerStatusReport>('server_status');
}

export async function agentManifests(): Promise<CommandOutcome<AgentManifestStatus>> {
  return optionalCommand<AgentManifestStatus>('agent_manifests');
}

export async function agentManifestsReload(): Promise<CommandOutcome<AgentManifestStatus>> {
  return optionalCommand<AgentManifestStatus>('agent_manifests_reload');
}

/* ---- Consola API (T4.5) ---- */

export interface ApiParamSpec {
  name: string;
  kind: string;
  required: boolean;
  nullable: boolean;
  default: unknown;
  enum_values: string[] | null;
  item: ApiParamSpec | null;
  properties: ApiParamSpec[] | null;
  ref_name: string | null;
}

export interface ApiMethodSpec {
  method: string;
  group: string;
  description: string | null;
  params: ApiParamSpec[];
}

export interface ApiCatalog {
  protocol: number;
  schema_version: number;
  total: number;
  methods: ApiMethodSpec[];
}

export async function apiCatalog(refresh = false): Promise<CommandOutcome<ApiCatalog>> {
  return optionalCommand<ApiCatalog>('api_catalog', { refresh });
}

/* ---- Notificación nativa (T4.6) ---- */

export interface NotificationShowOutcome {
  delivered: boolean;
  reason: string | null;
}

/** Toast nativo de prueba (contenido fijo) para Avanzado. */
export async function notificationShow(): Promise<CommandOutcome<NotificationShowOutcome>> {
  return optionalCommand<NotificationShowOutcome>('notification_show', { test: true });
}

/* ---- CLI (lista blanca) ---- */

export interface CliRunOutput {
  exit_code: number;
  stdout: string;
  stderr: string;
}

export async function cliRun(argv: string[]): Promise<CommandOutcome<CliRunOutput>> {
  return optionalCommand<CliRunOutput>('cli_run', { argv });
}
