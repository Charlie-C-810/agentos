/**
 * 飞书接入：WS 长连接收消息 + REST 回消息。
 */
import * as Lark from '@larksuiteoapi/node-sdk'
import { parseMentions, type Mention } from './message-parser.js'
import { extname, join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { CardJson } from './card.js'

const CONTENT_TYPE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/x-icon': 'ico',
}

export interface IncomingMessage {
  messageId: string
  chatId: string
  chatType: string
  messageType: string
  text: string
  rootId: string
  threadId: string
  senderOpenId: string
  mentions: Mention[]
  rawContent: string
}

export interface BotOptions {
  appId: string
  appSecret: string
  onMessage: (msg: IncomingMessage, bot: Bot) => Promise<void>
}

export interface Bot {
  client: Lark.Client
  reply: (
    messageId: string,
    text: string,
    replyInThread?: boolean,
  ) => Promise<string | undefined>
  downloadResource: (
    messageId: string,
    fileKey: string,
    type: 'image' | 'file',
    saveDir: string,
    fileName?: string,
  ) => Promise<string>
  replyCard: (
    messageId: string,
    card: CardJson,
    replyInThread?: boolean,
  ) => Promise<string | undefined>
  updateCard: (messageId: string, card: CardJson) => Promise<void>
}

function getHeader(headers: any, name: string): string {
  const value =
    typeof headers?.get === 'function'
      ? headers.get(name)
      : (headers?.[name] ?? headers?.[name.toLowerCase()])
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '')
}

function resourceExtension(
  type: 'image' | 'file',
  fileName: string | undefined,
  contentType: string,
): string {
  const original = fileName ? extname(fileName).slice(1).toLowerCase() : ''
  if (/^[a-z0-9]{1,10}$/.test(original)) return original

  const mime = contentType.split(';', 1)[0].trim().toLowerCase()
  return CONTENT_TYPE_EXTENSIONS[mime] ?? (type === 'image' ? 'img' : 'bin')
}

function extractText(messageType: string, content: string): string {
  const parsed = JSON.parse(content)
  if (messageType === 'text') {
    return parsed.text ?? ''
  }
  if (messageType === 'post') {
    const paragraphs: any[][] = parsed.content ?? []
    return paragraphs
      .flat()
      .filter((el) => el.tag === 'text')
      .map((el) => el.text)
      .join('')
      .trim()
  }
  return ''
}

export function startBot(opts: BotOptions): Bot {
  const { appId, appSecret, onMessage } = opts

  const client = new Lark.Client({ appId, appSecret })

  const bot: Bot = {
    client,
    async reply(messageId, text, replyInThread = false) {
      const res = await client.im.v1.message.reply({
        path: { message_id: messageId },
        data: {
          msg_type: 'text',
          content: JSON.stringify({ text }),
          ...(replyInThread ? { reply_in_thread: true } : {}),
        },
      })
      return res.data?.message_id
    },
    async replyCard(messageId, card, replyInThread = false) {
      const res = await client.im.v1.message.reply({
        path: { message_id: messageId },
        data: {
          msg_type: 'interactive',
          content: JSON.stringify(card),
          ...(replyInThread ? { reply_in_thread: true } : {}),
        },
      })
      return res.data?.message_id
    },
    async updateCard(messageId, card) {
      await client.im.v1.message.patch({
        path: { message_id: messageId },
        data: { content: JSON.stringify(card) },
      })
    },
    async downloadResource(messageId, fileKey, type, saveDir, fileName) {
      const res = await client.im.v1.messageResource.get({
        path: { message_id: messageId, file_key: fileKey },
        params: { type },
      })
      const contentType = getHeader(res.headers, 'content-type')
      const extension = resourceExtension(type, fileName, contentType)
      const savePath = join(saveDir, `${fileKey}.${extension}`)
      await mkdir(saveDir, { recursive: true })
      await res.writeFile(savePath)
      return savePath
    },
  }

  const dispatcher = new Lark.EventDispatcher({}).register({
    'im.message.receive_v1': async (data) => {
      const m = data.message
      const msg: IncomingMessage = {
        messageId: m.message_id,
        chatId: m.chat_id,
        chatType: m.chat_type,
        messageType: m.message_type,
        text: extractText(m.message_type, m.content),
        senderOpenId: data.sender.sender_id?.open_id ?? '',
        rootId: m.root_id ?? '',
        threadId: m.thread_id ?? '',
        mentions: parseMentions(m.mentions),
        rawContent: m.content,
      }
      await onMessage(msg, bot)
    },
  })

  const wsClient = new Lark.WSClient({ appId, appSecret })
  wsClient.start({ eventDispatcher: dispatcher })

  return bot
}
