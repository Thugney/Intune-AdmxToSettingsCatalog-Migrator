# MkBackup.psm1
# Backup and restore utilities for safe migration operations.
# Creates timestamped snapshots of policies before any destructive changes.
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function New-MkBackup {
  <#
  .SYNOPSIS
    Creates a timestamped backup of current Intune policy state before migration.
  .DESCRIPTION
    Exports a full snapshot of both ADMX and Settings Catalog policies to a
    timestamped backup directory. This provides a point-in-time recovery reference
    if anything goes wrong during migration. Also backs up local artifact files
    (export, mapping, manifest) if they exist.
  #>
  [CmdletBinding()]
  param(
    [Parameter(Mandatory=$true)][string]$Token,
    [Parameter(Mandatory=$true)][ValidateSet("beta","v1.0")] [string]$ApiVersion,
    [Parameter(Mandatory=$true)][string]$OutputDir,
    [Parameter(Mandatory=$true)][string]$LogPath
  )

  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $backupDir = Join-Path $OutputDir "backups" $timestamp

  Write-Log -Level "INFO" -Message "Creating backup in $backupDir" -LogPath $LogPath

  if (-not (Test-Path $backupDir)) {
    New-Item -Path $backupDir -ItemType Directory -Force | Out-Null
  }

  $base = "https://graph.microsoft.com/$ApiVersion/deviceManagement"

  # 1. Backup ADMX policies (groupPolicyConfigurations)
  try {
    Write-Log -Level "INFO" -Message "Backing up ADMX (groupPolicyConfigurations)..." -LogPath $LogPath
    $admxPolicies = Get-MkGraphPaged -Token $Token -Uri "$base/groupPolicyConfigurations"
    $admxSnapshot = @()
    foreach ($p in $admxPolicies) {
      $assignments = @()
      try { $assignments = Get-MkGraphPaged -Token $Token -Uri "$base/groupPolicyConfigurations/$($p.id)/assignments" }
      catch { Write-Log -Level "WARN" -Message "Could not backup assignments for ADMX policy $($p.id): $($_.Exception.Message)" -LogPath $LogPath }

      $defValues = @()
      try { $defValues = Get-MkGraphPaged -Token $Token -Uri "$base/groupPolicyConfigurations/$($p.id)/definitionValues" }
      catch { Write-Log -Level "WARN" -Message "Could not backup definitionValues for ADMX policy $($p.id): $($_.Exception.Message)" -LogPath $LogPath }

      $admxSnapshot += [pscustomobject]@{
        id = $p.id
        displayName = $p.displayName
        description = $p.description
        lastModifiedDateTime = $p.lastModifiedDateTime
        assignments = $assignments
        definitionValues = $defValues
      }
    }
    $admxFile = Join-Path $backupDir "backup.admx-policies.json"
    $admxSnapshot | ConvertTo-Json -Depth 40 | Out-File -FilePath $admxFile -Encoding utf8
    Write-Log -Level "INFO" -Message "ADMX backup: $($admxSnapshot.Count) policies -> $admxFile" -LogPath $LogPath
  }
  catch {
    Write-Log -Level "ERROR" -Message "Failed to backup ADMX policies: $($_.Exception.Message)" -LogPath $LogPath
    throw
  }

  # 2. Backup Settings Catalog policies (configurationPolicies)
  try {
    Write-Log -Level "INFO" -Message "Backing up Settings Catalog (configurationPolicies)..." -LogPath $LogPath
    $scPolicies = Get-MkGraphPaged -Token $Token -Uri "$base/configurationPolicies"
    $scFile = Join-Path $backupDir "backup.settings-catalog-policies.json"
    $scPolicies | ConvertTo-Json -Depth 40 | Out-File -FilePath $scFile -Encoding utf8
    Write-Log -Level "INFO" -Message "Settings Catalog backup: $($scPolicies.Count) policies -> $scFile" -LogPath $LogPath
  }
  catch {
    Write-Log -Level "ERROR" -Message "Failed to backup Settings Catalog policies: $($_.Exception.Message)" -LogPath $LogPath
    throw
  }

  # 3. Backup local artifacts if they exist
  $localFiles = @("export.admx.json", "mapping.json", "mapping.suggestions.json", "migration.manifest.json")
  foreach ($f in $localFiles) {
    $src = Join-Path $OutputDir $f
    if (Test-Path $src) {
      $dst = Join-Path $backupDir "local.$f"
      Copy-Item -Path $src -Destination $dst -Force
      Write-Log -Level "INFO" -Message "Backed up local artifact: $f" -LogPath $LogPath
    }
  }

  # 4. Write backup metadata
  $meta = [pscustomobject]@{
    timestamp    = $timestamp
    generatedAt  = (Get-Date).ToString("o")
    apiVersion   = $ApiVersion
    admxCount    = $admxSnapshot.Count
    scCount      = $scPolicies.Count
    localFiles   = ($localFiles | Where-Object { Test-Path (Join-Path $OutputDir $_) })
  }
  $meta | ConvertTo-Json -Depth 10 | Out-File -FilePath (Join-Path $backupDir "backup.metadata.json") -Encoding utf8

  Write-Log -Level "INFO" -Message "Backup complete: $backupDir" -LogPath $LogPath
  return $backupDir
}

function Get-MkBackupList {
  <#
  .SYNOPSIS
    Lists all available backups in the output directory.
  #>
  [CmdletBinding()]
  param(
    [Parameter(Mandatory=$true)][string]$OutputDir,
    [Parameter(Mandatory=$true)][string]$LogPath
  )

  $backupsRoot = Join-Path $OutputDir "backups"
  if (-not (Test-Path $backupsRoot)) {
    Write-Log -Level "INFO" -Message "No backups directory found at $backupsRoot" -LogPath $LogPath
    return @()
  }

  $backups = @()
  foreach ($dir in (Get-ChildItem -Path $backupsRoot -Directory | Sort-Object Name -Descending)) {
    $metaFile = Join-Path $dir.FullName "backup.metadata.json"
    if (Test-Path $metaFile) {
      $meta = Get-Content $metaFile -Raw | ConvertFrom-Json
      $backups += [pscustomobject]@{
        path      = $dir.FullName
        timestamp = $meta.timestamp
        date      = $meta.generatedAt
        admxCount = $meta.admxCount
        scCount   = $meta.scCount
      }
    }
  }

  return $backups
}

function Restore-MkBackupLocalFiles {
  <#
  .SYNOPSIS
    Restores local artifact files (export, mapping, manifest) from a backup.
  .DESCRIPTION
    Copies the backed-up local files back to the output directory.
    Does NOT restore remote Intune policies - that requires manual intervention
    or using the exported JSON as reference to recreate them.
  #>
  [CmdletBinding()]
  param(
    [Parameter(Mandatory=$true)][string]$BackupPath,
    [Parameter(Mandatory=$true)][string]$OutputDir,
    [Parameter(Mandatory=$true)][string]$LogPath
  )

  if (-not (Test-Path $BackupPath)) { throw "Backup path not found: $BackupPath" }

  Write-Log -Level "INFO" -Message "Restoring local files from backup: $BackupPath" -LogPath $LogPath

  $restoredCount = 0
  foreach ($file in (Get-ChildItem -Path $BackupPath -Filter "local.*")) {
    $originalName = $file.Name -replace '^local\.', ''
    $dst = Join-Path $OutputDir $originalName
    Copy-Item -Path $file.FullName -Destination $dst -Force
    Write-Log -Level "INFO" -Message "Restored: $originalName" -LogPath $LogPath
    $restoredCount++
  }

  Write-Log -Level "INFO" -Message "Restore complete: $restoredCount files restored to $OutputDir" -LogPath $LogPath
  return $restoredCount
}

Export-ModuleMember -Function New-MkBackup, Get-MkBackupList, Restore-MkBackupLocalFiles
