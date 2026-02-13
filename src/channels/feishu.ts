import crypto from 'crypto';
import http from 'http';
import { URL } from 'url';

import { FEISHU_ASSISTANT_NAME, FEISHU_TRIGGER_PATTERN } from '../config.js';
import {
  getLastGroupSync,
  setLastGroupSync,
  updateChatName,
} from '../db.js';
import { logger } from '../logger.js';
import { Channel, OnInboundMessage, OnChatMetadata, RegisteredGroup } from '../types.js';

const GROUP_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const FEISHU_API_BASE = 'https://open.feishu.cn/open-apis';

export interface FeishuChannelOpts {
  onMessage: OnInboundMessage;
  onChatMetadata: OnChatMetadata;
  registeredGroups: () => Record<string, RegisteredGroup>;
}

interface FeishuTokenResponse {
  tenant_access_token: string;
  expire: number;
}

interface FeishuMessageContent {
  text?: string;
}

interface FeishuEvent {
  header: {
    event_id: string;
    event_type: string;
    create_time: string;
    token: string;
    app_id: string;
    tenant_key: string;
  };
  event: {
    sender: {
      sender_id: {
        union_id: string;
        user_id: string;
        open_id: string;
      };
      sender_type: string;
      tenant_key: string;
    };
    message: {
      message_id: string;
      root_id?: string;
      parent_id?: string;
      create_time: string;
      chat_id: string;
      chat_type: string;
      message_type: string;
      content: string;
      mentions?: Array<{
        key: string;
        id: {
          union_id: string;
          user_id: string;
          open_id: string;
        };
        name: string;
        tenant_key: string;
      }>;
      user_agent?: string;
      update_time?: string;
      deleted?: boolean;
      updated?: boolean;
    };
    mentions?: Array<{
      key: string;
      id: {
        union_id: string;
        user_id: string;
        open_id: string;
      };
      name: string;
      tenant_key: string;
    }>;
  };
}

export class FeishuChannel implements Channel {
  name = 'feishu';
  prefixAssistantName = true;

  private connected = false;
  private server: http.Server | null = null;
  private tenantToken: string | null = null;
  private tokenExpiry: number = 0;
  private groupSyncTimerStarted = false;
  private outgoingQueue: Array<{ chatId: string; text: string }> = [];
  private flushing = false;

  private opts: FeishuChannelOpts;
  private config: {
    appId: string;
    appSecret: string;
    verificationToken: string;
    encryptKey?: string;
    webhookPort: number;
  };

  constructor(opts: FeishuChannelOpts) {
    this.opts = opts;

    // Load configuration from environment
    const appId = process.env.FEISHU_APP_ID;
    const appSecret = process.env.FEISHU_APP_SECRET;
    const verificationToken = process.env.FEISHU_VERIFICATION_TOKEN;
    const webhookPort = parseInt(process.env.FEISHU_WEBHOOK_PORT || '3001', 10);

    if (!appId || !appSecret || !verificationToken) {
      throw new Error(
        'Missing Feishu configuration. Set FEISHU_APP_ID, FEISHU_APP_SECRET, and FEISHU_VERIFICATION_TOKEN environment variables.',
      );
    }

    this.config = {
      appId,
      appSecret,
      verificationToken,
      encryptKey: process.env.FEISHU_ENCRYPT_KEY,
      webhookPort,
    };
  }

  async connect(): Promise<void> {
    // Initial token fetch
    await this.refreshToken();

    // Start webhook server
    await this.startWebhookServer();

    // Set up periodic token refresh (refresh 5 minutes before expiry)
    const refreshInterval = Math.max((this.tokenExpiry - Date.now()) - 5 * 60 * 1000, 5 * 60 * 1000);
    setInterval(() => {
      this.refreshToken().catch((err) => logger.error({ err }, 'Failed to refresh Feishu token'));
    }, refreshInterval);

    // Set up daily group sync
    if (!this.groupSyncTimerStarted) {
      this.groupSyncTimerStarted = true;
      setInterval(() => {
        this.syncGroupMetadata().catch((err) => logger.error({ err }, 'Periodic group sync failed'));
      }, GROUP_SYNC_INTERVAL_MS);
    }

    this.connected = true;
    logger.info('Connected to Feishu');
  }

  private async startWebhookServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleWebhookRequest(req, res).catch((err) => {
          logger.error({ err }, 'Error handling webhook request');
          res.statusCode = 500;
          res.end('Internal Server Error');
        });
      });

      this.server.listen(this.config.webhookPort, () => {
        logger.info({ port: this.config.webhookPort }, 'Feishu webhook server started');
        resolve();
      });

      this.server.on('error', (err) => {
        reject(err);
      });
    });
  }

  private async handleWebhookRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url || '/', `http://localhost:${this.config.webhookPort}`);

    if (url.pathname !== '/webhook/feishu') {
      res.statusCode = 404;
      res.end('Not Found');
      return;
    }

    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.end('Method Not Allowed');
      return;
    }

    // Read body
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks).toString('utf-8');

    // Verify signature if encrypt key is configured
    if (this.config.encryptKey) {
      const signature = req.headers['x-lark-signature'] as string;
      if (!signature || !this.verifySignature(body, signature)) {
        logger.warn('Invalid Feishu webhook signature');
        res.statusCode = 401;
        res.end('Unauthorized');
        return;
      }
    }

    let payload: any;
    try {
      payload = JSON.parse(body);
    } catch (err) {
      logger.warn({ body }, 'Invalid JSON in Feishu webhook');
      res.statusCode = 400;
      res.end('Bad Request');
      return;
    }

    // Handle URL verification challenge
    if (payload.type === 'url_verification') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ challenge: payload.challenge }));
      return;
    }

    // Handle event callback
    if (payload.schema === '2.0' && payload.header && payload.event) {
      const event = payload as FeishuEvent;

      // Verify token
      if (event.header.token !== this.config.verificationToken) {
        logger.warn('Invalid Feishu verification token');
        res.statusCode = 401;
        res.end('Unauthorized');
        return;
      }

      // Acknowledge receipt immediately
      res.statusCode = 200;
      res.end('OK');

      // Process event asynchronously
      this.processEvent(event).catch((err) => {
        logger.error({ err }, 'Error processing Feishu event');
      });
      return;
    }

    res.statusCode = 400;
    res.end('Bad Request');
  }

  private verifySignature(body: string, signature: string): boolean {
    const hmac = crypto.createHmac('sha256', this.config.encryptKey!);
    hmac.update(body);
    const computed = hmac.digest('base64');
    return computed === signature;
  }

  private async processEvent(event: FeishuEvent): Promise<void> {
    const eventType = event.header.event_type;

    if (eventType === 'im.message.receive_v1') {
      await this.handleMessageEvent(event);
    } else {
      logger.debug({ eventType }, 'Unhandled Feishu event type');
    }
  }

  private async handleMessageEvent(event: FeishuEvent): Promise<void> {
    const { sender, message } = event.event;

    // Skip messages from the bot itself
    if (sender.sender_type === 'app') {
      return;
    }

    const chatId = message.chat_id;
    const chatJid = `feishu_${chatId}@feishu.net`;
    const timestamp = new Date(parseInt(message.create_time)).toISOString();

    // Notify about chat metadata
    this.opts.onChatMetadata(chatJid, timestamp);

    // Only process messages for registered groups
    const groups = this.opts.registeredGroups();
    if (!groups[chatJid]) {
      return;
    }

    // Parse message content
    let content: FeishuMessageContent = {};
    try {
      content = JSON.parse(message.content);
    } catch (err) {
      logger.warn({ content: message.content }, 'Failed to parse Feishu message content');
      return;
    }

    const text = content.text || '';
    const senderName = sender.sender_id.user_id || sender.sender_id.open_id || 'Unknown';

    this.opts.onMessage(chatJid, {
      id: message.message_id,
      chat_jid: chatJid,
      sender: sender.sender_id.open_id || sender.sender_id.user_id || '',
      sender_name: senderName,
      content: text,
      timestamp,
      is_from_me: false,
    });
  }

  private async refreshToken(): Promise<void> {
    try {
      const response = await fetch(`${FEISHU_API_BASE}/auth/v3/tenant_access_token/internal`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          app_id: this.config.appId,
          app_secret: this.config.appSecret,
        }),
      });

      if (!response.ok) {
        throw new Error(`Token refresh failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as { code: number; msg: string; tenant_access_token: string; expire: number };

      if (data.code !== 0) {
        throw new Error(`Token refresh error: ${data.msg}`);
      }

      this.tenantToken = data.tenant_access_token;
      this.tokenExpiry = Date.now() + data.expire * 1000;
      logger.debug('Feishu tenant token refreshed');
    } catch (err) {
      logger.error({ err }, 'Failed to refresh Feishu token');
      throw err;
    }
  }

  private async ensureToken(): Promise<string> {
    if (!this.tenantToken || Date.now() >= this.tokenExpiry - 5 * 60 * 1000) {
      await this.refreshToken();
    }
    return this.tenantToken!;
  }

  async sendMessage(chatId: string, text: string): Promise<void> {
    // chatId for Feishu is feishu_{chatId}@feishu.net, extract the actual chat ID
    const actualChatId = chatId.replace(/^feishu_/, '').replace(/@feishu\.net$/, '');

    if (!this.connected) {
      this.outgoingQueue.push({ chatId: actualChatId, text });
      logger.info({ chatId, length: text.length, queueSize: this.outgoingQueue.length }, 'Feishu disconnected, message queued');
      return;
    }

    try {
      await this.sendMessageToFeishu(actualChatId, text);
      logger.info({ chatId, length: text.length }, 'Message sent to Feishu');
    } catch (err) {
      this.outgoingQueue.push({ chatId: actualChatId, text });
      logger.warn({ chatId, err, queueSize: this.outgoingQueue.length }, 'Failed to send to Feishu, message queued');
    }
  }

  private async sendMessageToFeishu(chatId: string, text: string): Promise<void> {
    const token = await this.ensureToken();

    const response = await fetch(`${FEISHU_API_BASE}/im/v1/messages?receive_id_type=chat_id`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        receive_id: chatId,
        msg_type: 'text',
        content: JSON.stringify({ text }),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to send message: ${response.status} ${errorText}`);
    }

    const data = await response.json() as { code: number; msg?: string };
    if (data.code !== 0) {
      throw new Error(`Feishu API error: ${data.msg}`);
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  ownsJid(jid: string): boolean {
    return jid.endsWith('@feishu.net');
  }

  async setTyping(jid: string, isTyping: boolean): Promise<void> {
    // Feishu doesn't have a direct typing indicator API for bots
    // This is a no-op but satisfies the interface
    logger.debug({ jid, isTyping }, 'Feishu typing indicator not supported');
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    if (this.server) {
      return new Promise((resolve) => {
        this.server!.close(() => {
          logger.info('Feishu webhook server stopped');
          resolve();
        });
      });
    }
  }

  /**
   * Sync group metadata from Feishu.
   * Fetches chat information and stores names in the database.
   */
  async syncGroupMetadata(force = false): Promise<void> {
    if (!force) {
      const lastSync = getLastGroupSync();
      if (lastSync) {
        const lastSyncTime = new Date(lastSync).getTime();
        if (Date.now() - lastSyncTime < GROUP_SYNC_INTERVAL_MS) {
          logger.debug({ lastSync }, 'Skipping Feishu group sync - synced recently');
          return;
        }
      }
    }

    try {
      logger.info('Syncing group metadata from Feishu...');
      const token = await this.ensureToken();

      // Fetch chats the bot is in
      const response = await fetch(`${FEISHU_API_BASE}/im/v1/chats`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch chats: ${response.status}`);
      }

      const data = await response.json() as { code: number; msg?: string; data?: { items?: Array<{ chat_id?: string; name?: string }> } };
      if (data.code !== 0) {
        throw new Error(`Feishu API error: ${data.msg}`);
      }

      let count = 0;
      for (const chat of data.data?.items || []) {
        if (chat.chat_id && chat.name) {
          const chatJid = `feishu_${chat.chat_id}@feishu.net`;
          updateChatName(chatJid, chat.name);
          count++;
        }
      }

      setLastGroupSync();
      logger.info({ count }, 'Feishu group metadata synced');
    } catch (err) {
      logger.error({ err }, 'Failed to sync Feishu group metadata');
    }
  }

  private async flushOutgoingQueue(): Promise<void> {
    if (this.flushing || this.outgoingQueue.length === 0) return;
    this.flushing = true;
    try {
      logger.info({ count: this.outgoingQueue.length }, 'Flushing Feishu outgoing message queue');
      while (this.outgoingQueue.length > 0) {
        const item = this.outgoingQueue.shift()!;
        await this.sendMessageToFeishu(item.chatId, item.text);
      }
    } finally {
      this.flushing = false;
    }
  }
}
