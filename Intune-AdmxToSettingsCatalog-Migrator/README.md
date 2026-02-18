# Intune ADMX (Administrative Templates) -> Settings Catalog Migrator

This repo automates migration of **Administrative Templates** (Graph: `groupPolicyConfigurations`) to **Settings Catalog** (Graph: `configurationPolicies`).

## Why
- Administrative Templates profiles are being phased out in favor of Settings Catalog (unified model). See Intune Settings Catalog docs.  
- The tool reduces manual re-creation and prevents drift.

## Branch + Leaf
- **Branch:** Intune
- **Leaf:** Microsoft Graph `deviceManagement/groupPolicyConfigurations` -> `deviceManagement/configurationPolicies`
- **Outcome:** Removes manual export/recreate/re-assign work for 59+ profiles

## Capabilities
- Export all ADMX profiles + settings + assignments to JSON
- Build a mapping report (auto-suggest Settings Catalog candidates)
- Create Settings Catalog policies for mapped settings
- Re-apply assignments (incl. filters where present)
- Idempotent: re-runs do not duplicate policies (uses a source marker)
- Full audit logging + manifest for rollback

## Requirements
- PowerShell 7+
- App registration with **application permissions**:
  - `DeviceManagementConfiguration.Read.All` (export)
  - `DeviceManagementConfiguration.ReadWrite.All` (create/assign)
> Note: Microsoft updated permissions for *scripts* endpoints in 2025, but configuration policies still use DeviceManagementConfiguration permissions. Review Intune Graph API permissions doc and your tenant needs.

## Auth
App-only (client secret) or certificate auth.

## Quick start
1) Copy `config\config.sample.json` to `config\config.json` and fill values.
2) Run:

```powershell
pwsh .\Invoke-Migration.ps1 -ConfigPath .\config\config.json -Mode Export
pwsh .\Invoke-Migration.ps1 -ConfigPath .\config\config.json -Mode Map
# Review output\mapping.suggestions.json and create mapping.json (or tweak auto mapping)
pwsh .\Invoke-Migration.ps1 -ConfigPath .\config\config.json -Mode Migrate -WhatIf
pwsh .\Invoke-Migration.ps1 -ConfigPath .\config\config.json -Mode Migrate
```

## Outputs
- `output\export.admx.json`
- `output\mapping.suggestions.json`
- `output\mapping.json` (your curated mapping)
- `output\migration.manifest.json`
- Logs: `C:\MK-LogFiles\Invoke-Migration.log`

## Rollback
```powershell
pwsh .\Invoke-Migration.ps1 -ConfigPath .\config\config.json -Mode Rollback
```
Rollback deletes Settings Catalog policies created by this tool (identified by marker), and logs all actions.

## Notes / Limitations
- Not every ADMX setting has a 1:1 Settings Catalog counterpart. The mapping report highlights unmapped settings.
- For best results, run **Export -> Map -> Migrate** and validate in a pilot ring before broad rollout.
