@echo off
where py >nul 2>nul
if %errorlevel% equ 0 (
  py -3 "%~dp0arev.py" %*
  exit /b
)

where python3 >nul 2>nul
if %errorlevel% equ 0 (
  python3 "%~dp0arev.py" %*
  exit /b
)

where python >nul 2>nul
if %errorlevel% equ 0 (
  python "%~dp0arev.py" %*
  exit /b
)

echo artifact-review requires Python 3.9 or newer. 1>&2
exit /b 127
