# Web 管理面板

ClawCenter 内置 Web 管理界面用于配置和监控。默认地址 `http://localhost:9800`。

## 仪表板

首页显示系统概览：

- **统计卡片**：微信账号数、Agent 数、活跃会话数、今日消息数
- **微信账号**：各账号连接状态
- **Agent**：各 Agent 运行状态
- **最近消息**：实时滚动的收发消息

仪表板每 5 秒自动刷新。

## 微信账号管理

管理微信连接：

- **Add Account**：创建新账号条目，填写 ID 和显示名称
- **Login (QR)**：扫码连接微信
- **Connect / Disconnect**：启停消息接收
- **Delete**：删除账号及其所有路由规则

## Agent 管理

添加、配置和控制 AI Agent：

- **Add Agent**：创建新 Agent，设置 ID（用作标签）、显示名称、类型、工作目录、模型
- **Start / Stop**：单独控制每个 Agent
- **Delete**：删除 Agent 及其所有会话

Agent 列表实时显示状态、类型、工作目录，以及是本地还是远程。

## 路由配置

按微信账号设置访问规则：

1. 从下拉菜单选择微信账号
2. 添加规则：选择 Agent、设置用户匹配模式（`*` 表示所有人）、可选标记为默认
3. 规则立即生效——无需重启

规则表显示所有当前规则，支持单独删除。

## 设置

全局设置：

- **Reply Prefix Format**：Agent 回复前缀模板（默认：`[{displayName}]`）
- **Web UI Port**：管理面板端口
- **Worker Hub Port**：远程 Worker 连接端口
- **Host bindings**：监听哪些网络接口

端口和 Host 设置需重启后生效。回复前缀格式即时生效。

设置页面还显示已连接的 **Worker 节点**及其 ID、地址和连接状态。
