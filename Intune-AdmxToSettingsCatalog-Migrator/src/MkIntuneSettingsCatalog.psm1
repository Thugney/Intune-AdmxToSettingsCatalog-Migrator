# MkIntuneSettingsCatalog.psm1
# Settings Catalog (configurationPolicies) operations for Intune.
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Search-MkSettingsCatalogSettings {
  <#
  .SYNOPSIS
    Searches the Settings Catalog for settings matching a query string.
  .DESCRIPTION
    Uses the $search query parameter which requires the ConsistencyLevel=eventual header.
    Returns matching settings or an empty array. Failures are logged rather than silently swallowed.
  #>
  [CmdletBinding()]
  param(
    [Parameter(Mandatory=$true)][string]$Token,
    [Parameter(Mandatory=$true)][ValidateSet("beta","v1.0")] [string]$ApiVersion,
    [Parameter(Mandatory=$true)][string]$Query,
    [Parameter()][string]$LogPath
  )

  $base = "https://graph.microsoft.com/$ApiVersion/deviceManagement"
  $uri = "$base/configurationSettings?`$search=""$Query"""
  $headers = @{ "ConsistencyLevel" = "eventual" }
  try {
    $resp = Invoke-MkGraphRequest -Token $Token -Method GET -Uri $uri -Headers $headers
    return $resp.value
  } catch {
    $msg = "Settings Catalog search failed for query '$Query': $($_.Exception.Message)"
    if ($LogPath) { Write-Log -Level "WARN" -Message $msg -LogPath $LogPath }
    else { Write-Warning $msg }
    return @()
  }
}

function Get-MkSettingsCatalogPolicyByMarker {
  <#
  .SYNOPSIS
    Finds an existing Settings Catalog policy that contains the source marker in its description.
  .DESCRIPTION
    Used for idempotency: checks if a policy was already created by this tool for a given source policy ID.
  #>
  [CmdletBinding()]
  param(
    [Parameter(Mandatory=$true)][string]$Token,
    [Parameter(Mandatory=$true)][ValidateSet("beta","v1.0")] [string]$ApiVersion,
    [Parameter(Mandatory=$true)][string]$MarkerKey,
    [Parameter(Mandatory=$true)][string]$SourceId
  )
  $base = "https://graph.microsoft.com/$ApiVersion/deviceManagement"
  $pols = Get-MkGraphPaged -Token $Token -Uri "$base/configurationPolicies"
  foreach ($p in $pols) {
    if ($p.description -and $p.description -match [regex]::Escape($MarkerKey) -and $p.description -match [regex]::Escape($SourceId)) {
      return $p
    }
  }
  return $null
}

function New-MkSettingsCatalogPolicy {
  <#
  .SYNOPSIS
    Creates a new Settings Catalog policy in Intune.
  #>
  [CmdletBinding()]
  param(
    [Parameter(Mandatory=$true)][string]$Token,
    [Parameter(Mandatory=$true)][ValidateSet("beta","v1.0")] [string]$ApiVersion,
    [Parameter(Mandatory=$true)][string]$DisplayName,
    [Parameter()][string]$Description,
    [Parameter(Mandatory=$true)][string]$Platform,
    [Parameter()][string]$Technologies = "mdm"
  )

  if ([string]::IsNullOrWhiteSpace($DisplayName)) { throw "DisplayName cannot be empty when creating a Settings Catalog policy." }

  $base = "https://graph.microsoft.com/$ApiVersion/deviceManagement"
  $body = @{
    name = $DisplayName
    description = $Description
    platforms = $Platform
    technologies = $Technologies
  }
  return Invoke-MkGraphRequest -Token $Token -Method POST -Uri "$base/configurationPolicies" -Body $body
}

function Add-MkSettingsCatalogSettings {
  <#
  .SYNOPSIS
    Adds one or more settings to an existing Settings Catalog policy.
  #>
  [CmdletBinding()]
  param(
    [Parameter(Mandatory=$true)][string]$Token,
    [Parameter(Mandatory=$true)][ValidateSet("beta","v1.0")] [string]$ApiVersion,
    [Parameter(Mandatory=$true)][string]$PolicyId,
    [Parameter(Mandatory=$true)][array]$Settings
  )

  if ([string]::IsNullOrWhiteSpace($PolicyId)) { throw "PolicyId cannot be empty." }
  if ($Settings.Count -eq 0) { throw "Settings array cannot be empty." }

  $base = "https://graph.microsoft.com/$ApiVersion/deviceManagement"
  foreach ($s in $Settings) {
    Invoke-MkGraphRequest -Token $Token -Method POST -Uri "$base/configurationPolicies/$PolicyId/settings" -Body $s | Out-Null
  }
}

function Assign-MkSettingsCatalogPolicy {
  <#
  .SYNOPSIS
    Applies assignment targets to a Settings Catalog policy.
  #>
  [CmdletBinding()]
  param(
    [Parameter(Mandatory=$true)][string]$Token,
    [Parameter(Mandatory=$true)][ValidateSet("beta","v1.0")] [string]$ApiVersion,
    [Parameter(Mandatory=$true)][string]$PolicyId,
    [Parameter(Mandatory=$true)][array]$Assignments
  )

  if ([string]::IsNullOrWhiteSpace($PolicyId)) { throw "PolicyId cannot be empty." }

  $base = "https://graph.microsoft.com/$ApiVersion/deviceManagement"
  $body = @{ assignments = $Assignments }
  Invoke-MkGraphRequest -Token $Token -Method POST -Uri "$base/configurationPolicies/$PolicyId/assign" -Body $body | Out-Null
}

function Remove-MkSettingsCatalogPolicy {
  <#
  .SYNOPSIS
    Deletes a Settings Catalog policy from Intune.
  #>
  [CmdletBinding()]
  param(
    [Parameter(Mandatory=$true)][string]$Token,
    [Parameter(Mandatory=$true)][ValidateSet("beta","v1.0")] [string]$ApiVersion,
    [Parameter(Mandatory=$true)][string]$PolicyId
  )

  if ([string]::IsNullOrWhiteSpace($PolicyId)) { throw "PolicyId cannot be empty." }

  $base = "https://graph.microsoft.com/$ApiVersion/deviceManagement"
  Invoke-MkGraphRequest -Token $Token -Method DELETE -Uri "$base/configurationPolicies/$PolicyId" | Out-Null
}

Export-ModuleMember -Function Search-MkSettingsCatalogSettings, Get-MkSettingsCatalogPolicyByMarker, New-MkSettingsCatalogPolicy, Add-MkSettingsCatalogSettings, Assign-MkSettingsCatalogPolicy, Remove-MkSettingsCatalogPolicy
