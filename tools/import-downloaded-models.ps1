$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$archive = Join-Path $repoRoot '3d models\xbox360\xbox-360-black-3d-model-by-rob-bryant-jr.zip'
$workRoot = Join-Path $repoRoot '.tmp-model-import\xbox360-black'
$outerRoot = Join-Path $workRoot 'outer'
$innerRoot = Join-Path $workRoot 'inner'

if (-not (Test-Path -LiteralPath $archive)) { throw "Missing archive: $archive" }
New-Item -ItemType Directory -Path $outerRoot -Force | Out-Null
New-Item -ItemType Directory -Path $innerRoot -Force | Out-Null
Expand-Archive -LiteralPath $archive -DestinationPath $outerRoot -Force
$nested = Join-Path $outerRoot 'source\XBox360_FBX_export.zip.zip'
if (-not (Test-Path -LiteralPath $nested)) { throw "Missing nested source archive: $nested" }
Expand-Archive -LiteralPath $nested -DestinationPath $innerRoot -Force
$obj = Join-Path $innerRoot 'XBox360_FBX_export.obj'
$output = Join-Path $repoRoot '3d models\xbox360\xbox_360_black.glb'
& node (Join-Path $PSScriptRoot 'convert-obj-to-glb.cjs') $obj $output
if ($LASTEXITCODE -ne 0) { throw 'OBJ conversion failed' }
