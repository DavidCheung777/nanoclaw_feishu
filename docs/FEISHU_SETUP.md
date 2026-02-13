# Feishu (Lark) Channel Setup

This guide walks you through setting up Feishu (Lark) as a channel for NanoClaw.

## Prerequisites

- A Feishu/Lark account with admin access to create apps
- A publicly accessible URL or tunnel (like ngrok) for webhooks during development

## Step 1: Create a Feishu App

1. Go to the [Feishu Developer Console](https://open.larksuite.com/app)
2. Click "Create Custom App"
3. Give your app a name (e.g., "NanoClaw Assistant")
4. Choose an appropriate app icon
5. Note down the **App ID** and **App Secret** - you'll need these for configuration

## Step 2: Configure App Permissions

1. In your app settings, go to "Permissions & Scopes"
2. Add the following permissions:
   - `im:chat:readonly` - Read chat information
   - `im:message:send` - Send messages
   - `im:message:receive` - Receive messages
3. Save the changes

## Step 3: Configure Event Subscription

1. Go to "Event Subscriptions" in your app settings
2. Enable event subscription
3. Set the **Request URL** to your webhook endpoint (e.g., `https://your-domain.com/webhook/feishu` or `https://your-ngrok-url.ngrok-free.app/webhook/feishu` for development)
4. Add the following event types:
   - `im.message.receive_v1` - Triggered when a message is received
5. Click "Save" and verify the URL verification challenge
6. Note down the **Verification Token** - you'll need it for configuration

## Step 4: Configure Environment Variables

Add the following environment variables to your `.env` file or environment:

```bash
# Feishu (Lark) Configuration
FEISHU_APP_ID=your_app_id_here
FEISHU_APP_SECRET=your_app_secret_here
FEISHU_VERIFICATION_TOKEN=your_verification_token_here
FEISHU_WEBHOOK_PORT=3001  # Optional, defaults to 3001

# Optional: Different assistant name for Feishu (defaults to main ASSISTANT_NAME)
FEISHU_ASSISTANT_NAME=Andy
```

## Step 5: Configure Webhook URL (Production)

For production, you need a publicly accessible HTTPS URL. Options include:

1. **Cloudflare Tunnel** (Recommended for simplicity)
   ```bash
   cloudflared tunnel --url http://localhost:3001
   ```

2. **ngrok** (Good for development)
   ```bash
   ngrok http 3001
   ```

3. **Reverse proxy** (Production with your own domain)
   Set up Nginx or similar to proxy to `localhost:3001`

Update the webhook URL in your Feishu app settings to match your public URL.

## Step 6: Start NanoClaw

1. Build the project:
   ```bash
   npm run build
   ```

2. Start the service:
   ```bash
   launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist
   ```

   Or for development:
   ```bash
   npm run dev
   ```

3. Check logs to verify Feishu connection:
   ```bash
   tail -f logs/combined.log
   ```

## Step 7: Register a Group

To start using the assistant in a Feishu group:

1. Add your Feishu bot to a group chat
2. In the group, mention the bot with a trigger message, e.g.:
   ```
   @NanoClaw Assistant register this group
   ```

3. The bot will register the group and create a folder in `groups/feishu-{chat_name}`
4. Future messages with the trigger (e.g., `@Andy help`) will be processed by the agent

## Troubleshooting

### Webhook Verification Failed

- Ensure your public URL is accessible from the internet
- Check that the webhook port (default 3001) is not blocked by a firewall
- Verify the `FEISHU_VERIFICATION_TOKEN` matches the one in your Feishu app settings

### Cannot Send Messages

- Verify the `im:message:send` permission is granted in your Feishu app
- Check that the bot has been added to the chat/group
- Ensure the `FEISHU_APP_ID` and `FEISHU_APP_SECRET` are correct

### Token Refresh Errors

- Verify `FEISHU_APP_ID` and `FEISHU_APP_SECRET` are correct
- Ensure your app is published (or you're using a test enterprise)
- Check the app has the necessary permissions enabled

### Group Not Registered

- Ensure the group chat has the bot added as a member
- Check that messages contain the trigger pattern (e.g., `@Andy`)
- Verify the bot has permission to read messages in the group

## Additional Resources

- [Feishu Open Platform Documentation](https://open.larksuite.com/document/home/index)
- [Feishu Bot API Reference](https://open.larksuite.com/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message/events)
- [NanoClaw Main README](../README.md)
