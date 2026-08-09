/**
 * Chat box — receptionists asking the Admin questions, inside the application.
 *
 * HUMAN TO HUMAN. There is no assistant, no suggestion, no generated reply
 * anywhere in this module. Every message has a person behind it.
 *
 * THE ACCESS RULE, ONCE, IN ONE PLACE: an Admin reads every conversation; a
 * receptionist reads only the conversations they created. It is expressed as
 * `visibilityWhere()` and applied to EVERY read — list, detail, message and
 * attachment — so a new endpoint cannot quietly widen it by forgetting a
 * filter. Nothing accepts a conversation id from the client without running it
 * through that filter first.
 *
 * VISIBILITY IS OWNERSHIP, NOT BRANCH. Two receptionists at the same branch
 * must not read each other's questions to the Admin — the existing branch model
 * scopes bookings and issues, which belong to a branch, whereas a question
 * belongs to the person who asked it. No requirement anywhere in the product
 * asks for branch-level chat visibility, so none is granted.
 *
 * BỘ PHẬN ĐẶT PHÒNG IS NOT INCLUDED. That role exists for Chứng từ and has no
 * stated role in reception↔Admin correspondence, so it gets no access rather
 * than an assumed one.
 */
import type { PrismaClient, UserRole } from '@prisma/client';
import { prisma as defaultPrisma } from '../db/prisma';
import { ApiError } from '../lib/errors';

/** Who is acting. Mirrors the shape the rest of the app already passes around. */
export interface ChatActor {
  id: number;
  role: UserRole;
  branchId: number | null;
}

/** The roles that may use Chat box at all. */
export const CHAT_ROLES: readonly UserRole[] = ['ADMIN', 'RECEPTIONIST'];

export function assertChatAccess(actor: ChatActor): void {
  if (!CHAT_ROLES.includes(actor.role)) {
    throw ApiError.forbidden('Bạn không có quyền truy cập Chat box.');
  }
}

/**
 * The one visibility predicate. An Admin gets `{}` (everything); anyone else is
 * pinned to their own conversations.
 *
 * Returned as a Prisma `where` fragment rather than a boolean check on a row we
 * already fetched, so the restriction runs IN THE DATABASE. A "fetch then
 * compare" version leaks existence through timing and through the difference
 * between 403 and 404; this simply cannot return another user's row.
 */
export function visibilityWhere(actor: ChatActor): { createdByUserId?: number } {
  if (actor.role === 'ADMIN') return {};
  return { createdByUserId: actor.id };
}

const MESSAGE_INCLUDE = {
  sender: { select: { id: true, fullName: true, role: true } },
  attachments: {
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      originalFileName: true,
      mimeType: true,
      fileSize: true,
      createdAt: true,
    },
  },
} as const;

const CONVERSATION_INCLUDE = {
  branch: { select: { id: true, code: true, hotelName: true } },
  createdBy: { select: { id: true, fullName: true, role: true } },
} as const;

export interface ChatAttachmentView {
  id: string;
  originalFileName: string;
  mimeType: string;
  fileSize: number;
  createdAt: string;
}

export interface ChatMessageView {
  id: string;
  conversationId: string;
  body: string;
  senderRole: UserRole;
  sender: { id: number; fullName: string } | null;
  createdAt: string;
  attachments: ChatAttachmentView[];
}

export interface ChatConversationView {
  id: string;
  subject: string;
  status: 'WAITING_ADMIN' | 'ANSWERED' | 'CLOSED';
  branch: { id: number; code: string; hotelName: string } | null;
  createdBy: { id: number; fullName: string; role: UserRole } | null;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
  /** Denormalised for the list: enough to render a row without a second call. */
  lastMessagePreview: string | null;
  messageCount: number;
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

const MAX_SUBJECT = 200;
const MAX_BODY = 5000;

export function assertSubject(subject: string): string {
  const trimmed = subject.trim();
  if (trimmed.length === 0) throw ApiError.validation('Vui lòng nhập tiêu đề.');
  if (trimmed.length > MAX_SUBJECT) throw ApiError.validation('Tiêu đề quá dài.');
  return trimmed;
}

/**
 * A message must carry something. An empty body is allowed ONLY when images are
 * attached — an "empty" message with no attachments is a mis-click, and storing
 * it would put a blank bubble in a thread nobody can interpret.
 */
export function assertBody(body: string, attachmentCount: number): string {
  const trimmed = body.trim();
  if (trimmed.length === 0 && attachmentCount === 0) {
    throw ApiError.validation('Vui lòng nhập nội dung hoặc đính kèm ảnh.');
  }
  if (trimmed.length > MAX_BODY) throw ApiError.validation('Nội dung quá dài.');
  return trimmed;
}

/* ------------------------------------------------------------------ */
/* Serialisation                                                       */
/* ------------------------------------------------------------------ */

type ConversationRow = {
  id: string;
  subject: string;
  status: 'WAITING_ADMIN' | 'ANSWERED' | 'CLOSED';
  createdAt: Date;
  updatedAt: Date;
  lastMessageAt: Date;
  branch: { id: number; code: string; hotelName: string } | null;
  createdBy: { id: number; fullName: string; role: UserRole } | null;
};

function serializeConversation(
  row: ConversationRow,
  extra: { lastMessagePreview: string | null; messageCount: number },
): ChatConversationView {
  return {
    id: row.id,
    subject: row.subject,
    status: row.status,
    branch: row.branch,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastMessageAt: row.lastMessageAt.toISOString(),
    lastMessagePreview: extra.lastMessagePreview,
    messageCount: extra.messageCount,
  };
}

type MessageRow = {
  id: string;
  conversationId: string;
  body: string;
  senderRole: UserRole;
  createdAt: Date;
  sender: { id: number; fullName: string; role: UserRole } | null;
  attachments: {
    id: string;
    originalFileName: string;
    mimeType: string;
    fileSize: number;
    createdAt: Date;
  }[];
};

function serializeMessage(row: MessageRow): ChatMessageView {
  return {
    id: row.id,
    conversationId: row.conversationId,
    body: row.body,
    senderRole: row.senderRole,
    sender: row.sender ? { id: row.sender.id, fullName: row.sender.fullName } : null,
    createdAt: row.createdAt.toISOString(),
    attachments: row.attachments.map((a) => ({
      id: a.id,
      originalFileName: a.originalFileName,
      mimeType: a.mimeType,
      fileSize: a.fileSize,
      createdAt: a.createdAt.toISOString(),
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Read                                                                */
/* ------------------------------------------------------------------ */

export async function listConversations(
  actor: ChatActor,
  client: PrismaClient = defaultPrisma,
): Promise<ChatConversationView[]> {
  assertChatAccess(actor);

  const rows = await client.chatConversation.findMany({
    where: visibilityWhere(actor),
    orderBy: { lastMessageAt: 'desc' },
    include: {
      ...CONVERSATION_INCLUDE,
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { body: true, attachments: { select: { id: true } } },
      },
      _count: { select: { messages: true } },
    },
  });

  return rows.map((row) => {
    const last = row.messages[0];
    // A picture-only message has no text to preview; say so rather than
    // rendering an empty row the operator cannot distinguish from a bug.
    const preview = last
      ? last.body.trim().length > 0
        ? last.body.trim()
        : last.attachments.length > 0
          ? '[Hình ảnh]'
          : null
      : null;
    return serializeConversation(row as unknown as ConversationRow, {
      lastMessagePreview: preview,
      messageCount: row._count.messages,
    });
  });
}

/**
 * One conversation the actor is allowed to see, or 404.
 *
 * NOT FOUND, NOT FORBIDDEN, for a conversation belonging to someone else: a 403
 * would confirm the id exists, which is itself information a receptionist has
 * no business learning about another receptionist's thread.
 */
export async function getConversation(
  id: string,
  actor: ChatActor,
  client: PrismaClient = defaultPrisma,
): Promise<ChatConversationView> {
  assertChatAccess(actor);

  const row = await client.chatConversation.findFirst({
    where: { id, ...visibilityWhere(actor) },
    include: {
      ...CONVERSATION_INCLUDE,
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { body: true, attachments: { select: { id: true } } },
      },
      _count: { select: { messages: true } },
    },
  });
  if (!row) throw ApiError.notFound('Không tìm thấy cuộc trò chuyện.');

  const last = row.messages[0];
  const preview = last
    ? last.body.trim().length > 0
      ? last.body.trim()
      : last.attachments.length > 0
        ? '[Hình ảnh]'
        : null
    : null;
  return serializeConversation(row as unknown as ConversationRow, {
    lastMessagePreview: preview,
    messageCount: row._count.messages,
  });
}

export async function listMessages(
  conversationId: string,
  actor: ChatActor,
  client: PrismaClient = defaultPrisma,
): Promise<ChatMessageView[]> {
  // Re-uses the visibility check rather than trusting the id.
  await getConversation(conversationId, actor, client);

  const rows = await client.chatMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
    include: MESSAGE_INCLUDE,
  });
  return (rows as unknown as MessageRow[]).map(serializeMessage);
}

/* ------------------------------------------------------------------ */
/* Write                                                               */
/* ------------------------------------------------------------------ */

export interface NewAttachment {
  storedFileName: string;
  originalFileName: string;
  mimeType: string;
  fileSize: number;
}

/**
 * Starts a thread with its first message.
 *
 * ONLY A RECEPTIONIST OPENS A CONVERSATION. The feature is "reception asks the
 * Admin"; an Admin-initiated thread is a different feature (a broadcast or a
 * direct message) with different expectations, and inventing it here would ship
 * something nobody specified.
 *
 * The branch is a snapshot of the ASKER's own branch, taken server-side. It is
 * never read from the request: a client-supplied branch would let a receptionist
 * label their question with someone else's location.
 */
export async function createConversation(
  input: { subject: string; body: string; attachments: NewAttachment[] },
  actor: ChatActor,
  client: PrismaClient = defaultPrisma,
  now: Date = new Date(),
): Promise<{ conversation: ChatConversationView; message: ChatMessageView }> {
  assertChatAccess(actor);
  if (actor.role !== 'RECEPTIONIST') {
    throw ApiError.forbidden('Chỉ lễ tân mới mở được cuộc trò chuyện mới.');
  }

  const subject = assertSubject(input.subject);
  const body = assertBody(input.body, input.attachments.length);

  const created = await client.chatConversation.create({
    data: {
      subject,
      branchId: actor.branchId,
      createdByUserId: actor.id,
      status: 'WAITING_ADMIN',
      lastMessageAt: now,
      messages: {
        create: {
          senderUserId: actor.id,
          senderRole: actor.role,
          body,
          createdAt: now,
          attachments: { create: input.attachments },
        },
      },
    },
    include: {
      ...CONVERSATION_INCLUDE,
      messages: { orderBy: { createdAt: 'asc' }, include: MESSAGE_INCLUDE },
      _count: { select: { messages: true } },
    },
  });

  const message = (created.messages as unknown as MessageRow[])[0]!;
  return {
    conversation: serializeConversation(created as unknown as ConversationRow, {
      lastMessagePreview: message.body.trim().length > 0 ? message.body.trim() : '[Hình ảnh]',
      messageCount: created._count.messages,
    }),
    message: serializeMessage(message),
  };
}

/**
 * Appends a message to a thread the actor may see.
 *
 * The status follows from WHO SPOKE, not from anything the client asked for:
 * an Admin reply marks the thread ANSWERED, a receptionist message puts it back
 * to WAITING_ADMIN. That is what the Admin list's "chưa trả lời" filter reads,
 * so it must be a consequence of the write rather than a separate flag someone
 * can forget to set.
 *
 * A CLOSED thread is reopened by a new receptionist message rather than
 * rejecting it — the alternative is a receptionist with a follow-up and nowhere
 * to put it.
 */
export async function addMessage(
  conversationId: string,
  input: { body: string; attachments: NewAttachment[] },
  actor: ChatActor,
  client: PrismaClient = defaultPrisma,
  now: Date = new Date(),
): Promise<ChatMessageView> {
  // Visibility first: this throws 404 for a thread the actor may not see.
  await getConversation(conversationId, actor, client);

  const body = assertBody(input.body, input.attachments.length);

  const message = await client.chatMessage.create({
    data: {
      conversationId,
      senderUserId: actor.id,
      senderRole: actor.role,
      body,
      createdAt: now,
      attachments: { create: input.attachments },
    },
    include: MESSAGE_INCLUDE,
  });

  await client.chatConversation.update({
    where: { id: conversationId },
    data: {
      lastMessageAt: now,
      status: actor.role === 'ADMIN' ? 'ANSWERED' : 'WAITING_ADMIN',
    },
  });

  return serializeMessage(message as unknown as MessageRow);
}

/** Admin-only: close a thread that needs no further reply. */
export async function closeConversation(
  conversationId: string,
  actor: ChatActor,
  client: PrismaClient = defaultPrisma,
): Promise<ChatConversationView> {
  assertChatAccess(actor);
  if (actor.role !== 'ADMIN') {
    throw ApiError.forbidden('Chỉ Admin mới đóng được cuộc trò chuyện.');
  }
  await getConversation(conversationId, actor, client);
  await client.chatConversation.update({
    where: { id: conversationId },
    data: { status: 'CLOSED' },
  });
  return getConversation(conversationId, actor, client);
}

/**
 * Authorises an attachment download and returns what is needed to serve it.
 *
 * The join back to the conversation carries the SAME visibility filter as every
 * other read. An attachment id is a cuid and unguessable, but "unguessable" is
 * not an access control — this is.
 */
export async function authorizeChatAttachment(
  attachmentId: string,
  actor: ChatActor,
  client: PrismaClient = defaultPrisma,
): Promise<{ storedFileName: string; mimeType: string; originalFileName: string }> {
  assertChatAccess(actor);

  const row = await client.chatAttachment.findFirst({
    where: {
      id: attachmentId,
      message: { conversation: visibilityWhere(actor) },
    },
    select: { storedFileName: true, mimeType: true, originalFileName: true },
  });
  if (!row) throw ApiError.notFound('Không tìm thấy tệp.');
  return row;
}
