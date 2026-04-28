import { FormEvent, useEffect, useState } from 'react';
import { api } from '../../api';
import { Button, Card } from '../../components/dashboard-ui';
import { Field, Select, Textarea, Empty } from '../../components/form-controls';
import { MobileSheetModal } from '../../components/mobile-sheet-modal';
import { CommentsPanel } from '../../components/comments-panel';
import { executableRoles, targetTypeLabels, techRequestCategories } from '../../lib/dictionaries';

export function Tasks({ user, admin = false, showTechComposer = false, onCloseComposer }: any) {
  const [tasks, setTasks] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [form, setForm] = useState<any>({ title: '', description: '', target_type: 'all', target_role: 'waiter', target_user_id: '' });
  const [taskMsg, setTaskMsg] = useState('');
  const [techMsg, setTechMsg] = useState('');
  const [showTechForm, setShowTechForm] = useState(false);
  const [techForm, setTechForm] = useState<any>({ title: '', description: '', category: 'equipment' });

  async function load() {
    const [taskRows, userRows] = await Promise.all([
      api('/api/tasks'),
      admin ? api('/api/admin/users') : Promise.resolve([])
    ]);
    setTasks(taskRows);
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
  }

  useEffect(() => {
    if (!admin && showTechComposer) setShowTechForm(true);
  }, [admin, showTechComposer]);

  if (!admin) {
    const activeTasks = tasks.filter((task) => !task.assignment?.done);
    const completedTasks = tasks.filter((task) => task.assignment?.done);

    return <>
      <div className="mobileSectionStack mobileTasksScreen">
        <section className="mobileSection mobileFlatPanel">
          <div className="mobileListSectionHead"><h3>Сегодня</h3><span className="mobileSectionCount">{activeTasks.length}</span></div>
          <div className="mobileTaskList">
            {activeTasks.length === 0 && <Empty text="Нет активных задач на текущую смену" />}
            {activeTasks.map((task) => <div key={task.id} className="mobileTaskRow static">
              <span className="mobileTaskStatus" />
              <div className="mobileTaskCopy"><strong>{task.title}</strong><span>{task.description || 'Без описания'}</span></div>
              <Button type="button" kind="soft" onClick={() => done(task.id)}>Выполнено</Button>
              <CommentsPanel entityType="task" entityId={task.id} />
            </div>)}
          </div>
        </section>

        <section className="mobileSection mobileFlatPanel">
          <div className="mobileListSectionHead"><h3>Выполнено</h3><span className="mobileSectionCount">{completedTasks.length}</span></div>
          <div className="mobileTaskList">
            {completedTasks.length === 0 && <Empty text="Пока нет завершённых задач" />}
            {completedTasks.map((task) => <div key={task.id} className="mobileTaskRow static done"><span className="mobileTaskStatus done" /><div className="mobileTaskCopy"><strong>{task.title}</strong><span>{task.description || 'Задача выполнена'}</span></div><span className="badge active">Готово</span></div>)}
          </div>
        </section>
        {techMsg && <div className="notice mobileInlineNotice">{techMsg}</div>}
      </div>

      {showTechForm && <MobileSheetModal
        title="Техзаявка"
        subtitle="Опишите проблему, менеджер увидит её в уведомлениях"
        onClose={() => { setShowTechForm(false); onCloseComposer?.(); }}
        className="mobileFormSheet techRequestSheet"
        footer={<Button type="submit" form="tech-request-form" className="mobilePrimaryButton">Отправить техзаявку</Button>}
      >
        <form className="form" id="tech-request-form" onSubmit={createTechRequest}>
          <Field label="Тема заявки" value={techForm.title} onChange={(e: any) => setTechForm({ ...techForm, title: e.target.value })} placeholder="Например: вызвать мастера по холодильнику" />
          <Select label="Тип проблемы" value={techForm.category} onChange={(e: any) => setTechForm({ ...techForm, category: e.target.value })}>{Object.entries(techRequestCategories).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</Select>
          <Textarea label="Что случилось" value={techForm.description} onChange={(e: any) => setTechForm({ ...techForm, description: e.target.value })} placeholder="Опишите проблему" />
        </form>
      </MobileSheetModal>}
    </>;
  }

  return <>
    <Card title="Создать задачу">
      <form className="form two" onSubmit={create}>
        <Field label="Задача" value={form.title} onChange={(e: any) => setForm({ ...form, title: e.target.value })} />
        <Textarea label="Описание" value={form.description} onChange={(e: any) => setForm({ ...form, description: e.target.value })} />
        <Select label="Кому" value={form.target_type} onChange={(e: any) => setForm({ ...form, target_type: e.target.value })}>{Object.entries(targetTypeLabels).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</Select>
        {form.target_type === 'role' && <Select label="Роль" value={form.target_role} onChange={(e: any) => setForm({ ...form, target_role: e.target.value })}>{executableRoles.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}
        {form.target_type === 'user' && <Select label="Сотрудник" value={form.target_user_id} onChange={(e: any) => setForm({ ...form, target_user_id: e.target.value })}><option value="">Выбрать</option>{users.filter(u => u.role !== 'owner').map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>}
        <Button>Создать задачу</Button>
      </form>
      {taskMsg && <div className="notice">{taskMsg}</div>}
    </Card>

    <Card title="Задачи ресторана">
      <div className="grid">{tasks.map(t => <div className="miniCard" key={t.id}>
        <div className="rowBetween"><b>{t.title}</b></div>
        <p>{t.description}</p>
        <p>Назначено: {t.assignments?.length || 0}, выполнено: {t.assignments?.filter((a: any) => a.done).length || 0}</p>
        <CommentsPanel entityType="task" entityId={t.id} />
      </div>)}</div>
    </Card>
  </>;
}
