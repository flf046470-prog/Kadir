@echo off
setlocal
rem Compiles the DERINLIK editor module (Development Editor, Win64) without opening Visual Studio.
rem Set UE_ROOT if your engine is installed somewhere else.
if "%UE_ROOT%"=="" set "UE_ROOT=C:\Program Files\Epic Games\UE_5.6"

set "PROJECT=%~dp0..\..\Derinlik.uproject"
set "UBT_BUILD=%UE_ROOT%\Engine\Build\BatchFiles\Build.bat"

if not exist "%UBT_BUILD%" (
  echo [Derinlik] Unreal Engine not found at "%UE_ROOT%".
  echo            Run:  set UE_ROOT=C:\Path\To\UE_5.x   then run this file again.
  exit /b 1
)

echo [Derinlik] Building DerinlikEditor with %UE_ROOT% ...
call "%UBT_BUILD%" DerinlikEditor Win64 Development -Project="%PROJECT%" -WaitMutex -NoHotReloadFromIDE
if errorlevel 1 (
  echo [Derinlik] BUILD FAILED. Copy the errors above and send them.
  exit /b 1
)
echo [Derinlik] Build OK. Open Derinlik.uproject.
exit /b 0
