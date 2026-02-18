# MkIntuneAdmx.psm1
# Exports Administrative Templates (ADMX / groupPolicyConfigurations) from Intune.
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Export-MkAdmxPolicies {
  <#
  .SYNOPSIS
    Exports all ADMX policies with their assignments and definition values.
  .DESCRIPTION
    Fetches groupPolicyConfigurations from Microsoft Graph and, for each policy,
    retrieves assignments and definitionValues. Failures on individual sub-resources
    are logged as warnings (not silently swallowed) so the admin is aware of partial data.
  #>
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

  if (-not $policies -or $policies.Count -eq 0) {
    Write-Log -Level "WARN" -Message "No ADMX policies found in tenant." -LogPath $LogPath
    @() | ConvertTo-Json -Depth 5 | Out-File -FilePath $OutFile -Encoding utf8
    return
  }

  $export = @()
  $warningCount = 0
  foreach ($p in $policies) {
    $pid = $p.id
    Write-Log -Level "INFO" -Message "Export policy: $($p.displayName) ($pid)" -LogPath $LogPath

    $assignments = @()
    try {
      $assignments = Get-MkGraphPaged -Token $Token -Uri "$base/groupPolicyConfigurations/$pid/assignments"
    }
    catch {
      $warningCount++
      Write-Log -Level "WARN" -Message "Failed to retrieve assignments for policy $($p.displayName) ($pid): $($_.Exception.Message)" -LogPath $LogPath
      $assignments = @()
    }

    $defValues = @()
    try {
      $defValues = Get-MkGraphPaged -Token $Token -Uri "$base/groupPolicyConfigurations/$pid/definitionValues"
    }
    catch {
      $warningCount++
      Write-Log -Level "WARN" -Message "Failed to retrieve definitionValues for policy $($p.displayName) ($pid): $($_.Exception.Message)" -LogPath $LogPath
      $defValues = @()
    }

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

  if ($warningCount -gt 0) {
    Write-Log -Level "WARN" -Message "Export completed with $warningCount warning(s). Some assignments or settings may be missing. Review the log for details." -LogPath $LogPath
  }
}

Export-ModuleMember -Function Export-MkAdmxPolicies
