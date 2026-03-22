# 🐾 ClawCenter

> 欢迎提交 Issue 和 Pull Request！无论是 bug 反馈、功能建议还是代码贡献，我们都非常欢迎。

**在微信里使用多个 AI 编程助手。**

ClawCenter 是一个中央路由器，连接你的微信和多个 AI Agent（Claude Code、OpenCode 等）。你可以在微信聊天里直接跟 AI 对话、写代码、跑命令——用 `#话题标签` 切换不同的 Agent。

## 它能做什么

- **多 Agent 共存**：同一个微信聊天窗口里接入多个 AI Agent，用 `#claude`、`#助手` 等标签切换
- **引用回复接续**：直接引用 Agent 的消息继续对话，无需重复打标签
- **多微信账号**：同时连接多个微信号，各自独立配置
- **多机器协作**：Agent 可以分布在不同机器上，远程连接到中央服务器
- **零配置起步**：启动即用，所有设置在 Web 管理面板中完成
- **权限控制**：矩阵视图一目了然，配置每个微信账号可访问哪些 Agent

## 安装

```bash
npm install -g clawcenter
```

需要 Node.js 22 或更高版本。

## 快速开始

### 1. 启动服务

```bash
clawcenter start
```

服务启动后会显示 Web 管理面板地址（默认 `http://localhost:9800`）。

### 2. 添加微信账号

打开 Web 管理面板 → **WeChat** → **Add Account**：
- 输入一个名称（如"我的微信"）
- 点击 **Login (QR)**，用微信扫码
- 扫码确认后即连接成功

### 3. 添加 Agent

**WeChat** → **Agents** → **Add Agent**：
- **ID**：`claude`（这就是微信里的 `#claude` 标签）
- **Display Name**：`🤖 Claude`
- **Type**：选择 Claude Code
- **Working Directory**：填你的项目路径，如 `/home/user/myproject`
- 点击 **Create & Start**

### 4. 开始使用

新建的 Agent 会自动对所有微信账号可用。如需调整权限，打开 **Access** 页面：
- 用矩阵视图查看所有微信账号和 Agent 的访问关系
- 勾选/取消勾选控制访问权限
- 点击 ★ 设置默认 Agent

### 5. 在微信里聊天

在微信里给 bot 发消息：

```
#claude 帮我看看这段代码有什么问题
```

Agent 会回复：

```
[🤖 Claude] 我来看看。这段代码有几个问题...
```

直接引用这条回复继续追问，无需再打 `#claude`。

## 微信里的用法

### 话题标签

用 `#名称` 指定发给哪个 Agent：

```
#claude 跑一下测试
#助手 写一首诗
#code 检查一下这个 bug
```

### 引用回复

引用 Agent 的某条消息直接回复，自动发给同一个 Agent，保持上下文连续。

### 无标签发送

直接发消息（不带 `#`，不引用），会发给你上次使用的 Agent。

### 系统命令

```
/help                查看所有命令
/agents              列出可用 Agent
/status              查看系统状态
/switch 助手          切换默认 Agent
/model               查看/切换当前 Agent 的模型
/session             管理当前 Agent 的会话
/sessions            查看所有会话概览
/clear               清空当前会话上下文
/clear all           清空所有会话
/echo <文本>          回显测试
```

## 多个 Agent 示例

你可以同时配置多个 Agent，哪怕类型相同、只是工作目录不同：

| ID | 类型 | 工作目录 | 用途 |
|----|------|---------|------|
| frontend | Claude Code | /home/user/frontend | 前端项目 |
| backend | Claude Code | /home/user/backend | 后端项目 |
| 助手 | Claude SDK | — | 通用问答 |

在微信里：
```
#frontend 这个组件渲染太慢了
#backend 数据库查询怎么优化
#助手 今天天气怎么样
```

## 多机器部署

如果你的 Agent 需要跑在不同机器上：

**中央服务器**（连微信的那台）：
```bash
clawcenter start
```

**远程机器**（跑 Agent 的）：
```bash
clawcenter start --worker --center ws://中央服务器IP:9801
```

Worker 启动后打开自己的管理面板（`http://localhost:9802`）添加本地 Agent，它们会自动出现在中央服务器的 Agent 列表中。

## 支持的 Agent 类型

| 类型 | 说明 |
|------|------|
| Claude Code | 本地 `claude` CLI |
| Claude Agent SDK | 直接调用 Anthropic API |
| OpenCode | 本地 `opencode` CLI |
| OpenClaw | 本地 `openclaw` CLI |
| Codex | 本地 `codex` CLI（OpenAI） |
| CodeBuddy | 本地 `codebuddy` CLI（腾讯） |
| Cursor Agent | 本地 `cursor` CLI |
| Custom HTTP | 任意 HTTP API 的 Agent |
| Remote Worker | 远程机器上的 Agent |

## 文档

- [English Documentation](docs/)
- [中文文档](docs/cn/)

## License

MIT
