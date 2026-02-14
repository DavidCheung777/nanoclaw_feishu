# Feishu 配置说明

## 事件订阅模式选择

飞书开放平台提供两种事件订阅方式：

### 1. HTTP 回调模式（推荐）
- 飞书服务器主动推送事件到你的 HTTP 接口
- 需要公网可访问的 HTTPS URL
- 可以使用 cloudflared/ngrok 等隧道工具
- 文档: https://open.feishu.cn/document/ukTMukTMukTM/ucTM5YjL3ETO24yNxkjN

### 2. WebSocket 长连接模式（不稳定）
- 你的服务器主动连接飞书 WebSocket 服务器
- 需要正确的 WebSocket URL 和认证方式
- 飞书官方文档中 WebSocket 端点信息较少
- 302 错误表明 URL 格式可能已变更

## 推荐方案

当前代码使用 WebSocket 遇到 302 错误，建议：

1. **切换到 HTTP 回调模式**（更稳定）
   - 使用 cloudflared 创建免费隧道
   - 配置飞书事件订阅为 HTTP 回调

2. **或者等待飞书更新 WebSocket 文档**
   - 当前 WebSocket URL 可能已变更
   - 需要官方文档确认新地址

## 当前配置

环境变量:
- FEISHU_APP_ID=cli_a905f852eef8dcbd
- FEISHU_APP_SECRET=***
- FEISHU_VERIFICATION_TOKEN=***

WebSocket URL (当前返回 302):
- wss://ws-open.feishu.cn/event?app_id={app_id}&token={token}
