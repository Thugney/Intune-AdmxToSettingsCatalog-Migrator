function Write-Log {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory=$true)][ValidateSet("INFO","WARN","ERROR","DEBUG")] [string]$Level,
    [Parameter(Mandatory=$true)][string]$Message,
    [Parameter(Mandatory=$true)][string]$LogPath
  )
  $ts = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss.fff")
  $line = "$ts [$Level] $Message"
  Add-Content -Path $LogPath -Value $line
  if ($Level -eq "ERROR") { Write-Error $Message } else { Write-Host $line }
}

function Resolve-PathSafe {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory=$true)][string]$Path,
    [Parameter(Mandatory=$true)][string]$BasePath
  )
  if ([System.IO.Path]::IsPathRooted($Path)) { return $Path }
  return (Join-Path $BasePath $Path)
}
