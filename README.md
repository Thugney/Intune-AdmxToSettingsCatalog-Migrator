[![Repo](https://img.shields.io/badge/Repo-Intune--ADMX--Migrator-2088FF?style=for-the-badge&logo=github)](https://github.com/Thugney/Intune-AdmxToSettingsCatalog-Migrator)

# Intune ADMX to Settings Catalog Migrator

[![GitHub](https://img.shields.io/badge/GitHub-Thugney-181717?style=for-the-badge&logo=github)](https://github.com/Thugney/)
[![X](https://img.shields.io/badge/X-@eriteach-000000?style=for-the-badge&logo=x)](https://x.com/eriteach)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-eriteach-0A66C2?style=for-the-badge&logo=linkedin)](https://www.linkedin.com/in/eriteach/)

Automates migration of **Administrative Templates** (ADMX) to **Settings Catalog** policies in Microsoft Intune.

Microsoft has deprecated Administrative Templates. This tool handles the full migration workflow: export, duplicate detection, mapping, migration, backup, and rollback.

## Screenshots

![Landing Page](docs/screenshots/landing.png)

![Login](docs/screenshots/login.png)

![Dashboard](docs/screenshots/dashboard.png)

## Two Ways to Use

### Web UI (Browser-Based)

A fully client-side web app that runs in your browser. No PowerShell required — just a local web server.

You need a local HTTP server to serve the files (opening `index.html` directly won't work due to browser security restrictions). **You must serve from the `web` folder** — not the repo root, or you'll see a directory listing instead of the app.

After cloning, the folder structure looks like this:
```
Intune-AdmxToSettingsCatalog-Migrator/          ← repo root
└── Intune-AdmxToSettingsCatalog-Migrator/      ← project folder
    └── web/                                     ← serve from HERE
        ├── index.html
        ├── css/
        └── js/
```

Pick any option below to start the server:

**Python** (install from [python.org](https://www.python.org/downloads/) or `winget install Python.Python.3`):
```bash
# From the repo root:
cd Intune-AdmxToSettingsCatalog-Migrator/web
python -m http.server 8080
# Open http://localhost:8080
```

> **Windows note:** Use `python` not `python3`. If you get a Microsoft Store redirect, disable the Python app execution aliases in **Settings > Apps > Advanced app settings > App execution aliases**.

**npx** (if you have Node.js installed):
```bash
# From the repo root:
npx http-server Intune-AdmxToSettingsCatalog-Migrator/web -p 8080
```

**PowerShell** (no extra install needed):
```powershell
# From the repo root:
cd Intune-AdmxToSettingsCatalog-Migrator/web
Start-Process "http://localhost:8080"
$listener = [System.Net.HttpListener]::new(); $listener.Prefixes.Add("http://localhost:8080/"); $listener.Start()
while ($listener.IsListening) { $ctx = $listener.GetContext(); $file = Join-Path $PWD ($ctx.Request.Url.LocalPath.TrimStart('/')); if ($file -eq $PWD) { $file = Join-Path $PWD 'index.html' }; if (Test-Path $file) { $bytes = [IO.File]::ReadAllBytes($file); $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length) } else { $ctx.Response.StatusCode = 404 }; $ctx.Response.Close() }
```

### PowerShell CLI

Full migration workflow from the command line with certificate, client secret, or interactive auth.

```powershell
# From the repo root:
cd Intune-AdmxToSettingsCatalog-Migrator
pwsh ./Invoke-Migration.ps1 -ConfigPath ./config/config.json -Mode Export
```

## Prerequisites

Both the Web UI and PowerShell CLI require an **Entra ID (Azure AD) app registration**. This is what gives you the Tenant ID and Client ID you'll be asked for.

**See the full [app registration setup guide](Intune-AdmxToSettingsCatalog-Migrator/README.md#entra-id-app-registration-setup) in the project README.**

Quick summary:
1. Create an app registration in the [Entra admin center](https://entra.microsoft.com)
2. Add `DeviceManagementConfiguration.ReadWrite.All` Graph API permission and grant admin consent
3. For the Web UI: add a **SPA redirect URI** (`http://localhost:8080`) under Authentication
4. For the PowerShell CLI: add a client secret, certificate, or enable public client flows for interactive login

## Requirements

- **Web UI**: Any modern browser + a local HTTP server (Python, Node.js, or PowerShell)
- **PowerShell CLI**: PowerShell 7+
- **Both**: Entra ID app registration with Graph API permissions ([setup guide](Intune-AdmxToSettingsCatalog-Migrator/README.md#entra-id-app-registration-setup))

## Documentation

See the full [README](Intune-AdmxToSettingsCatalog-Migrator/README.md) inside the project folder for:
- Entra ID app registration setup (step-by-step)
- Authentication methods (client secret, certificate, interactive)
- Step-by-step workflow guide
- Duplicate detection and resolution
- Backup and restore
- Troubleshooting

