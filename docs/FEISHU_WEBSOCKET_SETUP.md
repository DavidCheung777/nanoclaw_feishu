# Feishu (Lark) WebSocket 详细安装配置指南

本指南详细介绍如何在NanoClaw中配置使用**飞书(Feishu/Lark) WebSocket模式**。

WebSocket模式相比Webhook模式：
- ✅ **不需要公网可访问URL** - 直接长连接，本地就能运行
- ✅ **实时消息接收** - 低延迟
- ✅ **配置更简单** - 不需要域名、不需要反向代理、不需要ngrok
- ✅ **使用飞书官方SDK** - 稳定可靠

## 📋 前置要求

- 一个飞书账号（可以是个人或企业）
- 能够创建自定义应用（在你的飞书租户中）
- 已安装 Node.js 20+
- 已安装 Claude Code
- macOS/Linux环境（支持Docker或Apple Container）

## 🚀 步骤 1: 在飞书开发者平台创建应用

1. 打开 [飞书开发者平台](https://open.feishu.cn/)
2. 点击**创建应用** → **自定义应用**
3. 填写应用信息：
   - **应用名称**：NanoClaw AI助手（或自定义名称）
   - **应用描述**：个人Claude AI助手
   - **应用图标**：可选，上传一个图标
   - 点击**创建**

4. 创建完成后，在**凭证与基础信息**页面，获取：
   - **App ID** (格式如 `cli_xxxxxxxxxxxxxxxx`)
   - **App Secret** (你的密钥)

   ✅ **保存这两个值，后面配置要用**

## 🔑 步骤 2: 配置应用权限

1. 在左侧菜单点击**权限管理**
2. **添加权限**，需要添加以下权限：

   | 权限分类 | 权限名称 | 权限标识 | 说明 |
   |---------|---------|---------|------|
   | 消息 |  获取用户发给机器人的单聊、群聊消息 | `im:message` | ✅ **必须** |
   | 消息 |  给用户发消息 | `im:message:send_as_bot` | ✅ **必须** |
   | 群组 |  查看群组信息和群成员 | `im:chat:readonly` | ✅ **必须**（用于同步群信息）|

3. 添加完权限后，点击**申请发布**
4. 如果是测试环境，你可以先**版本管理与发布** → 创建一个版本并发布到测试企业

> 💡 **提示**：如果这是你自己创建的个人企业租户，权限会自动通过，不需要等待审核。

## ⚙️ 步骤 3: 配置事件订阅（WebSocket模式）

对于WebSocket模式，**不需要配置请求URL**！这就是它比webhook简单的地方。

1. 在左侧菜单点击**事件订阅**
2. **开启Events API** 保持开启即可
3. 不需要填写请求URL（WebSocket会自动连接）
4. **添加事件**，订阅以下事件：
   - `im.message.receive_v1` - 接收消息事件 ✅
   - `im.chat.access_event.bot_p2p_chat_entered_v1` - 用户进入单聊（可选）

5. 点击**保存更改**

> 💡 **重要**：WebSocket模式不需要配置Request URL，飞书SDK会主动建立长连接。

## 🔧 步骤 4: 配置 NanoClaw 环境变量

编辑项目根目录的 `.env` 文件：

```env
# ============================================
# Feishu (Lark) WebSocket Configuration
# ============================================

# 你的飞书应用 App ID (从开发者平台获取)
FEISHU_APP_ID=cli_xxxxxxxxxxxxxxxx

# 你的飞书应用 App Secret (从开发者平台获取)
FEISHU_APP_SECRET=your_app_secret_here

# 选择使用飞书作为通道（替换默认WhatsApp）
CHANNEL_TYPE=feishu

# ============================================
# Claude API Configuration (火山引擎示例)
# ============================================
ANTHROPIC_BASE_URL=https://ark.cn-beijing.volces.com/api/compatible
ANTHROPIC_AUTH_TOKEN=your_volces_ark_token
ANTHROPIC_MODEL=your_model_endpoint_id
ANTHROPIC_API_KEY=
CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
```

### 环境变量说明

| 变量名 | 必填 | 说明 | 示例 |
|--------|------|------|------|
| `FEISHU_APP_ID` | ✅ | 飞书应用的App ID | `cli_a905f852eef8dcbd` |
| `FEISHU_APP_SECRET` | ✅ | 飞书应用的App Secret | `M2WcPXVSv61ATaLyr4m6ogyq4V0pKPfI` |
| `CHANNEL_TYPE` | ✅ 设置为 `feishu` 启用飞书通道 | `feishu` |
| `FEISHU_ASSISTANT_NAME` | ❌ | 自定义助手名称（触发词） | 默认为 `Andy` |
| `FEISHU_TRIGGER_PATTERN` | ❌ | 自定义触发正则表达式 | 默认自动识别 @助手名称 |

## 📦 步骤 5: 安装依赖并构建

```bash
# 进入项目目录
cd nanoclaw_feishu

# 安装依赖（包括飞书SDK）
npm install

# 构建项目
npm run build
```

## 🚀 步骤 6: 运行测试

开发模式运行测试：

```bash
npm run dev
```

你应该能看到类似这样的日志输出：

```
[INFO] Starting Feishu WebSocket connection...
[INFO] Connected to Feishu via WebSocket
[INFO] Feishu channel connected and ready
```

如果看到 "Connected to Feishu via WebSocket"，说明**连接成功**！✅

## 👥 步骤 7: 添加机器人到群组并开始使用

1. 在飞书客户端，创建一个新群聊（或打开已有群）
2. 添加你的机器人（刚才创建的应用）为群成员
3. 在群里@机器人并发送消息：

   ```
   @你的机器人名称 你好！
   ```

机器人应该会回复你！🎉

### 注册群组

NanoClaw会自动为每个飞书聊天/群组创建独立的隔离环境：
- 每个群组有独立的上下文记忆
- 每个群组有独立的CLAUDE.md配置
- 完全隔离，保证安全

## 🏁 步骤 8: 配置为系统服务（开机自启）

### macOS (使用launchd):

```bash
# 编辑 plist 文件中的路径
nano ~/Library/LaunchAgents/com.nanoclaw.plist

# 加载并启动服务
launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist

# 查看日志
tail -f ~/projects/nanoclaw_feishu/logs/combined.log
```

### Linux (使用systemd):

创建 `/etc/systemd/system/nanoclaw.service`:

```ini
[Unit]
Description=NanoClaw Feishu Assistant
After=network.target

[Service]
User=your_username
WorkingDirectory=/home/your_username/projects/nanoclaw_feishu
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

然后启用：

```bash
sudo systemctl daemon-reload
sudo systemctl enable nanoclaw
sudo systemctl start nanoclaw
```

## 🔍 常见问题排查

### 问题 1: WebSocket连接失败

**症状**:
```
[ERROR] Failed to connect to Feishu WebSocket
```

**解决**:
- 检查 `FEISHU_APP_ID` 和 `FEISHU_APP_SECRET` 是否正确
- 确认网络能够访问飞书API（检查防火墙/代理设置）
- 检查应用是否已经发布（需要发布后才能使用）

---

### 问题 2: 发送消息后没有回复

**症状**:
- 发送了消息，但机器人不回应

**解决**:
1. **检查连接状态**：查看日志确认WebSocket已连接
   ```bash
   grep "Connected to Feishu" logs/combined.log
   ```
   如果没有这行，说明连接没成功，请排查连接问题

2. **检查权限**：
   - 确认已经添加了 `im:message` 权限
   - 确认应用已经发布（不是草稿状态）
   - 确认机器人已经被添加到群组中

3. **检查触发词**：
   - 默认需要 @机器人 才能触发
   - 如果你修改了 `FEISHU_ASSISTANT_NAME`，确保@的名称正确

4. **查看日志**：看有没有错误信息
   ```bash
   tail -n 50 logs/combined.log
   ```

---

### 问题 3: 机器人能收到消息，但无法发送回复

**症状**:
- 日志显示收到消息，但没有回复出去

**解决**:
- 检查是否添加了 `im:message:send_as_bot` 权限
- 确认机器人在群组中（检查群组成员列表）
- 检查App ID/App Secret是否正确
- 查看日志中是否有API错误信息

---

### 问题 4: 连接断开后自动重连吗？

是的，飞书SDK会自动处理重连，如果连接断开会自动尝试重新连接。不需要额外配置。

---

### 问题 5: 支持单聊吗？

支持！机器人支持：
- ✅ 单聊（一对一）
- ✅ 群聊

在单聊中，不需要@机器人也会处理消息。

---

### 问题 6: 需要公网IP吗？

不需要！这是WebSocket模式最大的优势。WebSocket是主动出站连接，只要你的服务器能上网就行，不需要入站端口开放，不需要公网IP。

---

### 问题 7: 多个群组会冲突吗？

不会。每个飞书聊天/群组都会被NanoClaw视为独立的"group"，有：
- 独立的文件系统目录
- 独立的CLAUDE.md记忆
- 独立的容器沙箱
- 完全隔离

## 📝 目录结构说明

```
src/channels/
├── whatsapp.ts          # WhatsApp通道（原版本）
├── feishu.ts            # 飞书Webhook模式（旧）
├── feishu-ws.ts          # 飞书WebSocket模式（开发中）
└── feishu-sdk-ws.ts      # ✅ 飞书官方SDK WebSocket模式（当前使用）
```

本项目当前使用的是 **`feishu-sdk-ws.ts`** - 飞书官方SDK + WebSocket长连接。

## 🔒 安全说明

- 你的 `FEISHU_APP_SECRET` 和 Claude API密钥都存在本地 `.env` 文件
- `.env` 在 `.gitignore` 中，**不会被提交到Git**
- 所有AI代理运行在隔离的容器中，只能访问你允许挂载的目录
- 飞书机器人只能看到你把它加进去的群组的消息

## 📚 相关文档

- [项目主页 README](../README.md)
- [飞书开放平台文档](https://open.feishu.cn/document/home/index)
- [飞书Node.js SDK 文档](https://github.com/larksuite/node-sdk)
- [NanoClaws 安全模型](../docs/SECURITY.md)

## 🆘 获取帮助

如果遇到问题：
1. 查看日志 `logs/combined.log`
2. 检查 `docs/DEBUG_CHECKLIST.md`
3. 在GitHub上提交Issue

---

**享受你的飞书AI助手吧！** 🎉
