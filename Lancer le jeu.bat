@echo off
title PC TACTIQUE - serveur local
cd /d "%~dp0"
py serve.py 8123 2>nul || python serve.py 8123
pause
