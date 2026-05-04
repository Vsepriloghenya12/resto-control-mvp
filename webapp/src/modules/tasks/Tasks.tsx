import { FormEvent, useEffect, useState } from 'react';
import { api } from '../../api';
import { AppIcon, Button, Card } from '../../components/dashboard-ui';
import { Field, Select, Textarea, Empty } from '../../components/form-controls';
import { MobileSheetModal } from '../../components/mobile-sheet-modal';
import { CommentsPanel } from '../../components/comments-panel';
import { cx } from '../../lib/cx';
import {
  executableRoles,
  seniorRoles,
  targetTypeLabels,
  taskRecipientRolesFor,
  techRequestCategories,
  techRequestStatuses
} from '../../lib/dictionaries';
import { fmtDate } from '../../lib/format';

export function Tasks({ user, admin = false, showTechComposer = false, onCloseComposer }: any) {
  const [tasks, setTasks] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [techRequests, setTechRequests] = useState<any[]>([]);
  const [techDrafts, setTechDrafts] = useState<any>({});
  const [form, setForm] = useState<any>({ title: '', description: '', target_type: 'all', target_role: 'waiter', target_user_id: '', due_at: '' });
  const [taskMsg, setTaskMsg] = useState('');
  const [techMsg, setTechMsg] = useState('');
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [showTechForm, setShowTechForm] = useState(false);
  const [techForm, setTechForm] = useState<any>({ title: '', description: '', category: 'equipment' });
  const isSenior = seniorRoles.includes(user?.role);
  const canCreateTasks = admin || isSenior;
  const canManageTechRequests = admin && ['owner', 'manager'].includes(user?.role);
  const shouldLoadTechRequests = !admin || canManageTechRequests;
  const recipientRoleKeys = taskRecipientRolesFor(user);
  const manageableRoleEntries = canCreateTasks ? executableRoles.filter(([key]) => recipientRoleKeys.includes(key)) : executableRoles;
  const roleOptions = manageableRoleEntries.length ? manageableRoleEntries : executableRoles;

  useEffect(() => {
    if (canCreateTasks && roleOptions.length && !roleOptions.some(([key]) => key === form.target_role)) {
      setForm((current: any) => ({ ...current, target_role: roleOptions[0][0] }));
    }
  }, [canCreateTasks, user.role]);

  async function load() {
    const [taskRows, userRows, techRows] = await Promise.all([
      api(canCreateTasks ? '/api/tasks?manage=1' : '/api/tasks'),
      canCreateTasks ? api('/api/admin/users') : Promise.resolve([]),
      shouldLoadTechRequests ? api('/api/tech-requests') : Promise.resolve([])
    ]);
    setTasks(taskRows);
    if (canCreateTasks) setUsers(userRows);
    if (shouldLoadTechRequests) {
      setTechRequests(techRows);
      setTechDrafts(Object.fromEntries(techRows.map((request: any) => [request.id, {
        status: request.status || 'new',
        manager_comment: request.manager_comment || ''
      }])));
    }
  }

  useEffect(() => { load(); }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    setTaskMsg('');
    const result = await api('/api/tasks', { method: 'POST', body: JSON.stringify(form) });
    setForm({ ...form, title: '', description: '', due_at: '' });
    setTaskMsg(result?.offline ? 'Задача сохранена офлайн' : 'Задача создана');
    setShowTaskForm(false);
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
    setTechMsg(result?.offline ? 'Проблема сохранена офлайн' : 'Проблема отправлена менеджеру');
    setShowTechForm(false);
    onCloseComposer?.();
    load().catch(() => undefined);
  }

  async function updateTechRequest(request: any, forcedStatus?: string) {
    if (!canManageTechRequests) return;
    setTechMsg('');
    const draft = techDrafts[request.id] || {};
    const payload = {
      status: forcedStatus || draft.status || request.status,
      manager_comment: draft.manager_comment ?? request.manager_comment ?? ''
    };
    try {
      await api(`/api/tech-requests/${request.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      setTechMsg('Проблема обновлена');
      load();
    } catch (error: any) {
      setTechMsg(error.message || 'Не удалось обновить проблему');
    }
  }

  function updateTechDraft(id: string, patch: any) {
    setTechDrafts((current: any) => ({ ...current, [id]: { ...(current[id] || {}), ...patch } }));
  }

  useEffect(() => {
    if (!admin && showTechComposer) setShowTechForm(true);
  }, [admin, showTechComposer]);

  const filteredTaskUsers = users.filter((candidate: any) => recipientRoleKeys.includes(candidate.role) && candidate.id !== user.id);
  const taskForm = <form className="form" id="department-task-form" onSubmit={create}>
    <Field label="Задача" value={form.title} onChange={(e: any) => setForm({ ...form, title: e.target.value })} placeholder="Например: проверить заготовки перед сменой" />
    <Textarea label="Описание" value={form.description} onChange={(e: any) => setForm({ ...form, description: e.target.value })} placeholder="Что нужно сделать и где" />
    <Field label="Срок выполнения" type="datetime-local" value={form.due_at} onChange={(e: any) => setForm({ ...form, due_at: e.target.value })} />
    <Select label="Кому" value={form.target_type} onChange={(e: any) => setForm({ ...form, target_type: e.target.value })}>{Object.entries(targetTypeLabels).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</Select>
    {form.target_type === 'role' && <Select label="Роль" value={form.target_role} onChange={(e: any) => setForm({ ...form, target_role: e.target.value })}>{roleOptions.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}
    {form.target_type === 'user' && <Select label="Сотрудник" value={form.target_user_id} onChange={(e: any) => setForm({ ...form, target_user_id: e.target.value })}><option value="">Выбрать</option>{filteredTaskUsers.map((candidate: any) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</Select>}
  </form>;

  if (!admin) {
    const activeTasks = tasks.filter((task) => !task.assignment?.done);
    const completedTasks = tasks.filter((task) => task.assignment?.done);
    const openTechRequests = techRequests.filter((request) => !['done', 'cancelled'].includes(request.status));

    return <>
      <div className="mobileSectionStack mobileTasksScreen">
        <button type="button" className="mobileOverviewRow" onClick={() => setShowTechForm(true)}>
          <div className="mobileOverviewIcon amber"><AppIcon name="support" className="navIcon" /></div>
          <div className="mobileOverviewCopy">
            <strong>Сообщить о проблеме</strong>
            <span>Поломка, сервисная ситуация или нужна помощь менеджера</span>
          </div>
          <b>+</b>
        </button>

        <section className="mobileSection mobileFlatPanel">
          <div className="mobileListSectionHead"><h3>Сегодня</h3><div className="mobileSectionHeadActions"><span className="mobileSectionCount">{activeTasks.length}</span>{isSenior && <button type="button" className="sectionLink" onClick={() => setShowTaskForm(true)}>+ задача</button>}</div></div>
          <div className="mobileTaskList">
            {activeTasks.length === 0 && <Empty text="Нет активных задач на текущую смену" />}
            {activeTasks.map((task) => <div key={task.id} className="mobileTaskRow static">
              <span className="mobileTaskStatus" />
              <div className="mobileTaskCopy"><strong>{task.title}</strong><span>{task.description || 'Без описания'}{task.due_at ? ` · срок: ${fmtDate(task.due_at)}` : ''}</span></div>
              <Button type="button" kind="soft" onClick={() => done(task.id)}>Выполнено</Button>
              <CommentsPanel entityType="task" entityId={task.id} />
            </div>)}
          </div>
        </section>

        {openTechRequests.length > 0 && <section className="mobileSection mobileFlatPanel">
          <div className="mobileListSectionHead"><h3>Мои проблемы</h3><span className="mobileSectionCount">{openTechRequests.length}</span></div>
          <div className="mobileTaskList">
            {openTechRequests.map((request) => <div key={request.id} className="mobileTaskRow static techRequestEmployeeView">
              <span className={cx('badge', request.status === 'new' ? 'warning' : 'trial')}>{techRequestStatuses[request.status] || request.status}</span>
              <div className="mobileTaskCopy"><strong>{request.title}</strong><span>{techRequestCategories[request.category] || 'Другое'} · {request.manager_comment || 'Комментария менеджера пока нет'}</span></div>
            </div>)}
          </div>
        </section>}

        <section className="mobileSection mobileFlatPanel">
          <div className="mobileListSectionHead"><h3>Выполнено</h3><span className="mobileSectionCount">{completedTasks.length}</span></div>
          <div className="mobileTaskList">
            {completedTasks.length === 0 && <Empty text="Пока нет завершённых задач" />}
            {completedTasks.map((task) => <div key={task.id} className="mobileTaskRow static done"><span className="mobileTaskStatus done" /><div className="mobileTaskCopy"><strong>{task.title}</strong><span>{task.description || 'Задача выполнена'}</span></div><span className="badge active">Готово</span></div>)}
          </div>
        </section>
        {taskMsg && <div className="notice mobileInlineNotice">{taskMsg}</div>}
        {techMsg && <div className="notice mobileInlineNotice">{techMsg}</div>}
      </div>

      {showTaskForm && <MobileSheetModal
        title="Задача подразделению"
        subtitle="Назначьте задачу сотрудникам своего подразделения"
        onClose={() => setShowTaskForm(false)}
        className="mobileFormSheet departmentTaskSheet"
        footer={<Button type="submit" form="department-task-form" className="mobilePrimaryButton">Создать задачу</Button>}
      >
        {taskForm}
        {taskMsg && <div className="notice mobileInlineNotice">{taskMsg}</div>}
      </MobileSheetModal>}

      {showTechForm && <MobileSheetModal
        title="Проблема"
        subtitle="Опишите проблему, менеджер увидит её в пульте контроля"
        onClose={() => { setShowTechForm(false); onCloseComposer?.(); }}
        className="mobileFormSheet techRequestSheet"
        footer={<Button type="submit" form="tech-request-form" className="mobilePrimaryButton">Отправить проблему</Button>}
      >
        <form className="form" id="tech-request-form" onSubmit={createTechRequest}>
          <Field label="Тема проблемы" value={techForm.title} onChange={(e: any) => setTechForm({ ...techForm, title: e.target.value })} placeholder="Например: вызвать мастера по холодильнику" />
          <Select label="Тип проблемы" value={techForm.category} onChange={(e: any) => setTechForm({ ...techForm, category: e.target.value })}>{Object.entries(techRequestCategories).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</Select>
          <Textarea label="Что случилось" value={techForm.description} onChange={(e: any) => setTechForm({ ...techForm, description: e.target.value })} placeholder="Опишите проблему" />
        </form>
      </MobileSheetModal>}
    </>;
  }

  return <>
    {canManageTechRequests && <Card title="Проблемы сотрудников" right={<span className="badge warning">{techRequests.filter((request) => !['done', 'cancelled'].includes(request.status)).length} открыто</span>}>
      {techRequests.length === 0 && <Empty text="Проблем пока нет" />}
      <div className="grid cardsGrid">
        {techRequests.map((request) => {
          const draft = techDrafts[request.id] || { status: request.status, manager_comment: request.manager_comment || '' };
          return <div className="miniCard techRequestCard" key={request.id}>
            <div className="rowBetween"><b>{request.title}</b><span className={`badge ${request.status === 'done' ? 'active' : request.status === 'cancelled' ? 'cancelled' : request.status === 'new' ? 'warning' : 'trial'}`}>{techRequestStatuses[request.status] || request.status}</span></div>
            <div className="techRequestMeta"><span>{request.created_by_user?.name || 'Сотрудник'}</span><span>{techRequestCategories[request.category] || 'Другое'}</span><span>{fmtDate(request.created_at)}</span></div>
            {request.description && <p>{request.description}</p>}
            <div className="techRequestAdmin">
              <Select label="Статус" value={draft.status} onChange={(e: any) => updateTechDraft(request.id, { status: e.target.value })}>
                {Object.entries(techRequestStatuses).map(([key, value]) => <option key={key} value={key}>{value}</option>)}
              </Select>
              <Textarea label="Комментарий менеджера" value={draft.manager_comment || ''} onChange={(e: any) => updateTechDraft(request.id, { manager_comment: e.target.value })} placeholder="Что сделано или что нужно передать сотруднику" />
              <div className="actions">
                {request.status === 'new' && <Button kind="soft" type="button" onClick={() => updateTechRequest(request, 'in_progress')}>Взять в работу</Button>}
                <Button type="button" onClick={() => updateTechRequest(request)}>Сохранить</Button>
                {request.status !== 'done' && <Button kind="soft" type="button" onClick={() => updateTechRequest(request, 'done')}>Закрыть</Button>}
              </div>
            </div>
            <CommentsPanel entityType="tech_request" entityId={request.id} />
          </div>;
        })}
      </div>
      {techMsg && <div className={techMsg.includes('обновлена') ? 'notice' : 'error'}>{techMsg}</div>}
    </Card>}

    <Card title={isSenior ? "Создать задачу подразделению" : "Создать задачу"}>
      <div className="desktopTaskForm">{taskForm}</div>
      <div className="actions"><Button type="submit" form="department-task-form">Создать задачу</Button></div>
      {taskMsg && <div className="notice">{taskMsg}</div>}
    </Card>

    <Card title="Задачи ресторана">
      <div className="grid">{tasks.map(t => <div className="miniCard" key={t.id}>
        <div className="rowBetween"><b>{t.title}</b></div>
        <p>{t.description}</p>
        {t.due_at && <p>Срок: {fmtDate(t.due_at)}</p>}
        <p>Назначено: {t.assignments?.length || 0}, выполнено: {t.assignments?.filter((a: any) => a.done).length || 0}</p>
        <CommentsPanel entityType="task" entityId={t.id} />
      </div>)}</div>
    </Card>
  </>;
}
