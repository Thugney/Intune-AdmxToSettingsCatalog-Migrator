# MkGraph.psm1
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-MkGraphToken {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory=$true)][string]$TenantId,
    [Parameter(Mandatory=$true)][string]$ClientId,
    [Parameter(Mandatory=$true)]$Auth,
    [Parameter(Mandatory=$true)][string]$LogPath
  )

  try {
    $tokenEndpoint = "https://login.microsoftonline.com/$TenantId/oauth2/v2.0/token"
    $body = @{
      client_id = $ClientId
      scope     = "https://graph.microsoft.com/.default"
      grant_type = "client_credentials"
    }

    if ($Auth.Type -eq "ClientSecret") {
      if ([string]::IsNullOrWhiteSpace($Auth.ClientSecret)) { throw "Auth.ClientSecret is empty" }
      $body.client_secret = $Auth.ClientSecret
    }
    elseif ($Auth.Type -eq "Certificate") {
      throw "Certificate auth not implemented in this minimal version. Use ClientSecret or extend Get-MkGraphToken with JWT assertion."
    }
    else {
      throw "Unsupported Auth.Type: $($Auth.Type)"
    }

    Write-Log -Level "INFO" -Message "Requesting app-only token (client credentials)" -LogPath $LogPath
    $resp = Invoke-RestMethod -Method Post -Uri $tokenEndpoint -Body $body -ContentType "application/x-www-form-urlencoded"
    return $resp.access_token
  }
  catch {
    Write-Log -Level "ERROR" -Message ("Token acquisition failed: " + $_.Exception.Message) -LogPath $LogPath
    throw
  }
}

function Invoke-MkGraphRequest {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory=$true)][string]$Token,
    [Parameter(Mandatory=$true)][ValidateSet("GET","POST","PUT","PATCH","DELETE")] [string]$Method,
    [Parameter(Mandatory=$true)][string]$Uri,
    [Parameter()][object]$Body,
    [Parameter()][hashtable]$Headers
  )

  $h = @{
    Authorization = "Bearer $Token"
  }

  if ($Headers) {
    foreach ($k in $Headers.Keys) { $h[$k] = $Headers[$k] }
  }

  if ($Method -in @("POST","PUT","PATCH")) {
    $json = $null
    if ($null -ne $Body) { $json = ($Body | ConvertTo-Json -Depth 30) }
    return Invoke-RestMethod -Method $Method -Uri $Uri -Headers $h -ContentType "application/json" -Body $json
  } else {
    return Invoke-RestMethod -Method $Method -Uri $Uri -Headers $h
  }
}

function Get-MkGraphPaged {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory=$true)][string]$Token,
    [Parameter(Mandatory=$true)][string]$Uri
  )
  $items = @()
  $next = $Uri
  while ($next) {
    $resp = Invoke-MkGraphRequest -Token $Token -Method GET -Uri $next
    if ($resp.value) { $items += $resp.value }
    $next = $resp.'@odata.nextLink'
  }
  return $items
}

Export-ModuleMember -Function Get-MkGraphToken, Invoke-MkGraphRequest, Get-MkGraphPaged
