# 奶蛙桌宠 v0.8.3

首个可直接下载的奶蛙 Windows 正式发行版，由 bigSuai 维护。

## 下载选择

- `Naiwa-Desktop-Pet-Setup-0.8.3-x64.exe`：普通 Intel / AMD Windows 电脑安装版。
- `Naiwa-Desktop-Pet-Setup-0.8.3-arm64.exe`：Windows ARM 设备原生安装版。
- `Naiwa-Desktop-Pet-Portable-0.8.3-x64.exe` / `arm64.exe`：无需安装的便携启动版，偏好和聊天配置仍保存在当前用户应用数据目录。
- `SHA256SUMS.txt`：SHA-256 校验文件；`latest.yml` 和 `.blockmap` 用于安装版更新。

安装版可通过设置中的“检查更新”获取本仓库后续发行版。便携版需手动下载替换，不自动执行安装程序。程序自带 Electron 运行时，不需要另装 Node.js。

## 本版内容

- 保留奶蛙立体原画与经典大笑，优化待机、思考、工作、睡眠节奏及状态间的短过渡。
- 新增仅待机时启用的轻微身体随鼠标缓动，兼容 Mini 镜像、低功耗及减少动态效果偏好；不是独立眼球追踪。
- 修复 Codex 来源退出后的状态残留，以及未验证临时会话重复占用状态列表的问题。不根据静默时间猜测任务完成。
- 聊天首次使用可引导配置自己的 OpenAI API Key；使用系统安全存储加密保存，不包含维护者的个人密钥、聊天或配置。
- 关于页、更新检查和项目链接指向 bigSuai/naiwa-desktop-pet。
- 修正奶蛙产品改名后的卸载集成清理路径，保留程序 AGPL 许可证及素材来源声明。

## 限制与来源

此版发行 Windows x64 / ARM64 包；ARM64 为原生交叉构建，未在 ARM64 实机验收。macOS / Linux 原有源代码与手动构建入口保留，本次不发布这些平台的安装包。

本项目没有代码签名证书，Windows 可能提示未知发布者。请从本仓库下载并核对 SHA-256，不要为安装而关闭系统安全防护。

程序继承 Clawd on Desk 的 AGPL-3.0-only，原作者及贡献者归属保留。奶蛙素材许可及角色权利说明见仓库 `themes/naiwa/THIRD-PARTY-NOTICES.md`；素材许可不代表取得角色或商标的独占权。
