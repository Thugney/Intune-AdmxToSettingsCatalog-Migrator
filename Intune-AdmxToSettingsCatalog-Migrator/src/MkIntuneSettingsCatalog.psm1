# MkIntuneSettingsCatalog.psm1
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Search-MkSettingsCatalogSettings {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory=$true)][string]$Token,
    [Parameter(Mandatory=$true)][ValidateSet("beta","v1.0")] [string]$ApiVersion,
    [Parameter(Mandatory=$true)][string]$Query
  )

  # Uses $search which requires ConsistencyLevel header.
  $base = "https://graph.microsoft.com/$ApiVersion/deviceManagement"
  $uri = "$base/configurationSettings?`$search=""$Query"""
  $headers = @{ "ConsistencyLevel" = "eventual" }
  try {
    $resp = Invoke-MkGraphRequest -Token $Token -Method GET -Uri $uri -Headers $headers
    return $resp.value
  } catch {
    # Fallback: return empty if tenant does not allow search
    return @()
  }
}

function Get-MkSettingsCatalogPolicyByMarker {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory=$true)][string]$Token,
    [Parameter(Mandatory=$true)][ValidateSet("beta","v1.0")] [string]$ApiVersion,
    [Parameter(Mandatory=$true)][string]$MarkerKey,
    [Parameter(Mandatory=$true)][string]$SourceId
  )
  $base = "https://graph.microsoft.com/$ApiVersion/deviceManagement"
  # filter on name not reliable; we fetch and match marker in description
  $pols = Get-MkGraphPaged -Token $Token -Uri "$base/configurationPolicies"
  foreach ($p in $pols) {
    if ($p.description -and $p.description -match [regex]::Escape($MarkerKey) -and $p.description -match [regex]::Escape($SourceId)) {
      return $p
    }
  }
  return $null
}

function New-MkSettingsCatalogPolicy {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory=$true)][string]$Token,
    [Parameter(Mandatory=$true)][ValidateSet("beta","v1.0")] [string]$ApiVersion,
    [Parameter(Mandatory=$true)][string]$DisplayName,
    [Parameter()][string]$Description,
    [Parameter(Mandatory=$true)][string]$Platform,  # windows10
    [Parameter()][string]$Technologies = "mdm"
  )

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
  [CmdletBinding()]
  param(
    [Parameter(Mandatory=$true)][string]$Token,
    [Parameter(Mandatory=$true)][ValidateSet("beta","v1.0")] [string]$ApiVersion,
    [Parameter(Mandatory=$true)][string]$PolicyId,
    [Parameter(Mandatory=$true)][array]$Settings # array of deviceManagementConfigurationSetting
  )
  $base = "https://graph.microsoft.com/$ApiVersion/deviceManagement"
  foreach ($s in $Settings) {
    Invoke-MkGraphRequest -Token $Token -Method POST -Uri "$base/configurationPolicies/$PolicyId/settings" -Body $s | Out-Null
  }
}

function Assign-MkSettingsCatalogPolicy {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory=$true)][string]$Token,
    [Parameter(Mandatory=$true)][ValidateSet("beta","v1.0")] [string]$ApiVersion,
    [Parameter(Mandatory=$true)][string]$PolicyId,
    [Parameter(Mandatory=$true)][array]$Assignments
  )
  $base = "https://graph.microsoft.com/$ApiVersion/deviceManagement"
  $body = @{ assignments = $Assignments }
  Invoke-MkGraphRequest -Token $Token -Method POST -Uri "$base/configurationPolicies/$PolicyId/assign" -Body $body | Out-Null
}

function Remove-MkSettingsCatalogPolicy {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory=$true)][string]$Token,
    [Parameter(Mandatory=$true)][ValidateSet("beta","v1.0")] [string]$ApiVersion,
    [Parameter(Mandatory=$true)][string]$PolicyId
  )
  $base = "https://graph.microsoft.com/$ApiVersion/deviceManagement"
  Invoke-MkGraphRequest -Token $Token -Method DELETE -Uri "$base/configurationPolicies/$PolicyId" | Out-Null
}

Export-ModuleMember -Function Search-MkSettingsCatalogSettings, Get-MkSettingsCatalogPolicyByMarker, New-MkSettingsCatalogPolicy, Add-MkSettingsCatalogSettings, Assign-MkSettingsCatalogPolicy, Remove-MkSettingsCatalogPolicy
