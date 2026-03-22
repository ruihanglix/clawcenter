# 系统命令

在微信里发送以 `/` 开头的命令来管理 ClawCenter，无需离开聊天界面。

## 可用命令

### /help

显示所有可用命令。

### /agents

列出你有权访问的所有 Agent 及其状态：

```
可用 Agent:
🟢 🤖 Claude (#claude) [默认]
🟢 🧠 助手 (#助手) ← 当前
⚪ 💻 Code (#code)
```

- `[默认]` 标记该微信账号的默认 Agent。
- `← 当前` 标记你的粘性 Agent（普通消息的目标）。

### /status

显示系统状态：

```
📊 系统状态:

微信账号: 1
  🟢 我的微信

Agent: 3
  🟢 🤖 Claude (#claude)
  🟢 🧠 助手 (#助手)
  ⚪ 💻 Code (#code)

会话数: 5
今日消息: 42
```

### /switch \<agent\>

切换粘性 Agent（普通消息发给谁）：

```
/switch 助手
→ ✅ 已切换到 🧠 助手 (#助手)
```

之后不带标签的消息会发给 `助手`。

### /model

查看或切换当前 Agent 的模型。仅对支持模型切换的 Agent 有效。

**查看当前模型：**

```
/model
→ 🤖 当前 Agent: 🤖 Claude (#claude)
  📌 当前模型: sonnet

  用法:
    /model list          查看可用 Provider
    /model list <name>   查看某 Provider 的模型
    /model <model-name>  切换模型
```

**查看 Provider 列表：**

```
/model list
→ 🤖 Agent: 🤖 Claude (#claude)
  📌 当前模型: sonnet

  可用 Provider:
    ★ anthropic (5 models)
      openai (3 models)

  使用 /model list <provider> 查看具体模型
```

**查看某 Provider 的模型：**

```
/model list anthropic
→ 📋 anthropic 可用模型:
    → sonnet ← 当前
      opus
      haiku

  切换: /model anthropic/sonnet
```

**切换模型：**

```
/model opus
→ ✅ 已将 🤖 Claude (#claude) 的模型切换为: opus
```

### /session

管理当前 Agent 的会话。每个 Agent 可以有多个会话，各自拥有独立的对话历史。

**列出会话：**

```
/session
→ 📋 🤖 Claude 会话列表:
    1. [修 Bug] — 12条消息, 3分钟前 ← 当前
    2. [未命名] — 5条消息, 1小时前

  💡 /session <编号> 切换 | /session new 新建
```

**新建会话：**

```
/session new 重构
→ ✅ 已为 🤖 Claude 新建会话「重构」并切换
```

**切换会话：**

```
/session 2
→ ✅ 已切换到 🤖 Claude 会话 #2
```

**重命名当前会话：**

```
/session rename API 开发
→ ✅ 当前会话已命名为「API 开发」
```

**删除会话：**

```
/session delete 2
→ ✅ 已删除 🤖 Claude 会话 #2
```

### /sessions

查看所有 Agent 的会话概览：

```
📋 所有会话概览:

🤖 Claude (2个会话):
  • [修 Bug] — 12条消息, 3分钟前 ← 当前
  • [未命名] — 5条消息, 1小时前

🧠 助手 (1个会话):
  • [未命名] — 3条消息, 2小时前 ← 当前
```

### /clear \[agent | all\]

清空对话历史：

```
/clear             → 清空当前 Agent 的当前会话
/clear claude      → 清空 #claude 的所有会话
/clear all         → 清空所有 Agent 的所有会话
```

这会重置会话，Agent 会丢失之前的上下文。

### /echo \<文本\>

回声测试——bot 原样回复你的输入。用来验证连接是否正常。

```
/echo 你好
→ 你好
```
