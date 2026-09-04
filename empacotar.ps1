# Gera um .zip do projeto pronto pra rodar em outra máquina.
# Inclui os .env (config), exclui node_modules/.venv/.git/dist (pesados e
# específicos da máquina — a outra máquina recria com npm install / venv).
#
# Uso:  powershell -ExecutionPolicy Bypass -File empacotar.ps1

$src = $PSScriptRoot
$nome = "extrato-dominio"
$stage = Join-Path $env:TEMP $nome
$zip = Join-Path ([Environment]::GetFolderPath('Desktop')) "$nome.zip"

if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
if (Test-Path $zip)   { Remove-Item $zip -Force }

Write-Host "Copiando (sem node_modules/.venv/.git/dist)..."
robocopy $src $stage /E /NFL /NDL /NJH /NJS `
  /XD node_modules .venv .git dist build .pytest_cache __pycache__ .vscode .idea `
  /XF *.tsbuildinfo *.log | Out-Null

Write-Host "Compactando..."
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -Force
Remove-Item $stage -Recurse -Force

$mb = [math]::Round((Get-Item $zip).Length / 1MB, 1)
Write-Host "`nPronto: $zip  ($mb MB)"
Write-Host "Na outra máquina: descompacta, e roda 'configurar.bat' (ou veja o README)."
