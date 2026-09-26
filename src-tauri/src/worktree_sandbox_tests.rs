#![cfg(all(test, feature = "sandbox"))]

//! worktree.* contra el server real en sesion sandbox hd-test-*, siempre
//! contra un repo git TEMPORAL (nunca el repo del usuario).

use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::Duration;

use std::os::windows::process::CommandExt;

use crate::commands::worktrees::{
    WorktreeCreateRequest, WorktreeOpenRequest, WorktreeRemoveRequest, worktree_create_rpc,
    worktree_list_rpc, worktree_open_rpc, worktree_remove_rpc,
};
use crate::sandbox_guard::Sandbox;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn git(args: &[&str], cwd: Option<&std::path::Path>) {
    let mut cmd = Command::new("git");
    cmd.args(args)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW);
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    let out = cmd.output().expect("spawn git");
    assert!(
        out.status.success(),
        "git {} fallo: {}",
        args.join(" "),
        String::from_utf8_lossy(&out.stderr)
    );
}

/// Repo git desechable con un commit vacio (identidad via -c, sin tocar la
/// configuracion global del usuario).
fn init_temp_repo(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("herdr-desk-wt-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("tmp repo dir");
    git(&["init", dir.to_string_lossy().as_ref()], None);
    git(
        [
            "-c",
            "user.name=hd-test",
            "-c",
            "user.email=hd-test@example.com",
            "commit",
            "--allow-empty",
            "-m",
            "init",
        ]
        .as_slice(),
        Some(&dir),
    );
    dir
}

/// worktree.create + list + open + remove (con doble confirmacion) de verdad.
#[tokio::test]
async fn worktree_lifecycle_real() {
    let repo = init_temp_repo("lifecycle");
    let sandbox = Sandbox::start();
    let client = sandbox.client();

    // workspace anclado al repo temporal (evita tocar el repo del usuario)
    let created = client
        .call(
            "workspace.create",
            &serde_json::json!({
                "cwd": repo.to_string_lossy(),
                "label": "hd-test-wt",
                "focus": false
            }),
        )
        .await
        .expect("workspace.create en repo temporal");
    let workspace_id = created["workspace"]["workspace_id"]
        .as_str()
        .expect("workspace_id")
        .to_string();

    // 1) lista inicial: el repo temporal con su checkout principal
    let list = worktree_list_rpc(&client, None, Some(repo.to_string_lossy().as_ref()))
        .await
        .expect("worktree.list");
    assert_eq!(
        list.source.repo_name,
        repo.file_name().unwrap().to_string_lossy()
    );
    assert_eq!(list.worktrees.len(), 1);
    assert!(list.worktrees[0].open_workspace_id.is_some());

    // 2) create con rama nueva; base por defecto (HEAD del repo)
    let branch = format!("hd-test-wt-{}", std::process::id());
    let created = worktree_create_rpc(
        &client,
        &WorktreeCreateRequest {
            workspace_id: None,
            cwd: Some(repo.to_string_lossy().to_string()),
            branch: Some(branch.clone()),
            base: None,
            path: None,
            label: Some("hd-test wt".to_string()),
            focus: Some(false),
        },
    )
    .await
    .expect("worktree.create");
    assert_eq!(created.worktree.branch.as_deref(), Some(branch.as_str()));
    // el server deriva worktree.label del checkout (el --label va al workspace)
    assert!(!created.worktree.label.is_empty());
    assert!(created.worktree.open_workspace_id.is_some());
    let wt_workspace_id = created
        .worktree
        .open_workspace_id
        .clone()
        .expect("workspace del worktree creado");
    assert!(std::path::Path::new(&created.worktree.path).is_dir());

    // 3) list muestra el worktree enlazado
    let list2 = worktree_list_rpc(&client, None, Some(repo.to_string_lossy().as_ref()))
        .await
        .expect("worktree.list tras create");
    assert_eq!(list2.worktrees.len(), 2, "{:?}", list2.worktrees);
    let linked = list2
        .worktrees
        .iter()
        .find(|w| w.branch.as_deref() == Some(branch.as_str()))
        .expect("worktree enlazado en la lista");
    assert!(linked.is_linked_worktree);
    assert!(!linked.is_bare && !linked.is_detached && !linked.is_prunable);

    // 4) open de un worktree ya abierto: already_open=true
    let opened = worktree_open_rpc(
        &client,
        &WorktreeOpenRequest {
            workspace_id: None,
            cwd: Some(repo.to_string_lossy().to_string()),
            branch: Some(branch.clone()),
            path: None,
            label: None,
            focus: Some(false),
        },
    )
    .await
    .expect("worktree.open");
    assert!(opened.already_open, "deberia estar ya abierto");

    // 5) remove sin confirm=true: rechazado por el guard del contrato
    let err = worktree_remove_rpc(
        &client,
        &WorktreeRemoveRequest {
            workspace_id: wt_workspace_id.clone(),
            force: true,
            confirm: None,
        },
    )
    .await
    .expect_err("sin confirm no elimina");
    assert_eq!(err.code, "invalid_params");

    // 6) remove con doble confirmacion y force
    let removed = worktree_remove_rpc(
        &client,
        &WorktreeRemoveRequest {
            workspace_id: wt_workspace_id.clone(),
            force: true,
            confirm: Some(true),
        },
    )
    .await
    .expect("worktree.remove");
    assert!(removed.forced);
    assert_eq!(removed.workspace_id, wt_workspace_id);
    assert!(!std::path::Path::new(&removed.path).exists());

    // 7) la lista vuelve a tener solo el principal
    let list3 = worktree_list_rpc(&client, None, Some(repo.to_string_lossy().as_ref()))
        .await
        .expect("worktree.list tras remove");
    assert_eq!(list3.worktrees.len(), 1);

    // limpieza del workspace abierto y del repo temporal
    let _ = client
        .call(
            "workspace.close",
            &serde_json::json!({ "workspace_id": workspace_id }),
        )
        .await;
    drop(sandbox);
    std::thread::sleep(Duration::from_millis(200));
    let _ = std::fs::remove_dir_all(&repo);
    // el checkout principal vive en el repo temporal; al borrarlo no queda rastro
}
