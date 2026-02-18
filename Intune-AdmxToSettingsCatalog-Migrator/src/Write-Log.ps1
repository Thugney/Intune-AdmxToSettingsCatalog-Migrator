function Write-Log {
  <#
  .SYNOPSIS
    Writes a timestamped, leveled log entry to file and console.
  .DESCRIPTION
    Appends structured log lines to the specified log file. Supports INFO, WARN, ERROR,
    and DEBUG levels. Automatically rotates the log file when it exceeds the size limit.
    ERROR-level messages are also written to the error stream for visibility.
  #>
  [CmdletBinding()]
  param(
    [Parameter(Mandatory=$true)][ValidateSet("INFO","WARN","ERROR","DEBUG")] [string]$Level,
    [Parameter(Mandatory=$true)][string]$Message,
    [Parameter(Mandatory=$true)][string]$LogPath
  )

  # Ensure the log directory exists
  $logDir = Split-Path -Path $LogPath -Parent
  if ($logDir -and -not (Test-Path $logDir)) {
    New-Item -Path $logDir -ItemType Directory -Force | Out-Null
  }

  # Rotate if log exceeds 10 MB
  if (Test-Path $LogPath) {
    $logFile = Get-Item $LogPath
    if ($logFile.Length -gt 10MB) {
      $rotatedName = "$LogPath.$(Get-Date -Format 'yyyyMMdd-HHmmss').bak"
      Move-Item -Path $LogPath -Destination $rotatedName -Force
    }
  }

  $ts = (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd HH:mm:ss.fff") + "Z"
  $line = "$ts [$Level] $Message"
  Add-Content -Path $LogPath -Value $line -Encoding utf8

  switch ($Level) {
    "ERROR" { Write-Error $Message }
    "WARN"  { Write-Warning $Message }
    "DEBUG" { Write-Verbose $Message }
    default { Write-Host $line }
  }
}

function Resolve-PathSafe {
  <#
  .SYNOPSIS
    Resolves a path that may be relative (to a base directory) or absolute.
  #>
  [CmdletBinding()]
  param(
    [Parameter(Mandatory=$true)][string]$Path,
    [Parameter(Mandatory=$true)][string]$BasePath
  )
  if ([System.IO.Path]::IsPathRooted($Path)) { return $Path }
  return (Join-Path $BasePath $Path)
}
