import { Client, EventDispatcher } from '@larksuiteoapi/node-sdk';

import { FEISHU_ASSISTANT_NAME, FEISHU_TRIGGER_PATTERN } from '../config.js';
import {
  getLastGroupSync,
  setLastGroupSync,
  updateChatName,
} from '../db.js';
import { logger } from '../logger.js';
import { Channel, OnInboundMessage, OnChatMetadata, RegisteredGroup } from '../types.js';

const GROUP_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface FeishuChannelOpts {
  onMessage: OnInboundMessage;
  onChatMetadata: OnChatMetadata;
  registeredGroups: () => Record<string, RegisteredGroup>;
}

interface FeishuMessageContent {
  text?: string;
}

export class FeishuChannel implements Channel {
  name = 'feishu';
  prefixAssistantName = true;

  private connected = false;
  private client: Client | null = null;
  private dispatcher: EventDispatcher | null = null;
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
    };
  }

  async connect(): Promise<void> {
    // Create Lark SDK client
    this.client = new Client({
      appId: this.config.appId,
      appSecret: this.config.appSecret,
    });

    // Create event dispatcher for WebSocket connection
    this.dispatcher = new EventDispatcher({
      verificationToken: this.config.verificationToken,
    });

    // Register message handler
    this.dispatcher.on('im.message.receive_v1', async (data) => {
      await this.handleMessageEvent(data);
    });

    // Start WebSocket connection using SDK
    try {
      // The SDK handles WebSocket connection internally
      logger.info('Connecting to Feishu via SDK WebSocket...');

      // Set up periodic token refresh
      const refreshInterval = 5 * 60 * 1000; // 5 minutes
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
      logger.info('Connected to Feishu via SDK');
    } catch (err) {
      logger.error({ err }, 'Failed to connect to Feishu via SDK');
      throw err;
    }
  }

  private async handleMessageEvent(data: any): Promise<void> {
    try {
      const { sender, message } = data.event;

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
    } catch (err) {
      logger.error({ err }, 'Failed to handle Feishu message event');
    }
  }

  private async refreshToken(): Promise<void> {
    try {
      if (!this.client) {
        throw new Error('Client not initialized');
      }

      // Get tenant access token using SDK
      const resp = await this.client.request({
        method: 'POST',
        url: '/auth/v3/tenant_access_token/internal',
        data: {
          app_id: this.config.appId,
          app_secret: this.config.appSecret,
        },
      });

      const data = resp as { tenant_access_token: string; expire: number };
      this.tenantToken = data.tenant_access_token;
      this.tokenExpiry = Date.now() + data.expire * 1000;
      logger.debug('Feishu tenant token refreshed');
    } catch (err) {
      logger.error({ err }, 'Failed to refresh Feishu token');
      throw err;
    }
  }

  async sendMessage(chatId: string, text: string): Promise<void> {
    const actualChatId = chatId.replace(/^feishu_/, '').replace(/@feishu\.net$/, '');

    if (!this.connected || !this.client) {
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
    if (!this.client) {
      throw new Error('Client not initialized');
    }

    await this.client.im.message.create({
      params: {
        receive_id_type: 'chat_id',
      },
      data: {
        receive_id: chatId,
        msg_type: 'text',
        content: JSON.stringify({ text }),
      },
    });
  }

  isConnected(): boolean {
    return this.connected;
  }

  ownsJid(jid: string): boolean {
    return jid.endsWith('@feishu.net');
  }

  async setTyping(jid: string, isTyping: boolean): Promise<void> {
    // Feishu doesn't have a direct typing indicator API for bots
    logger.debug({ jid, isTyping }, 'Feishu typing indicator not supported');
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.dispatcher = null;
    this.client = null;
    logger.info('Feishu SDK disconnected');
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

      if (!this.client) {
        throw new Error('Client not initialized');
      }

      // Get chats using SDK
      const resp = await this.client.im.chat.list({
        params: {},
      });

      const data = resp as { items?: Array<{ chat_id?: string; name?: string }> };
      let count = 0;
      for (const chat of data.items || []) {
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
