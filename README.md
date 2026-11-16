# DSH Git Bash

让 DeepSeek Harness（DSH）在 Windows 上使用 Git Bash 执行命令，适合习惯 Bash、Git 和常见命令行工作流的用户。

## 有什么功能

- **独立的 Git Bash 模式**：新建会话时可选，不替换标准模式，也不改变现有会话。
- **直接使用 Git for Windows**：无需 WSL，不经过 PowerShell 转发。
- **自动找到 Git**：通常无需填写安装路径，也支持已加入 PATH 的便携版 Git。
- **保留常用能力**：文件读写、搜索、后台任务、命令取消和长输出处理仍可使用。

## 使用前准备

- Windows，已安装 [Git for Windows](https://gitforwindows.org/)。
- DSH **0.2.2-rc.3**；其他版本尚未验证。
- 使用时需选择 **Full access（完全访问）**。只读或工作区写入权限下不会执行 Bash 命令；请仅在信任的项目中使用。

## 安装

1. 将本仓库下载或克隆到本机的固定目录，安装后不要移动或删除。
2. 确保已安装 Git for Windows。插件会自动查找，无需手动填写安装路径；便携版请先将 Git 的 `cmd` 或 `bin` 目录加入 PATH，再重启 DSH。
3. 在 DSH 中让助手安装该本地扩展包，例如：

   > 请将 C:/你的目录/dsh-git-bash 作为本地扩展包安装到当前 DSH 配置。

4. 在插件管理中确认扩展包已启用。

## 怎么用

1. 新建会话，在首次发送消息前选择 **Git Bash** 模式。
2. 将权限设为 **Full access**。
3. 像平时一样描述任务，例如：“查看当前仓库的修改，并运行测试。”助手会使用 Git Bash 执行命令。

不需要修改默认会话模式；需要原来的使用方式时，另建标准模式会话即可。

## 常见问题

**看不到 Git Bash 模式？**

确认扩展包已启用、DSH 版本匹配且 Git for Windows 已安装。如果刚安装 Git 或修改过 PATH，请重启 DSH。

**自动查找失败，或想指定某个 Git 安装？**

插件优先使用手动指定的路径，其次读取 Windows 安装记录，最后查找 PATH 中的 Git，不会选择 WSL 的 Bash。

如需手动指定，可让助手在本地扩展包的 `cordis.patch.yml` 中，为 `git-bash-executor` 的 `config` 添加 `bashPath`，指向所需的 `bin/bash.exe`（例如 `C:/Program Files/Git/bin/bash.exe`），然后重新安装扩展包并按提示重启 DSH。手动指定的路径无效时会报错，不会悄悄切换到其他 Git；删除该设置即可恢复自动查找。

**为什么提示命令不能执行？**

本插件仅支持 Full access，不支持 Windows Bash 沙箱。文件读写工具仍遵循 DSH 的权限设置。

**会读取我的 Bash 启动配置吗？**

不会。每条命令都在新的 Bash 环境中执行，不加载启动脚本；不要依赖上一条命令中设置的变量或别名。

**如何停用？**

在插件管理中禁用或卸载整个扩展包即可。使用 Git Bash 模式的历史会话可能需要重新启用扩展包才能继续。
