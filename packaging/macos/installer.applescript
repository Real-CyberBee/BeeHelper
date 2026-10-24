on run
  set resourceRoot to (POSIX path of (path to me)) & "Contents/Resources/"
  set payloadRoot to resourceRoot & "payload/"
  set action to button returned of (display dialog "安装 BeeHelper 本地连接器与扩展文件，无需终端或管理员权限。已有 Agent 需要自行安装并登录；浏览器仍需确认扩展和用户脚本权限。" buttons {"取消", "卸载连接器", "安装 / 修复"} default button "安装 / 修复" cancel button "取消" with title "BeeHelper 安装器")
  try
    set commandPrefix to quoted form of (payloadRoot & "bin/beehelper")
    if action is "卸载连接器" then
      do shell script commandPrefix & " --uninstall"
      display dialog "连接器已卸载。浏览器内的应用、会话及 Agent 数据均保留；如不再使用，可在浏览器扩展页移除 BeeHelper。" buttons {"完成"} default button "完成"
    else
      set extensionDirectory to do shell script commandPrefix & " --install --source " & quoted form of payloadRoot & " --gui"
      do shell script "/usr/bin/open " & quoted form of extensionDirectory
      do shell script "/usr/bin/open " & quoted form of "https://github.com/Real-CyberBee/BeeHelper/blob/main/docs/getting-started.md"
      display dialog "连接器已安装。\n\n下一步：\n1. 在 Chrome 扩展页开启开发者模式，点「加载已解压的扩展」，选择刚打开的 extension 文件夹。\n2. 在 BeeHelper 扩展详情开启「允许用户脚本」。\n3. 点击工具栏 BeeHelper 图标，按首次使用向导完成检查。\n\n当前为商店上架前预览安装方式；已有扩展请保留数据并重新加载。" buttons {"完成"} default button "完成" with title "BeeHelper 安装完成"
    end if
  on error errorMessage number errorNumber
    if errorNumber is not -128 then display dialog "安装未完成：" & errorMessage buttons {"关闭"} default button "关闭" with title "BeeHelper"
  end try
end run
