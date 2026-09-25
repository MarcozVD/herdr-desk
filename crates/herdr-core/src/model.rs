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

impl EventEnvelope {
    /// Typed view of the payload; None if the wire type is unknown to this build
    /// (schema drift must not break the core).
    pub fn typed(&self) -> Option<EventData> {
        serde_json::from_value(self.data.clone()).ok()
    }
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default)]
pub struct WorktreeInfo {
    pub path: String,
    pub label: String,
    pub branch: Option<String>,
    pub is_bare: bool,
    pub is_detached: bool,
    pub is_prunable: bool,
    pub is_linked_worktree: bool,
    pub open_workspace_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentStatus {
    Idle,
    Working,
    Blocked,
    Done,
    Unknown,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default)]
pub struct EventLayoutSplit {
    pub id: String,
    pub direction: String,
    pub ratio: f64,
    pub rect: Option<Rect>,
}

/// The 26 event payloads emitted by herdr (schema `event.EventData`).
/// Unknown wire types fail `typed()` instead of the whole pipeline.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum EventData {
    WorkspaceCreated {
        workspace: WorkspaceInfo,
    },
    WorkspaceUpdated {
        workspace: WorkspaceInfo,
    },
    WorkspaceMetadataUpdated {
        workspace: WorkspaceInfo,
    },
    WorkspaceClosed {
        workspace_id: String,
        workspace: Option<WorkspaceInfo>,
    },
    WorkspaceRenamed {
        workspace_id: String,
        label: String,
    },
    WorkspaceMoved {
        workspace_id: String,
        insert_index: u32,
        workspaces: Vec<WorkspaceInfo>,
    },
    WorkspaceReordered {
        workspace_ids: Vec<String>,
        workspaces: Vec<WorkspaceInfo>,
        before_workspace_id: Option<String>,
    },
    WorkspaceFocused {
        workspace_id: String,
    },
    WorktreeCreated {
        workspace: WorkspaceInfo,
        worktree: WorktreeInfo,
    },
    WorktreeOpened {
        workspace: WorkspaceInfo,
        worktree: WorktreeInfo,
        already_open: bool,
    },
    WorktreeRemoved {
        workspace_id: String,
        worktree: WorktreeInfo,
        forced: bool,
        workspace: Option<WorkspaceInfo>,
    },
    TabCreated {
        tab: TabInfo,
    },
    TabClosed {
        tab_id: String,
        workspace_id: String,
    },
    TabRenamed {
        tab_id: String,
        workspace_id: String,
        label: String,
    },
    TabMoved {
        tab_id: String,
        workspace_id: String,
        insert_index: u32,
        tabs: Vec<TabInfo>,
    },
    TabFocused {
        tab_id: String,
        workspace_id: String,
    },
    PaneCreated {
        pane: PaneInfo,
    },
    PaneClosed {
        pane_id: String,
        workspace_id: String,
    },
    PaneUpdated {
        pane: PaneInfo,
    },
    PaneFocused {
        pane_id: String,
        workspace_id: String,
    },
    PaneMoved {
        previous_pane_id: String,
        previous_workspace_id: String,
        previous_tab_id: String,
        pane: Box<PaneInfo>,
        closed_workspace_id: Option<String>,
        closed_tab_id: Option<String>,
        created_workspace: Option<WorkspaceInfo>,
        created_tab: Option<TabInfo>,
    },
    PaneOutputChanged {
        pane_id: String,
        workspace_id: String,
        revision: u64,
    },
    PaneExited {
        pane_id: String,
        workspace_id: String,
    },
    PaneAgentDetected {
        pane_id: String,
        workspace_id: String,
        agent: Option<String>,
        final_status: Option<AgentStatus>,
        released: Option<bool>,
    },
    PaneAgentStatusChanged {
        pane_id: String,
        workspace_id: String,
        agent_status: AgentStatus,
        agent: Option<String>,
        display_agent: Option<String>,
        title: Option<String>,
        state_labels: std::collections::HashMap<String, String>,
    },
    LayoutUpdated {
        layout: Box<PaneLayoutSnapshot>,
    },
}
