import { useEffect, useState } from 'react';
import { api } from '../api';
import { Button } from './dashboard-ui';
import { entityTypeLabels } from '../lib/dictionaries';
import { fmtDate } from '../lib/format';

export function CommentsPanel({ entityType, entityId, title = 'Комментарии' }: { entityType: string; entityId: string; title?: string }) {
  const [open, setOpen] = useState(false);
  const [comments, setComments] = useState<any[]>([]);
  const [body, setBody] = useState('');
  const [msg, setMsg] = useState('');

  async function load() {
    setComments(await api(`/api/comments?entity_type=${encodeURIComponent(entityType)}&entity_id=${encodeURIComponent(entityId)}`));
  }

  async function send() {
    const value = body.trim();
    if (!value) return;
    const result = await api('/api/comments', { method: 'POST', body: JSON.stringify({ entity_type: entityType, entity_id: entityId, body: value }) });
    setBody('');
    setMsg(result?.offline ? 'Комментарий сохранён офлайн' : '');
    load().catch(() => undefined);
  }

  useEffect(() => {
    if (open) load().catch(() => setComments([]));
  }, [open, entityType, entityId]);

  const titleLabel = entityTypeLabels[entityType] ? `${title} · ${entityTypeLabels[entityType]}` : title;

  return <div className="commentsPanel">
    <button type="button" className="commentsToggle" onClick={() => setOpen(!open)}>{titleLabel} {open ? '↑' : '↓'}</button>
    {open && <div className="commentsBody">
      {comments.length === 0 && <span className="muted">Комментариев пока нет</span>}
      {comments.map(comment => <div className="commentItem" key={comment.id}>
        <strong>{comment.user?.name || 'Сотрудник'}</strong>
        <span>{comment.body}</span>
        <em>{fmtDate(comment.created_at)}</em>
      </div>)}
      <div className="commentComposer">
        <input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Написать комментарий" />
        <Button type="button" kind="soft" onClick={send}>Отправить</Button>
      </div>
      {msg && <div className="notice">{msg}</div>}
    </div>}
  </div>;
}
