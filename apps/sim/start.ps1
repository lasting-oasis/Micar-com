if (-not (Test-Path "node\node.exe")) {
    Write-Host "Downloading Node.js (this will take a moment)..."
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri "https://nodejs.org/dist/v20.11.1/node-v20.11.1-win-x64.zip" -OutFile "node.zip"
    Write-Host "Extracting Node.js..."
    Expand-Archive -Path "node.zip" -DestinationPath "." -Force
    Rename-Item -Path "node-v20.11.1-win-x64" -NewName "node"
    Remove-Item "node.zip" -Force
}

Write-Host "Setting local path..."
$env:Path = "$PWD\node;" + $env:Path

Write-Host "Checking node version:"
node -v

Write-Host "Installing NPM Packages..."
npm install

Write-Host "Starting App Server on http://localhost:3000"
npm run server
