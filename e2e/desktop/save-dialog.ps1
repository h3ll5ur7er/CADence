# Answers the native save dialog of a process: types the path into the file name field and saves.
# Finds controls by their Win32 control ids and classes (file name: Edit 1001, Save: Button 1), which
# do not depend on the language of Windows.
param([Parameter(Mandatory)][int]$ProcessId, [Parameter(Mandatory)][string]$Path, [int]$TimeoutSeconds = 30)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$A = [System.Windows.Automation.AutomationElement]
$scope = [System.Windows.Automation.TreeScope]
function Control($id, $class) {
  New-Object System.Windows.Automation.AndCondition(
    (New-Object System.Windows.Automation.PropertyCondition($A::AutomationIdProperty, $id)),
    (New-Object System.Windows.Automation.PropertyCondition($A::ClassNameProperty, $class)))
}
$ofProcess = New-Object System.Windows.Automation.PropertyCondition($A::ProcessIdProperty, $ProcessId)
$isDialog = New-Object System.Windows.Automation.PropertyCondition($A::ClassNameProperty, '#32770')

# The process may have other (hidden) dialog windows, and the save dialog shows before all its
# controls exist: wait for a dialog that has the file name field.
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$dialog = $null
$name = $null
while (-not $name -and (Get-Date) -lt $deadline) {
  foreach ($window in $A::RootElement.FindAll($scope::Children, $ofProcess)) {
    $candidates = @($window.FindAll($scope::Descendants, $isDialog))
    if ($window.Current.ClassName -eq '#32770') { $candidates = @($window) + $candidates }
    foreach ($candidate in $candidates) {
      $field = $candidate.FindFirst($scope::Descendants, (Control '1001' 'Edit'))
      if ($field) { $dialog = $candidate; $name = $field; break }
    }
    if ($name) { break }
  }
  if (-not $name) { Start-Sleep -Milliseconds 250 }
}
if (-not $name) { throw "No save dialog with a file name field in process $ProcessId within $TimeoutSeconds s" }

# UI Automation can find these controls but not operate them: Win32 messages can.
Add-Type -Namespace Win32 -Name Messages -MemberDefinition @'
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wParam, string lParam);
[DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
'@
$WM_SETTEXT = 0x000C
$BM_CLICK = 0x00F5
[void][Win32.Messages]::SendMessage([IntPtr]$name.Current.NativeWindowHandle, $WM_SETTEXT, [IntPtr]::Zero, $Path)
$save = $dialog.FindFirst($scope::Descendants, (Control '1' 'Button'))
if (-not $save) { throw 'No Save button in the save dialog' }
[void][Win32.Messages]::SendMessage([IntPtr]$save.Current.NativeWindowHandle, $BM_CLICK, [IntPtr]::Zero, [IntPtr]::Zero)

# The dialog closes once it took the path; if it stays, say what it shows (a question, another name).
$closed = (Get-Date).AddSeconds(10)
while ((Get-Date) -lt $closed) {
  try { $null = $dialog.Current.Name } catch { exit 0 }
  if ($dialog.Current.IsOffscreen) { exit 0 }
  Start-Sleep -Milliseconds 250
}
$texts = @($A::RootElement.FindAll($scope::Children, $ofProcess) | ForEach-Object { $_.FindAll($scope::Descendants, [System.Windows.Automation.Condition]::TrueCondition) } | ForEach-Object { $_.Current.Name } | Where-Object { $_ } | Select-Object -First 30)
throw "The save dialog stayed open; it shows: $($texts -join ' | '); the file name field says: $($name.Current.Name)" 
