use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default)]
pub struct SessionSnapshot {
    pub version: String,
    pub protocol: u32,
    pub focused_workspace_id: Option<String>,
    pub focused_tab_id: Option<String>,
    pub focused_pane_id: Option<String>,
    pub workspaces: Vec<WorkspaceInfo>,
    pub tabs: Vec<TabInfo>,
    pub panes: Vec<PaneInfo>,
    pub layouts: Vec<PaneLayoutSnapshot>,
    pub agents: Vec<AgentInfo>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default)]
pub struct WorkspaceInfo {
    pub workspace_id: String,
    pub number: u32,
    pub label: String,
    pub focused: bool,
    pub pane_count: u32,
    pub tab_count: u32,
    pub active_tab_id: Option<String>,
    pub agent_status: String,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default)]
pub struct TabInfo {
    pub tab_id: String,
    pub workspace_id: String,
    pub number: u32,
    pub label: String,
    pub focused: bool,
    pub pane_count: u32,
    pub agent_status: String,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default)]
pub struct PaneInfo {
    pub pane_id: String,
    pub terminal_id: Option<String>,
    pub workspace_id: String,
    pub tab_id: String,
    pub focused: bool,
    pub cwd: Option<String>,
    pub terminal_title: Option<String>,
    pub terminal_title_stripped: Option<String>,
    pub agent_status: String,
    pub scroll: Option<PaneScrollInfo>,
    pub revision: u64,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default)]
pub struct PaneScrollInfo {
    pub offset_from_bottom: u64,
    pub max_offset_from_bottom: u64,
    pub viewport_rows: u64,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default)]
pub struct PaneLayoutSnapshot {
    pub workspace_id: String,
    pub tab_id: String,
    pub zoomed: bool,
    pub area: Option<Rect>,
    pub focused_pane_id: Option<String>,
    pub panes: Vec<LayoutPaneRect>,
    pub splits: Vec<Value>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default)]
pub struct LayoutPaneRect {
    pub pane_id: String,
    pub focused: bool,
    pub rect: Option<Rect>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default)]
pub struct AgentInfo {
    pub pane_id: Option<String>,
    pub agent: Option<String>,
    pub display_agent: Option<String>,
    pub agent_status: Option<String>,
    pub title: Option<String>,
    pub workspace_id: Option<String>,
    pub tab_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default)]
pub struct EventEnvelope {
    pub event: String,
    pub data: Value,
}
