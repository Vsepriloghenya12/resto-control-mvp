import { FormEvent, useEffect, useState } from 'react';
import { api } from '../../api';
import { AppIcon, Button, Card } from '../../components/dashboard-ui';
import { Field, Select, Textarea, Empty } from '../../components/form-controls';
import { SectionTitle } from '../../components/mobile-ui';
import { CommentsPanel } from '../../components/comments-panel';
import { cx } from '../../lib/cx';
import { executableRoles, targetTypeLabels, techRequestCategories, techRequestStatuses } from '../../lib/dictionaries';
import { fmtDate } from '../../lib/format';

export function Tasks({ user, admin = false, showTechComposer = false, onCloseComposer }: any) {
  const [tasks, setTasks] = useState<any[]>([]);
  const [techRequests, setTechRequests] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [form, setForm] = useState<any>({ title: '', description: '', target_type: 'all', target_role: 'waiter', target_user_id: '' });
  const [taskMsg, setTaskMsg] = useState('');
  const [techMsg, setTechMsg] = useState('');
  const [showTechForm, setShowTechForm] = useState(false);
  const [techForm, setTechForm] = useState<any>({ title: '', description: '', category: 'equipment' });
  const [techDrafts, setTechDrafts] = useState<any>({});

  async function load() {
    const [taskRows, techRows, userRows] = await Promise.all([
      api('/api/tasks'),
      api('/api/tech-requests'),
      admin ? api('/api/admin/users') : Promise.resolve([])
    ]);
    setTasks(taskRows);
    setTechRequests(techRows);
    if (admin) setUsers(userRows);
  }
  useEffect(() => { load(); }, []);
  async function create(e: FormEvent) {
    e.preventDefault();
    setTaskMsg('');
    const result = await api('/api/tasks', { method: 'POST', body: JSON.stringify(form) });
    setForm({ ...form, title: '', description: '' });
    setTaskMsg(result?.offline ? 'Задача сохранена офлайн' : 'Задача создана');
    load().catch(() => undefined);
  }
  async function done(id: string) {
    const result = await api(`/api/tasks/${id}/done`, { method: 'PATCH', body: JSON.stringify({ comment: '' }) });
    setTaskMsg(result?.offline ? 'Выполнение сохранено офлайн' : 'Задача выполнена');
    load().catch(() => undefined);
  }
  async function createTechRequest(e: FormEvent) {
    e.preventDefault();
    setTechMsg('');
    const result = await api('/api/tech-requests', { method: 'POST', body: JSON.stringify(techForm) });
    setTechForm({ title: '', description: '', category: 'equipment' });
    setTechMsg(result?.offline ? 'Техзаявка сохранена офлайн' : 'Техзаявка отправлена менеджеру');
    setShowTechForm(false);
    onCloseComposer?.();
    load();
  }
  async function updateTechRequest(request: any) {
    const draft = techDrafts[request.id] || {};
    const result = await api(`/api/tech-requests/${request.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: draft.status || request.status,
        manager_comment: draft.manager_comment !== undefined ? draft.manager_comment : request.manager_comment || ''
      })
    });
    setTechMsg(result?.offline ? 'Обновление сохранено офлайн' : 'Техзаявка обновлена');
    load();
  }

  useEffect(() => {
    if (!admin && showTechComposer) {
      setShowTechForm(true);
    }
  }, [admin, showTechComposer]);

  if (!admin) {
    const activeTasks = tasks.filter((task) => !task.assignment?.done);
    const completedTasks = tasks.filter((task) => task.assignment?.done);
    const activeTechRequests = techRequests.filter((request) => !['done', 'cancelled'].includes(request.status));
    const finishedTechRequests = techRequests.filter((request) => ['done', 'cancelled'].includes(request.status));

    return <>
      <div className="mobileSectionStack">
        <SectionTitle title="Задачи" action={<button type="button" className="sectionLink" onClick={() => setShowTechForm(true)}>Техзаявка</button>} />

        <Card title="Сегодня" className="mobileCard">
          <div className="mobileTaskList">
            {activeTasks.length === 0 && <Empty text="Нет активных задач на текущую смену" />}
            {activeTasks.map((task) => <div key={task.id} className="mobileTaskRow static">
              <span className="mobileTaskStatus" />
              <div className="mobileTaskCopy">
                <strong>{task.title}</strong>
                <span>{task.description || 'Без описания'}</span>
              </div>
              <Button type="button" kind="soft" onClick={() => done(task.id)}>Выполнено</Button>
              <CommentsPanel entityType="task" entityId={task.id} />
            </div>)}
          </div>
        </Card>

        <Card title="Техзаявки" className="mobileCard">
          <div className="mobileRequestList">
            {activeTechRequests.length === 0 && <Empty text="Нет срочных техзаявок" />}
            {activeTechRequests.map((request) => <article key={request.id} className="mobileRequestCard">
              <div className="rowBetween">
                <div>
                  <strong>{request.title}</strong>
                  <span>{techRequestCategories[request.category] || request.category}</span>
                </div>
                <span className={`badge ${request.status}`}>{techRequestStatuses[request.status] || request.status}</span>
              </div>
              <p>{request.description || 'Без описания'}</p>
              <div className="mobileInlineHint">{request.manager_comment || 'Комментарий менеджера появится здесь'}</div>
              <CommentsPanel entityType="tech_request" entityId={request.id} />
            </article>)}
          </div>
          {techMsg && <div className="notice mobileInlineNotice">{techMsg}</div>}
        </Card>

        <Card title="Выполнено" className="mobileCard">
          <div className="mobileTaskList">
            {completedTasks.length === 0 && finishedTechRequests.length === 0 && <Empty text="Пока нет завершённых задач" />}
            {completedTasks.map((task) => <div key={task.id} className="mobileTaskRow static done">
              <span className="mobileTaskStatus done" />
              <div className="mobileTaskCopy">
                <strong>{task.title}</strong>
                <span>{task.description || 'Задача выполнена'}</span>
              </div>
              <span className="badge active">Готово</span>
            </div>)}
            {finishedTechRequests.map((request) => <div key={request.id} className="mobileTaskRow static done">
              <span className="mobileTaskStatus done" />
              <div className="mobileTaskCopy">
                <strong>{request.title}</strong>
                <span>{request.manager_comment || 'Без комментария менеджера'}</span>
              </div>
              <span className={`badge ${request.status}`}>{techRequestStatuses[request.status] || request.status}</span>
            </div>)}
          </div>
        </Card>
      </div>

      {showTechForm && <div className="modal" onClick={() => {
        setShowTechForm(false);
        onCloseComposer?.();
      }}>
        <div className="modalCard mobileDocModal" onClick={(e) => e.stopPropagation()}>
          <div className="rowBetween">
            <h2>Техзаявка</h2>
            <button className="iconBtn" onClick={() => {
              setShowTechForm(false);
              onCloseComposer?.();
            }}>×</button>
          </div>
          <form className="form" onSubmit={createTechRequest}>
            <Field label="Тема заявки" value={techForm.title} onChange={(e: any) => setTechForm({ ...techForm, title: e.target.value })} placeholder="Например: вызвать мастера по холодильнику" />
            <Select label="Тип проблемы" value={techForm.category} onChange={(e: any) => setTechForm({ ...techForm, category: e.target.value })}>
              {Object.entries(techRequestCategories).map(([key, value]) => <option key={key} value={key}>{value}</option>)}
            </Select>
            <Textarea label="Что случилось" value={techForm.description} onChange={(e: any) => setTechForm({ ...techForm, description: e.target.value })} placeholder="Опишите проблему" />
            <Button className="mobilePrimaryButton">Отправить техзаявку</Button>
          </form>
        </div>
      </div>}
    </>;
  }

  return <>
    {admin && <Card title="Создать задачу">
      <form className="form two" onSubmit={create}>
        <Field label="Задача" value={form.title} onChange={(e: any) => setForm({ ...form, title: e.target.value })} />
        <Textarea label="Описание" value={form.description} onChange={(e: any) => setForm({ ...form, description: e.target.value })} />
        <Select label="Кому" value={form.target_type} onChange={(e: any) => setForm({ ...form, target_type: e.target.value })}>{Object.entries(targetTypeLabels).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</Select>
        {form.target_type === 'role' && <Select label="Роль" value={form.target_role} onChange={(e: any) => setForm({ ...form, target_role: e.target.value })}>{executableRoles.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}
        {form.target_type === 'user' && <Select label="Сотрудник" value={form.target_user_id} onChange={(e: any) => setForm({ ...form, target_user_id: e.target.value })}><option value="">Выбрать</option>{users.filter(u => u.role !== 'owner').map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>}
        <Button>Создать задачу</Button>
      </form>
      {taskMsg && <div className="notice">{taskMsg}</div>}
    </Card>}
    {!admin && <Card title="Сообщить о техпроблеме" right={<span className="badge sent">Увидит менеджер</span>}>
      <form className="form" onSubmit={createTechRequest}>
        <div className="form two">
          <Field label="Тема заявки" value={techForm.title} onChange={(e: any) => setTechForm({ ...techForm, title: e.target.value })} placeholder="Например: вызвать мастера по холодильнику" />
          <Select label="Тип проблемы" value={techForm.category} onChange={(e: any) => setTechForm({ ...techForm, category: e.target.value })}>
            {Object.entries(techRequestCategories).map(([key, value]) => <option key={key} value={key}>{value}</option>)}
          </Select>
        </div>
        <Textarea label="Что случилось" value={techForm.description} onChange={(e: any) => setTechForm({ ...techForm, description: e.target.value })} placeholder="Опишите проблему, где она находится и что нужно сделать" />
        <Button>Отправить техзаявку</Button>
      </form>
      {techMsg && <div className="notice">{techMsg}</div>}
    </Card>}

    <Card title={admin ? 'Техзаявки сотрудников' : 'Мои техзаявки'}>
      {techRequests.length === 0 && <Empty text={admin ? 'Техзаявок пока нет' : 'Вы ещё не отправляли техзаявки'} />}
      <div className="grid cardsGrid">
        {techRequests.map((request) => {
          const draft = techDrafts[request.id] || {};
          return <div className="miniCard techRequestCard" key={request.id}>
            <div className="rowBetween">
              <b>{request.title}</b>
              <span className={`badge ${request.status}`}>{techRequestStatuses[request.status] || request.status}</span>
            </div>
            <div className="techRequestMeta">
              <span>{techRequestCategories[request.category] || request.category}</span>
              <span>{fmtDate(request.created_at)}</span>
              {request.created_by_user?.name && <span>{request.created_by_user.name}</span>}
            </div>
            <p>{request.description || 'Без описания'}</p>
            {admin
              ? <div className="techRequestAdmin">
                <Select
                  label="Статус"
                  value={draft.status || request.status}
                  onChange={(e: any) => setTechDrafts({ ...techDrafts, [request.id]: { ...draft, status: e.target.value } })}
                >
                  {Object.entries(techRequestStatuses).map(([key, value]) => <option key={key} value={key}>{value}</option>)}
                </Select>
                <Textarea
                  label="Комментарий менеджера"
                  value={draft.manager_comment !== undefined ? draft.manager_comment : request.manager_comment || ''}
                  onChange={(e: any) => setTechDrafts({ ...techDrafts, [request.id]: { ...draft, manager_comment: e.target.value } })}
                  placeholder="Например: мастер вызван, ждём до 18:00"
                />
                <Button kind="soft" onClick={() => updateTechRequest(request)}>Сохранить статус</Button>
              </div>
              : <div className="techRequestEmployeeView">
                <div className="techRequestComment">
                  <span className="muted">Комментарий менеджера</span>
                  <strong>{request.manager_comment || 'Комментария пока нет'}</strong>
                </div>
              </div>}
              <CommentsPanel entityType="tech_request" entityId={request.id} />
          </div>;
        })}
      </div>
      {admin && techMsg && <div className="notice">{techMsg}</div>}
    </Card>
    <Card title={admin ? 'Задачи ресторана' : 'Мои задачи'}>
      <div className="grid">{tasks.map(t => <div className="miniCard" key={t.id}>
        <div className="rowBetween"><b>{t.title}</b>{!admin && <span className={`badge ${t.assignment?.done ? 'active' : ''}`}>{t.assignment?.done ? 'готово' : 'ждёт'}</span>}</div>
        <p>{t.description}</p>
        {admin ? <p>Назначено: {t.assignments?.length || 0}, выполнено: {t.assignments?.filter((a: any) => a.done).length || 0}</p> : !t.assignment?.done && <Button onClick={() => done(t.id)}>Выполнено</Button>}
        <CommentsPanel entityType="task" entityId={t.id} />
      </div>)}</div>
    </Card>
  </>;
}
