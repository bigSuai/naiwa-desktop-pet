# 奶蛙桌宠 v0.8.4

修复 v0.8.3 发布后真实联网核验发现的更新检查问题。包含 v0.8.3 全部奶蛙动效、状态可靠性与聊天配置改进。

- 共享代理出口触发 GitHub 匿名 API 限流时，备用公开 Releases 页面现在使用 Electron 支持的自动重定向，并从最终地址或页面规范链接识别版本，不再因 `Redirect was cancelled` 或空的 `Response.url` 报检查失败。只接受本仓库的 GitHub 版本地址。
- 不需要新增 GitHub Token，不改变用户系统代理、个人 API 密钥或聊天配置；安装版和便携版继续分开处理更新。

## 下载

普通 Intel / AMD Windows 电脑选择 `Naiwa-Desktop-Pet-Setup-0.8.4-x64.exe`；Windows ARM 设备选择 `arm64`。不需要安装时选择同架构 `Portable` 包，其设置和聊天数据仍位于当前用户应用数据目录。

发行版附 `SHA256SUMS.txt`、`latest.yml` 和安装包 blockmap；后两者用于安装版后续更新。程序自带运行时，无需为启动桌宠另装 Node.js。聊天需自行配置 API，不附带维护者密钥或额度。

程序未进行代码签名，Windows 可能提示未知发布者；请从本仓库下载并核对 SHA-256，不要关闭系统安全防护。ARM64 为交叉构建，未进行 ARM64 实机测试。macOS / Linux 本次不发行二进制。

程序继承 Clawd on Desk 的 AGPL-3.0-only，上游作者和贡献者归属保留；奶蛙素材及角色权利说明见源码中的 `themes/naiwa/THIRD-PARTY-NOTICES.md`。
