param(
    [int]$Minutes = 180,
    [int]$Seed = 17,
    [ValidateSet("greeting", "play", "grooming", "warning", "conflict")]
    [string]$Interaction = "greeting"
)
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
$env:PYTHONPATH = "$Root/src;$env:PYTHONPATH"
python -m unittest discover -s tests -v
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
python -m living_atlas.cli --minutes $Minutes --seed $Seed --interaction $Interaction
exit $LASTEXITCODE
