# PostToolUse hook (Edit|Write) — formats the touched file and reports lint findings.
# Advisory only: never blocks, always exits 0, silently skips when a tool is not installed.
#   .py            -> ruff format + ruff check   (backend venv first, then PATH; config in backend/pyproject.toml)
#   .js .jsx .css  -> prettier --write           (frontend/node_modules only; never npx-downloads)
$ErrorActionPreference = 'SilentlyContinue'

try {
  $raw = [Console]::In.ReadToEnd()
  $j = $raw | ConvertFrom-Json
} catch { exit 0 }

$f = $j.tool_input.file_path
if (-not $f) { $f = $j.tool_response.filePath }
if (-not $f -or -not (Test-Path $f)) { exit 0 }

# Repo root from this script's location; independent of CLAUDE_PROJECT_DIR's path format.
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

$ext = [IO.Path]::GetExtension($f).ToLower()
$notes = @()

if ($ext -eq '.py') {
  $ruff = Join-Path $root 'backend\.venv\Scripts\ruff.exe'
  if (-not (Test-Path $ruff)) { $ruff = (Get-Command ruff -ErrorAction SilentlyContinue).Source }
  if ($ruff) {
    & $ruff format $f 2>$null | Out-Null
    $lint = @(& $ruff check --output-format concise $f 2>$null) -join "`n"
    if ($LASTEXITCODE -ne 0 -and $lint) { $notes += "ruff check findings in $f`:`n$lint" }
  }
}
elseif ($ext -in '.js', '.jsx', '.css') {
  $prettier = Join-Path $root 'frontend\node_modules\.bin\prettier.cmd'
  if (Test-Path $prettier) { & $prettier --log-level silent --write $f 2>$null | Out-Null }
}

if ($notes.Count -gt 0) {
  $out = @{ hookSpecificOutput = @{ hookEventName = 'PostToolUse'; additionalContext = ($notes -join "`n") } }
  Write-Output ($out | ConvertTo-Json -Depth 4 -Compress)
}
exit 0
