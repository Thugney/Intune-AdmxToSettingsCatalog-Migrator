# Intune ADMX (Administrative Templates) -> Settings Catalog Migrator

Automates migration of **Administrative Templates** (Graph: `groupPolicyConfigurations`) to **Settings Catalog** (Graph: `configurationPolicies`) in Microsoft Intune.

---

## Why

- Administrative Templates profiles are being phased out in favor of the unified Settings Catalog model.
- Manual recreation across dozens of policies is error-prone and time-consuming.
- This tool provides an auditable, repeatable, rollback-capable migration path.

## What It Does

| Mode | Description |
|------|-------------|
| **Export** | Exports all ADMX policies, settings, and assignments to JSON |
| **Map** | Auto-suggests Settings Catalog counterparts for each ADMX setting |
| **Migrate** | Creates Settings Catalog policies from your curated mapping (supports `-WhatIf`) |
| **Rollback** | Deletes only the policies this tool created (marker-based) |
| **Duplicates** | Detects duplicate/conflicting settings across ADMX policies |
| **Backup** | Snapshots current ADMX and Settings Catalog state before changes |
| **Restore** | Lists and restores local artifact files from a backup |

---

## Requirements

- **PowerShell 7+** (cross-platform)
- **Azure AD App Registration** with one of:
  - Client secret
  - Certificate (thumbprint in local store, or PFX file)
  - Interactive login (device code flow - no secret needed)
- **Microsoft Graph API permissions** (application or delegated):
  - `DeviceManagementConfiguration.Read.All` (export, duplicates)
  - `DeviceManagementConfiguration.ReadWrite.All` (migrate, assign, rollback)

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

### 1. Configure

Copy `config\config.sample.json` to `config\config.json` and fill in your tenant values:

```powershell
Copy-Item .\config\config.sample.json .\config\config.json
# Edit config.json with your TenantId, ClientId, and Auth details
```

### 2. Export ADMX Policies

```powershell
pwsh .\Invoke-Migration.ps1 -ConfigPath .\config\config.json -Mode Export
```

### 3. Detect Duplicates (Recommended)

Before migrating, check for duplicate or conflicting settings across your ADMX policies:

```powershell
pwsh .\Invoke-Migration.ps1 -ConfigPath .\config\config.json -Mode Duplicates
```

This produces two files:
- `output\duplicate-report.json` - Machine-readable report with full analysis
- `output\duplicate-report.txt` - Human-readable summary

The report shows:
- **Consistent duplicates**: Same setting enabled in multiple policies (safe to merge)
- **Conflicts**: Same setting configured differently across policies (needs manual review)
- **Merge candidates**: Policy pairs that share settings, ranked by overlap count
- **Recommendations**: Whether each pair can be auto-merged or needs review

### 4. Build Mapping Suggestions

```powershell
pwsh .\Invoke-Migration.ps1 -ConfigPath .\config\config.json -Mode Map
```

Review `output\mapping.suggestions.json`, then create `output\mapping.json` with your curated mappings. See `output\mapping.json` for the expected format.

### 5. Preview Migration

```powershell
pwsh .\Invoke-Migration.ps1 -ConfigPath .\config\config.json -Mode Migrate -WhatIf
```

### 6. Run Migration

```powershell
pwsh .\Invoke-Migration.ps1 -ConfigPath .\config\config.json -Mode Migrate
```

A backup is automatically created before migration runs.

### 7. Rollback (if needed)

```powershell
pwsh .\Invoke-Migration.ps1 -ConfigPath .\config\config.json -Mode Rollback -WhatIf
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

## Limitations

- Not every ADMX setting has a 1:1 Settings Catalog counterpart. The mapping report highlights unmapped settings.
- The `$search` endpoint for Settings Catalog requires `ConsistencyLevel=eventual` and may have indexing delays.
- Certificate authentication requires PowerShell 7+ for the RSA signing APIs.
- The tool does not modify or delete original ADMX policies. That must be done manually after validation.
- Token does not auto-refresh during very long operations. For large tenants, consider running in batches.
- Interactive auth uses delegated permissions, which are scoped to the signed-in user's access level.
