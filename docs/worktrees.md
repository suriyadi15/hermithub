# Parallel tasks with worktrees

Several sessions in one project folder all edit the same files on the same branch. To work on several
tasks, issues or features at once, give each one a **git worktree**: its own folder and branch that share
the project's git history. A session in one worktree never touches the files of another.

Worktrees need a git repository with at least one commit.

## Workflow

1. **Start a task.** On the project page, click **+ Session**. Under **Run in**, pick **+ New worktree**,
   enter a branch name (e.g. `feat/login`) and optionally the branch to start from (default: the current
   branch). Click **Start**. The hub creates the folder and branch and starts the agent in it. If you enter
   a branch that already exists, it is checked out as is.
2. **Repeat** for the other tasks. Every session tab shows the worktree it runs in.
3. **Switch between tasks.** Clicking a session tab points the file tree, search, editor and Git panel at
   that session's worktree. The branch line under the project name in the header is a switcher, so you can
   also pick **Project folder** or any worktree there by hand. Files you opened in another worktree keep
   their tabs and always save to the folder they came from.
4. **Review and integrate.** Check the agent's work in the Git panel, commit, then either:
   - **Push** and open a pull request on GitHub, or
   - open **New / manage worktrees…** from the switcher and click **Merge into main** (runs
     `git merge <branch>` in the project folder). Resolve any conflicts in the project folder's Git panel.
5. **Clean up.** Stop the worktree's sessions, then click **Remove** in the worktrees panel. Tick
   **Also delete branch** once it is merged. Git refuses to remove a worktree with uncommitted changes
   unless you tick **Force**.

**Resume** works per worktree: agents continue the last conversation of the folder they run in.

## Where they live

Worktrees are kept in `data/projects/.hub-worktrees/<project>/<name>`. That folder is hidden from the
project list and never put inside the project, so nothing needs adding to `.gitignore`. In the API, every
route that takes a project also accepts `<project>@<worktree>`, e.g. `/api/projects/app@feat-login/git`.

- **Renaming a project** moves its worktrees too and runs `git worktree repair`.
- **Moving a project to the trash** is refused while it has worktrees. Remove them first.
- Git stores absolute paths in worktrees. If you open `data/projects` from the host at a different path,
  run `git worktree repair` there before using host-side git in a worktree.
- Untracked files such as `.env` are not copied into new worktrees. Copy them in yourself if a task needs them.
