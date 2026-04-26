import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { api, clearToken, download, getToken, setToken } from './api';

type View = 'login' | 'register';
type Tab = string;

const roles: Record<string, string> = {
  owner: 'Владелец',
  manager: 'Управляющий',
  waiter: 'Официант',
  bartender: 'Бармен',
  cook: 'Повар'
};

const departments: Record<string, string> = {
  hall: 'Зал',
  bar: 'Бар',
  kitchen: 'Кухня',
  common: 'Общее'
};

const checklistTypes: Record<string, string> = {
  open: 'Открытие',
  close: 'Закрытие',
  routine: 'Смена',
  custom: 'Произвольный'
};

const subscriptionStatuses: Record<string, string> = {
  active: 'активна',
  blocked: 'заблокирована',
  trial: 'trial',
  trial_expired: 'trial истёк',
  subscription_expired: 'подписка истекла'
};

const brandLogoSrc = '/resto-control-logo.png';

function fmtDate(value?: string) {
  if (!value) return '—';
  return new Date(value).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
}

function daysLeft(value?: string) {
  if (!value) return 0;
  return Math.max(0, Math.ceil((new Date(value).getTime() - Date.now()) / 86400000));
}

function subscriptionLabel(status?: string) {
  if (!status) return 'неизвестно';
  return subscriptionStatuses[status] || status;
}

function Card({ title, children, right }: { title?: string; children: any; right?: any }) {
  return <section className="card">{title && <div className="cardHead"><h3>{title}</h3>{right}</div>}{children}</section>;
}

function Button({ children, kind = 'primary', ...props }: any) {
  return <button className={`btn ${kind}`} {...props}>{children}</button>;
}

function Field({ label, ...props }: any) {
  return <label className="field"><span>{label}</span><input {...props} /></label>;
}

function Select({ label, children, ...props }: any) {
  return <label className="field"><span>{label}</span><select {...props}>{children}</select></label>;
}

function Textarea({ label, ...props }: any) {
  return <label className="field"><span>{label}</span><textarea {...props} /></label>;
}

function Empty({ text }: { text: string }) {
  return <div className="empty">{text}</div>;
}

function CameraCapture({ title, onCapture, onClose }: { title: string; onCapture: (photo: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');

  function stopStream() {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
  }

  useEffect(() => {
    let mounted = true;

    async function openCamera() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Камера недоступна в этом браузере');
        setBusy(false);
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false
        });
        if (!mounted) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } catch {
        setError('Не удалось открыть камеру. Проверьте разрешение на съёмку.');
      } finally {
        if (mounted) setBusy(false);
      }
    }

    openCamera();
    return () => {
      mounted = false;
      stopStream();
    };
  }, []);

  function takePhoto() {
    const video = videoRef.current;
    if (!video) return;

    const maxSide = 1280;
    const scale = Math.min(1, maxSide / Math.max(video.videoWidth || maxSide, video.videoHeight || maxSide));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round((video.videoWidth || maxSide) * scale));
    canvas.height = Math.max(1, Math.round((video.videoHeight || maxSide) * scale));

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setError('Не удалось сохранить кадр');
      return;
    }

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const photo = canvas.toDataURL('image/jpeg', 0.82);
    stopStream();
    onCapture(photo);
    onClose();
  }

  return <div className="modal" onClick={onClose}>
    <div className="modalCard" onClick={(e) => e.stopPropagation()}>
      <div className="rowBetween">
        <h2>Фото для: {title}</h2>
        <button className="iconBtn" onClick={onClose}>×</button>
      </div>
      {busy && <div className="notice">Подключаем камеру...</div>}
      {error && <div className="error">{error}</div>}
      {!error && <video ref={videoRef} className="cameraVideo" autoPlay playsInline muted />}
      <div className="actions cameraActions">
        <Button kind="soft" onClick={onClose}>Отмена</Button>
        <Button disabled={busy || !!error} onClick={takePhoto}>Сделать фото</Button>
      </div>
    </div>
  </div>;
}

export default function App() {
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function loadMe() {
    try {
      if (!getToken()) return;
      const data = await api('/api/me');
      setSession(data);
    } catch {
      clearToken();
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadMe(); }, []);

  function onLogout() {
    clearToken();
    setSession(null);
  }

  if (loading) return <div className="splash">
    <img className="splashLogo" src={brandLogoSrc} alt="Resto Control" />
    <b>Загружаем Resto Control</b>
    <span>Подготавливаем рабочее пространство</span>
  </div>;
  if (!session) return <AuthScreen onLogin={(data: any) => { setToken(data.token); setSession(data); }} error={error} setError={setError} />;

  const user = session.user;
  return <div className="appShell">
    <header className="topbar">
      <div className="topbarBrand">
        <img className="topbarLogo" src={brandLogoSrc} alt="Resto Control" />
        <div className="topbarMeta">
          <div className="topbarContext">{user.is_super_admin ? 'Супер-админ создателя' : session.restaurant?.name}</div>
          <div className="muted">{user.is_super_admin ? 'Управление платформой' : `${roles[user.role] || user.role} в рабочем кабинете`}</div>
        </div>
      </div>
      <button className="logout" onClick={onLogout}>Выйти</button>
    </header>

    {user.is_super_admin ? <SuperAdmin /> : ['owner', 'manager'].includes(user.role) ? <RestaurantAdmin user={user} restaurant={session.restaurant} /> : <EmployeeApp user={user} restaurant={session.restaurant} />}
  </div>;
}

function AuthScreen({ onLogin, error, setError }: any) {
  const [view, setView] = useState<View>('login');
  const [form, setForm] = useState<any>({ login: '', password: '', restaurantName: '', ownerName: '', phone: '', email: '', city: '' });
  const [busy, setBusy] = useState(false);

  function switchView(next: View) {
    setError('');
    setView(next);
    setForm((current: any) => ({ ...current, login: '', password: '' }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const data = view === 'login'
        ? await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ login: form.login, password: form.password }) })
        : await api('/api/auth/register-restaurant', { method: 'POST', body: JSON.stringify(form) });
      onLogin(data);
    } catch (err: any) {
      setError(err.message);
    } finally { setBusy(false); }
  }

  return <main className="authPage">
    <div className="authCard">
      <div className="authBrandLockup">
        <img className="authLogoImage" src={brandLogoSrc} alt="Resto Control" />
      </div>
      <p className="authLead">Чек-листы, заявки, инвентаризация, задачи и сервис-бук для ресторанов.</p>
      <div className="switcher">
        <button className={view === 'login' ? 'active' : ''} onClick={() => switchView('login')}>Войти</button>
        <button className={view === 'register' ? 'active' : ''} onClick={() => switchView('register')}>14 дней бесплатно</button>
      </div>
      <form onSubmit={submit} className="form">
        {view === 'register' && <>
          <Field label="Название ресторана" value={form.restaurantName} onChange={(e: any) => setForm({ ...form, restaurantName: e.target.value })} placeholder="Например: Мята Lounge" />
          <Field label="Имя владельца" value={form.ownerName} onChange={(e: any) => setForm({ ...form, ownerName: e.target.value })} placeholder="Иван" />
          <Field label="Телефон" value={form.phone} onChange={(e: any) => setForm({ ...form, phone: e.target.value })} />
          <Field label="Email" value={form.email} onChange={(e: any) => setForm({ ...form, email: e.target.value })} />
          <Field label="Город" value={form.city} onChange={(e: any) => setForm({ ...form, city: e.target.value })} />
        </>}
        <Field label="Логин" value={form.login} onChange={(e: any) => setForm({ ...form, login: e.target.value })} />
        <Field label="Пароль" type="password" value={form.password} onChange={(e: any) => setForm({ ...form, password: e.target.value })} />
        {error && <div className="error">{error}</div>}
        <Button disabled={busy}>{busy ? 'Проверяем...' : view === 'login' ? 'Войти' : 'Создать ресторан'}</Button>
      </form>
    </div>
  </main>;
}

function Nav({ tabs, active, setActive }: { tabs: { id: string; title: string }[]; active: string; setActive: (v: string) => void }) {
  return <nav className="tabs">{tabs.map(t => <button key={t.id} className={active === t.id ? 'active' : ''} onClick={() => setActive(t.id)}>{t.title}</button>)}</nav>;
}

function SuperAdmin() {
  const [tab, setTab] = useState<Tab>('restaurants');
  const [restaurants, setRestaurants] = useState<any[]>([]);
  const [form, setForm] = useState<any>({ name: '', owner_name: '', city: '', phone: '', email: '', login: '', password: '' });
  const [msg, setMsg] = useState('');

  async function load() {
    setRestaurants(await api('/api/super/restaurants'));
  }
  useEffect(() => { load(); }, []);

  async function createRestaurant(e: FormEvent) {
    e.preventDefault(); setMsg('');
    try {
      await api('/api/super/restaurants', { method: 'POST', body: JSON.stringify(form) });
      setForm({ name: '', owner_name: '', city: '', phone: '', email: '', login: '', password: '' });
      setMsg('Ресторан создан');
      load();
    } catch (e: any) { setMsg(e.message); }
  }

  async function extend(id: string, days: number) {
    await api(`/api/super/restaurants/${id}/subscription`, { method: 'PATCH', body: JSON.stringify({ days, plan: 'pro' }) });
    load();
  }

  async function block(id: string) {
    await api(`/api/super/restaurants/${id}/subscription`, { method: 'PATCH', body: JSON.stringify({ status: 'blocked' }) });
    load();
  }

  return <main>
    <Nav tabs={[{ id: 'restaurants', title: 'Рестораны' }, { id: 'create', title: 'Создать' }]} active={tab} setActive={setTab} />
    {tab === 'restaurants' && <Card title="Рестораны платформы">
      <div className="grid cardsGrid">
        {restaurants.map(r => <div className="miniCard" key={r.id}>
          <div className="rowBetween"><b>{r.name}</b><span className={`badge ${r.computed_status}`}>{subscriptionLabel(r.computed_status)}</span></div>
          <p>{r.city || 'Город не указан'} · сотрудников: {r.users_count}</p>
          <p>Trial до: {fmtDate(r.trial_ends_at)} · осталось {daysLeft(r.trial_ends_at)} дн.</p>
          <p>Заявки: {r.requests_count} · чек-листы: {r.checklist_runs_count}</p>
          <div className="actions"><Button kind="soft" onClick={() => extend(r.id, 30)}>+30 дней</Button><Button kind="danger" onClick={() => block(r.id)}>Блок</Button></div>
        </div>)}
      </div>
    </Card>}
    {tab === 'create' && <Card title="Создать кабинет ресторана">
      <form className="form two" onSubmit={createRestaurant}>
        <Field label="Ресторан" value={form.name} onChange={(e: any) => setForm({ ...form, name: e.target.value })} />
        <Field label="Владелец" value={form.owner_name} onChange={(e: any) => setForm({ ...form, owner_name: e.target.value })} />
        <Field label="Город" value={form.city} onChange={(e: any) => setForm({ ...form, city: e.target.value })} />
        <Field label="Телефон" value={form.phone} onChange={(e: any) => setForm({ ...form, phone: e.target.value })} />
        <Field label="Email" value={form.email} onChange={(e: any) => setForm({ ...form, email: e.target.value })} />
        <Field label="Логин владельца" value={form.login} onChange={(e: any) => setForm({ ...form, login: e.target.value })} />
        <Field label="Пароль" value={form.password} onChange={(e: any) => setForm({ ...form, password: e.target.value })} />
        <Button>Создать ресторан</Button>
      </form>
      {msg && <div className="notice">{msg}</div>}
    </Card>}
  </main>;
}

function RestaurantAdmin({ user, restaurant }: any) {
  const [tab, setTab] = useState<Tab>('overview');
  const tabs = [
    { id: 'overview', title: 'Обзор' }, { id: 'users', title: 'Сотрудники' }, { id: 'checklists', title: 'Чек-листы' },
    { id: 'requests', title: 'Заявки' }, { id: 'inventory', title: 'Инвент.' }, { id: 'tasks', title: 'Задачи' }, { id: 'knowledge', title: 'База знаний' }
  ];
  return <main>
    <SubscriptionBanner restaurant={restaurant} />
    <Nav tabs={tabs} active={tab} setActive={setTab} />
    {tab === 'overview' && <AdminOverview />}
    {tab === 'users' && <UsersAdmin />}
    {tab === 'checklists' && <Checklists user={user} admin />}
    {tab === 'requests' && <Requests user={user} admin />}
    {tab === 'inventory' && <Inventory user={user} admin />}
    {tab === 'tasks' && <Tasks user={user} admin />}
    {tab === 'knowledge' && <Knowledge user={user} admin />}
  </main>;
}

function SubscriptionBanner({ restaurant }: any) {
  const status = restaurant?.subscription_status;
  const left = daysLeft(restaurant?.trial_ends_at);
  const computedStatus = restaurant?.subscription_status === 'active' && daysLeft(restaurant?.subscription_ends_at) === 0 && restaurant?.subscription_ends_at
    ? 'subscription_expired'
    : restaurant?.subscription_status === 'trial' && left === 0
      ? 'trial_expired'
      : status;

  return <div className={`subBanner ${computedStatus}`}>
    {computedStatus === 'trial'
      ? `Пробный период: осталось ${left} дн. Доступ до ${fmtDate(restaurant.trial_ends_at)}`
      : `Статус подписки: ${subscriptionLabel(computedStatus)}`}
  </div>;
}

function AdminOverview() {
  const [data, setData] = useState<any>(null);
  useEffect(() => { api('/api/admin/overview').then(setData); }, []);
  if (!data) return <Card><Empty text="Загружаем обзор" /></Card>;
  return <div className="statsGrid">
    <Card title="Сотрудники"><div className="stat">{data.users}</div></Card>
    <Card title="Чек-листы сегодня"><div className="stat">{data.checklists_today}</div></Card>
    <Card title="Открытые заявки"><div className="stat">{data.requests_open}</div></Card>
    <Card title="Задачи открыты"><div className="stat">{data.tasks_open}</div></Card>
    <Card title="Документы"><div className="stat">{data.docs}</div></Card>
    <Card title="Инвентаризации"><div className="stat">{data.inventories}</div></Card>
  </div>;
}

function UsersAdmin() {
  const [users, setUsers] = useState<any[]>([]);
  const [form, setForm] = useState<any>({ name: '', login: '', password: '', role: 'waiter' });
  const [msg, setMsg] = useState('');
  async function load() { setUsers(await api('/api/admin/users')); }
  useEffect(() => { load(); }, []);
  async function submit(e: FormEvent) {
    e.preventDefault(); setMsg('');
    try { await api('/api/admin/users', { method: 'POST', body: JSON.stringify(form) }); setForm({ name: '', login: '', password: '', role: 'waiter' }); load(); }
    catch (e: any) { setMsg(e.message); }
  }
  return <>
    <Card title="Создать сотрудника">
      <form className="form two" onSubmit={submit}>
        <Field label="Имя" value={form.name} onChange={(e: any) => setForm({ ...form, name: e.target.value })} />
        <Field label="Логин" value={form.login} onChange={(e: any) => setForm({ ...form, login: e.target.value })} />
        <Field label="Пароль" value={form.password} onChange={(e: any) => setForm({ ...form, password: e.target.value })} />
        <Select label="Роль" value={form.role} onChange={(e: any) => setForm({ ...form, role: e.target.value })}>{Object.entries(roles).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
        <Button>Добавить</Button>
      </form>
      {msg && <div className="notice">{msg}</div>}
    </Card>
    <Card title="Сотрудники">
      <div className="list">{users.map(u => <div className="listRow" key={u.id}><div><b>{u.name}</b><span>{u.login} · {roles[u.role]} · {departments[u.department]}</span></div><span className="badge active">{u.active ? 'активен' : 'выкл'}</span></div>)}</div>
    </Card>
  </>;
}

function EmployeeApp({ user, restaurant }: any) {
  const [tab, setTab] = useState<Tab>('today');
  const tabs = [
    { id: 'today', title: 'Сегодня' }, { id: 'checklists', title: 'Чек-лист' }, { id: 'requests', title: 'Заявки' },
    { id: 'inventory', title: 'Инвент.' }, { id: 'tasks', title: 'Задачи' }, { id: 'knowledge', title: 'База' }
  ];
  return <main>
    <div className="hello"><b>{user.name}</b><span>{roles[user.role]} · {restaurant?.name}</span></div>
    <Nav tabs={tabs} active={tab} setActive={setTab} />
    {tab === 'today' && <Today user={user} />}
    {tab === 'checklists' && <Checklists user={user} />}
    {tab === 'requests' && <Requests user={user} />}
    {tab === 'inventory' && <Inventory user={user} />}
    {tab === 'tasks' && <Tasks user={user} />}
    {tab === 'knowledge' && <Knowledge user={user} />}
  </main>;
}

function Today({ user }: any) {
  return <div className="grid">
    <Card title="Ваш день"><p>Роль: <b>{roles[user.role]}</b></p><p>Отдел: <b>{departments[user.department]}</b></p><p>Откройте чек-лист, создайте заявку, заполните инвентаризацию или посмотрите сервис-бук.</p></Card>
    <Card title="Что важно"><ul className="cleanList"><li>Чек-листы сохраняют дату, время и автора.</li><li>Заявки коллег видны внутри отдела.</li><li>Документы можно подтвердить кнопкой «Ознакомился».</li></ul></Card>
  </div>;
}

function Checklists({ user, admin = false }: any) {
  const [templates, setTemplates] = useState<any[]>([]);
  const [runs, setRuns] = useState<any[]>([]);
  const [answers, setAnswers] = useState<any>({});
  const [runMsg, setRunMsg] = useState('');
  const [editorMsg, setEditorMsg] = useState('');
  const [cameraTarget, setCameraTarget] = useState<{ itemId: string; title: string } | null>(null);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [templateForm, setTemplateForm] = useState<any>({
    title: '',
    role: 'manager',
    type: 'open',
    items: [{ id: '', text: '' }]
  });

  function resetTemplateEditor() {
    setEditingTemplateId(null);
    setTemplateForm({
      title: '',
      role: 'manager',
      type: 'open',
      items: [{ id: '', text: '' }]
    });
  }

  async function load() {
    setTemplates(await api('/api/checklists/templates'));
    if (admin) setRuns(await api('/api/admin/checklists/runs'));
  }
  useEffect(() => { load(); }, []);
  function updateAnswer(itemId: string, patch: any) {
    setAnswers((current: any) => ({ ...current, [itemId]: { ...(current[itemId] || {}), ...patch } }));
  }

  function updateTemplateItem(index: number, text: string) {
    setTemplateForm((current: any) => ({
      ...current,
      items: current.items.map((item: any, itemIndex: number) => itemIndex === index ? { ...item, text } : item)
    }));
  }

  function addTemplateItem() {
    setTemplateForm((current: any) => ({
      ...current,
      items: [...current.items, { id: '', text: '' }]
    }));
  }

  function removeTemplateItem(index: number) {
    setTemplateForm((current: any) => {
      const nextItems = current.items.filter((_: any, itemIndex: number) => itemIndex !== index);
      return {
        ...current,
        items: nextItems.length ? nextItems : [{ id: '', text: '' }]
      };
    });
  }

  function startTemplateEdit(template: any) {
    setEditorMsg('');
    setEditingTemplateId(template.id);
    setTemplateForm({
      title: template.title,
      role: template.role,
      type: template.type,
      items: template.items.map((item: any) => ({ id: item.id, text: item.text }))
    });
  }

  async function saveTemplate(e: FormEvent) {
    e.preventDefault();
    setEditorMsg('');
    const payload = {
      title: String(templateForm.title || '').trim(),
      role: templateForm.role,
      type: templateForm.type,
      items: templateForm.items
        .map((item: any) => ({ id: item.id || undefined, text: String(item.text || '').trim() }))
        .filter((item: any) => item.text)
    };

    try {
      if (editingTemplateId) {
        await api(`/api/admin/checklists/templates/${editingTemplateId}`, { method: 'PATCH', body: JSON.stringify(payload) });
        setEditorMsg('Чек-лист обновлён');
      } else {
        await api('/api/admin/checklists/templates', { method: 'POST', body: JSON.stringify(payload) });
        setEditorMsg('Чек-лист создан');
      }
      resetTemplateEditor();
      load();
    } catch (error: any) {
      setEditorMsg(error.message);
    }
  }

  async function submit(template: any) {
    setRunMsg('');
    const templateAnswers: any = {};
    template.items.forEach((i: any) => { templateAnswers[i.id] = answers[i.id] || { done: false, comment: '' }; });
    const missingPhoto = template.items.find((i: any) => templateAnswers[i.id]?.done && !templateAnswers[i.id]?.photo_url);
    if (missingPhoto) {
      setRunMsg(`Для пункта "${missingPhoto.text}" нужно сделать фото`);
      return;
    }
    await api('/api/checklists/runs', { method: 'POST', body: JSON.stringify({ template_id: template.id, answers: templateAnswers }) });
    setRunMsg('Чек-лист сохранён'); setAnswers({}); load();
  }
  return <>
    {admin && <Card title="Редактор чек-листов" right={<span className="badge active">Менеджер и владелец</span>}>
      <form className="form" onSubmit={saveTemplate}>
        <div className="form two">
          <Field label="Название чек-листа" value={templateForm.title} onChange={(e: any) => setTemplateForm({ ...templateForm, title: e.target.value })} placeholder="Например: Проверка открытия зала" />
          <Select label="Для роли" value={templateForm.role} onChange={(e: any) => setTemplateForm({ ...templateForm, role: e.target.value })}>
            {Object.entries(roles).map(([key, value]) => <option key={key} value={key}>{value}</option>)}
          </Select>
          <Select label="Тип" value={templateForm.type} onChange={(e: any) => setTemplateForm({ ...templateForm, type: e.target.value })}>
            {Object.entries(checklistTypes).map(([key, value]) => <option key={key} value={key}>{value}</option>)}
          </Select>
        </div>

        <div className="editorItems">
          {templateForm.items.map((item: any, index: number) => <div className="editorItemRow" key={item.id || `new-${index}`}>
            <input
              value={item.text}
              onChange={(e) => updateTemplateItem(index, e.target.value)}
              placeholder={`Пункт ${index + 1}`}
            />
            <button type="button" className="iconBtn" onClick={() => removeTemplateItem(index)}>×</button>
          </div>)}
        </div>

        <div className="actions">
          <Button kind="soft" type="button" onClick={addTemplateItem}>Добавить пункт</Button>
          {editingTemplateId && <Button kind="soft" type="button" onClick={resetTemplateEditor}>Отмена</Button>}
          <Button>{editingTemplateId ? 'Сохранить изменения' : 'Создать чек-лист'}</Button>
        </div>
      </form>
      {editorMsg && <div className={editorMsg.includes('обновл') || editorMsg.includes('создан') ? 'notice' : 'error'}>{editorMsg}</div>}
    </Card>}

    <Card title={admin ? 'Шаблоны и выполнение чек-листов' : 'Мои чек-листы'}>
      {templates.length === 0 && <Empty text="Нет чек-листов" />}
      <div className="grid">{templates.map(t => <div className="miniCard" key={t.id}>
        <div className="rowBetween"><b>{t.title}</b><span className="badge">{roles[t.role]} · {checklistTypes[t.type] || t.type}</span></div>
        <div className="checkItems">{t.items.map((i: any) => <div className="checkRow" key={i.id}>
          <input type="checkbox" checked={!!answers[i.id]?.done} onChange={(e) => updateAnswer(i.id, { done: e.target.checked })} />
          <div className="checkContent">
            <span>{i.text}</span>
            {answers[i.id]?.done && <div className="checkExtras">
              <Button kind="soft" onClick={() => setCameraTarget({ itemId: i.id, title: i.text })}>
                {answers[i.id]?.photo_url ? 'Переснять фото' : 'Сделать фото'}
              </Button>
              {answers[i.id]?.photo_url && <img className="photoPreview" src={answers[i.id].photo_url} alt={`Фото: ${i.text}`} />}
            </div>}
          </div>
        </div>)}</div>
        <div className="actions">
          {admin && <Button kind="soft" onClick={() => startTemplateEdit(t)}>Редактировать</Button>}
          <Button onClick={() => submit(t)}>Сохранить выполнение</Button>
        </div>
      </div>)}</div>
      {runMsg && <div className="notice">{runMsg}</div>}
    </Card>
    {admin && <Card title="Отчёты по выполнению чек-листов" right={<span className="badge active">Доступно менеджеру</span>}><div className="list">{runs.map(r => <div className="miniCard" key={r.id}>
      <div className="rowBetween"><div><b>{r.template?.title}</b><span>{r.user?.name} · {roles[r.user?.role] || 'Сотрудник'} · {fmtDate(r.created_at)}</span></div><span className="badge active">{r.status}</span></div>
      <div className="thumbRow">
        {r.answers?.filter((answer: any) => answer.photo_url).map((answer: any) => <a key={answer.id} className="thumbLink" href={answer.photo_url} target="_blank" rel="noreferrer">
          <img src={answer.photo_url} alt="Фото подтверждения" />
        </a>)}
        {r.answers?.filter((answer: any) => answer.photo_url).length === 0 && <span className="muted">Без фото</span>}
      </div>
    </div>)}</div></Card>}
    {cameraTarget && <CameraCapture
      title={cameraTarget.title}
      onClose={() => setCameraTarget(null)}
      onCapture={(photo) => updateAnswer(cameraTarget.itemId, { done: true, photo_url: photo })}
    />}
  </>;
}

function Requests({ user, admin = false }: any) {
  const [products, setProducts] = useState<any[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  const [qty, setQty] = useState<any>({});
  const [received, setReceived] = useState<any>({});
  const [msg, setMsg] = useState('');
  async function load() { setProducts(await api('/api/products')); setRequests(await api('/api/requests')); }
  useEffect(() => { load(); }, []);
  async function submit() {
    const items = Object.entries(qty).map(([product_id, q]) => ({ product_id, qty_ordered: Number(q) })).filter(i => i.qty_ordered > 0);
    await api('/api/requests', { method: 'POST', body: JSON.stringify({ department: user.department, items }) });
    setQty({}); setMsg('Заявка отправлена'); load();
  }
  async function receive(req: any) {
    await api(`/api/requests/${req.id}/receive`, { method: 'PATCH', body: JSON.stringify({ received: received[req.id] || {} }) });
    setMsg('Приход товара обновлён'); load();
  }
  return <>
    {!admin && <Card title="Создать заявку">
      <div className="productsGrid">{products.map(p => <label className="productQty" key={p.id}><span>{p.name}<em>{p.unit}</em></span><input type="number" min="0" value={qty[p.id] || ''} onChange={(e) => setQty({ ...qty, [p.id]: e.target.value })} placeholder="0" /></label>)}</div>
      <Button onClick={submit}>Отправить заявку</Button>{msg && <div className="notice">{msg}</div>}
    </Card>}
    <Card title={admin ? 'Все заявки ресторана' : 'Заявки коллег'}>
      {requests.length === 0 && <Empty text="Заявок пока нет" />}
      <div className="grid">{requests.map(r => <div className="miniCard" key={r.id}>
        <div className="rowBetween"><b>{departments[r.department]}</b><span className={`badge ${r.status}`}>{r.status}</span></div>
        <p>{r.created_by_user?.name} · {fmtDate(r.created_at)}</p>
        {r.items.map((i: any) => <div className="receiveRow" key={i.id}>
          <span>{i.product?.name}: заказано {i.qty_ordered} {i.product?.unit}, пришло {i.qty_received}</span>
          <input type="number" min="0" placeholder="пришло" onChange={(e) => setReceived({ ...received, [r.id]: { ...(received[r.id] || {}), [i.id]: e.target.value } })} />
        </div>)}
        <Button kind="soft" onClick={() => receive(r)}>Отметить приход</Button>
      </div>)}</div>
    </Card>
  </>;
}

function Inventory({ user, admin = false }: any) {
  const [templates, setTemplates] = useState<any[]>([]);
  const [runs, setRuns] = useState<any[]>([]);
  const [values, setValues] = useState<any>({});
  const [msg, setMsg] = useState('');
  async function load() {
    setTemplates(await api('/api/inventory/templates'));
    if (admin) setRuns(await api('/api/admin/inventory/runs'));
  }
  useEffect(() => { load(); }, []);
  async function submit(t: any) {
    const payload: any = {};
    t.items.forEach((i: any) => { payload[i.product_id] = { qty: Number(values[i.product_id] || 0), comment: '' }; });
    await api('/api/inventory/runs', { method: 'POST', body: JSON.stringify({ template_id: t.id, values: payload }) });
    setValues({}); setMsg('Инвентаризация сохранена'); load();
  }
  return <>
    <Card title="Бланки инвентаризации">
      <div className="grid">{templates.map(t => <div className="miniCard" key={t.id}>
        <div className="rowBetween"><b>{t.title}</b><span className="badge">{departments[t.department]}</span></div>
        <div className="productsGrid">{t.items.map((i: any) => <label className="productQty" key={i.product_id}><span>{i.product?.name}<em>{i.product?.unit}</em></span><input type="number" min="0" value={values[i.product_id] || ''} onChange={(e) => setValues({ ...values, [i.product_id]: e.target.value })} /></label>)}</div>
        <Button onClick={() => submit(t)}>Сохранить остатки</Button>
      </div>)}</div>
      {msg && <div className="notice">{msg}</div>}
    </Card>
    {admin && <Card title="Заполненные инвентаризации"><div className="list">{runs.map(r => <div className="listRow" key={r.id}><div><b>{r.template?.title}</b><span>{r.user?.name} · {fmtDate(r.created_at)}</span></div><Button kind="soft" onClick={() => download(`/api/admin/inventory/runs/${r.id}/export.xlsx`, `inventory-${r.id}.xlsx`)}>Excel</Button></div>)}</div></Card>}
  </>;
}

function Tasks({ user, admin = false }: any) {
  const [tasks, setTasks] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [form, setForm] = useState<any>({ title: '', description: '', target_type: 'all', target_role: 'waiter', target_user_id: '' });
  async function load() { setTasks(await api('/api/tasks')); if (admin) setUsers(await api('/api/admin/users')); }
  useEffect(() => { load(); }, []);
  async function create(e: FormEvent) { e.preventDefault(); await api('/api/tasks', { method: 'POST', body: JSON.stringify(form) }); setForm({ ...form, title: '', description: '' }); load(); }
  async function done(id: string) { await api(`/api/tasks/${id}/done`, { method: 'PATCH', body: JSON.stringify({ comment: '' }) }); load(); }
  return <>
    {admin && <Card title="Создать задачу">
      <form className="form two" onSubmit={create}>
        <Field label="Задача" value={form.title} onChange={(e: any) => setForm({ ...form, title: e.target.value })} />
        <Textarea label="Описание" value={form.description} onChange={(e: any) => setForm({ ...form, description: e.target.value })} />
        <Select label="Кому" value={form.target_type} onChange={(e: any) => setForm({ ...form, target_type: e.target.value })}><option value="all">Всем</option><option value="role">Роли</option><option value="user">Сотруднику</option></Select>
        {form.target_type === 'role' && <Select label="Роль" value={form.target_role} onChange={(e: any) => setForm({ ...form, target_role: e.target.value })}>{Object.entries(roles).filter(([k]) => !['owner'].includes(k)).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}
        {form.target_type === 'user' && <Select label="Сотрудник" value={form.target_user_id} onChange={(e: any) => setForm({ ...form, target_user_id: e.target.value })}><option value="">Выбрать</option>{users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>}
        <Button>Создать задачу</Button>
      </form>
    </Card>}
    <Card title={admin ? 'Задачи ресторана' : 'Мои задачи'}>
      <div className="grid">{tasks.map(t => <div className="miniCard" key={t.id}>
        <div className="rowBetween"><b>{t.title}</b>{!admin && <span className={`badge ${t.assignment?.done ? 'active' : ''}`}>{t.assignment?.done ? 'готово' : 'ждёт'}</span>}</div>
        <p>{t.description}</p>
        {admin ? <p>Назначено: {t.assignments?.length || 0}, выполнено: {t.assignments?.filter((a: any) => a.done).length || 0}</p> : !t.assignment?.done && <Button onClick={() => done(t.id)}>Выполнено</Button>}
      </div>)}</div>
    </Card>
  </>;
}

function Knowledge({ user, admin = false }: any) {
  const [categories, setCategories] = useState<any[]>([]);
  const [stats, setStats] = useState<any[]>([]);
  const [openDoc, setOpenDoc] = useState<any>(null);
  const [catForm, setCatForm] = useState<any>({ title: '', allowed_roles: ['waiter'] });
  const [docForm, setDocForm] = useState<any>({ category_id: '', title: '', content: '', allowed_roles: ['waiter'], requires_acknowledgement: true });
  async function load() { const cats = await api('/api/knowledge'); setCategories(cats); if (admin) setStats(await api('/api/admin/knowledge/stats')); }
  useEffect(() => { load(); }, []);
  async function viewDoc(doc: any) { setOpenDoc(doc); await api(`/api/knowledge/${doc.id}/view`, { method: 'POST', body: '{}' }); }
  async function ack(doc: any) { await api(`/api/knowledge/${doc.id}/ack`, { method: 'POST', body: '{}' }); setOpenDoc({ ...doc, acknowledged: true }); load(); }
  async function createCat(e: FormEvent) { e.preventDefault(); await api('/api/admin/knowledge/categories', { method: 'POST', body: JSON.stringify(catForm) }); setCatForm({ title: '', allowed_roles: ['waiter'] }); load(); }
  async function createDoc(e: FormEvent) { e.preventDefault(); await api('/api/admin/knowledge/documents', { method: 'POST', body: JSON.stringify(docForm) }); setDocForm({ ...docForm, title: '', content: '' }); load(); }
  return <>
    {admin && <Card title="Добавить документацию">
      <form className="form two" onSubmit={createCat}>
        <Field label="Новая папка" value={catForm.title} onChange={(e: any) => setCatForm({ ...catForm, title: e.target.value })} placeholder="Например: Сервис-бук" />
        <Button kind="soft">Создать папку</Button>
      </form>
      <form className="form" onSubmit={createDoc}>
        <Select label="Папка" value={docForm.category_id} onChange={(e: any) => setDocForm({ ...docForm, category_id: e.target.value })}><option value="">Выбрать папку</option>{categories.map(c => <option value={c.id} key={c.id}>{c.title}</option>)}</Select>
        <Field label="Название документа / ТТК" value={docForm.title} onChange={(e: any) => setDocForm({ ...docForm, title: e.target.value })} />
        <Textarea label="Текст" rows={8} value={docForm.content} onChange={(e: any) => setDocForm({ ...docForm, content: e.target.value })} />
        <Button>Добавить документ</Button>
      </form>
    </Card>}
    <Card title="База знаний / ТТК / сервис-бук">
      {categories.length === 0 && <Empty text="Документов нет" />}
      <div className="grid">{categories.map(c => <div className="miniCard" key={c.id}><b>{c.title}</b>{c.documents.map((d: any) => <button className="docRow" key={d.id} onClick={() => viewDoc(d)}><span>{d.title}</span><em>{d.acknowledged ? 'ознакомлен' : d.requires_acknowledgement ? 'нужно ознакомиться' : 'документ'}</em></button>)}</div>)}</div>
    </Card>
    {openDoc && <div className="modal" onClick={() => setOpenDoc(null)}><div className="modalCard" onClick={(e) => e.stopPropagation()}><div className="rowBetween"><h2>{openDoc.title}</h2><button className="iconBtn" onClick={() => setOpenDoc(null)}>×</button></div><pre>{openDoc.content}</pre>{openDoc.requires_acknowledgement && !openDoc.acknowledged && <Button onClick={() => ack(openDoc)}>Ознакомился</Button>}</div></div>}
    {admin && <Card title="Статистика ознакомления"><div className="list">{stats.map(s => <div className="listRow" key={s.id}><div><b>{s.title}</b><span>Просмотры: {s.views}</span></div><span className="badge active">Ознакомились: {s.acknowledgements}</span></div>)}</div></Card>}
  </>;
}
