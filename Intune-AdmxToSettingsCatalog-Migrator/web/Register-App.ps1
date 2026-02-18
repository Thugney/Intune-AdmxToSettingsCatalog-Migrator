<#
.SYNOPSIS
    One-time setup: registers the Entra ID app for the ADMX Migrator web tool.

.DESCRIPTION
    Creates a multi-tenant app registration with the required SPA redirect URI
    and delegated Graph permissions. Run this once, then paste the Client ID
    into the web app setup screen.

.PARAMETER RedirectUri
    The SPA redirect URI. Defaults to http://localhost:8080/web/
#>
param(
    [string]$RedirectUri = 'http://localhost:8080/web/'
)

$ErrorActionPreference = 'Stop'

# Ensure Microsoft.Graph.Applications module is available
if (-not (Get-Module -ListAvailable -Name Microsoft.Graph.Applications)) {
    Write-Host "Installing Microsoft.Graph.Applications module..." -ForegroundColor Yellow
    Install-Module Microsoft.Graph.Applications -Scope CurrentUser -Force
}

Write-Host "`n=== ADMX Migrator - App Registration Setup ===" -ForegroundColor Cyan
Write-Host "Redirect URI: $RedirectUri`n"

# Connect with permission to create apps
Connect-MgGraph -Scopes 'Application.ReadWrite.All' -NoWelcome

# Microsoft Graph resource ID
$graphId = '00000003-0000-0000-c000-000000000000'

# Required delegated permissions
$permissions = @(
    @{ Id = '9241abd9-d0e6-425a-bd4f-47ba86e767a4'; Type = 'Scope' }  # DeviceManagementConfiguration.ReadWrite.All
    @{ Id = '5f8c59db-677d-491f-a6b8-5f174b11ec1d'; Type = 'Scope' }  # Group.Read.All
    @{ Id = 'e330c4f0-4571-4d01-8d09-f20692995c2b'; Type = 'Scope' }  # DeviceManagementRBAC.ReadWrite.All
)

$requiredAccess = @{
    ResourceAppId  = $graphId
    ResourceAccess = $permissions
}

# Create the app registration
$app = New-MgApplication `
    -DisplayName 'ADMX to Settings Catalog Migrator' `
    -SignInAudience 'AzureADMultipleOrgs' `
    -Spa @{ RedirectUris = @($RedirectUri) } `
    -RequiredResourceAccess @($requiredAccess)

$clientId = $app.AppId

Write-Host "`nApp registered successfully!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Client ID:  $clientId" -ForegroundColor White
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "`nPaste this Client ID into the web app setup screen." -ForegroundColor Yellow
Write-Host "You only need to do this once.`n"

# Copy to clipboard if possible
try {
    $clientId | Set-Clipboard
    Write-Host "(Copied to clipboard)" -ForegroundColor DarkGray
} catch {}
