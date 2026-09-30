@echo off
rem Open the Tactics Board in a new, maximized Chrome window.
set "URL=https://fffederer.github.io/tactics-board/"
set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" (
  start "" "%URL%"
  exit /b
)
start "" "%CHROME%" --new-window --start-maximized "%URL%"
rem When Chrome is already running, --start-maximized is ignored.
rem Wait for the new Chrome window to come to the front, then maximize it.
powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "$sig='[DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow(); [DllImport(\"user32.dll\")] public static extern bool ShowWindow(IntPtr h, int c); [DllImport(\"user32.dll\")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);'; Add-Type -Name W -Namespace U -MemberDefinition $sig; Start-Sleep -Milliseconds 800; for($i=0; $i -lt 40; $i++){ $h=[U.W]::GetForegroundWindow(); $p=0; [void][U.W]::GetWindowThreadProcessId($h,[ref]$p); if((Get-Process -Id $p -ErrorAction SilentlyContinue).ProcessName -eq 'chrome'){ [void][U.W]::ShowWindow($h,3); break }; Start-Sleep -Milliseconds 250 }"
