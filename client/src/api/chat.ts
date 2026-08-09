/**
 * Chat box — the receptionist↔Admin question thread.
 *
 * IMAGES ARE NEVER ADDRESSED BY A PUBLIC URL. `attachmentUrl` points at an
 * authenticated endpoint that re-checks, per request, that the caller may read
 * the conversation the image belongs to. The stored file name never appears
 * here and is not something this module can construct a path from.
 *
 * There is no realtime transport in this application, so the conversation view
 * polls. See `CHAT_POLL_MS`.
 */
import { api } from './client';

export type ChatConversationStatus = 'WAITING_ADMIN' | 'ANSWERED' | 'CLOSED';

export const CHAT_STATUS_LABEL: Record<ChatConversationStatus, string> = {
  WAITING_ADMIN: 'Chờ Admin trả lời',
  ANSWERED: 'Đã trả lời',
  CLOSED: 'Đã đóng',
};

export const CHAT_STATUS_TONE: Record<ChatConversationStatus, string> = {
  WAITING_ADMIN: 'bg-amber-50 text-amber-700 ring-amber-200',
  ANSWERED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  CLOSED: 'bg-slate-100 text-slate-600 ring-slate-200',
};

/**
 * How often an open conversation re-reads its messages.
 *
 * Six seconds is a deliberate compromise: fast enough that a reply feels
 * immediate in a conversation people are actively having, slow enough that a
 * screen left open all day is a rounding error against the rest of the app's
 * traffic. It is only polled while a conversation is open, never from the list.
 */
export const CHAT_POLL_MS = 6000;

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
  senderRole: 'ADMIN' | 'RECEPTIONIST' | 'BOOKING_DEPARTMENT';
  sender: { id: number; fullName: string } | null;
  createdAt: string;
  attachments: ChatAttachmentView[];
}

export interface ChatConversationView {
  id: string;
  subject: string;
  status: ChatConversationStatus;
  branch: { id: number; code: string; hotelName: string } | null;
  createdBy: { id: number; fullName: string; role: string } | null;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
  lastMessagePreview: string | null;
  messageCount: number;
}

/** The authenticated bytes endpoint. Never a public or guessable file path. */
export function chatAttachmentUrl(attachmentId: string): string {
  return `/api/chat/attachments/${attachmentId}/file`;
}

export const chatApi = {
  listConversations: () =>
    api.get<{ conversations: ChatConversationView[] }>('/chat/conversations'),

  conversation: (id: string) =>
    api.get<{ conversation: ChatConversationView }>(`/chat/conversations/${id}`),

  messages: (id: string) =>
    api.get<{ messages: ChatMessageView[] }>(`/chat/conversations/${id}/messages`),

  createConversation: (subject: string, body: string, images: File[]) => {
    const form = new FormData();
    form.append('subject', subject);
    form.append('body', body);
    for (const image of images) form.append('images', image);
    return api.postForm<{ conversation: ChatConversationView; message: ChatMessageView }>(
      '/chat/conversations',
      form,
    );
  },

  sendMessage: (id: string, body: string, images: File[]) => {
    const form = new FormData();
    form.append('body', body);
    for (const image of images) form.append('images', image);
    return api.postForm<{ message: ChatMessageView }>(
      `/chat/conversations/${id}/messages`,
      form,
    );
  },

  close: (id: string) =>
    api.post<{ conversation: ChatConversationView }>(`/chat/conversations/${id}/close`),
};
