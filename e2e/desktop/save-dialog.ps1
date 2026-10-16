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
$fallback = $null
while (-not $name -and (Get-Date) -lt $deadline) {
  foreach ($window in $A::RootElement.FindAll($scope::Children, $ofProcess)) {
    $candidates = @($window.FindAll($scope::Descendants, $isDialog))
    if ($window.Current.ClassName -eq '#32770') { $candidates = @($window) + $candidates }
    foreach ($candidate in $candidates) {
      $field = $candidate.FindFirst($scope::Descendants, (Control '1001' 'Edit'))
      if (-not $field) { continue }
      # A dialog on screen first: the process keeps hidden ones too (the first of those is the fallback).
      if (-not $candidate.Current.IsOffscreen) { $dialog = $candidate; $name = $field; break }
      if (-not $fallback) { $fallback = @($candidate, $field) }
    }
    if ($name) { break }
  }
  if (-not $name) { Start-Sleep -Milliseconds 250 }
}
if (-not $name -and $fallback) { $dialog, $name = $fallback }
if (-not $name) { throw "No save dialog with a file name field in process $ProcessId within $TimeoutSeconds s" }

# UI Automation can find these controls but not operate them: Win32 messages can.
Add-Type -Namespace Win32 -Name Messages -MemberDefinition @'
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wParam, string lParam);
[DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wParam, System.Text.StringBuilder lParam);
[DllImport("user32.dll")] public static extern bool IsWindow(IntPtr window);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
'@
$WM_SETTEXT = 0x000C
$WM_GETTEXT = 0x000D
$BM_CLICK = 0x00F5
# The dialog fills in its suggested name while it starts (later on slow machines): type the path until
# the field has held it for a second.
$field = [IntPtr]$name.Current.NativeWindowHandle
function FieldText {
  $text = New-Object System.Text.StringBuilder 1024
  [void][Win32.Messages]::SendMessage($field, $WM_GETTEXT, [IntPtr]1024, $text)
  $text.ToString()
}
$settled = (Get-Date).AddSeconds(15)
$held = 0
while ($held -lt 4 -and (Get-Date) -lt $settled) {
  if ((FieldText) -eq $Path) { $held++ } else { $held = 0; [void][Win32.Messages]::SendMessage($field, $WM_SETTEXT, [IntPtr]::Zero, $Path) }
  Start-Sleep -Milliseconds 250
}
if ($held -lt 4) { throw "The save dialog's file name field does not keep the path; it holds: $(FieldText)" }
$save = $dialog.FindFirst($scope::Descendants, (Control '1' 'Button'))
if (-not $save) { throw 'No Save button in the save dialog' }
[void][Win32.Messages]::SendMessage([IntPtr]$save.Current.NativeWindowHandle, $BM_CLICK, [IntPtr]::Zero, [IntPtr]::Zero)

# The dialog closes once it took the path; if it stays, say what it shows (a question, another name).
$window = [IntPtr]$dialog.Current.NativeWindowHandle
$closed = (Get-Date).AddSeconds(10)
while ((Get-Date) -lt $closed) {
  if (-not [Win32.Messages]::IsWindow($window) -or -not [Win32.Messages]::IsWindowVisible($window)) { exit 0 }
  Start-Sleep -Milliseconds 250
}
$texts = @($dialog.FindAll($scope::Descendants, [System.Windows.Automation.Condition]::TrueCondition) | ForEach-Object { $_.Current.Name } | Where-Object { $_ } | Select-Object -First 40)
$value = try { $name.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value } catch { '?' }
throw "The save dialog stayed open; it shows: $($texts -join ' | '); the file name field holds: $value" 
