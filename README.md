# Intune ADMX to Settings Catalog Migrator

Automates migration of **Administrative Templates** (ADMX) to **Settings Catalog** policies in Microsoft Intune.

Microsoft has deprecated Administrative Templates. This tool handles the full migration workflow: export, duplicate detection, mapping, migration, backup, and rollback.

## Two Ways to Use

### Web UI (Browser-Based)

A fully client-side web app that runs in your browser. No server, no PowerShell, no installation required.

```bash
cd Intune-AdmxToSettingsCatalog-Migrator/web
python3 -m http.server 8080
# Open http://localhost:8080
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

- **Web UI**: Any modern browser + Azure AD app registration with SPA redirect URI
- **PowerShell CLI**: PowerShell 7+ and Azure AD app registration with Graph API permissions

## Author

- [GitHub](https://github.com/Thugney/)
- [X / Twitter](https://x.com/eriteach)
- [LinkedIn](https://www.linkedin.com/in/eriteach/)
