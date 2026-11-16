param([string]$Script = 'tests/verify.cjs')
$start = [System.Diagnostics.ProcessStartInfo]::new($env:DSH_NODE_EXECUTABLE)
$start.ArgumentList.Add((Join-Path $PSScriptRoot "../$Script"))
$start.Environment['ELECTRON_RUN_AS_NODE'] = '1'
$start.UseShellExecute = $false
$start.RedirectStandardOutput = $true
$start.RedirectStandardError = $true
$process = [System.Diagnostics.Process]::Start($start)
$stderr = $process.StandardError.ReadToEndAsync()
$stdout = $process.StandardOutput.ReadToEnd()
$process.WaitForExit()
[Console]::Out.Write($stdout)
[Console]::Error.Write($stderr.Result)
exit $process.ExitCode
