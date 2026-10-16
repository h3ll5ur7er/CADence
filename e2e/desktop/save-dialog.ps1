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
# UI Automation can find these controls but not operate them: Win32 messages can.
Add-Type -Namespace Win32 -Name Messages -MemberDefinition @'
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wParam, string lParam);
[DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wParam, System.Text.StringBuilder lParam);
[DllImport("user32.dll")] public static extern bool IsWindow(IntPtr window);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
'@
$ofProcess = New-Object System.Windows.Automation.PropertyCondition($A::ProcessIdProperty, $ProcessId)
$isDialog = New-Object System.Windows.Automation.PropertyCondition($A::ClassNameProperty, '#32770')

# The process may have other (hidden) dialog windows, and the save dialog shows before all its
# controls exist: wait for a dialog on screen (by Win32: UI Automation may call everything offscreen on
# a runner without a display) that has the file name field. Each candidate is logged, for diagnosis.
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$dialog = $null
$name = $null
$fallback = $null
$logged = @{}
while (-not $name -and (Get-Date) -lt $deadline) {
  foreach ($window in $A::RootElement.FindAll($scope::Children, $ofProcess)) {
    $candidates = @($window.FindAll($scope::Descendants, $isDialog))
    if ($window.Current.ClassName -eq '#32770') { $candidates = @($window) + $candidates }
    foreach ($candidate in $candidates) {
      $field = $candidate.FindFirst($scope::Descendants, (Control '1001' 'Edit'))
      if (-not $field) { continue }
      $handle = [IntPtr]$candidate.Current.NativeWindowHandle
      $visible = [Win32.Messages]::IsWindowVisible($handle)
      $key = "$handle $visible"
      if (-not $logged.ContainsKey($key)) {
        $logged[$key] = $true
        Write-Output "candidate $handle '$($candidate.Current.Name)' visible=$visible offscreen=$($candidate.Current.IsOffscreen) field=$($field.Current.NativeWindowHandle)"
      }
      if ($visible) { $dialog = $candidate; $name = $field; break }
      if (-not $fallback) { $fallback = @($candidate, $field) }
    }
    if ($name) { break }
  }
  if (-not $name) { Start-Sleep -Milliseconds 250 }
}
if (-not $name -and $fallback) {
  Write-Output 'no visible dialog: using a hidden one'
  $dialog, $name = $fallback
}
if (-not $name) { throw "No save dialog with a file name field in process $ProcessId within $TimeoutSeconds s" }

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
# Typed as characters: some versions of Windows' dialog ignore text set directly (WM_SETTEXT) when
# saving, and use what was typed. The field is emptied first.
$WM_CHAR = 0x0102
function TypePath {
  [void][Win32.Messages]::SendMessage($field, $WM_SETTEXT, [IntPtr]::Zero, '')
  foreach ($character in $Path.ToCharArray()) { [void][Win32.Messages]::SendMessage($field, $WM_CHAR, [IntPtr][int]$character, [IntPtr]::Zero) }
  # Autocompletion may have added to what was typed: if so, the text is set as a whole.
  if ((FieldText) -ne $Path) {
    Write-Output "typed, the field holds: $(FieldText)"
    [void][Win32.Messages]::SendMessage($field, $WM_SETTEXT, [IntPtr]::Zero, $Path)
  }
}
$settled = (Get-Date).AddSeconds(15)
$held = 0
while ($held -lt 4 -and (Get-Date) -lt $settled) {
  if ((FieldText) -eq $Path) { $held++ } else { $held = 0; TypePath }
  Start-Sleep -Milliseconds 250
}
Write-Output "chose $([IntPtr]$dialog.Current.NativeWindowHandle); the field holds: $(FieldText)"
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
