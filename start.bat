@echo off
chcp 65001 >nul
cd /d "%~dp0"
start "智驾中心交付物管理系统" AdDeliverableManager.exe
