<#
.SYNOPSIS
Kjorer eksport, mapping, migrering eller rollback for ADMX->Settings Catalog.
.DESCRIPTION
This script is the entry point for the migration tool. It supports four modes:
- Export: exports Administrative Templates (ADMX) policies, settings, and assignments from Intune
- Map: builds mapping suggestions from ADMX settings to Settings Catalog settings
- Migrate: creates Settings Catalog policies for mapped settings and re-applies assignments (supports -WhatIf)
- Rollback: deletes Settings Catalog policies created by this tool (based on a marker) using the manifest
All actions are logged to C:\MK-LogFiles\Invoke-Migration.log with full error handling.
#>

[CmdletBinding(SupportsShouldProcess=$true)]
param(
  [Parameter(Mandatory=$true)]
  [string]$ConfigPath,

  [Parameter(Mandatory=$true)]
  [ValidateSet("Export","Map","Migrate","Rollback")]
  [string]$Mode,

  [switch]$WhatIf
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$script:ScriptName = "Invoke-Migration"
$logDir = "C:\MK-LogFiles"
if (-not (Test-Path $logDir)) { New-Item -Path $logDir -ItemType Directory -Force | Out-Null }
$logPath = Join-Path $logDir "$script:ScriptName.log"

. "$PSScriptRoot\src\Write-Log.ps1"
Import-Module "$PSScriptRoot\src\MkGraph.psm1" -Force
Import-Module "$PSScriptRoot\src\MkIntuneAdmx.psm1" -Force
Import-Module "$PSScriptRoot\src\MkIntuneSettingsCatalog.psm1" -Force
Import-Module "$PSScriptRoot\src\MkMigration.psm1" -Force

try {
  Write-Log -Level "INFO" -Message "Starting mode=$Mode config=$ConfigPath WhatIf=$WhatIf" -LogPath $logPath

  if (-not (Test-Path $ConfigPath)) { throw "ConfigPath not found: $ConfigPath" }
  $cfg = Get-Content $ConfigPath -Raw | ConvertFrom-Json

  $outDir = Resolve-PathSafe -Path $cfg.Paths.OutputDir -BasePath $PSScriptRoot
  if (-not (Test-Path $outDir)) { New-Item -Path $outDir -ItemType Directory -Force | Out-Null }

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

      Invoke-MkMigration -Token $token -ApiVersion $cfg.Graph.ApiVersion -ExportFile $exportFile -MappingFile $mappingFile `
        -TargetNamePrefix $cfg.Migration.TargetNamePrefix -SourceMarkerKey $cfg.Migration.SourceMarkerKey -SkipUnmapped:$cfg.Migration.SkipUnmapped `
        -OutManifest (Join-Path $outDir "migration.manifest.json") -LogPath $logPath -WhatIf:$WhatIf
    }
    "Rollback" {
      $manifest = Join-Path $outDir "migration.manifest.json"
      if (-not (Test-Path $manifest)) { throw "Missing manifest: $manifest. Run Mode=Migrate first." }
      Invoke-MkRollback -Token $token -ApiVersion $cfg.Graph.ApiVersion -ManifestFile $manifest -LogPath $logPath -WhatIf:$WhatIf
    }
  }

  Write-Log -Level "INFO" -Message "Completed mode=$Mode" -LogPath $logPath
  exit 0
}
catch {
  Write-Log -Level "ERROR" -Message ("FAILED: " + $_.Exception.Message) -LogPath $logPath
  Write-Log -Level "ERROR" -Message ($_.ScriptStackTrace) -LogPath $logPath
  exit 1
}
