import * as Lark from '@larksuiteoapi/node-sdk';

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
  prefixAssistantName = false;


  private connected = false;
  private wsClient: Lark.WSClient | null = null;
  private eventDispatcher: Lark.EventDispatcher | null = null;
  private groupSyncTimerStarted = false;
  private outgoingQueue: Array<{ chatId: string; text: string }> = [];
  private flushing = false;

  private opts: FeishuChannelOpts;
  private config: {
    appId: string;
    appSecret: string;
  };

  constructor(opts: FeishuChannelOpts) {
    this.opts = opts;


    // Load configuration from environment
    const appId = process.env.FEISHU_APP_ID;
    const appSecret = process.env.FEISHU_APP_SECRET;


    if (!appId || !appSecret) {
      throw new Error(
        'Missing Feishu configuration. Set FEISHU_APP_ID and FEISHU_APP_SECRET environment variables.',
      );
    }


    this.config = {
      appId,
      appSecret,
    };
  }

  async connect(): Promise<void> {
    try {
      // Create WebSocket client
      this.wsClient = new Lark.WSClient({
        appId: this.config.appId,
        appSecret: this.config.appSecret,
      });

      // Create event dispatcher and register handlers
      this.eventDispatcher = new Lark.EventDispatcher({});
      this.eventDispatcher.register({
        'im.message.receive_v1': async (data: any) => {
          logger.info({ eventType: 'im.message.receive_v1', hasEvent: !!data?.event, hasMessage: !!data?.event?.message }, 'Feishu message event received');
          await this.handleMessageEvent(data);
        },
      });
      this.eventDispatcher.register({
        'im.chat.access_event.bot_p2p_chat_entered_v1': async (data: any) => {
          logger.info({ eventType: 'bot_p2p_chat_entered', data }, 'User entered p2p chat with bot');
        },
      });
      this.eventDispatcher.register({
        'p2p_chat_create': async (data: any) => {
          logger.info({ eventType: 'p2p_chat_create', data }, 'P2P chat created');
        },
      });
      logger.info('Starting Feishu WebSocket connection...');
      // Start WebSocket connection
      await this.wsClient.start({
        eventDispatcher: this.eventDispatcher,
      });
      this.connected = true;
      logger.info('Connected to Feishu via WebSocket');
      // Set up daily group sync
      if (!this.groupSyncTimerStarted) {
        this.groupSyncTimerStarted = true;
        setInterval(() => {
          this.syncGroupMetadata().catch((err) => logger.error({ err }, 'Periodic group sync failed'));
        }, GROUP_SYNC_INTERVAL_MS);
      }
    } catch (err) {
      logger.error({ err }, 'Failed to connect to Feishu WebSocket');
      throw err;
    }
  }
  private async handleMessageEvent(data: any): Promise<void> {
    try {
      logger.info({ eventData: JSON.stringify(data).substring(0, 500) }, 'Received Feishu message event');
      // Handle both direct event data and nested event structure
      const eventData = data.event || data;
      const { sender, message } = eventData;
      // Skip messages from the bot itself
      if (sender.sender_type === 'app') {
        logger.info({ sender }, 'Skipping message from app/bot itself');
        return;
      }
      const chatId = message.chat_id;
      const chatJid = `feishu_${chatId}@feishu.net`;
      const timestamp = new Date(parseInt(message.create_time)).toISOString();
      // Notify about chat metadata
      this.opts.onChatMetadata(chatJid, timestamp);
      // Only process messages for registered groups (temporarily disabled for testing)
      const groups = this.opts.registeredGroups();
      if (!groups[chatJid]) {
        logger.info({ chatJid, text: message.content?.substring(0, 50) }, 'Received message from unregistered group (processing anyway)');
        // Auto-register this group for testing
        // return;
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
  async sendMessage(chatId: string, text: string): Promise<void> {
    const actualChatId = chatId.replace(/^feishu_/, '').replace(/@feishu\.net$/, '');
    if (!this.connected || !this.wsClient) {
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
    // Note: For WebSocket mode, we need to use the HTTP client to send messages
    // Create a temporary client for sending messages
    const client = new Lark.Client({
      appId: this.config.appId,
      appSecret: this.config.appSecret,
    });
    await client.im.message.create({
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
    if (this.wsClient) {
      // Note: WSClient doesn't have a disconnect method in the SDK
      // The connection will be closed when the process exits
      this.wsClient = null;
    }
    this.eventDispatcher = null;
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
      // Create a temporary client for API calls
      const client = new Lark.Client({
        appId: this.config.appId,
        appSecret: this.config.appSecret,
      });
      // Get chats using SDK
      const resp = await client.im.chat.list({
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
