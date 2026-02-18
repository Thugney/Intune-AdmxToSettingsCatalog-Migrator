[![GitHub](https://img.shields.io/badge/GitHub-Thugney-181717?style=for-the-badge&logo=github)](https://github.com/Thugney/)
[![X](https://img.shields.io/badge/X-@eriteach-000000?style=for-the-badge&logo=x)](https://x.com/eriteach)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-eriteach-0A66C2?style=for-the-badge&logo=linkedin)](https://www.linkedin.com/in/eriteach/)

# Intune ADMX to Settings Catalog Migrator

Automates migration of **Administrative Templates** (ADMX) to **Settings Catalog** policies in Microsoft Intune.

Microsoft has deprecated Administrative Templates. This tool handles the full migration workflow: export, duplicate detection, mapping, migration, backup, and rollback.

## Two Ways to Use

### Web UI (Browser-Based)

A fully client-side web app that runs in your browser. No PowerShell required — just a local web server.

You need a local HTTP server to serve the files (opening `index.html` directly won't work due to browser security restrictions). Pick any option below:

**Python** (install from [python.org](https://www.python.org/downloads/) or `winget install Python.Python.3`):
```bash
cd Intune-AdmxToSettingsCatalog-Migrator/web
python -m http.server 8080
# Open http://localhost:8080
```

> **Windows note:** Use `python` not `python3`. If you get a Microsoft Store redirect, disable the Python app execution aliases in **Settings > Apps > Advanced app settings > App execution aliases**.

**npx** (if you have Node.js installed):
```bash
npx http-server Intune-AdmxToSettingsCatalog-Migrator/web -p 8080
```

**PowerShell** (no extra install needed):
```powershell
cd Intune-AdmxToSettingsCatalog-Migrator/web
Start-Process "http://localhost:8080"
$listener = [System.Net.HttpListener]::new(); $listener.Prefixes.Add("http://localhost:8080/"); $listener.Start()
while ($listener.IsListening) { $ctx = $listener.GetContext(); $file = Join-Path $PWD ($ctx.Request.Url.LocalPath.TrimStart('/')); if ($file -eq $PWD) { $file = Join-Path $PWD 'index.html' }; if (Test-Path $file) { $bytes = [IO.File]::ReadAllBytes($file); $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length) } else { $ctx.Response.StatusCode = 404 }; $ctx.Response.Close() }
```

### PowerShell CLI

Full migration workflow from the command line with certificate, client secret, or interactive auth.

```powershell
cd Intune-AdmxToSettingsCatalog-Migrator
pwsh ./Invoke-Migration.ps1 -ConfigPath ./config/config.json -Mode Export
```

## Documentation

See the full [README](Intune-AdmxToSettingsCatalog-Migrator/README.md) inside the project folder for:
- Setup and configuration
- Authentication methods (client secret, certificate, interactive)
- Step-by-step workflow guide
- Duplicate detection and resolution
- Backup and restore
- Troubleshooting

## Requirements

- **Web UI**: Any modern browser + a local HTTP server (Python, Node.js, or PowerShell) + Azure AD app registration with SPA redirect URI
- **PowerShell CLI**: PowerShell 7+ and Azure AD app registration with Graph API permissions

