# 奶蛙 Naiwa 1.1

16 种动作使用连续 CSS 身体、双腿、弹性曲线；避免站立到摔倒的原画跳变及光流形变。实际刷新跟随显示器和 Chromium 合成器，无固定运行帧率承诺。其他状态保留 30 fps APNG，原图 180×180。

窗口、任务栏、托盘及关于页使用同一主形象。原主题、原图标与作者署名保留。兼容标识和配置路径不变。

复现：python themes/naiwa/build-theme.py；只更新连续动作和图标：python themes/naiwa/improve-motion.py。preview.html 显示当前绑定；旧 APNG 留作恢复，validator 的未引用文件提示包含这些旧文件及 UI 图标。许可见 THIRD-PARTY-NOTICES.md。
