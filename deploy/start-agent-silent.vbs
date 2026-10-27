' 静默启动 piwebui agent-host（不弹黑窗口）
'
' 用法：
'   双击即可，或用任务计划程序在登录时触发。
'   停掉它：任务管理器结束 node.exe，或在任务计划程序里结束该任务。
'
' 日志不会显示在任何窗口。需要看日志时改用 start-agent.bat。

Option Explicit

Dim fso, sh, root, workDir, cmd

Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")

' 本文件位于 <repo>\deploy\ 下
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
workDir = root & "\agent-host"

If Not fso.FileExists(workDir & "\.env") Then
	MsgBox "缺少 agent-host\.env" & vbCrLf & _
		"请先复制 .env.example 为 .env 并填写 AGENT_SECRET。", 16, "piwebui"
	WScript.Quit 1
End If

If Not fso.FileExists(workDir & "\dist\agent-host.js") Then
	MsgBox "未找到构建产物 dist\agent-host.js" & vbCrLf & _
		"请在项目根目录执行：npm run build", 16, "piwebui"
	WScript.Quit 1
End If

sh.CurrentDirectory = workDir
cmd = "cmd /c node dist\agent-host.js >> agent.log 2>&1"
sh.Run cmd, 0, False
