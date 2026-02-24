# Intune ADMX to Settings Catalog Migrator

**Automate the migration of Administrative Templates to Settings Catalog in Microsoft Intune.**

[![PowerShell](https://img.shields.io/badge/PowerShell-7%2B-blue.svg)](https://github.com/PowerShell/PowerShell)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)]()
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub](https://img.shields.io/badge/GitHub-Thugney-181717?style=flat&logo=github)](https://github.com/Thugney)
[![Blog](https://img.shields.io/badge/Blog-eriteach.com-0d9488?style=flat&logo=hugo)](https://blog.eriteach.com)
[![YouTube](https://img.shields.io/badge/YouTube-Eriteach-FF0000?style=flat&logo=youtube)](https://www.youtube.com/@eriteach)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-Eriteach-0A66C2?style=flat&logo=linkedin)](https://www.linkedin.com/in/eriteach/)

Microsoft is phasing out Administrative Templates (ADMX) in favor of the unified Settings Catalog. This tool provides an automated, auditable, and rollback-capable migration path—eliminating the error-prone manual recreation of policies.

## Key Features

- **Export** — Export all ADMX policies, settings, and assignments to JSON
- **Smart Mapping** — Auto-suggest Settings Catalog equivalents for each ADMX setting
- **Duplicate Detection** — Identify conflicting settings across policies before migration
- **Safe Migration** — Preview changes with `-WhatIf` before committing
- **Rollback Support** — Instantly revert changes using marker-based tracking
- **Backup & Restore** — Point-in-time snapshots before every operation
- **Web UI Included** — Browser-based dashboard with real-time progress (no server required)

---

## Requirements

| Requirement | Details |
|-------------|---------|
| **PowerShell** | Version 7+ (cross-platform) |
| **Entra ID App Registration** | See setup guide below |
| **Graph API Permissions** | `DeviceManagementConfiguration.Read.All` (read-only) |
| | `DeviceManagementConfiguration.ReadWrite.All` (migration) |

---

## Entra ID App Registration Setup

You need an app registration in Microsoft Entra ID (formerly Azure AD) to authenticate with the Microsoft Graph API. This gives you the **Tenant ID** and **Client ID** that both the Web UI and PowerShell CLI require.

### Step 1: Create the App Registration

1. Go to the [Microsoft Entra admin center](https://entra.microsoft.com)
2. Navigate to **Identity > Applications > App registrations**
3. Click **New registration**
4. Fill in:
   - **Name**: `Intune ADMX Migrator` (or any name you prefer)
   - **Supported account types**: *Accounts in this organizational directory only (Single tenant)*
   - **Redirect URI**: Leave blank for now (you'll add this in Step 3 if using the Web UI)
5. Click **Register**

After registration, you'll land on the app's **Overview** page. Copy these two values — you'll need them for configuration:

| Value | Where to find it | Used in |
|-------|------------------|---------|
| **Application (client) ID** | Overview page, top section | `ClientId` in config.json / Web UI login |
| **Directory (tenant) ID** | Overview page, top section | `TenantId` in config.json / Web UI login |

### Step 2: Add API Permissions

1. In your app registration, go to **API permissions**
2. Click **Add a permission** > **Microsoft Graph** > **Application permissions**
3. Search for and add:
   - `DeviceManagementConfiguration.Read.All` — required for export and duplicate detection
   - `DeviceManagementConfiguration.ReadWrite.All` — required for migration, assignments, and rollback
4. Click **Grant admin consent for [your tenant]** (requires Global Admin or Privileged Role Admin)

> If you only plan to export and detect duplicates (read-only), `Read.All` is sufficient. Add `ReadWrite.All` when you're ready to migrate.

### Step 3: Configure Authentication

Choose one method based on your needs:

#### For the Web UI (browser-based):
1. In your app registration, go to **Authentication**
2. Click **Add a platform** > **Single-page application (SPA)**
3. Set **Redirect URI** to `http://localhost:8080` (or the URL where you serve the web app)
4. Click **Configure**

No client secret or certificate is needed — the Web UI uses interactive popup login via MSAL.js.

#### For PowerShell CLI — pick one:

**Option A: Interactive login (easiest, no secrets)**
- No extra setup needed. The tool uses device code flow — you sign in via browser when prompted.
- In your app registration, go to **Authentication** > **Advanced settings** and set **Allow public client flows** to **Yes**

**Option B: Client secret**
1. Go to **Certificates & secrets** > **Client secrets** > **New client secret**
2. Set a description and expiry, then click **Add**
3. Copy the secret **Value** immediately (it's only shown once)

**Option C: Certificate (recommended for production)**
1. Go to **Certificates & secrets** > **Certificates** > **Upload certificate**
2. Upload the public key (`.cer` or `.pem`)
3. Install the private key (`.pfx`) on the machine where you'll run the tool

### Step 4: Verify

To confirm everything is set up correctly:
1. Copy `config\config.sample.json` to `config\config.json`
2. Fill in your **TenantId**, **ClientId**, and **Auth** section
3. Run a test export:
   ```powershell
   pwsh .\Invoke-Migration.ps1 -ConfigPath .\config\config.json -Mode Export
   ```
   If it connects and exports your policies, the app registration is correctly configured.

---

## Authentication Methods

### Option 1: Client Secret (app-only)
```json
{
  "Auth": {
    "Type": "ClientSecret",
    "ClientSecret": "your-secret-here"
  }
}
```

### Option 2: Certificate (app-only, recommended for production)
Uses a signed JWT assertion (RFC 7523). No secret stored in config.

```json
{
  "Auth": {
    "Type": "Certificate",
    "CertificateThumbprint": "AB12CD34EF56...",
    "CertificatePath": "",
    "CertificatePassword": ""
  }
}
```
The tool searches `CurrentUser\My` then `LocalMachine\My` certificate stores. Alternatively, set `CertificatePath` to a `.pfx` file.

### Option 3: Interactive (device code flow)
No secrets or certificates needed. The user signs in via browser.

```json
{
  "Auth": {
    "Type": "Interactive"
  }
}
```
When you run the tool, it displays a URL and code. Open the URL in a browser, enter the code, and sign in with an account that has Intune admin permissions.

---

## Quick Start

```powershell
# 1. Configure
Copy-Item .\config\config.sample.json .\config\config.json
# Edit config.json with your TenantId, ClientId, and Auth details

# 2. Export current ADMX policies
pwsh .\Invoke-Migration.ps1 -ConfigPath .\config\config.json -Mode Export

# 3. Detect duplicates and conflicts (recommended)
pwsh .\Invoke-Migration.ps1 -ConfigPath .\config\config.json -Mode Duplicates

# 4. Generate mapping suggestions
pwsh .\Invoke-Migration.ps1 -ConfigPath .\config\config.json -Mode Map

# 5. Preview migration (dry run)
pwsh .\Invoke-Migration.ps1 -ConfigPath .\config\config.json -Mode Migrate -WhatIf

# 6. Execute migration (auto-backup included)
pwsh .\Invoke-Migration.ps1 -ConfigPath .\config\config.json -Mode Migrate

# 7. Rollback if needed
pwsh .\Invoke-Migration.ps1 -ConfigPath .\config\config.json -Mode Rollback
```

---

## Duplicate Settings Detection

When you have dozens of ADMX policies, settings often overlap. For example:
- "Disable Telemetry" might be enabled in both "Security Baseline" and "Privacy Settings"
- "Configure Windows Update" might be set to different values in "IT Policy" vs "Dev Team Policy"

The **Duplicates** mode scans your exported policies and produces a report with:

**Duplicate Groups**: Each setting that appears in more than one policy, showing:
- Which policies contain it
- Whether the values match (consistent) or differ (conflict)
- A recommendation: merge-safe vs. needs-review

**Policy Overlap Matrix**: Every pair of policies that share settings, showing:
- Number of shared settings
- Number of conflicts
- Whether the pair can be auto-merged

**Actionable Instructions**: Step-by-step guidance on how to consolidate duplicates using the migration tool.

---

## Backup and Restore

### Automatic Backups
Before every **Migrate** or **Rollback** operation, the tool automatically creates a timestamped backup containing:
- Full export of all ADMX policies (with assignments and settings)
- Full list of all Settings Catalog policies
- Copies of local artifact files (export, mapping, manifest)

### Manual Backup
```powershell
pwsh .\Invoke-Migration.ps1 -ConfigPath .\config\config.json -Mode Backup
```

### List Available Backups
```powershell
pwsh .\Invoke-Migration.ps1 -ConfigPath .\config\config.json -Mode Restore
```

### Restore Local Files from Backup
```powershell
pwsh .\Invoke-Migration.ps1 -ConfigPath .\config\config.json -Mode Restore -BackupPath .\output\backups\20250115-143022
```

Backups are stored in `output\backups\<timestamp>\` with a metadata file for easy identification.

---

## Project Structure

```
Invoke-Migration.ps1              # Entry point - mode routing and config validation
config/
  config.sample.json              # Template configuration (copy to config.json)
output/
  mapping.json                    # Sample mapping format
src/
  Write-Log.ps1                   # Logging utility (UTC timestamps, rotation, leveled output)
  MkGraph.psm1                    # Microsoft Graph auth (secret, cert, interactive) and HTTP client
  MkIntuneAdmx.psm1              # ADMX policy export
  MkIntuneSettingsCatalog.psm1    # Settings Catalog CRUD operations
  MkMigration.psm1                # Migration orchestration and rollback
  MkDuplicateDetector.psm1        # Duplicate settings analysis and reporting
  MkBackup.psm1                   # Backup and restore utilities
```

---

## Output Files

| File | Generated By | Purpose |
|------|-------------|---------|
| `export.admx.json` | Export | Complete ADMX policy export with settings and assignments |
| `mapping.suggestions.json` | Map | Auto-generated Settings Catalog candidates for each ADMX setting |
| `mapping.json` | You | Your curated mapping (controls what gets migrated) |
| `migration.manifest.json` | Migrate | Record of created policies (used by Rollback) |
| `duplicate-report.json` | Duplicates | Machine-readable duplicate/conflict analysis |
| `duplicate-report.txt` | Duplicates | Human-readable duplicate summary |
| `backups/<timestamp>/` | Backup/Migrate/Rollback | Point-in-time snapshots |
| `logs/Invoke-Migration.log` | All modes | Audit trail with UTC timestamps |

---

## Configuration Reference

```json
{
  "TenantId": "Azure AD tenant ID (GUID)",
  "ClientId": "App registration client ID (GUID)",
  "Auth": {
    "Type": "ClientSecret | Certificate | Interactive",
    "ClientSecret": "Only for Type=ClientSecret",
    "CertificateThumbprint": "Only for Type=Certificate",
    "CertificatePath": "Optional PFX file path for Type=Certificate",
    "CertificatePassword": "Optional PFX password for Type=Certificate"
  },
  "Graph": {
    "ApiVersion": "beta | v1.0"
  },
  "Migration": {
    "TargetNamePrefix": "Prefix for new Settings Catalog policies (e.g. 'SC - ')",
    "SourceMarkerKey": "Unique marker embedded in policy description for idempotency",
    "SkipUnmapped": "true = skip unmapped settings, false = fail on unmapped settings"
  },
  "Paths": {
    "OutputDir": "Relative or absolute path for output files",
    "LogDir": "Optional: custom log directory. Defaults to <OutputDir>/logs/"
  }
}
```

---

## Logging

- **Format**: `2025-01-15 14:30:22.123Z [INFO] message`
- **Timezone**: All timestamps are UTC
- **Levels**: INFO, WARN, ERROR, DEBUG
- **Rotation**: Logs auto-rotate at 10 MB (old log renamed with timestamp `.bak` suffix)
- **Location**: Configurable via `Paths.LogDir` in config, defaults to `output/logs/`
- **Scope**: Every API call, policy creation, assignment, skip, and error is logged

---

## Security Considerations

- **Never commit `config.json`** - it may contain secrets. The `.gitignore` excludes it.
- **Prefer Certificate or Interactive auth** over client secrets for production use.
- Client secrets should be stored in a vault and injected at runtime, not hardcoded.
- Output files contain tenant-specific policy data and are excluded from git.
- The tool uses HTTPS exclusively for all Graph API communication.
- All API requests include Bearer token authentication; tokens are not persisted to disk.
- Graph API retry logic respects `Retry-After` headers and uses exponential backoff.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Token acquisition failed` | Wrong credentials or insufficient permissions | Verify TenantId, ClientId, and Auth values. Check API permissions in Azure portal. |
| `Certificate not found` | Thumbprint mismatch or cert not installed | Import the certificate to `CurrentUser\My` or `LocalMachine\My`, or use `CertificatePath`. |
| `Missing export file` | Running Map/Migrate/Duplicates before Export | Run `Mode=Export` first to generate `export.admx.json`. |
| `Unmapped setting` with `SkipUnmapped=false` | Mapping file incomplete | Either add the missing mapping entry or set `SkipUnmapped=true`. |
| `Graph API returned 429` | Rate limiting | The tool retries automatically with exponential backoff. If persistent, reduce batch size or wait. |
| `Graph API returned 403` | Missing permissions | Ensure the app has `DeviceManagementConfiguration.ReadWrite.All` and admin consent is granted. |
| Duplicate report shows conflicts | Same setting configured differently | Review the conflicting policies and decide which value should win before migrating. |

---

## Recommended Workflow

```
1. Export          -> Get current state
2. Duplicates      -> Identify overlapping settings across policies
3. Resolve         -> (Manual) Decide how to handle duplicates and conflicts
4. Map             -> Generate mapping suggestions
5. Curate          -> (Manual) Review and finalize mapping.json
6. Migrate -WhatIf -> Preview what will be created
7. Migrate         -> Execute (auto-backup runs first)
8. Validate        -> (Manual) Verify in Intune portal
9. Rollback        -> If anything is wrong (auto-backup runs first)
```

---

## Web UI (Browser-Based Dashboard)

A fully browser-based web UI is included in the `web/` directory. No server needed - it runs entirely in your browser using MSAL.js for authentication and calls Microsoft Graph directly.

### Features
- Modern dashboard with sidebar navigation
- Interactive login via MSAL popup (no secrets needed in browser)
- Export policies with real-time progress
- Duplicate detection with visual conflict/consistent indicators and merge candidates
- Mapping suggestions with confidence levels (high/medium/no match)
- Migration execution with live log output and WhatIf preview
- Rollback support
- Backup management with download/delete

### Setup

1. **Add a SPA redirect URI** to your Azure AD app registration:
   - Go to Azure Portal > App Registrations > your app > Authentication
   - Add a platform: **Single-page application**
   - Redirect URI: `http://localhost:8080` (or wherever you serve the file)

2. **Serve the web folder** (any static server works):
   ```bash
   # Option A: Python
   cd web && python3 -m http.server 8080

   # Option B: Node.js
   npx serve web

   # Option C: Just open index.html directly (some browsers block MSAL popups from file://)
   ```

3. **Open in browser**, enter your Tenant ID and Client ID, and sign in.

### Architecture
```
web/
  index.html              # Main SPA shell (Tailwind CSS via CDN)
  css/style.css           # Custom styles
  js/
    auth.js               # MSAL.js popup authentication
    graph.js              # Graph API client with retry logic
    app.js                # Navigation, state management, UI utilities
    pages/
      dashboard.js        # Dashboard with stats cards and policy table
      export.js           # Export with progress bar and log output
      duplicates.js       # Client-side duplicate analysis and filtering
      mapping.js          # Mapping suggestions with confidence indicators
      migration.js        # Migration execution, preview, and rollback
      backup.js           # Backup create/list/download/delete
```

All data stays in your browser (sessionStorage/localStorage). No data is sent to third parties.

---

## Limitations

- Not every ADMX setting has a 1:1 Settings Catalog counterpart (unmapped settings are highlighted)
- Original ADMX policies are not modified or deleted—manual cleanup after validation
- Token does not auto-refresh during very long operations; consider batching for large tenants
- Web UI requires a SPA redirect URI in your app registration

---

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

---

## Author

**Robel**

[![GitHub](https://img.shields.io/badge/GitHub-Thugney-181717?style=flat&logo=github)](https://github.com/Thugney)
[![Blog](https://img.shields.io/badge/Blog-eriteach.com-0d9488?style=flat&logo=hugo)](https://blog.eriteach.com)
[![YouTube](https://img.shields.io/badge/YouTube-Eriteach-FF0000?style=flat&logo=youtube)](https://www.youtube.com/@eriteach)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-Eriteach-0A66C2?style=flat&logo=linkedin)](https://www.linkedin.com/in/eriteach/)

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
