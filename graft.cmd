@echo off
setlocal
set "DO_NOT_TRACK=1"
call "%APPDATA%\npm\graft.cmd" %*
exit /b %errorlevel%
