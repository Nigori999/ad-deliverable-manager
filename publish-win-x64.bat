@echo off
chcp 65001 >nul
cd /d "%~dp0"
dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:PublishTrimmed=false -o publish\win-x64
if errorlevel 1 (
  echo 发布失败，请检查.NET 10 SDK和NuGet网络。
  pause
  exit /b 1
)
copy /Y start.bat publish\win-x64\start.bat >nul
copy /Y appsettings.json publish\win-x64\appsettings.json >nul
if not exist publish\win-x64\data mkdir publish\win-x64\data
if not exist publish\win-x64\backups mkdir publish\win-x64\backups
if not exist publish\win-x64\logs mkdir publish\win-x64\logs
echo 发布完成：publish\win-x64
pause
