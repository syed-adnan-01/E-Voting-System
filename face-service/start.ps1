# ==============================================================================
# PQ-ZKVote Face Recognition Service — Windows Startup Script
# ==============================================================================

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

# Check if virtual environment exists; if not, create using Python 3.10 if available
if (-not (Test-Path "venv\Scripts\python.exe")) {
    $PythonCmd = "python"
    if (Get-Command py -ErrorAction SilentlyContinue) {
        $py310 = py -0 2>$null | Select-String "3.10"
        if ($py310) {
            $PythonCmd = "py -3.10"
        }
    }
    Write-Host "🔧 Creating Python virtual environment using $PythonCmd..." -ForegroundColor Cyan
    Invoke-Expression "$PythonCmd -m venv venv"
}

$VenvPip = ".\venv\Scripts\pip.exe"
$VenvUvicorn = ".\venv\Scripts\uvicorn.exe"

Write-Host "📦 Step 1/2 — Installing core dependencies..." -ForegroundColor Cyan
& $VenvPip install -r requirements.txt --quiet

Write-Host "📦 Step 2/2 — Installing facenet-pytorch (no-deps)..." -ForegroundColor Cyan
& $VenvPip install facenet-pytorch==2.6.0 --no-deps --quiet

Write-Host "`n🚀 Starting PQ-ZKVote Face Service on http://localhost:8000" -ForegroundColor Green
Write-Host "Press Ctrl + C to stop the service.`n" -ForegroundColor DarkGray
& $VenvUvicorn main:app --host 0.0.0.0 --port 8000 --reload
