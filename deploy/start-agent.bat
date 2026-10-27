@echo off
chcp 65001 >nul
setlocal

rem piwebui agent-host — 前台运行，日志直接打在窗口里
rem 关闭窗口即停止。日常使用建议用 deploy\start-agent-silent.vbs 或任务计划程序。

set "ROOT=%~dp0.."
cd /d "%ROOT%\agent-host"

if not exist ".env" (
	echo [x] 缺少 agent-host\.env
	echo     请先复制 .env.example 为 .env，填写 AGENT_SECRET 和 PIWEBUI_SERVER_URL
	pause
	exit /b 1
)

if not exist "dist\agent-host.js" (
	echo [*] 未找到构建产物，正在构建...
	call npm run build || goto :fail
)

echo [*] 启动 agent-host...
node "dist\agent-host.js"
echo.
echo [!] agent-host 已退出
pause
exit /b 0

:fail
echo [x] 构建失败
pause
exit /b 1
