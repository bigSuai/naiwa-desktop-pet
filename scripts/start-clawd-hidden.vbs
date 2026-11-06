Option Explicit

Dim shell, fso, appDir, nodeExe, launcher, command
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

appDir = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
launcher = appDir & "\scripts\launch-hidden.js"
nodeExe = "node.exe"

shell.CurrentDirectory = appDir
command = Chr(34) & nodeExe & Chr(34) & " " & Chr(34) & launcher & Chr(34)
shell.Run command, 0, False
