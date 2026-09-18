标题行格式为 <type>: <description>，字数不要超过100个，description如果不是中文，则翻译成中文。两个换行后，输出正文内容，每个要点作为一个符号列表，不超过70个字。type使用英文，description和正文用中文，如果不是，则翻译成中文。要点简洁清晰。type类型包含：init: 项目初始化; feat: 新功能; fix: 错误修复; docs: 文档变更; style: 代码格式化（不影响代码逻辑）; refactor: 代码重构（不新增功能或修复错误）; perf: 性能优化; test: 测试相关; build: 构建系统或外部依赖; ci: CI配置相关; chore: 构建过程或辅助工具的变动; revert: 撤销提交。

提交后立即推送，不要留下未推送的本地提交：

- 推送命令固定为 `git push origin main`，成功后用 `git status -sb` 确认无 ahead/behind
- 非交互环境加 `GIT_TERMINAL_PROMPT=0`，避免缺少凭据时卡在交互提示
- github.com 的凭据由 gh CLI 提供（`gh auth git-credential`，命令为 `gh`）