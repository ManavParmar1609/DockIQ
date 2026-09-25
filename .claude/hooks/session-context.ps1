# SessionStart hook — injects branch, working-tree summary and DB presence as context.
# Advisory only. Always exits 0.
$ErrorActionPreference = 'SilentlyContinue'

# Derive the repo root from this script's location (.claude/hooks -> .claude -> root) so the
# result is a native Windows path regardless of how CLAUDE_PROJECT_DIR is formatted.
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

$branch = (git -C $root rev-parse --abbrev-ref HEAD 2>$null)
if (-not $branch) { $branch = '(not a git repo)' }

$statusLines = @(git -C $root status --short 2>$null)
$shown = ($statusLines | Select-Object -First 15) -join "`n"
if ($statusLines.Count -gt 15) { $shown += "`n... and $($statusLines.Count - 15) more" }
if (-not $shown) { $shown = '(clean)' }

$dbPresent = Test-Path (Join-Path $root 'backend\dockiq.db')

$ctx = @(
  "DockIQ session context",
  "Branch: $branch",
  "backend/dockiq.db present: $dbPresent  (schema/seed changes do NOT apply to an existing DB - delete it or run reset_db.py)",
  "Working tree:",
  $shown,
  "Rules: .claude/rules/  Docs: docs/README.md  Roadmap: docs/roadmap.md"
) -join "`n"

$out = @{ hookSpecificOutput = @{ hookEventName = 'SessionStart'; additionalContext = $ctx } }
Write-Output ($out | ConvertTo-Json -Depth 4 -Compress)
exit 0
