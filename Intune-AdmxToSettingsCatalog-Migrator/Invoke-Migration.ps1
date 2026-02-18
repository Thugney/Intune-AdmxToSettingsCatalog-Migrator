<#
.SYNOPSIS
  Entry point for ADMX -> Settings Catalog migration tool.
.DESCRIPTION
  Supports seven modes of operation:
  - Export:      Export ADMX policies, settings, and assignments from Intune
  - Map:         Build mapping suggestions from ADMX settings to Settings Catalog
  - Migrate:     Create Settings Catalog policies from mapped settings (supports -WhatIf)
  - Rollback:    Delete Settings Catalog policies created by this tool
  - Duplicates:  Detect duplicate/conflicting settings across ADMX policies
  - Backup:      Create a snapshot of current policies before changes
  - Restore:     Restore local artifact files from a backup

  Authentication: ClientSecret, Certificate (JWT assertion), or Interactive (device code flow).
  All actions are logged with UTC timestamps. Log path is configurable.
#>

[CmdletBinding(SupportsShouldProcess=$true)]
param(
  [Parameter(Mandatory=$true)]
  [string]$ConfigPath,

  [Parameter(Mandatory=$true)]
  [ValidateSet("Export","Map","Migrate","Rollback","Duplicates","Backup","Restore")]
  [string]$Mode,

  [Parameter()]
  [string]$BackupPath,  # Used with Mode=Restore to specify which backup to restore

  [switch]$WhatIf
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# --- Load helpers and modules ---
. "$PSScriptRoot\src\Write-Log.ps1"
Import-Module "$PSScriptRoot\src\MkGraph.psm1" -Force
Import-Module "$PSScriptRoot\src\MkIntuneAdmx.psm1" -Force
Import-Module "$PSScriptRoot\src\MkIntuneSettingsCatalog.psm1" -Force
Import-Module "$PSScriptRoot\src\MkMigration.psm1" -Force
Import-Module "$PSScriptRoot\src\MkDuplicateDetector.psm1" -Force
Import-Module "$PSScriptRoot\src\MkBackup.psm1" -Force

# --- Load and validate config ---
if (-not (Test-Path $ConfigPath)) { throw "ConfigPath not found: $ConfigPath" }
$cfg = Get-Content $ConfigPath -Raw | ConvertFrom-Json

# Validate required config fields
$requiredFields = @("TenantId", "ClientId", "Auth", "Graph", "Migration", "Paths")
foreach ($field in $requiredFields) {
  if (-not ($cfg.PSObject.Properties.Name -contains $field)) {
    throw "Missing required config field: $field"
  }
}
if (-not $cfg.Auth.Type) { throw "Missing required config field: Auth.Type" }
if ($cfg.Auth.Type -notin @("ClientSecret", "Certificate", "Interactive")) {
  throw "Unsupported Auth.Type: '$($cfg.Auth.Type)'. Supported: ClientSecret, Certificate, Interactive"
}
if (-not $cfg.Graph.ApiVersion) { throw "Missing required config field: Graph.ApiVersion" }

# --- Resolve paths ---
$outDir = Resolve-PathSafe -Path $cfg.Paths.OutputDir -BasePath $PSScriptRoot
if (-not (Test-Path $outDir)) { New-Item -Path $outDir -ItemType Directory -Force | Out-Null }

# Log path: configurable via Paths.LogDir, default to <OutputDir>/logs/
$logDir = $null
if ($cfg.Paths.PSObject.Properties.Name -contains "LogDir" -and -not [string]::IsNullOrWhiteSpace($cfg.Paths.LogDir)) {
  $logDir = Resolve-PathSafe -Path $cfg.Paths.LogDir -BasePath $PSScriptRoot
} else {
  $logDir = Join-Path $outDir "logs"
}
if (-not (Test-Path $logDir)) { New-Item -Path $logDir -ItemType Directory -Force | Out-Null }
$logPath = Join-Path $logDir "Invoke-Migration.log"

# --- Main execution ---
try {
  Write-Log -Level "INFO" -Message "=== Session Start ===" -LogPath $logPath
  Write-Log -Level "INFO" -Message "Mode=$Mode ConfigPath=$ConfigPath WhatIf=$WhatIf AuthType=$($cfg.Auth.Type)" -LogPath $logPath
  Write-Log -Level "INFO" -Message "PowerShell $($PSVersionTable.PSVersion) on $($PSVersionTable.OS)" -LogPath $logPath

  # Modes that don't need a Graph token
  if ($Mode -eq "Duplicates") {
    $exportFile = Join-Path $outDir "export.admx.json"
    if (-not (Test-Path $exportFile)) { throw "Missing export file: $exportFile. Run Mode=Export first." }
    Export-MkDuplicateReport -ExportFile $exportFile -OutFile (Join-Path $outDir "duplicate-report.json") -LogPath $logPath
    Write-Log -Level "INFO" -Message "Duplicate analysis complete. Review output\duplicate-report.json and output\duplicate-report.txt" -LogPath $logPath
    Write-Log -Level "INFO" -Message "=== Session End (Mode=$Mode) ===" -LogPath $logPath
    exit 0
  }

  if ($Mode -eq "Restore") {
    if ([string]::IsNullOrWhiteSpace($BackupPath)) {
      # List available backups
      $backups = Get-MkBackupList -OutputDir $outDir -LogPath $logPath
      if ($backups.Count -eq 0) {
        Write-Log -Level "WARN" -Message "No backups found. Nothing to restore." -LogPath $logPath
      } else {
        Write-Log -Level "INFO" -Message "Available backups:" -LogPath $logPath
        foreach ($b in $backups) {
          Write-Host "  $($b.timestamp) - ADMX: $($b.admxCount) policies, SC: $($b.scCount) policies - $($b.path)"
        }
        Write-Log -Level "INFO" -Message "Re-run with -BackupPath <path> to restore a specific backup." -LogPath $logPath
      }
    } else {
      Restore-MkBackupLocalFiles -BackupPath $BackupPath -OutputDir $outDir -LogPath $logPath
    }
    Write-Log -Level "INFO" -Message "=== Session End (Mode=$Mode) ===" -LogPath $logPath
    exit 0
  }

  # All remaining modes need a Graph token
  $token = Get-MkGraphToken -TenantId $cfg.TenantId -ClientId $cfg.ClientId -Auth $cfg.Auth -LogPath $logPath

  switch ($Mode) {
    "Export" {
      Export-MkAdmxPolicies -Token $token -ApiVersion $cfg.Graph.ApiVersion -OutFile (Join-Path $outDir "export.admx.json") -LogPath $logPath
    }

    "Map" {
      $exportFile = Join-Path $outDir "export.admx.json"
      if (-not (Test-Path $exportFile)) { throw "Missing export file: $exportFile. Run Mode=Export first." }
      Build-MkMappingSuggestions -Token $token -ApiVersion $cfg.Graph.ApiVersion -ExportFile $exportFile -OutFile (Join-Path $outDir "mapping.suggestions.json") -LogPath $logPath
      Write-Log -Level "INFO" -Message "Mapping suggestions created. Curate output\mapping.json for deterministic migrations." -LogPath $logPath
    }

    "Migrate" {
      $exportFile = Join-Path $outDir "export.admx.json"
      $mappingFile = Join-Path $outDir "mapping.json"
      if (-not (Test-Path $exportFile)) { throw "Missing export file: $exportFile. Run Mode=Export first." }
      if (-not (Test-Path $mappingFile)) { throw "Missing mapping file: $mappingFile. Create it from mapping.suggestions.json." }

      # Auto-backup before migration unless WhatIf
      if (-not $WhatIf) {
        Write-Log -Level "INFO" -Message "Creating automatic pre-migration backup..." -LogPath $logPath
        $backupDir = New-MkBackup -Token $token -ApiVersion $cfg.Graph.ApiVersion -OutputDir $outDir -LogPath $logPath
        Write-Log -Level "INFO" -Message "Pre-migration backup saved to: $backupDir" -LogPath $logPath
      }

      Invoke-MkMigration -Token $token -ApiVersion $cfg.Graph.ApiVersion -ExportFile $exportFile -MappingFile $mappingFile `
        -TargetNamePrefix $cfg.Migration.TargetNamePrefix -SourceMarkerKey $cfg.Migration.SourceMarkerKey -SkipUnmapped:$cfg.Migration.SkipUnmapped `
        -OutManifest (Join-Path $outDir "migration.manifest.json") -LogPath $logPath -WhatIf:$WhatIf
    }

    "Rollback" {
      $manifest = Join-Path $outDir "migration.manifest.json"
      if (-not (Test-Path $manifest)) { throw "Missing manifest: $manifest. Run Mode=Migrate first." }

      # Auto-backup before rollback unless WhatIf
      if (-not $WhatIf) {
        Write-Log -Level "INFO" -Message "Creating automatic pre-rollback backup..." -LogPath $logPath
        $backupDir = New-MkBackup -Token $token -ApiVersion $cfg.Graph.ApiVersion -OutputDir $outDir -LogPath $logPath
        Write-Log -Level "INFO" -Message "Pre-rollback backup saved to: $backupDir" -LogPath $logPath
      }

      Invoke-MkRollback -Token $token -ApiVersion $cfg.Graph.ApiVersion -ManifestFile $manifest -LogPath $logPath -WhatIf:$WhatIf
    }

    "Backup" {
      New-MkBackup -Token $token -ApiVersion $cfg.Graph.ApiVersion -OutputDir $outDir -LogPath $logPath
    }
  }

  Write-Log -Level "INFO" -Message "=== Session End (Mode=$Mode) ===" -LogPath $logPath
  exit 0
}
catch {
  Write-Log -Level "ERROR" -Message ("FAILED: " + $_.Exception.Message) -LogPath $logPath
  Write-Log -Level "ERROR" -Message ($_.ScriptStackTrace) -LogPath $logPath
  exit 1
}
