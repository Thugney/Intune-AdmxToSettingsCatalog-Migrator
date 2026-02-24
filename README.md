# Intune ADMX to Settings Catalog Migrator

[![GitHub](https://img.shields.io/badge/GitHub-Thugney-181717?style=flat&logo=github)](https://github.com/Thugney)
[![Blog](https://img.shields.io/badge/Blog-eriteach.com-0d9488?style=flat&logo=hugo)](https://blog.eriteach.com)
[![YouTube](https://img.shields.io/badge/YouTube-Eriteach-FF0000?style=flat&logo=youtube)](https://www.youtube.com/@eriteach)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-Eriteach-0A66C2?style=flat&logo=linkedin)](https://www.linkedin.com/in/eriteach/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)


Microsoft is deprecating Administrative Templates (ADMX) in Intune. This tool automates the migration to Settings Catalog policies — handling export, duplicate detection, mapping, migration, backup, and rollback.

---

## How It Works

The migration follows a structured pipeline. Each step builds on the previous one.

```
Export ─> Duplicates ─> Mapping ─> Migrate ─> Validate
                                       │
                                       └── Rollback (if needed)
```

| Step | What happens |
|------|-------------|
| **Export** | Reads all ADMX policies from your tenant via Microsoft Graph, including settings, assignments, and definition metadata |
| **Duplicates** | Analyzes exported policies for overlapping or conflicting settings across policies. Flags conflicts and suggests merge candidates |
| **Mapping** | Searches the Settings Catalog for each ADMX setting and suggests the closest match. Supports localized tenants (Norwegian, German, etc.) via product-aware search |
| **Migrate** | Creates new Settings Catalog policies from your reviewed mapping. Copies assignments. Supports dry-run preview before committing |
| **Rollback** | Deletes only the policies this tool created (tracked via embedded markers). Does not touch your original ADMX policies |
| **Backup / Restore** | Automatic snapshots before every migration and rollback. Manual backup and restore also available |

---

## Two Ways to Use

### Web UI (Browser-Based)

A fully client-side SPA that runs in your browser. Authenticates via MSAL.js popup — no secrets stored, no backend server. All data stays in your browser.

You need a local HTTP server to serve the files. **Serve from the `web/` folder**, not the repo root.

```
Intune-AdmxToSettingsCatalog-Migrator/          <-- repo root
└── Intune-AdmxToSettingsCatalog-Migrator/
    └── web/                                     <-- serve from HERE
        ├── index.html
        ├── css/
        └── js/
```

**Python:**
```bash
cd Intune-AdmxToSettingsCatalog-Migrator/web
python -m http.server 8080
# Open http://localhost:8080
```

**Node.js:**
```bash
npx http-server Intune-AdmxToSettingsCatalog-Migrator/web -p 8080
```

**PowerShell:**
```powershell
cd Intune-AdmxToSettingsCatalog-Migrator/web
Start-Process "http://localhost:8080"
$listener = [System.Net.HttpListener]::new(); $listener.Prefixes.Add("http://localhost:8080/"); $listener.Start()
while ($listener.IsListening) { $ctx = $listener.GetContext(); $file = Join-Path $PWD ($ctx.Request.Url.LocalPath.TrimStart('/')); if ($file -eq $PWD) { $file = Join-Path $PWD 'index.html' }; if (Test-Path $file) { $bytes = [IO.File]::ReadAllBytes($file); $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length) } else { $ctx.Response.StatusCode = 404 }; $ctx.Response.Close() }
```

### PowerShell CLI

Full migration workflow from the command line. Supports certificate, client secret, or interactive (device code) authentication.

```powershell
cd Intune-AdmxToSettingsCatalog-Migrator
pwsh ./Invoke-Migration.ps1 -ConfigPath ./config/config.json -Mode Export
```

---

## Prerequisites

Both the Web UI and PowerShell CLI require an **Entra ID (Azure AD) app registration**.

1. Create an app registration in the [Entra admin center](https://entra.microsoft.com)
2. Add **`DeviceManagementConfiguration.ReadWrite.All`** (Microsoft Graph, Application) and grant admin consent
3. **Web UI**: Add a SPA redirect URI (`http://localhost:8080`) under Authentication
4. **PowerShell CLI**: Add a client secret, upload a certificate, or enable public client flows for interactive login

See the full [app registration setup guide](Intune-AdmxToSettingsCatalog-Migrator/README.md#entra-id-app-registration-setup) for step-by-step instructions.

---

## Requirements

| Component | What you need |
|-----------|--------------|
| **Web UI** | Any modern browser + local HTTP server (Python, Node.js, or PowerShell) |
| **PowerShell CLI** | PowerShell 7+ |
| **Both** | Entra ID app registration with Graph API permissions |

---

## Limitations

- **Not every ADMX setting has a Settings Catalog equivalent.** The mapping step highlights unmapped settings so you know what needs manual attention.
- **Localized tenants** (Norwegian, German, etc.) may return fewer automatic matches. The tool uses product-aware fallback search, but some settings may require manual mapping via the search modal.
- **Settings Catalog search depends on Microsoft Graph indexing.** There can be slight delays before newly created definitions are searchable.
- **Original ADMX policies are not modified or deleted.** You must decommission them manually after validating the migration.
- **Token lifetime.** For very large tenants with hundreds of policies, the auth token may expire mid-operation. Run in batches if needed.
- **Certificate auth requires PowerShell 7+** for the RSA signing APIs.
- **Interactive auth uses delegated permissions**, scoped to the signed-in user's Intune access level.

---

## Documentation

See the full [project README](Intune-AdmxToSettingsCatalog-Migrator/README.md) for:

- Entra ID app registration setup (step-by-step with screenshots)
- Authentication methods (client secret, certificate, interactive)
- Recommended workflow
- Duplicate detection and conflict resolution
- Backup and restore
- Configuration reference
- Troubleshooting guide

---

## Connect

Built by [Robel](https://www.linkedin.com/in/eriteach).

[![LinkedIn](https://img.shields.io/badge/Connect_on_LinkedIn-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white)](https://www.linkedin.com/in/eriteach)
