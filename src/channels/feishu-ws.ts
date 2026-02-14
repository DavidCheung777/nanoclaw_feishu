import crypto from 'crypto';
import WebSocket from 'ws';

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
const WS_RECONNECT_INTERVAL = 5000; // 5 seconds
const WS_HEARTBEAT_INTERVAL = 30000; // 30 seconds

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
  private ws: WebSocket | null = null;
  private wsUrl: string;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
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
  };

  constructor(opts: FeishuChannelOpts) {
    this.opts = opts;

    // Load configuration from environment
    const appId = process.env.FEISHU_APP_ID;
    const appSecret = process.env.FEISHU_APP_SECRET;
    const verificationToken = process.env.FEISHU_VERIFICATION_TOKEN;

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
    };

    // WebSocket URL for Feishu event subscription
    this.wsUrl = `wss://ws-open.feishu.cn/event?app_id=${appId}&token=${verificationToken}`;
  }

  async connect(): Promise<void> {
    // Initial token fetch
    await this.refreshToken();

    // Start WebSocket connection
    this.connectWebSocket();

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
  }

  private connectWebSocket(): void {
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
    }

    logger.info({ url: this.wsUrl.replace(/token=[^&]+/, 'token=***') }, 'Connecting to Feishu WebSocket');

    this.ws = new WebSocket(this.wsUrl, {
      headers: {
        'User-Agent': 'NanoClaw/1.0',
      },
    });

    this.ws.on('open', () => {
      logger.info('Feishu WebSocket connected');
      this.connected = true;
      this.startHeartbeat();
    });

    this.ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleWebSocketMessage(message);
      } catch (err) {
        logger.warn({ err, data: data.toString() }, 'Failed to parse WebSocket message');
      }
    });

    this.ws.on('error', (err) => {
      logger.error({ err }, 'Feishu WebSocket error');
    });

    this.ws.on('close', (code, reason) => {
      logger.warn({ code, reason: reason.toString() }, 'Feishu WebSocket closed');
      this.connected = false;
      this.stopHeartbeat();
      this.scheduleReconnect();
    });
  }

  private handleWebSocketMessage(message: any): void {
    logger.debug({ messageType: message.type }, 'Received WebSocket message');

    // Handle different message types from Feishu
    switch (message.type) {
      case 'im.message.receive_v1':
        this.handleMessageEvent(message.event);
        break;
      case 'url_verification':
        // Handle challenge for URL verification
        if (message.challenge) {
          this.ws?.send(JSON.stringify({ challenge: message.challenge }));
        }
        break;
      default:
        logger.debug({ type: message.type }, 'Unhandled message type');
    }
  }

  private handleMessageEvent(event: FeishuEvent): void {
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

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
        logger.debug('Sent WebSocket heartbeat');
      }
    }, WS_HEARTBEAT_INTERVAL);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    logger.info({ delay: WS_RECONNECT_INTERVAL }, 'Scheduling WebSocket reconnect');
    this.reconnectTimer = setTimeout(() => {
      this.connectWebSocket();
    }, WS_RECONNECT_INTERVAL);
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
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
    logger.info('Feishu WebSocket disconnected');
  }

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
