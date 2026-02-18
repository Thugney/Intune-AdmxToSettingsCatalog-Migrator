# MkDuplicateDetector.psm1
# Detects duplicate / overlapping settings across Administrative Template policies.
# Produces a report with merge, deduplicate, and move recommendations.
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Find-MkDuplicateSettings {
  <#
  .SYNOPSIS
    Scans exported ADMX policies for duplicate or conflicting settings across policies.
  .DESCRIPTION
    Iterates through all definitionValues across all exported policies and groups them
    by their definition reference (definitionId or displayName). When the same setting
    appears in more than one policy, it is flagged as a duplicate with conflict analysis
    (same value = consistent duplicate, different value = conflict).
  #>
  [CmdletBinding()]
  param(
    [Parameter(Mandatory=$true)][string]$ExportFile,
    [Parameter(Mandatory=$true)][string]$LogPath
  )

  if (-not (Test-Path $ExportFile)) {
    throw "Export file not found: $ExportFile. Run Mode=Export first."
  }

  Write-Log -Level "INFO" -Message "Starting duplicate settings analysis on $ExportFile" -LogPath $LogPath

  $data = Get-Content $ExportFile -Raw | ConvertFrom-Json
  if (-not $data -or $data.Count -eq 0) {
    Write-Log -Level "WARN" -Message "Export file is empty or contains no policies." -LogPath $LogPath
    return @{ duplicates = @(); summary = @{ totalPolicies = 0; totalSettings = 0; duplicateGroups = 0; conflicts = 0 } }
  }

  # Build a lookup: settingKey -> list of occurrences across policies
  $settingIndex = @{}

  foreach ($policy in $data) {
    $policyId   = $policy.id
    $policyName = $policy.displayName

    foreach ($dv in $policy.definitionValues) {
      # Determine a stable key for this setting
      $defId = $null
      if ($dv.definition -and $dv.definition.id) {
        $defId = $dv.definition.id
      }

      $defDisplayName = $null
      if ($dv.definition -and $dv.definition.displayName) {
        $defDisplayName = $dv.definition.displayName
      }
      elseif ($dv.displayName) {
        $defDisplayName = $dv.displayName
      }

      # Determine the configured state (enabled/disabled/notConfigured)
      $configuredState = "unknown"
      if ($dv.enabled -eq $true) { $configuredState = "enabled" }
      elseif ($dv.enabled -eq $false) { $configuredState = "disabled" }
      elseif ($dv.PSObject.Properties.Name -contains "enabled") { $configuredState = if ($dv.enabled) { "enabled" } else { "disabled" } }

      # Use definitionId as primary key, fall back to displayName-based key
      $settingKey = if ($defId) { "defId:$defId" } elseif ($defDisplayName) { "name:$($defDisplayName.ToLower().Trim())" } else { "dvId:$($dv.id)" }

      if (-not $settingIndex.ContainsKey($settingKey)) {
        $settingIndex[$settingKey] = @()
      }

      $settingIndex[$settingKey] += [pscustomobject]@{
        policyId          = $policyId
        policyName        = $policyName
        definitionValueId = $dv.id
        definitionId      = $defId
        settingName       = $defDisplayName
        configuredState   = $configuredState
        rawDefinitionValue = $dv
      }
    }
  }

  # Filter to only settings that appear in more than one policy
  $duplicateGroups = @()
  $conflictCount   = 0

  foreach ($key in $settingIndex.Keys) {
    $occurrences = $settingIndex[$key]
    if ($occurrences.Count -le 1) { continue }

    # Determine if all occurrences have the same state (consistent) or differ (conflict)
    $states = $occurrences | ForEach-Object { $_.configuredState } | Sort-Object -Unique
    $isConflict = ($states.Count -gt 1)
    if ($isConflict) { $conflictCount++ }

    $settingName = ($occurrences | Where-Object { $_.settingName } | Select-Object -First 1).settingName
    if (-not $settingName) { $settingName = $key }

    $policiesInvolved = $occurrences | ForEach-Object {
      [pscustomobject]@{
        policyId          = $_.policyId
        policyName        = $_.policyName
        definitionValueId = $_.definitionValueId
        configuredState   = $_.configuredState
      }
    }

    $duplicateGroups += [pscustomobject]@{
      settingKey        = $key
      settingName       = $settingName
      occurrenceCount   = $occurrences.Count
      isConflict        = $isConflict
      states            = $states
      policies          = $policiesInvolved
      recommendation    = if ($isConflict) { "CONFLICT - Review manually: same setting configured differently across policies" } else { "CONSISTENT - Safe to merge or deduplicate" }
    }
  }

  $totalSettings = 0
  foreach ($p in $data) { $totalSettings += ($p.definitionValues | Measure-Object).Count }

  $summary = [pscustomobject]@{
    totalPolicies        = $data.Count
    totalSettings        = $totalSettings
    duplicateGroups      = $duplicateGroups.Count
    conflicts            = $conflictCount
    consistentDuplicates = ($duplicateGroups.Count - $conflictCount)
  }

  Write-Log -Level "INFO" -Message "Duplicate analysis complete: $($summary.totalPolicies) policies, $($summary.totalSettings) settings, $($summary.duplicateGroups) duplicate groups ($($summary.conflicts) conflicts)" -LogPath $LogPath

  return @{
    duplicates = $duplicateGroups
    summary    = $summary
  }
}

function Export-MkDuplicateReport {
  <#
  .SYNOPSIS
    Generates a detailed duplicate settings report with actionable recommendations.
  .DESCRIPTION
    Produces a JSON report and an optional human-readable text summary.
    Includes merge candidates, conflict details, and per-policy duplicate counts.
  #>
  [CmdletBinding()]
  param(
    [Parameter(Mandatory=$true)][string]$ExportFile,
    [Parameter(Mandatory=$true)][string]$OutFile,
    [Parameter(Mandatory=$true)][string]$LogPath
  )

  $analysis = Find-MkDuplicateSettings -ExportFile $ExportFile -LogPath $LogPath
  $duplicates = $analysis.duplicates
  $summary    = $analysis.summary

  # Build per-policy duplicate map (which policies have the most overlap)
  $policyOverlap = @{}
  foreach ($dup in $duplicates) {
    $policyIds = $dup.policies | ForEach-Object { $_.policyId }
    # Generate all pairwise combinations
    for ($i = 0; $i -lt $policyIds.Count; $i++) {
      for ($j = $i + 1; $j -lt $policyIds.Count; $j++) {
        $pairKey = @($policyIds[$i], $policyIds[$j]) | Sort-Object
        $pairKeyStr = "$($pairKey[0])|$($pairKey[1])"
        if (-not $policyOverlap.ContainsKey($pairKeyStr)) {
          $policyOverlap[$pairKeyStr] = @{
            policy1 = ($dup.policies | Where-Object { $_.policyId -eq $pairKey[0] } | Select-Object -First 1)
            policy2 = ($dup.policies | Where-Object { $_.policyId -eq $pairKey[1] } | Select-Object -First 1)
            sharedSettings = @()
            conflicts = 0
          }
        }
        $policyOverlap[$pairKeyStr].sharedSettings += $dup.settingName
        if ($dup.isConflict) { $policyOverlap[$pairKeyStr].conflicts++ }
      }
    }
  }

  # Build merge candidates: policy pairs with high overlap and no conflicts
  $mergeCandidates = @()
  foreach ($key in $policyOverlap.Keys) {
    $pair = $policyOverlap[$key]
    $mergeCandidates += [pscustomobject]@{
      policy1Id          = $pair.policy1.policyId
      policy1Name        = $pair.policy1.policyName
      policy2Id          = $pair.policy2.policyId
      policy2Name        = $pair.policy2.policyName
      sharedSettingsCount = $pair.sharedSettings.Count
      sharedSettings     = ($pair.sharedSettings | Sort-Object -Unique)
      conflictCount      = $pair.conflicts
      canAutoMerge       = ($pair.conflicts -eq 0)
      recommendation     = if ($pair.conflicts -eq 0) { "MERGE_SAFE - All shared settings have identical configuration" } else { "MERGE_REVIEW - $($pair.conflicts) setting(s) have conflicting values" }
    }
  }

  $mergeCandidates = $mergeCandidates | Sort-Object -Property sharedSettingsCount -Descending

  $report = [pscustomobject]@{
    generatedAt     = (Get-Date).ToString("o")
    summary         = $summary
    duplicateGroups = $duplicates
    policyOverlap   = $mergeCandidates
    actions         = [pscustomobject]@{
      description = "Recommended actions based on analysis"
      mergeReady  = ($mergeCandidates | Where-Object { $_.canAutoMerge } | Measure-Object).Count
      reviewNeeded = ($mergeCandidates | Where-Object { -not $_.canAutoMerge } | Measure-Object).Count
      instructions = @(
        "1. Review 'duplicateGroups' for all settings that appear in multiple policies."
        "2. CONSISTENT duplicates (isConflict=false) can be safely consolidated."
        "3. CONFLICT duplicates (isConflict=true) have different enabled/disabled states - manual review required."
        "4. Check 'policyOverlap' for policy pairs that share the most settings - these are merge candidates."
        "5. Policies with canAutoMerge=true can be combined without risk of configuration change."
        "6. Use Mode=Migrate with a curated mapping.json to consolidate settings into fewer policies."
      )
    }
  }

  $report | ConvertTo-Json -Depth 40 | Out-File -FilePath $OutFile -Encoding utf8
  Write-Log -Level "INFO" -Message "Duplicate report written: $OutFile" -LogPath $LogPath

  # Also write a human-readable summary to a companion text file
  $txtFile = [System.IO.Path]::ChangeExtension($OutFile, ".txt")
  $lines = @()
  $lines += "=" * 80
  $lines += "DUPLICATE SETTINGS ANALYSIS REPORT"
  $lines += "Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
  $lines += "=" * 80
  $lines += ""
  $lines += "SUMMARY"
  $lines += "-" * 40
  $lines += "Total Policies:           $($summary.totalPolicies)"
  $lines += "Total Settings:           $($summary.totalSettings)"
  $lines += "Duplicate Groups:         $($summary.duplicateGroups)"
  $lines += "  - Consistent:           $($summary.consistentDuplicates)"
  $lines += "  - Conflicts:            $($summary.conflicts)"
  $lines += ""

  if ($duplicates.Count -gt 0) {
    $lines += "DUPLICATE SETTINGS DETAIL"
    $lines += "-" * 40
    foreach ($dup in $duplicates) {
      $status = if ($dup.isConflict) { "[CONFLICT]" } else { "[CONSISTENT]" }
      $lines += ""
      $lines += "$status $($dup.settingName)"
      $lines += "  Found in $($dup.occurrenceCount) policies:"
      foreach ($pol in $dup.policies) {
        $lines += "    - $($pol.policyName) (State: $($pol.configuredState))"
      }
      $lines += "  Recommendation: $($dup.recommendation)"
    }
    $lines += ""
  }

  if ($mergeCandidates.Count -gt 0) {
    $lines += "MERGE CANDIDATES (Policy Pairs with Shared Settings)"
    $lines += "-" * 40
    foreach ($mc in $mergeCandidates) {
      $mergeStatus = if ($mc.canAutoMerge) { "[SAFE TO MERGE]" } else { "[REVIEW NEEDED]" }
      $lines += ""
      $lines += "$mergeStatus"
      $lines += "  Policy A: $($mc.policy1Name)"
      $lines += "  Policy B: $($mc.policy2Name)"
      $lines += "  Shared Settings: $($mc.sharedSettingsCount)"
      $lines += "  Conflicts: $($mc.conflictCount)"
      $lines += "  Shared: $($mc.sharedSettings -join ', ')"
    }
  }

  $lines += ""
  $lines += "=" * 80
  $lines += "END OF REPORT"
  $lines += "=" * 80

  $lines -join "`n" | Out-File -FilePath $txtFile -Encoding utf8
  Write-Log -Level "INFO" -Message "Human-readable duplicate report written: $txtFile" -LogPath $LogPath

  return $report
}

Export-ModuleMember -Function Find-MkDuplicateSettings, Export-MkDuplicateReport
