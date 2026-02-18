# MkMigration.psm1
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Build-MkMappingSuggestions {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory=$true)][string]$Token,
    [Parameter(Mandatory=$true)][ValidateSet("beta","v1.0")] [string]$ApiVersion,
    [Parameter(Mandatory=$true)][string]$ExportFile,
    [Parameter(Mandatory=$true)][string]$OutFile,
    [Parameter(Mandatory=$true)][string]$LogPath
  )

  $data = Get-Content $ExportFile -Raw | ConvertFrom-Json
  $suggestions = @()

  foreach ($p in $data) {
    foreach ($dv in $p.definitionValues) {
      # Best-effort keys - definitionValues payload varies; we preserve raw and try to infer.
      $defId = $dv.id
      $dn = $dv.displayName
      if (-not $dn -and $dv.definition -and $dv.definition.displayName) { $dn = $dv.definition.displayName }
      if (-not $dn) { $dn = "definitionValue:$defId" }

      $q = $dn.Replace('"','')
      $cands = Search-MkSettingsCatalogSettings -Token $Token -ApiVersion $ApiVersion -Query $q

      $top = @()
      foreach ($c in ($cands | Select-Object -First 5)) {
        $top += [pscustomobject]@{
          settingDefinitionId = $c.id
          displayName = $c.displayName
          description = $c.description
        }
      }

      $suggestions += [pscustomobject]@{
        sourcePolicyId = $p.id
        sourcePolicyName = $p.displayName
        sourceDefinitionValueId = $defId
        sourceSettingName = $dn
        candidates = $top
        recommended = ($top | Select-Object -First 1)
      }
    }
  }

  $obj = [pscustomobject]@{
    generatedAt = (Get-Date).ToString("o")
    notes = "Create output\\mapping.json with deterministic mappings. Each entry maps sourceDefinitionValueId -> settingDefinitionId and a value payload."
    suggestions = $suggestions
  }

  $obj | ConvertTo-Json -Depth 40 | Out-File -FilePath $OutFile -Encoding utf8
  Write-Log -Level "INFO" -Message "Mapping suggestions written: $OutFile" -LogPath $LogPath
}

function Convert-MkAssignmentAdmxToSettingsCatalog {
  param([object]$a)
  # Attempts to preserve group targets + filters if present.
  # Settings Catalog uses deviceManagementConfigurationPolicyAssignment.
  $target = $a.target
  $out = @{
    target = $target
  }
  if ($a -and $a.deviceAndAppManagementAssignmentFilterId) { $out.deviceAndAppManagementAssignmentFilterId = $a.deviceAndAppManagementAssignmentFilterId }
  if ($a -and $a.deviceAndAppManagementAssignmentFilterType) { $out.deviceAndAppManagementAssignmentFilterType = $a.deviceAndAppManagementAssignmentFilterType }
  return $out
}

function Build-MkSettingsPayloadFromMapping {
  param(
    [Parameter(Mandatory=$true)][object]$mapEntry
  )

  # This matches the format used by Microsoft Graph Intune samples:
  # deviceManagementConfigurationSetting with settingInstance.
  # Caller must provide correct @odata.type and value shape in mapping.json.
  return $mapEntry.settingPayload
}

function Invoke-MkMigration {
  [CmdletBinding(SupportsShouldProcess=$true)]
  param(
    [Parameter(Mandatory=$true)][string]$Token,
    [Parameter(Mandatory=$true)][ValidateSet("beta","v1.0")] [string]$ApiVersion,
    [Parameter(Mandatory=$true)][string]$ExportFile,
    [Parameter(Mandatory=$true)][string]$MappingFile,
    [Parameter(Mandatory=$true)][string]$TargetNamePrefix,
    [Parameter(Mandatory=$true)][string]$SourceMarkerKey,
    [Parameter(Mandatory=$true)][bool]$SkipUnmapped,
    [Parameter(Mandatory=$true)][string]$OutManifest,
    [Parameter(Mandatory=$true)][string]$LogPath
  )

  $export = Get-Content $ExportFile -Raw | ConvertFrom-Json
  $mapping = Get-Content $MappingFile -Raw | ConvertFrom-Json

  # mapping.entries: array with sourcePolicyId, sourceDefinitionValueId, targetSettingDefinitionId, settingPayload
  $mapIndex = @{}
  foreach ($e in $mapping.entries) {
    $key = "$($e.sourcePolicyId)|$($e.sourceDefinitionValueId)"
    $mapIndex[$key] = $e
  }

  $manifest = [ordered]@{
    generatedAt = (Get-Date).ToString("o")
    createdPolicies = @()
    skipped = @()
  }

  foreach ($p in $export) {
    $sourceId = $p.id
    $targetName = "$TargetNamePrefix$($p.displayName)"
    $marker = "$SourceMarkerKey=$sourceId"
    $desc = ($p.description + "`n" + $marker).Trim()

    # Idempotency: reuse existing policy with marker
    $existing = Get-MkSettingsCatalogPolicyByMarker -Token $Token -ApiVersion $ApiVersion -MarkerKey $SourceMarkerKey -SourceId $sourceId
    if ($existing) {
      Write-Log -Level "INFO" -Message "Found existing Settings Catalog policy for source=$sourceId -> $($existing.name) ($($existing.id))" -LogPath $LogPath
      $targetPolicy = $existing
    } else {
      if ($PSCmdlet.ShouldProcess($targetName, "Create Settings Catalog policy")) {
        Write-Log -Level "INFO" -Message "Creating Settings Catalog policy: $targetName" -LogPath $LogPath
        $targetPolicy = New-MkSettingsCatalogPolicy -Token $Token -ApiVersion $ApiVersion -DisplayName $targetName -Description $desc -Platform "windows10" -Technologies "mdm"
        $manifest.createdPolicies += [pscustomobject]@{ sourcePolicyId=$sourceId; targetPolicyId=$targetPolicy.id; targetName=$targetPolicy.name }
      } else {
        Write-Log -Level "INFO" -Message "WhatIf: would create policy $targetName" -LogPath $LogPath
        continue
      }
    }

    # Build settings payload from mapping entries for this policy
    $settingsToAdd = @()
    foreach ($dv in $p.definitionValues) {
      $key = "$sourceId|$($dv.id)"
      if ($mapIndex.ContainsKey($key)) {
        $settingsToAdd += (Build-MkSettingsPayloadFromMapping -mapEntry $mapIndex[$key])
      } else {
        $manifest.skipped += [pscustomobject]@{ sourcePolicyId=$sourceId; sourceDefinitionValueId=$dv.id; reason="unmapped" }
        if (-not $SkipUnmapped) { throw "Unmapped setting in policy=$($p.displayName) definitionValueId=$($dv.id)" }
      }
    }

    if ($settingsToAdd.Count -gt 0) {
      if ($PSCmdlet.ShouldProcess($targetPolicy.id, "Add $($settingsToAdd.Count) settings")) {
        Write-Log -Level "INFO" -Message "Adding $($settingsToAdd.Count) settings to $($targetPolicy.id)" -LogPath $LogPath
        Add-MkSettingsCatalogSettings -Token $Token -ApiVersion $ApiVersion -PolicyId $targetPolicy.id -Settings $settingsToAdd
      } else {
        Write-Log -Level "INFO" -Message "WhatIf: would add $($settingsToAdd.Count) settings to $($targetPolicy.id)" -LogPath $LogPath
      }
    }

    # Assignments
    $assign = @()
    foreach ($a in ($p.assignments | Where-Object { $_ -and $_.target })) {
      $assign += (Convert-MkAssignmentAdmxToSettingsCatalog -a $a)
    }

    if ($assign.Count -gt 0) {
      if ($PSCmdlet.ShouldProcess($targetPolicy.id, "Assign policy to $($assign.Count) targets")) {
        Write-Log -Level "INFO" -Message "Assigning policy $($targetPolicy.id) to $($assign.Count) targets" -LogPath $LogPath
        Assign-MkSettingsCatalogPolicy -Token $Token -ApiVersion $ApiVersion -PolicyId $targetPolicy.id -Assignments $assign
      } else {
        Write-Log -Level "INFO" -Message "WhatIf: would assign policy $($targetPolicy.id) to $($assign.Count) targets" -LogPath $LogPath
      }
    }
  }

  $manifest | ConvertTo-Json -Depth 40 | Out-File -FilePath $OutManifest -Encoding utf8
  Write-Log -Level "INFO" -Message "Migration manifest written: $OutManifest" -LogPath $LogPath
}

function Invoke-MkRollback {
  [CmdletBinding(SupportsShouldProcess=$true)]
  param(
    [Parameter(Mandatory=$true)][string]$Token,
    [Parameter(Mandatory=$true)][ValidateSet("beta","v1.0")] [string]$ApiVersion,
    [Parameter(Mandatory=$true)][string]$ManifestFile,
    [Parameter(Mandatory=$true)][string]$LogPath
  )

  $m = Get-Content $ManifestFile -Raw | ConvertFrom-Json
  foreach ($cp in $m.createdPolicies) {
    $id = $cp.targetPolicyId
    if ($PSCmdlet.ShouldProcess($id, "Delete Settings Catalog policy")) {
      Write-Log -Level "WARN" -Message "Deleting policy created by tool: $($cp.targetName) ($id)" -LogPath $LogPath
      Remove-MkSettingsCatalogPolicy -Token $Token -ApiVersion $ApiVersion -PolicyId $id
    } else {
      Write-Log -Level "INFO" -Message "WhatIf: would delete $($cp.targetName) ($id)" -LogPath $LogPath
    }
  }
}

Export-ModuleMember -Function Build-MkMappingSuggestions, Invoke-MkMigration, Invoke-MkRollback
