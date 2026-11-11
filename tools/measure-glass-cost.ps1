# Compare process RAM and GPU while Liquid Glass is on vs off.
# Usage:
#   1. Open AIR Office (desktop or http://127.0.0.1:5173) on Home with rails visible.
#   2. Leave Liquid Glass & Transparency ON, scroll a little, then run:
#        bunx --bun powershell -File tools/measure-glass-cost.ps1 -Label glass-on
#   3. Turn the switch OFF, wait ~2s, scroll the same way, then run:
#        bunx --bun powershell -File tools/measure-glass-cost.ps1 -Label glass-off
# Compare the two JSON summaries.

param(
  [Parameter(Mandatory = $true)][string]$Label,
  [int]$Seconds = 5
)

function Sum-ProcessBytes([string]$Name, [string]$Property) {
  $procs = Get-Process -Name $Name -ErrorAction SilentlyContinue
  if (-not $procs) { return $null }
  return ($procs | Measure-Object $Property -Sum).Sum
}

$end = [DateTime]::UtcNow.AddSeconds($Seconds)
$gpuSamples = @()
while ([DateTime]::UtcNow -lt $end) {
  try {
    $samples = (Get-Counter '\GPU Engine(*)\Utilization Percentage' -ErrorAction Stop).CounterSamples |
      Where-Object { $_.CookedValue -gt 0 }
    foreach ($sample in $samples) {
      $gpuSamples += [pscustomobject]@{
        instance = $sample.InstanceName
        utilPct = [math]::Round($sample.CookedValue, 2)
      }
    }
  } catch {
    $gpuSamples += [pscustomobject]@{ instance = 'unavailable'; utilPct = 0; error = $_.Exception.Message }
    break
  }
  Start-Sleep -Milliseconds 400
}

$gpuTop = $gpuSamples |
  Group-Object instance |
  ForEach-Object {
    [pscustomobject]@{
      instance = $_.Name
      avgUtilPct = [math]::Round((($_.Group | Measure-Object utilPct -Average).Average), 2)
      maxUtilPct = [math]::Round((($_.Group | Measure-Object utilPct -Maximum).Maximum), 2)
      hits = $_.Count
    }
  } |
  Sort-Object avgUtilPct -Descending |
  Select-Object -First 12

$result = [pscustomobject]@{
  label = $Label
  capturedAt = (Get-Date).ToString('s')
  seconds = $Seconds
  airOffice = [pscustomobject]@{
    workingSetMB = $(
      $n = Sum-ProcessBytes 'AIR Office' 'WorkingSet64'
      if ($null -eq $n) { $null } else { [math]::Round($n / 1MB, 1) }
    )
    privateMB = $(
      $n = Sum-ProcessBytes 'AIR Office' 'PrivateMemorySize64'
      if ($null -eq $n) { $null } else { [math]::Round($n / 1MB, 1) }
    )
  }
  chrome = [pscustomobject]@{
    workingSetMB = $(
      $n = Sum-ProcessBytes 'chrome' 'WorkingSet64'
      if ($null -eq $n) { $null } else { [math]::Round($n / 1MB, 1) }
    )
    privateMB = $(
      $n = Sum-ProcessBytes 'chrome' 'PrivateMemorySize64'
      if ($null -eq $n) { $null } else { [math]::Round($n / 1MB, 1) }
    )
  }
  gpuTop = @($gpuTop)
}

$outDir = Join-Path $PSScriptRoot '..\_temp'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$outFile = Join-Path $outDir ("glass-cost-" + $Label + ".json")
$result | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 $outFile
Write-Output $outFile
$result | ConvertTo-Json -Depth 5
