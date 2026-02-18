# MkGraph.psm1
# Microsoft Graph API authentication and request utilities.
# Supports: ClientSecret, Certificate (JWT assertion), Interactive (device code flow).
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function New-MkJwtAssertion {
  <#
  .SYNOPSIS
    Builds a signed JWT client assertion for certificate-based auth (RFC 7523).
  .DESCRIPTION
    Creates a JWT signed with the certificate's private key for use in the
    client_credentials grant with client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer.
  #>
  [CmdletBinding()]
  param(
    [Parameter(Mandatory=$true)][string]$TenantId,
    [Parameter(Mandatory=$true)][string]$ClientId,
    [Parameter(Mandatory=$true)][System.Security.Cryptography.X509Certificates.X509Certificate2]$Certificate
  )

  # JWT header
  $thumbprint = $Certificate.GetCertHash()
  $x5t = [Convert]::ToBase64String($thumbprint).TrimEnd('=').Replace('+','-').Replace('/','_')

  $header = @{
    alg = "RS256"
    typ = "JWT"
    x5t = $x5t
  } | ConvertTo-Json -Compress

  # JWT payload - token endpoint as audience
  $now = [int]([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())
  $payload = @{
    aud = "https://login.microsoftonline.com/$TenantId/oauth2/v2.0/token"
    iss = $ClientId
    sub = $ClientId
    jti = [guid]::NewGuid().ToString()
    nbf = $now
    exp = ($now + 600)  # 10 minute validity
  } | ConvertTo-Json -Compress

  # Base64url encode
  $headerB64  = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($header)).TrimEnd('=').Replace('+','-').Replace('/','_')
  $payloadB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($payload)).TrimEnd('=').Replace('+','-').Replace('/','_')

  $dataToSign = "$headerB64.$payloadB64"
  $bytesToSign = [Text.Encoding]::UTF8.GetBytes($dataToSign)

  # Sign with RSA-SHA256
  $rsa = $Certificate.GetRSAPrivateKey()
  if (-not $rsa) { throw "Certificate does not contain a private key or the private key is not accessible." }
  $sigBytes = $rsa.SignData($bytesToSign, [Security.Cryptography.HashAlgorithmName]::SHA256, [Security.Cryptography.RSASignaturePadding]::Pkcs1)
  $sigB64 = [Convert]::ToBase64String($sigBytes).TrimEnd('=').Replace('+','-').Replace('/','_')

  return "$dataToSign.$sigB64"
}

function Get-MkGraphToken {
  <#
  .SYNOPSIS
    Acquires a Microsoft Graph access token.
  .DESCRIPTION
    Supports three authentication methods:
    - ClientSecret: App-only client credentials with a secret
    - Certificate: App-only client credentials with a certificate (JWT assertion)
    - Interactive: Delegated permissions via device code flow (user signs in via browser)
  #>
  [CmdletBinding()]
  param(
    [Parameter(Mandatory=$true)][string]$TenantId,
    [Parameter(Mandatory=$true)][string]$ClientId,
    [Parameter(Mandatory=$true)]$Auth,
    [Parameter(Mandatory=$true)][string]$LogPath
  )

  $tokenEndpoint = "https://login.microsoftonline.com/$TenantId/oauth2/v2.0/token"

  try {
    switch ($Auth.Type) {
      "ClientSecret" {
        if ([string]::IsNullOrWhiteSpace($Auth.ClientSecret)) { throw "Auth.ClientSecret is empty." }

        Write-Log -Level "INFO" -Message "Requesting app-only token (client_credentials + secret)" -LogPath $LogPath
        $body = @{
          client_id     = $ClientId
          scope         = "https://graph.microsoft.com/.default"
          grant_type    = "client_credentials"
          client_secret = $Auth.ClientSecret
        }
        $resp = Invoke-RestMethod -Method Post -Uri $tokenEndpoint -Body $body -ContentType "application/x-www-form-urlencoded"
        return $resp.access_token
      }

      "Certificate" {
        # Locate the certificate by thumbprint from the local certificate store
        $thumbprint = $Auth.CertificateThumbprint
        if ([string]::IsNullOrWhiteSpace($thumbprint)) { throw "Auth.CertificateThumbprint is empty." }

        Write-Log -Level "INFO" -Message "Locating certificate with thumbprint $thumbprint" -LogPath $LogPath

        # Search CurrentUser then LocalMachine stores
        $cert = $null
        foreach ($storeLocation in @([System.Security.Cryptography.X509Certificates.StoreLocation]::CurrentUser, [System.Security.Cryptography.X509Certificates.StoreLocation]::LocalMachine)) {
          $store = [System.Security.Cryptography.X509Certificates.X509Store]::new([System.Security.Cryptography.X509Certificates.StoreName]::My, $storeLocation)
          try {
            $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadOnly)
            $found = $store.Certificates.Find([System.Security.Cryptography.X509Certificates.X509FindType]::FindByThumbprint, $thumbprint, $false)
            if ($found.Count -gt 0) {
              $cert = $found[0]
              Write-Log -Level "INFO" -Message "Certificate found in $storeLocation\My" -LogPath $LogPath
              break
            }
          }
          finally { $store.Close() }
        }

        # Also allow a PFX file path via Auth.CertificatePath
        if (-not $cert -and $Auth.PSObject.Properties.Name -contains "CertificatePath" -and -not [string]::IsNullOrWhiteSpace($Auth.CertificatePath)) {
          if (-not (Test-Path $Auth.CertificatePath)) { throw "Certificate file not found: $($Auth.CertificatePath)" }
          $pfxPassword = $null
          if ($Auth.PSObject.Properties.Name -contains "CertificatePassword" -and -not [string]::IsNullOrWhiteSpace($Auth.CertificatePassword)) {
            $pfxPassword = ConvertTo-SecureString -String $Auth.CertificatePassword -AsPlainText -Force
          }
          $cert = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($Auth.CertificatePath, $pfxPassword, [System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]::MachineKeySet)
          Write-Log -Level "INFO" -Message "Certificate loaded from file: $($Auth.CertificatePath)" -LogPath $LogPath
        }

        if (-not $cert) { throw "Certificate with thumbprint '$thumbprint' not found in CurrentUser or LocalMachine stores, and no CertificatePath provided." }

        Write-Log -Level "INFO" -Message "Requesting app-only token (client_credentials + certificate JWT assertion)" -LogPath $LogPath
        $assertion = New-MkJwtAssertion -TenantId $TenantId -ClientId $ClientId -Certificate $cert

        $body = @{
          client_id             = $ClientId
          scope                 = "https://graph.microsoft.com/.default"
          grant_type            = "client_credentials"
          client_assertion_type = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer"
          client_assertion      = $assertion
        }
        $resp = Invoke-RestMethod -Method Post -Uri $tokenEndpoint -Body $body -ContentType "application/x-www-form-urlencoded"
        return $resp.access_token
      }

      "Interactive" {
        # Device code flow: user authenticates in a browser
        Write-Log -Level "INFO" -Message "Starting interactive authentication (device code flow)" -LogPath $LogPath

        $deviceCodeEndpoint = "https://login.microsoftonline.com/$TenantId/oauth2/v2.0/devicecode"
        $dcBody = @{
          client_id = $ClientId
          scope     = "https://graph.microsoft.com/DeviceManagementConfiguration.ReadWrite.All offline_access"
        }
        $dcResp = Invoke-RestMethod -Method Post -Uri $deviceCodeEndpoint -Body $dcBody -ContentType "application/x-www-form-urlencoded"

        # Display the device code instructions to the user
        Write-Host ""
        Write-Host "============================================================" -ForegroundColor Cyan
        Write-Host "  INTERACTIVE LOGIN REQUIRED" -ForegroundColor Yellow
        Write-Host "============================================================" -ForegroundColor Cyan
        Write-Host "  To sign in, open a browser and go to:" -ForegroundColor White
        Write-Host "  $($dcResp.verification_uri)" -ForegroundColor Green
        Write-Host ""
        Write-Host "  Enter the code: $($dcResp.user_code)" -ForegroundColor Green
        Write-Host "============================================================" -ForegroundColor Cyan
        Write-Host ""
        Write-Log -Level "INFO" -Message "Device code: $($dcResp.user_code) - Waiting for user authentication..." -LogPath $LogPath

        $interval = if ($dcResp.interval) { $dcResp.interval } else { 5 }
        $expiresIn = if ($dcResp.expires_in) { $dcResp.expires_in } else { 900 }
        $deadline = (Get-Date).AddSeconds($expiresIn)

        while ((Get-Date) -lt $deadline) {
          Start-Sleep -Seconds $interval

          try {
            $tokenBody = @{
              client_id   = $ClientId
              grant_type  = "urn:ietf:params:oauth:grant-type:device_code"
              device_code = $dcResp.device_code
            }
            $tokenResp = Invoke-RestMethod -Method Post -Uri $tokenEndpoint -Body $tokenBody -ContentType "application/x-www-form-urlencoded"
            Write-Log -Level "INFO" -Message "Interactive authentication successful." -LogPath $LogPath
            Write-Host "Authentication successful." -ForegroundColor Green
            return $tokenResp.access_token
          }
          catch {
            $errBody = $_.ErrorDetails.Message
            if ($errBody -match "authorization_pending") {
              # User hasn't completed login yet, keep polling
              continue
            }
            elseif ($errBody -match "slow_down") {
              $interval += 5
              continue
            }
            elseif ($errBody -match "expired_token") {
              throw "Device code expired. Please re-run the command and complete sign-in within the time limit."
            }
            else {
              throw
            }
          }
        }

        throw "Device code flow timed out after $expiresIn seconds. Please try again."
      }

      default {
        throw "Unsupported Auth.Type: '$($Auth.Type)'. Supported values: ClientSecret, Certificate, Interactive"
      }
    }
  }
  catch {
    Write-Log -Level "ERROR" -Message ("Token acquisition failed: " + $_.Exception.Message) -LogPath $LogPath
    throw
  }
}

function Invoke-MkGraphRequest {
  <#
  .SYNOPSIS
    Makes an authenticated request to the Microsoft Graph API with retry logic.
  #>
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

  # Retry logic for throttling (429) and transient server errors (500, 502, 503, 504)
  $maxRetries  = 4
  $retryDelay  = 2

  for ($attempt = 1; $attempt -le $maxRetries; $attempt++) {
    try {
      if ($Method -in @("POST","PUT","PATCH")) {
        $json = $null
        if ($null -ne $Body) { $json = ($Body | ConvertTo-Json -Depth 30) }
        return Invoke-RestMethod -Method $Method -Uri $Uri -Headers $h -ContentType "application/json" -Body $json
      } else {
        return Invoke-RestMethod -Method $Method -Uri $Uri -Headers $h
      }
    }
    catch {
      $statusCode = $null
      if ($_.Exception.Response) { $statusCode = [int]$_.Exception.Response.StatusCode }

      $isRetryable = ($statusCode -eq 429) -or ($statusCode -in @(500, 502, 503, 504))

      if ($isRetryable -and $attempt -lt $maxRetries) {
        # Use Retry-After header if present for 429, otherwise exponential backoff
        $waitSec = $retryDelay * [Math]::Pow(2, $attempt - 1)
        if ($statusCode -eq 429 -and $_.Exception.Response.Headers) {
          try {
            $retryAfter = $_.Exception.Response.Headers | Where-Object { $_.Key -eq "Retry-After" } | Select-Object -ExpandProperty Value -First 1
            if ($retryAfter) { $waitSec = [int]$retryAfter }
          } catch { }
        }
        Write-Warning "Graph API returned $statusCode on attempt $attempt/$maxRetries. Retrying in ${waitSec}s..."
        Start-Sleep -Seconds $waitSec
        continue
      }

      throw
    }
  }
}

function Get-MkGraphPaged {
  <#
  .SYNOPSIS
    Retrieves all pages of a Microsoft Graph API collection endpoint.
  #>
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
