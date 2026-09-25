# PreToolUse hook (Write|Edit) — warns when proposed content looks like a secret or a hardcoded
# absolute project path. Returns permissionDecision "ask" so the user confirms; never denies.
# Always exits 0.
$ErrorActionPreference = 'SilentlyContinue'

try {
  $raw = [Console]::In.ReadToEnd()
  $j = $raw | ConvertFrom-Json
} catch { exit 0 }

$file = [string]$j.tool_input.file_path
$content = @($j.tool_input.content, $j.tool_input.new_string) -join "`n"
if (-not $content.Trim()) { exit 0 }

$isDoc = $file -match '\.(md|txt)$'

$patterns = @(
  @{ name = 'NVIDIA API key';        re = 'nvapi-[A-Za-z0-9_\-]{20,}';            docsToo = $true  },
  @{ name = 'OpenAI-style key';      re = '\bsk-[A-Za-z0-9_\-]{20,}';             docsToo = $true  },
  @{ name = 'AWS access key';        re = '\bAKIA[0-9A-Z]{16}\b';                  docsToo = $true  },
  @{ name = 'private key block';     re = '-----BEGIN [A-Z ]*PRIVATE KEY-----';    docsToo = $true  },
  @{ name = 'hardcoded project path';re = '[A-Za-z]:\\Downloads\\DockIQ';          docsToo = $false }
)

$hits = @()
foreach ($p in $patterns) {
  if ($isDoc -and -not $p.docsToo) { continue }
  if ($content -match $p.re) { $hits += $p.name }
}

if ($hits.Count -gt 0) {
  $reason = "check-secrets: possible $($hits -join ', ') in $file. Confirm this is intentional (secrets belong in the environment; paths should derive from __file__ or CLAUDE_PROJECT_DIR)."
  $out = @{ hookSpecificOutput = @{ hookEventName = 'PreToolUse'; permissionDecision = 'ask'; permissionDecisionReason = $reason } }
  Write-Output ($out | ConvertTo-Json -Depth 4 -Compress)
}
exit 0
