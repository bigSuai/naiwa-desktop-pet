# 奶蛙桌宠 Naiwa

维护者：[bigSuai](https://github.com/bigSuai)。基于 [Clawd on Desk](https://github.com/rullerzhou-afk/clawd-on-desk) 的开源衍生版本。

奶蛙会随 AI 智能体的思考、工具调用、权限请求、完成、异常和休息状态变化。支持普通/迷你模式、多会话状态、主题切换及可选的独立聊天窗口。

## 本地运行

需要 Node.js 24 或更高版本和 npm。

```sh
npm ci
npm start
```

Windows 可运行 `wscript scripts/start-clawd-hidden.vbs` 隐藏控制台启动。请先确保 Node.js 已加入 PATH。当前重点验证平台为 Windows；macOS/Linux 的原有集成保留，但本次未进行真实桌面验收。

## 配置聊天

在桌宠右键菜单打开聊天。首次使用进入配置界面，填写自己的 OpenAI API Key 和模型，默认 `gpt-6-luna`。可先测试连接，再加密保存；之后可在聊天窗口重新配置。

- API 固定使用 OpenAI 官方 Responses 接口，不会把官方密钥发送给第三方模型服务。
- 密钥通过 Electron safeStorage 使用系统密钥存储保护，写入当前用户的应用数据目录，不在项目目录中保存明文。
- 若系统安全存储不可用，则拒绝保存，不降级为明文。
- 聊天通过 Electron 网络栈使用系统代理。API 测试和聊天会消耗用户自己的额度；测试不会自动重试。
- 仓库不包含维护者的 API Key、DPAPI 文件、个人聊天记录或 OpenClaw 配置。
- 不需要聊天功能时，可以取消配置，继续使用桌宠状态功能。
- 聊天记录以本机文件保存，不做加密；可在聊天窗口清空。公开源码不包含这些记录。

## 状态可靠性

真实 `Stop`/`task_complete` 是完成边界，不根据工具结束后的静默时间猜测完成。日志结束信号会按任务轮次校验，可在最后一条官方 hook 缺失时兜底，并避免迟到的旧事件结束新任务、重复播放音效。

自动化测试同时覆盖多会话、子智能体身份、任务打断、权限进入/解除、普通/迷你模式以及睡眠唤醒。测试不是所有操作系统和动画交互的无遗漏保证。

```sh
npm test
```

## 许可证与来源

程序继承上游 **AGPL-3.0-only**，详见 [LICENSE](LICENSE)。修改版发布时应继续提供对应源代码及原有许可、归属信息。

原 Clawd 作者为 Ruller_Lulu / 鹿鹿（rullerzhou-afk）及其贡献者；上游文档和多语言指南在仓库中保留。奶蛙素材来源、MIT 授权原文及改编说明见 [素材声明](themes/naiwa/THIRD-PARTY-NOTICES.md) 和 [上游素材许可证](themes/naiwa/UPSTREAM-LICENSE.txt)。素材许可不代表获得角色或商标权的独占授权。

原技术包名、集成协议和部分配置标识为兼容保留，不代表这是上游官方发行版。本仓库是 bigSuai 维护的奶蛙衍生版本。
