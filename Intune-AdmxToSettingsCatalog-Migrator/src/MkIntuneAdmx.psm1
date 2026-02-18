# MkIntuneAdmx.psm1
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Export-MkAdmxPolicies {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory=$true)][string]$Token,
    [Parameter(Mandatory=$true)][ValidateSet("beta","v1.0")] [string]$ApiVersion,
    [Parameter(Mandatory=$true)][string]$OutFile,
    [Parameter(Mandatory=$true)][string]$LogPath
  )

  $base = "https://graph.microsoft.com/$ApiVersion/deviceManagement"

  Write-Log -Level "INFO" -Message "Exporting ADMX policies from $base/groupPolicyConfigurations" -LogPath $LogPath

  $policies = Get-MkGraphPaged -Token $Token -Uri "$base/groupPolicyConfigurations"

  $export = @()
  foreach ($p in $policies) {
    $pid = $p.id
    Write-Log -Level "INFO" -Message "Export policy: $($p.displayName) ($pid)" -LogPath $LogPath

    $assignments = @()
    try { $assignments = Get-MkGraphPaged -Token $Token -Uri "$base/groupPolicyConfigurations/$pid/assignments" } catch { $assignments = @() }

    $defValues = @()
    try { $defValues = Get-MkGraphPaged -Token $Token -Uri "$base/groupPolicyConfigurations/$pid/definitionValues" } catch { $defValues = @() }

    $export += [pscustomobject]@{
      id = $pid
      displayName = $p.displayName
      description = $p.description
      lastModifiedDateTime = $p.lastModifiedDateTime
      assignments = $assignments
      definitionValues = $defValues
      raw = $p
    }
  }

  $export | ConvertTo-Json -Depth 40 | Out-File -FilePath $OutFile -Encoding utf8
  Write-Log -Level "INFO" -Message "Export written: $OutFile policies=$($export.Count)" -LogPath $LogPath
}

Export-ModuleMember -Function Export-MkAdmxPolicies
