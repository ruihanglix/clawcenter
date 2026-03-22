# 快速开始

5 分钟启动 ClawCenter。

## 前置条件

- Node.js 22 或更高版本
- 至少安装一个 AI Agent CLI（如 Claude Code 的 `claude`）
- 一个微信账号

## 安装

```bash
npm install -g clawcenter
```

## 第一步：启动服务

```bash
clawcenter start
```

你会看到：

```
🐾 ClawCenter started
   Web UI: http://localhost:9800
   Worker hub: ws://0.0.0.0:9801
```

打开浏览器访问 `http://localhost:9800`。

## 第二步：添加微信账号

1. 点击侧边栏 **WeChat**
2. 点击 **Add Account**
3. 输入 ID（如 `personal`）和名称（如 `我的微信`）
4. 点击 **Create**，然后点击 **Login (QR)**
5. 用微信扫描二维码
6. 在手机上确认登录
7. 点击 **Connect** 开始接收消息

## 第三步：添加 Agent

1. 点击侧边栏 **Agents**
2. 点击 **Add Agent**
3. 填写：
   - **ID**：`claude`（这就是微信里的 `#claude` 标签）
   - **Display Name**：`🤖 Claude`
   - **Type**：Claude Code
   - **Working Directory**：你的项目路径（如 `/home/user/myproject`）
4. 点击 **Create & Start**

## 第四步：配置路由

1. 点击侧边栏 **Routing**
2. 选择你的微信账号
3. 添加规则：
   - **Agent**：选择 `claude`
   - **User Pattern**：`*`（所有用户）
   - 勾选 **Default Agent**

## 第五步：试试看

在微信里给 bot 发消息：

```
#claude 你好！你能做什么？
```

Bot 会回复：

```
[🤖 Claude] 你好！我可以帮你写代码...
```

试试引用那条消息继续追问——会自动发给同一个 Agent。

## 接下来

- [添加更多 Agent](04-agents.md)，可以为不同项目设置不同工作目录
- [配置路由规则](05-routing.md)
- [多机器部署](08-multi-machine.md)
- [系统命令](06-commands.md)
