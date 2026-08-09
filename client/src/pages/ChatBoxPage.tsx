/**
 * Chat box — the conversation list.
 *
 * ONE SCREEN, TWO AUDIENCES. An Admin sees every thread and needs to know who
 * asked and from where, so the row carries the sender and branch. A
 * receptionist sees only their own and already knows both, so those columns
 * would be noise — the row leads with the subject instead.
 *
 * "Chưa trả lời" is the Admin's working set, and it is a SERVER-DERIVED status
 * (WAITING_ADMIN), not a guess made here from timestamps. The filter is a plain
 * client-side narrowing of the already-fetched list; the meaning of the word is
 * decided in `chatService`.
 *
 * Only a receptionist can open a thread. That is the feature as specified —
 * reception asks, Admin answers — and the server refuses anything else.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquarePlus, Paperclip } from 'lucide-react';
import {
  CHAT_STATUS_LABEL,
  CHAT_STATUS_TONE,
  chatApi,
  type ChatConversationStatus,
} from '../api/chat';
import { toUserMessage } from '../api/errors';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { ErrorAlert } from '../components/ErrorAlert';
import { EmptyState } from '../components/EmptyState';
import { PageHeader, QueryState } from '../components/PageState';
import { formatDateTime } from '../lib/format';
import { useAuth } from '../auth/AuthProvider';

export function ChatStatusChip({ status }: { status: ChatConversationStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${CHAT_STATUS_TONE[status]}`}
    >
      {CHAT_STATUS_LABEL[status]}
    </span>
  );
}

/** The receptionist's "ask a question" form. Collapsed until asked for. */
function NewConversationForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [images, setImages] = useState<File[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => chatApi.createConversation(subject.trim(), body.trim(), images),
    onSuccess: () => {
      setSubject('');
      setBody('');
      setImages([]);
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['chat-conversations'] });
      onDone();
    },
    onError: (err) => setFormError(toUserMessage(err)),
  });

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} data-testid="chat-new">
        <MessageSquarePlus className="h-4 w-4" aria-hidden="true" />
        Đặt câu hỏi
      </Button>
    );
  }

  return (
    <Card className="p-5">
      <p className="mb-3 text-sm font-semibold text-slate-700">Câu hỏi mới</p>
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-sm text-slate-600" htmlFor="chat-subject">
            Tiêu đề
          </label>
          <input
            id="chat-subject"
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            disabled={create.isPending}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm text-slate-600" htmlFor="chat-body">
            Nội dung
          </label>
          <textarea
            id="chat-body"
            className="min-h-[96px] w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            disabled={create.isPending}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm text-slate-600" htmlFor="chat-images">
            Ảnh đính kèm (không bắt buộc)
          </label>
          <input
            id="chat-images"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            className="block w-full text-sm text-slate-600"
            disabled={create.isPending}
            onChange={(e) => setImages(Array.from(e.target.files ?? []))}
          />
          {images.length > 0 ? (
            <p className="mt-1 text-xs text-slate-500">{images.length} ảnh đã chọn</p>
          ) : null}
        </div>
        {formError ? <ErrorAlert>{formError}</ErrorAlert> : null}
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={create.isPending}
            onClick={() => {
              setFormError(null);
              if (subject.trim().length === 0) {
                setFormError('Vui lòng nhập tiêu đề.');
                return;
              }
              if (body.trim().length === 0 && images.length === 0) {
                setFormError('Vui lòng nhập nội dung hoặc đính kèm ảnh.');
                return;
              }
              create.mutate();
            }}
          >
            {create.isPending ? 'Đang gửi…' : 'Gửi câu hỏi'}
          </Button>
          <Button
            variant="secondary"
            disabled={create.isPending}
            onClick={() => {
              setOpen(false);
              setFormError(null);
            }}
          >
            Huỷ
          </Button>
        </div>
      </div>
    </Card>
  );
}

export function ChatBoxPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const [onlyUnanswered, setOnlyUnanswered] = useState(false);

  const list = useQuery({
    queryKey: ['chat-conversations'],
    queryFn: () => chatApi.listConversations(),
  });

  const conversations = (list.data?.conversations ?? []).filter((c) =>
    onlyUnanswered ? c.status === 'WAITING_ADMIN' : true,
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Chat box"
        description={
          isAdmin
            ? 'Câu hỏi từ lễ tân. Mở một cuộc trò chuyện để trả lời.'
            : 'Đặt câu hỏi cho Admin và xem câu trả lời.'
        }
        actions={
          isAdmin ? (
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={onlyUnanswered}
                onChange={(e) => setOnlyUnanswered(e.target.checked)}
              />
              Chỉ hiện chưa trả lời
            </label>
          ) : undefined
        }
      />

      {!isAdmin ? <NewConversationForm onDone={() => list.refetch()} /> : null}

      <QueryState isLoading={list.isLoading} isError={list.isError} error={list.error}>
        {conversations.length === 0 ? (
          <EmptyState
            title="Chưa có cuộc trò chuyện nào"
            message={
              isAdmin ? 'Khi lễ tân đặt câu hỏi, nó sẽ xuất hiện ở đây.' : 'Hãy đặt câu hỏi đầu tiên.'
            }
          />
        ) : (
          <ul className="space-y-2" data-testid="chat-conversations">
            {conversations.map((c) => (
              <li key={c.id}>
                <Link
                  to={`/app/chat/${c.id}`}
                  className="block rounded-2xl border border-slate-200 bg-white px-4 py-3 transition hover:border-brand-300 hover:bg-brand-50/40"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-slate-900">{c.subject}</span>
                    <ChatStatusChip status={c.status} />
                  </div>
                  {isAdmin ? (
                    <p className="mt-0.5 text-xs text-slate-500">
                      {c.createdBy?.fullName ?? '—'}
                      {c.branch ? ` · ${c.branch.hotelName}` : ''}
                    </p>
                  ) : null}
                  <p className="mt-1 line-clamp-1 text-sm text-slate-600">
                    {c.lastMessagePreview ?? '—'}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    {formatDateTime(c.lastMessageAt)} · {c.messageCount} tin nhắn
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </QueryState>

      <p className="flex items-center gap-1.5 text-xs text-slate-400">
        <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
        Ảnh đính kèm chỉ hiển thị cho người trong cuộc trò chuyện.
      </p>
    </div>
  );
}
