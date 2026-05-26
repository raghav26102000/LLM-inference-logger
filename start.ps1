$root = $PSScriptRoot
$env:PATH += ";C:\Program Files\PostgreSQL\18\bin"

Get-Content "$root\.env" | ForEach-Object {
    if ($_ -match '^\s*([^#][^=]+)=(.+)$') {
        [System.Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), "Process")
    }
}

$backendCmd = "Set-Location '$root\backend\ingestion'; Get-Content '$root\.env' | ForEach-Object { if (`$_ -match '^\s*([^#][^=]+)=(.+)`$') { [System.Environment]::SetEnvironmentVariable(`$matches[1].Trim(), `$matches[2].Trim(), 'Process') } }; node src/index.js"

$frontendCmd = "Set-Location '$root\frontend'; Get-Content '$root\.env' | ForEach-Object { if (`$_ -match '^\s*([^#][^=]+)=(.+)`$') { [System.Environment]::SetEnvironmentVariable(`$matches[1].Trim(), `$matches[2].Trim(), 'Process') } }; npm run dev"

Write-Host "Starting backend..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList @("-NoExit", "-Command", $backendCmd)

Start-Sleep -Seconds 3

Write-Host "Starting frontend..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList @("-NoExit", "-Command", $frontendCmd)

Write-Host "Done - open http://localhost:3000" -ForegroundColor Green