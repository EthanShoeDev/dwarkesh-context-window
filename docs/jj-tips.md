# Jujutsu (jj) Technical Workflow Guide

## Core Concepts

### Working Copy is a Commit
- Your working directory is automatically committed after every jj command
- No `git add` needed - changes are automatically tracked
- Use `.gitignore` to prevent files from being tracked

### Bookmarks (not Branches)
- **Local bookmark**: `main` - your local reference
- **Remote bookmark**: `main@origin` - the remote's state
- **Tracking**: Links local and remote bookmarks for automatic sync

### Change ID vs Commit ID
- **Change ID**: Stable identifier that persists across rewrites (e.g., `quqqyrqp`)
- **Commit ID**: Hash that changes when commit is modified (e.g., `1ce16b32`)

---

## Daily Workflow

### Basic Work Cycle

```bash
# Make changes (auto-committed to working copy @)
vim file.rs

# Add description when ready
jj describe -m "Add feature X"

# Create new working commit for next task
jj new

# Continue working...
```

**Alternative: Commit in one step**
```bash
# Describe and create new commit together
jj commit -m "Add feature X"
```

### Viewing Status and History

```bash
# See working copy status
jj status

# View commit log
jj log

# View log with file changes
jj log -p

# View specific commit
jj show <change-id>

# See what changed in working copy
jj diff

# See diff between commits
jj diff -r <from>..<to>
```

---

## Remote Operations

### Initial Setup with GitHub

```bash
# Add remote
jj git remote add origin git@github.com:user/repo.git

# Configure auto-tracking for all bookmarks
jj config set --repo remotes.origin.auto-track-bookmarks '"*"'

# Move main to latest commit
jj bookmark move main --to @

# Track the bookmark (required before first push)
jj bookmark track main@origin

# Push to remote
jj git push --bookmark main
```

### Regular Push/Pull Workflow

```bash
# Fetch updates from remote
jj git fetch

# Push your changes
jj git push --bookmark main

# Push all tracked bookmarks
jj git push --all

# Push a specific change (auto-creates bookmark)
jj git push --change <change-id>
```

### Working with Multiple Remotes

```bash
# Add upstream remote
jj git remote add upstream https://github.com/upstream/repo.git

# Track specific bookmarks from specific remotes
jj bookmark track main@origin
jj bookmark track main@upstream

# Fetch from specific remote
jj git fetch --remote upstream

# Reference remote bookmarks
jj log -r main@upstream
jj new main@upstream
```

---

## History Management

### Moving Bookmarks

```bash
# Move bookmark to specific commit
jj bookmark move main --to <change-id>

# Move bookmark to current working copy
jj bookmark move main --to @

# Move bookmark backward (requires --allow-backwards)
jj bookmark move main --to <older-commit> --allow-backwards
```

### Rebasing Changes

```bash
# Rebase current commit onto another
jj rebase --destination main

# Rebase a specific commit and its descendants
jj rebase --source <change-id> --destination main

# Insert commit between parent and children
jj rebase --revision <change-id> --insert-after main
jj rebase --revision <change-id> --insert-before other-commit
```

### Squashing and Splitting

```bash
# Squash working copy into parent
jj squash

# Squash specific files into parent
jj squash file1.rs file2.rs

# Squash into a specific commit
jj squash --into <change-id>

# Split a commit interactively
jj split -i

# Split by selecting specific files
jj split file1.rs file2.rs
```

### Editing History

```bash
# Edit/view a previous commit
jj edit <change-id>

# Return to latest working copy
jj edit @

# Abandon unwanted commits (hides them, rebases descendants)
jj abandon <change-id>

# Update description of any commit
jj describe -r <change-id> -m "New description"
```

---

## Conflict Resolution

```bash
# View conflicts in working copy
jj status

# Conflicts are recorded in commits - you can continue working
# To resolve:
jj new <conflicted-commit>
# ... edit files to resolve conflicts ...
jj squash  # Merge resolution into conflicted commit
```

---

## Undo Operations

```bash
# View operation log
jj op log

# Undo last operation
jj undo

# Restore to specific operation
jj op restore <operation-id>

# Abandon old operations (cleanup)
jj op abandon <operation-id>
```

---

## Security Best Practices

### Preventing Secrets in History

**CRITICAL**: jj auto-snapshots working copy on every command (including `jj status`)

```bash
# 1. Use .gitignore aggressively
echo ".env" >> .gitignore
echo "*.key" >> .gitignore
echo "secrets/" >> .gitignore

# 2. Disable automatic file tracking (optional but safer)
jj config set --user snapshot.auto-track 'none()'

# 3. Use private commits for local secrets
jj config set --user git.private-commits "description('private:*')"
# Then use commit messages like: "private: local dev config"

# 4. Never store real secrets in repo files - use environment variables
```

### If Secrets Are Committed

```bash
# 1. Find the commit with secrets
jj log -p | grep -i "password\|api_key\|secret"

# 2. Abandon the commit
jj abandon <commit-with-secrets>

# 3. Clean operation log (secrets persist here!)
jj op log
jj op abandon <operation-id>

# 4. Nuclear option: recreate repo without history
```

---

## VS Code Extension Behavior

The jjk VS Code extension:
- **Polls every 5 seconds** running `jj operation log` (triggers snapshots!)
- **Watches** `.jj/repo/op_store/operations/*` for changes
- **Triggers snapshots** whenever the panel refreshes

**Implication**: Opening VS Code snapshots your working copy constantly. Ensure `.gitignore` is configured before opening VS Code.

---

## Useful Configurations

```bash
# User-level config
jj config edit --user

# Repository-level config
jj config edit --repo
```

**Recommended settings:**
```toml
# ~/.jjconfig.toml or .jj/repo/config.toml

# Auto-track all bookmarks from origin
[remotes.origin]
auto-track-bookmarks = "*"

# Disable automatic file tracking (safer for secrets)
[snapshot]
auto-track = "none()"

# Mark commits as private (won't be pushed)
[git]
private-commits = "description('private:*')"
push = "origin"
fetch = ["origin"]
```

---

## Common Patterns

### Starting a New Feature

```bash
jj new main                    # Create new commit on top of main
jj describe -m "Start feature X"
# ... make changes ...
jj commit -m "Implement feature X"
```

### Amending Previous Commits

```bash
# Option 1: Squash current changes into parent
jj squash

# Option 2: Edit the commit directly
jj edit <commit-id>
# ... make changes ...
jj edit @  # Return to latest

# Option 3: Squash specific changes into any commit
jj squash --into <commit-id>
```

### Linearizing History

```bash
# If you have parallel commits, rebase them onto main line
jj rebase --source <parallel-commit> --destination <target>
```

### Creating a Pull Request

```bash
# Ensure work is on a bookmark
jj bookmark create my-feature --to @

# Track and push
jj bookmark track my-feature@origin
jj git push --bookmark my-feature

# Or use --change to auto-create bookmark
jj git push --change @
```

---

## Quick Reference

| Task | Command |
|------|---------|
| Add description | `jj describe -m "message"` |
| Create new commit | `jj new` |
| Describe + new | `jj commit -m "message"` |
| View status | `jj status` |
| View log | `jj log` |
| Push changes | `jj git push --bookmark main` |
| Fetch updates | `jj git fetch` |
| Rebase onto main | `jj rebase -d main` |
| Squash into parent | `jj squash` |
| Edit old commit | `jj edit <change-id>` |
| Abandon commit | `jj abandon <change-id>` |
| Undo last operation | `jj undo` |
| Track bookmark | `jj bookmark track name@origin` |
| Move bookmark | `jj bookmark move name --to <target>` |

---

## Key Differences from Git

| Git | Jujutsu |
|-----|---------|
| `git add` + `git commit` | Automatic (no staging) |
| `git branch` | `jj bookmark` |
| `git checkout` | `jj edit` or `jj new` |
| `git commit --amend` | `jj squash` or keep editing |
| `git rebase -i` | `jj rebase` with various flags |
| `git reflog` | `jj op log` |
| `git reset` | `jj undo` or `jj op restore` |
| Branches move automatically | Bookmarks stay put unless moved |
| Staging area | No staging - direct working copy |

---

## Further Reading

- Official docs: https://jj-vcs.dev/
- Tutorial: `docs/cloned-repos-as-docs/jj/docs/tutorial.md`
- Bookmarks: `docs/cloned-repos-as-docs/jj/docs/bookmarks.md`
- Config: `docs/cloned-repos-as-docs/jj/docs/config.md`
