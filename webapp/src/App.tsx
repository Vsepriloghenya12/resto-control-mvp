import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { OFFLINE_EVENT, api, clearToken, download, flushOfflineQueue, getToken, offlineQueueCount, setToken } from './api';
import {
  AppIcon,
  Button,
  Card,
  SidebarNav,
  StatCard,
  TrialBanner,
  WorkspaceHeader,
  type IconName,
  type NavTab
} from './components/dashboard-ui';
import {
  BottomNavigation,
  BottomSheet,
  MobileHeader,
  PageContainer,
  ProgressBar,
  SectionTitle,
  type MobileActionItem,
  type MobileNavItem
} from './components/mobile-ui';
import { Field, Select, Textarea, Empty } from './components/form-controls';
import { MobileSheetModal } from './components/mobile-sheet-modal';
import { Bookings } from './modules/bookings/Bookings';
import { Requests } from './modules/requests/Requests';
import { Tasks } from './modules/tasks/Tasks';
import { cx } from './lib/cx';
import {
  checklistRunStatuses,
  checklistTypes,
  departments,
  executableRoles,
  inventorySections,
  problemTypeLabels,
  requestStatuses,
  roles,
  seniorRoles,
  manageableRolesFor,
  type InventorySectionId
} from './lib/dictionaries';
import {
  daysLeft,
  fmtDate,
  inventorySectionMeta,
  mobileTabTitle,
  productMatchesInventorySection,
  subscriptionLabel,
  userInitials
} from './lib/format';

type View = 'login' | 'register';
type Tab = string;
type WorkspaceModalKind = 'notifications' | 'support' | 'billing' | null;
type MobileSheetKind = 'menu' | 'create' | 'profile' | null;
type MobileWorkspaceConfig = {
  title: ReactNode;
  subtitle?: ReactNode;
  isOverview?: boolean;
  showMenuButton?: boolean;
  showNotifications?: boolean;
  navItems: MobileNavItem[];
  menuItems: MobileActionItem[];
  createItems: MobileActionItem[];
  profileItems: MobileActionItem[];
  notificationCount?: number;
  onNotifications?: () => void;
  actionIcon?: IconName;
  onAction?: () => void;
};

const brandLogoSrc = '/resto-control-logo.png';

const subscriptionTariffs = [
  { title: 'Старт', employees: 'до 10 сотрудников', price: '1 490 ₽', period: '/ мес', note: 'Для небольших команд', featured: false },
  { title: 'Команда', employees: 'до 25 сотрудников', price: '2 590 ₽', period: '/ мес', note: 'Для растущего заведения', featured: true },
  { title: 'Бизнес', employees: 'до 50 сотрудников', price: '4 990 ₽', period: '/ мес', note: 'Для нескольких смен', featured: false },
  { title: 'Сеть', employees: 'до 100 сотрудников', price: '7 990 ₽', period: '/ мес', note: 'Для крупных ресторанов', featured: false },
  { title: 'Enterprise', employees: '100+ сотрудников', price: 'Индивидуально', period: '', note: 'Персональные условия', featured: false }
];

function TariffPlans() {
  return <div className="tariffGrid">
    {subscriptionTariffs.map((tariff) => <div className={cx('tariffCard', tariff.featured && 'featured')} key={tariff.title}>
      {tariff.featured && <span className="tariffBadge">Популярный</span>}
      <div className="tariffCardHead">
        <strong>{tariff.title}</strong>
        <span>{tariff.employees}</span>
      </div>
      <div className="tariffPrice">
        <b>{tariff.price}</b>
        {tariff.period && <em>{tariff.period}</em>}
      </div>
      <p>{tariff.note}</p>
    </div>)}
  </div>;
}

function WorkspaceInfoModal({
  title,
  text,
  details,
  actions,
  onClose
}: {
  title: string;
  text?: string;
  details?: ReactNode;
  actions: { label: string; kind?: string; onClick: () => void }[];
  onClose: () => void;
}) {
  return <div className="modal" onClick={onClose}>
    <div className="modalCard infoModalCard" onClick={(e) => e.stopPropagation()}>
      <div className="rowBetween">
        <h2>{title}</h2>
        <button className="iconBtn" onClick={onClose}>×</button>
      </div>
      {text && <p className="infoModalText">{text}</p>}
      {details}
      <div className="actions">
        {actions.map((action) => <Button
          key={action.label}
          type="button"
          kind={action.kind || 'soft'}
          onClick={() => {
            action.onClick();
            onClose();
          }}
        >
          {action.label}
        </Button>)}
      </div>
    </div>
  </div>;
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
    {user.is_super_admin
      ? <SuperAdmin user={user} onLogout={onLogout} />
      : ['owner', 'manager'].includes(user.role)
        ? <RestaurantAdmin user={user} restaurant={session.restaurant} onLogout={onLogout} />
        : <EmployeeApp user={user} restaurant={session.restaurant} onLogout={onLogout} />}
  </div>;
}


function useOfflineQueueState() {
  const [queueCount, setQueueCount] = useState(() => offlineQueueCount());
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' ? true : navigator.onLine);

  useEffect(() => {
    const update = () => {
      setQueueCount(offlineQueueCount());
      setOnline(typeof navigator === 'undefined' ? true : navigator.onLine);
    };
    const flush = () => { update(); flushOfflineQueue().finally(update); };
    window.addEventListener(OFFLINE_EVENT, update);
    window.addEventListener('online', flush);
    window.addEventListener('offline', update);
    flushOfflineQueue().finally(update);
    return () => {
      window.removeEventListener(OFFLINE_EVENT, update);
      window.removeEventListener('online', flush);
      window.removeEventListener('offline', update);
    };
  }, []);

  return { queueCount, online, sync: () => flushOfflineQueue().finally(() => setQueueCount(offlineQueueCount())) };
}


function OfflineSyncBanner() {
  const { queueCount, online, sync } = useOfflineQueueState();
  if (online && queueCount === 0) return null;
  return <div className={cx('mobileOfflineBanner', online && 'syncing')}>
    <div><strong>{online ? 'Есть действия для синхронизации' : 'Офлайн-режим'}</strong><span>{queueCount > 0 ? `${queueCount} действий ждут отправки` : 'Данные сохранятся при появлении сети'}</span></div>
    {online && queueCount > 0 && <button type="button" onClick={sync}>Синхр.</button>}
  </div>;
}

function NotificationCenter({ open, onClose, onChanged }: { open: boolean; onClose: () => void; onChanged: () => void }) {
  const [items, setItems] = useState<any[]>([]);
  const unread = items.filter(item => !item.read_at).length;
  async function load() { setItems(await api('/api/notifications')); }
  useEffect(() => { if (open) load(); }, [open]);
  async function markAllRead() { await api('/api/notifications/read-all', { method: 'POST', body: '{}' }); await load(); onChanged(); }
  if (!open) return null;
  return <MobileSheetModal title="Уведомления" subtitle={unread > 0 ? `${unread} новых` : 'Новых уведомлений нет'} onClose={onClose} className="mobileNotificationSheet" footer={items.length > 0 ? <Button type="button" kind="soft" onClick={markAllRead}>Отметить все прочитанными</Button> : null}>
    <div className="mobileListSurface mobileNotificationList">
      {items.length === 0 && <Empty text="Уведомлений пока нет" />}
      {items.map(item => <article key={item.id} className={cx('mobileNotificationItem', !item.read_at && 'unread')}><div><strong>{item.title}</strong><span>{item.body || 'Новое событие'} · {fmtDate(item.created_at)}</span></div>{!item.read_at && <span className="mobileNotificationDot" />}</article>)}
    </div>
  </MobileSheetModal>;
}

function ShiftControl({ user }: { user: any }) {
  const [shiftState, setShiftState] = useState<any>({ current: null, last_closed: null });
  const [msg, setMsg] = useState('');
  async function load() { try { setShiftState(await api('/api/shifts/current')); } catch { setShiftState({ current: null, last_closed: null }); } }
  useEffect(() => { load(); }, []);
  async function startShift() {
    setMsg('');
    const result = await api('/api/shifts/start', { method: 'POST', body: JSON.stringify({ location: departments[user.department] || '' }) });
    setMsg(result?.offline ? 'Смена сохранена офлайн' : 'Смена начата');
    load().catch(() => undefined);
  }
  async function closeShift() {
    if (!shiftState.current) return;
    const result = await api(`/api/shifts/${shiftState.current.id}/close`, { method: 'POST', body: JSON.stringify({ comment: '' }) });
    setMsg(result?.offline ? 'Закрытие смены сохранено офлайн' : 'Смена закрыта');
    load().catch(() => undefined);
  }
  const current = shiftState.current;
  return <section className={cx('mobileShiftCard', current && 'active')}>
    <div className="mobileShiftCardHead"><div><span>{roles[user.role]} · {departments[user.department]}</span><strong>{current ? 'Смена идёт' : 'Смена не начата'}</strong></div><span className={cx('badge', current ? 'active' : 'trial')}>{current ? 'активна' : 'начать'}</span></div>
    <p>{current ? `Начата ${fmtDate(current.opened_at)}` : shiftState.last_closed ? `Последняя смена: ${fmtDate(shiftState.last_closed.closed_at)}` : 'Начните смену перед чек-листами и задачами.'}</p>
    <div className="mobileShiftActions">{current ? <Button type="button" onClick={closeShift}>Закрыть смену</Button> : <Button type="button" onClick={startShift}>Начать смену</Button>}</div>
    {msg && <div className="notice mobileInlineNotice">{msg}</div>}
  </section>;
}

function ActivityFeed({ limit = 6, compact = false }: { limit?: number; compact?: boolean }) {
  const [events, setEvents] = useState<any[]>([]);
  useEffect(() => { api(`/api/activity?limit=${limit}`).then(setEvents).catch(() => setEvents([])); }, [limit]);
  return <div className={cx('activityFeed', compact && 'compact')}>{events.length === 0 && <Empty text="Событий пока нет" />}{events.map(event => <article key={event.id} className="activityItem"><span className="activityDot" /><div><strong>{event.title}</strong><span>{event.actor?.name || 'Система'} · {fmtDate(event.created_at)}</span></div></article>)}</div>;
}

function AdminProblemDashboard({ onNavigate }: { onNavigate?: (tab: string) => void }) {
  const [data, setData] = useState<any>(null);
  useEffect(() => { api('/api/admin/problems').then(setData).catch(() => setData(null)); }, []);
  if (!data) return <Card title="Проблемы"><Empty text="Загружаем проблемный дашборд" /></Card>;
  const metrics = data.metrics || {};
  function openProblem(problem: any) {
    if (problem.type === 'product_request') onNavigate?.('requests');
    else if (problem.type === 'tech_request' || problem.type === 'task') onNavigate?.('tasks');
    else if (problem.type === 'checklist_run') onNavigate?.('checklists');
  }
  return <><Card title="Пульт контроля" right={<Button kind="soft" onClick={() => download('/api/admin/reports/operations.csv', 'operations-report.csv')}>Экспорт CSV</Button>}>
    <div className="problemMetrics">
      <button type="button" onClick={() => onNavigate?.('checklists')}><strong>{metrics.open_shifts || 0}</strong><span>смен сейчас</span></button>
      <button type="button" onClick={() => onNavigate?.('tasks')}><strong>{metrics.overdue_tasks || 0}</strong><span>просрочено</span></button>
      <button type="button" onClick={() => onNavigate?.('tasks')}><strong>{metrics.open_tech_requests || 0}</strong><span>техзаявок</span></button>
      <button type="button" onClick={() => onNavigate?.('knowledge')}><strong>{metrics.pending_acknowledgements || 0}</strong><span>ознакомлений ждут</span></button>
    </div>
    <div className="problemList">
      {(data.problems || []).length === 0 && <Empty text="Критичных проблем сейчас нет" />}
      {(data.problems || []).map((problem: any) => <button type="button" className={cx('problemRow', problem.tone)} key={problem.id} onClick={() => openProblem(problem)}>
        <div><strong>{problem.title}</strong><span>{problem.subtitle}</span></div>
        <span className="badge">{problem.type_label || problemTypeLabels[problem.type] || problem.type}</span>
      </button>)}
    </div>
  </Card><Card title="Лента событий"><ActivityFeed limit={12} /></Card></>;
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
          <Field label="Эл. почта" value={form.email} onChange={(e: any) => setForm({ ...form, email: e.target.value })} />
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

const navIcons: Record<string, IconName> = {
  overview: 'overview',
  users: 'users',
  checklists: 'checklists',
  requests: 'requests',
  bookings: 'bookings',
  inventory: 'inventory',
  tasks: 'tasks',
  knowledge: 'knowledge',
  restaurants: 'overview',
  create: 'spark',
  today: 'overview'
};

function withIcons(tabs: { id: string; title: string }[]): NavTab[] {
  return tabs.map(tab => ({ ...tab, icon: navIcons[tab.id] || 'overview' }));
}

function Nav({ tabs, active, setActive }: { tabs: NavTab[]; active: string; setActive: (v: string) => void }) {
  return <nav className="tabs">{tabs.map(t => <button key={t.id} className={active === t.id ? 'active' : ''} onClick={() => setActive(t.id)}>
    <AppIcon name={t.icon || 'overview'} className="tabIcon" />
    <span>{t.title}</span>
  </button>)}</nav>;
}

function BasicWorkspace({
  user,
  subtitle,
  tabs,
  active,
  setActive,
  onLogout,
  children,
  mobile
}: {
  user: any;
  subtitle: string;
  tabs: NavTab[];
  active: string;
  setActive: (next: string) => void;
  onLogout: () => void;
  children: any;
  mobile?: MobileWorkspaceConfig;
}) {
  const [sheet, setSheet] = useState<MobileSheetKind>(null);

  function openNotifications() {
    if (tabs.some(tab => tab.id === 'tasks')) {
      setActive('tasks');
      return;
    }
    setActive(tabs[0]?.id || active);
  }

  return <main className="basicWorkspace">
    {mobile && <div className="mobileWorkspaceChrome">
      <MobileHeader
        mode={mobile.isOverview ? 'overview' : 'page'}
        title={mobile.title}
        subtitle={mobile.subtitle}
        logoSrc={brandLogoSrc}
        userInitials={userInitials(user.name)}
        notificationCount={mobile.notificationCount || 0}
        showMenuButton={mobile.showMenuButton !== false}
        showNotifications={mobile.showNotifications !== false}
        onMenu={() => setSheet('menu')}
        onBack={() => setActive(tabs[0]?.id || active)}
        onNotifications={mobile.onNotifications || openNotifications}
        onAction={mobile.onAction || (() => setSheet('profile'))}
        actionIcon={mobile.actionIcon || 'more'}
      />
    </div>}

    <div className="desktopWorkspaceChrome">
      <WorkspaceHeader userName={user.name} roleLabel={subtitle} onLogout={onLogout} onNotifications={openNotifications} />
      <Nav tabs={tabs} active={active} setActive={setActive} />
    </div>

    <PageContainer>{children}</PageContainer>

    {mobile && <>
      <BottomNavigation items={mobile.navItems} onCreate={() => setSheet('create')} />
      <BottomSheet open={sheet === 'menu'} title="Разделы" items={mobile.menuItems} onClose={() => setSheet(null)} />
      <BottomSheet open={sheet === 'create'} title="Быстрые действия" items={mobile.createItems} onClose={() => setSheet(null)} />
      <BottomSheet open={sheet === 'profile'} title="Профиль и доступ" items={mobile.profileItems} onClose={() => setSheet(null)} />
    </>}
  </main>;
}

function RestaurantWorkspace({
  user,
  restaurant,
  tabs,
  active,
  setActive,
  onLogout,
  banner,
  children
}: {
  user: any;
  restaurant: any;
  tabs: NavTab[];
  active: string;
  setActive: (next: string) => void;
  onLogout: () => void;
  banner: (openBilling: () => void) => any;
  children: any;
}) {
  const [modalKind, setModalKind] = useState<WorkspaceModalKind>(null);
  const [sheet, setSheet] = useState<MobileSheetKind>(null);

  function openNotifications() {
    setModalKind('notifications');
  }

  function openSupport() {
    setModalKind('support');
  }

  function openBilling() {
    setModalKind('billing');
  }

  function closeModal() {
    setModalKind(null);
  }

  const modal: { title: string; text?: string; details?: ReactNode; actions: { label: string; kind?: string; onClick: () => void }[] } | null = modalKind === 'notifications'
    ? {
        title: 'Центр действий',
        text: 'Быстро переходите к ключевым разделам кабинета: задачам, заявкам и чек-листам.',
        actions: [
          { label: 'Открыть задачи', kind: 'primary', onClick: () => setActive('tasks') },
          { label: 'Открыть заявки', onClick: () => setActive('requests') },
          { label: 'Открыть чек-листы', onClick: () => setActive('checklists') }
        ]
      }
    : modalKind === 'support'
      ? {
          title: 'Поддержка и сопровождение',
          text: 'Если нужно быстро разобраться в процессах, начните с базы знаний или вернитесь к обзору ресторана.',
          actions: [
            { label: 'База знаний', kind: 'primary', onClick: () => setActive('knowledge') },
            { label: 'Открыть обзор', onClick: () => setActive('overview') }
          ]
        }
      : modalKind === 'billing'
        ? {
            title: 'Тарифы и оплата',
            details: <TariffPlans />,
            actions: [
              { label: 'Открыть обзор', kind: 'primary', onClick: () => setActive('overview') }
            ]
          }
        : null;

  const managerMode = user.role === 'manager';
  const showMobileWorkspace = true;

  const mobileNavItems: MobileNavItem[] = [
    { id: 'overview', title: 'Обзор', icon: 'overview', active: active === 'overview', onClick: () => setActive('overview') },
    { id: 'bookings', title: 'Брони', icon: 'bookings', active: active === 'bookings', onClick: () => setActive('bookings') },
    { id: 'requests', title: 'Заявки', icon: 'requests', active: active === 'requests', onClick: () => setActive('requests') },
    { id: 'tasks', title: 'Задачи', icon: 'tasks', active: active === 'tasks', onClick: () => setActive('tasks') },
    { id: 'knowledge', title: 'База', icon: 'knowledge', active: active === 'knowledge', onClick: () => setActive('knowledge') }
  ];

  const mobileMenuItems: MobileActionItem[] = tabs
    .map((tab) => ({
      id: tab.id,
      title: tab.title,
      subtitle: restaurant?.name,
      icon: tab.icon || 'overview',
      onClick: () => setActive(tab.id)
    }));

  const mobileCreateItems: MobileActionItem[] = managerMode
    ? [
      { id: 'bookings', title: 'Открыть брони', subtitle: 'Схема зала и посадка гостей', icon: 'bookings', onClick: () => setActive('bookings') },
      { id: 'requests', title: 'Открыть заявки', subtitle: 'Приёмка и комментарии по заказам', icon: 'requests', onClick: () => setActive('requests') },
      { id: 'tasks', title: 'Создать задачу', subtitle: 'Поставить задачу или обработать техзаявку', icon: 'tasks', onClick: () => setActive('tasks') },
      { id: 'users', title: 'Сотрудники', subtitle: 'Доступы и роли команды', icon: 'users', onClick: () => setActive('users') }
    ]
    : [
      { id: 'users', title: 'Сотрудники', subtitle: 'Добавить и управлять доступами', icon: 'users', onClick: () => setActive('users') },
      { id: 'requests', title: 'Открыть заявки', subtitle: 'Закупки, приёмка и комментарии', icon: 'requests', onClick: () => setActive('requests') },
      { id: 'inventory', title: 'Номенклатура', subtitle: 'Товары, бланки и Excel-отчёты', icon: 'inventory', onClick: () => setActive('inventory') }
    ];

  const mobileProfileItems: MobileActionItem[] = managerMode
    ? [
      { id: 'support', title: 'База знаний', subtitle: 'Инструкции и документы', icon: 'knowledge', onClick: () => setActive('knowledge') },
      { id: 'logout', title: 'Выйти', subtitle: 'Завершить рабочую сессию', icon: 'logout', onClick: onLogout }
    ]
    : [
      { id: 'support', title: 'База знаний', subtitle: 'Инструкции и документы', icon: 'knowledge', onClick: () => setActive('knowledge') },
      { id: 'billing', title: 'Тарифы и оплата', subtitle: 'Статус подписки и продление', icon: 'trial', onClick: openBilling },
      { id: 'logout', title: 'Выйти', subtitle: 'Завершить рабочую сессию', icon: 'logout', onClick: onLogout }
    ];

  return <main className={cx('workspaceLayout', managerMode ? 'managerWorkspace' : 'ownerDesktopWorkspace')}>
    <SidebarNav
      logoSrc={brandLogoSrc}
      tabs={tabs}
      active={active}
      onChange={setActive}
      onPromoClick={() => setActive('overview')}
      onSupportClick={openSupport}
    />
    <section className="workspaceMain">
      {showMobileWorkspace && <div className="mobileWorkspaceChrome">
        <MobileHeader
          mode={active === 'overview' ? 'overview' : 'page'}
          title={active === 'overview' ? <>Добро пожаловать, <em>{user.name}</em></> : mobileTabTitle(active, tabs)}
          subtitle={active === 'overview' ? `${roles[user.role]} в рабочем кабинете` : restaurant?.name}
          logoSrc={brandLogoSrc}
          userInitials={userInitials(user.name)}
          notificationCount={0}
          onMenu={() => setSheet('menu')}
          onBack={() => setActive('overview')}
          onNotifications={() => setActive('tasks')}
          onAction={() => setSheet('profile')}
        />
      </div>}

      <div className="desktopWorkspaceChrome">
        <WorkspaceHeader
          userName={user.name}
          roleLabel={`${roles[user.role]} в рабочем кабинете`}
          onLogout={onLogout}
          onNotifications={openNotifications}
        />
        <div className="workspaceSubline">{restaurant?.name}</div>
        <div className="mobileTabsWrap">
          <Nav tabs={tabs} active={active} setActive={setActive} />
        </div>
      </div>

      <div className="pageContainer workspacePageContainer">
        {banner(openBilling)}
        <div className="workspaceContent">{children}</div>
      </div>
    </section>
    {modal && <WorkspaceInfoModal title={modal.title} text={modal.text} details={modal.details} actions={modal.actions} onClose={closeModal} />}
    {showMobileWorkspace && <>
      <BottomNavigation items={mobileNavItems} onCreate={() => setSheet('create')} />
      <BottomSheet open={sheet === 'menu'} title="Разделы кабинета" items={mobileMenuItems} onClose={() => setSheet(null)} />
      <BottomSheet open={sheet === 'create'} title="Быстрые действия" items={mobileCreateItems} onClose={() => setSheet(null)} />
      <BottomSheet open={sheet === 'profile'} title="Профиль и доступ" items={mobileProfileItems} onClose={() => setSheet(null)} />
    </>}
  </main>;
}

function SuperAdmin({ user, onLogout }: any) {
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

  return <BasicWorkspace
    user={user}
    subtitle="Супер-админ создателя"
    tabs={withIcons([{ id: 'restaurants', title: 'Рестораны' }, { id: 'create', title: 'Создать' }])}
    active={tab}
    setActive={setTab}
    onLogout={onLogout}
  >
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
        <Field label="Эл. почта" value={form.email} onChange={(e: any) => setForm({ ...form, email: e.target.value })} />
        <Field label="Логин владельца" value={form.login} onChange={(e: any) => setForm({ ...form, login: e.target.value })} />
        <Field label="Пароль" value={form.password} onChange={(e: any) => setForm({ ...form, password: e.target.value })} />
        <Button>Создать ресторан</Button>
      </form>
      {msg && <div className="notice">{msg}</div>}
    </Card>}
  </BasicWorkspace>;
}

function RestaurantAdmin({ user, restaurant, onLogout }: any) {
  const [tab, setTab] = useState<Tab>('overview');
  const isManager = user.role === 'manager';
  const tabs = withIcons([
    { id: 'overview', title: isManager ? 'Пульт смены' : 'Обзор' },
    { id: 'users', title: 'Сотрудники' },
    { id: 'checklists', title: 'Чек-листы' },
    { id: 'inventory', title: 'Номенклатура' },
    { id: 'bookings', title: 'Брони / залы' },
    { id: 'requests', title: 'Заявки' },
    { id: 'tasks', title: 'Задачи' },
    { id: 'knowledge', title: 'База знаний' }
  ]);
  const section = useMemo(() => {
    if (tab === 'overview') return <AdminOverview mode={user.role === 'manager' ? 'manager' : 'owner'} onNavigate={setTab} />;
    if (tab === 'users') return <UsersAdmin user={user} />;
    if (tab === 'checklists') return <Checklists user={user} admin />;
    if (tab === 'requests') return <Requests user={user} admin />;
    if (tab === 'bookings') return <Bookings user={user} admin />;
    if (tab === 'inventory') return <Inventory user={user} admin />;
    if (tab === 'tasks') return <Tasks user={user} admin />;
    return <Knowledge user={user} admin />;
  }, [tab, user]);

  return <RestaurantWorkspace
    user={user}
    restaurant={restaurant}
    tabs={tabs}
    active={tab}
    setActive={setTab}
    onLogout={onLogout}
    banner={(openBilling) => user.role === 'owner' ? <SubscriptionBanner restaurant={restaurant} openBilling={openBilling} /> : null}
  >
    <div className="contentStack">{section}</div>
  </RestaurantWorkspace>;
}

function SubscriptionBanner({ restaurant, openBilling }: any) {
  const status = restaurant?.subscription_status;
  const left = daysLeft(restaurant?.trial_ends_at);
  const computedStatus = restaurant?.subscription_status === 'active' && daysLeft(restaurant?.subscription_ends_at) === 0 && restaurant?.subscription_ends_at
    ? 'subscription_expired'
    : restaurant?.subscription_status === 'trial' && left === 0
      ? 'trial_expired'
      : status;
  const headline = computedStatus === 'trial'
    ? `Пробный период: осталось ${left} дней`
    : `Статус подписки: ${subscriptionLabel(computedStatus)}`;
  const subline = computedStatus === 'trial'
    ? `Доступ до ${fmtDate(restaurant.trial_ends_at)}`
    : restaurant?.subscription_ends_at
      ? `Оплачено до ${fmtDate(restaurant.subscription_ends_at)}`
      : 'Свяжитесь с нами для подключения тарифа';

  return <TrialBanner headline={headline} subline={subline} onAction={openBilling} />;
}

function AdminOverview({ mode = 'owner', onNavigate }: { mode?: 'owner' | 'manager'; onNavigate?: (tab: string) => void }) {
  const [data, setData] = useState<any>(null);
  useEffect(() => { api('/api/admin/overview').then(setData); }, []);
  if (!data) return <Card><Empty text="Загружаем обзор" /></Card>;
  const managerMode = mode === 'manager';
  const employeeLimit = data.employee_limit === null ? '∞' : data.employee_limit;
  const employeesValue = employeeLimit ? `${data.users} из ${employeeLimit}` : data.users;
  const summary = data.summary || {};
  const checklistSummary = summary.checklists || {};
  const requestSummary = summary.requests || {};
  const taskSummary = summary.tasks || {};
  const documentSummary = summary.documents || {};
  const inventorySummary = summary.inventories || {};
  const statNumber = (value: any, tone: 'done' | 'todo' | 'neutral' = 'neutral') => {
    const count = Number(value || 0);
    return <span className={cx('statNumberPart', count === 0 ? 'zero' : tone)}>{count}</span>;
  };
  const statNumbers = (...items: Array<{ value: any; tone?: 'done' | 'todo' | 'neutral' }>) => (
    <span className="statNumberSet">
      {items.map((item, index) => <span className="statNumberGroup" key={index}>
        {index > 0 && <span className="statNumberSep">/</span>}
        {statNumber(item.value, item.tone)}
      </span>)}
    </span>
  );
  return <>
    <div className={cx('statsGrid', managerMode && 'managerStatsGrid')}>
      <StatCard
        icon="users"
        title="Сотрудники"
        value={employeesValue}
        onClick={() => onNavigate?.('users')}
      />
      <StatCard
        icon="checklists"
        title="Чек-листы сегодня"
        value={statNumbers(
          { value: checklistSummary.done ?? data.checklists_today, tone: 'done' },
          { value: checklistSummary.not_done, tone: 'todo' }
        )}
        onClick={() => onNavigate?.('checklists')}
      />
      <StatCard
        icon="requests"
        title="Заявки"
        value={statNumber(requestSummary.new, 'todo')}
        onClick={() => onNavigate?.('requests')}
      />
      <StatCard
        icon="tasks"
        title="Задачи"
        value={statNumbers(
          { value: taskSummary.new, tone: 'todo' },
          { value: taskSummary.done, tone: 'done' },
          { value: taskSummary.not_done ?? data.tasks_open, tone: 'todo' }
        )}
        onClick={() => onNavigate?.('tasks')}
      />
      <StatCard
        icon="document"
        title="Документы"
        value={statNumber(documentSummary.total ?? data.docs, 'neutral')}
        onClick={() => onNavigate?.('knowledge')}
      />
      <StatCard
        icon="inventory"
        title="Инвентаризации"
        value={statNumbers(
          { value: inventorySummary.ready, tone: 'done' },
          { value: inventorySummary.not_ready, tone: 'todo' }
        )}
        onClick={() => onNavigate?.('inventory')}
      />
    </div>

    <OverviewEmployeeMetrics rows={data.employee_metrics || []} />

    {managerMode && <Card title="Пульт смены" right={<span className="badge active">Управление рестораном</span>}>
      <div className="overviewHero">
        <div className="overviewHeroCopy">
          <strong>Смена и настройки под контролем</strong>
          <p>Менеджер ведёт сотрудников, чек-листы, номенклатуру, залы, базу знаний и ежедневную операционку.</p>
        </div>
        <div className="overviewHighlights">
          <div><span className="muted">Открытые заявки</span><b>{data.requests_open || 0}</b></div>
          <div><span className="muted">Сотрудники</span><b>{employeesValue}</b></div>
          <div><span className="muted">Задачи в работе</span><b>{data.tasks_open}</b></div>
        </div>
      </div>
    </Card>}
    {managerMode && <AdminProblemDashboard onNavigate={onNavigate} />}
  </>;
}

function EmployeeDetailList({ title, count, empty, children }: { title: string; count?: number; empty: string; children: ReactNode }) {
  return <section className="employeeDetailSection">
    <div className="employeeDetailSectionHead"><strong>{title}</strong>{count !== undefined && <span>{count}</span>}</div>
    {count === 0 ? <p className="employeeDetailEmpty">{empty}</p> : <div className="employeeDetailSectionBody">{children}</div>}
  </section>;
}

function EmployeeDetailBullets({ items, done = false }: { items: any[]; done?: boolean }) {
  const visibleItems = items.slice(0, 6);
  return <ul className="employeeDetailBullets">
    {visibleItems.map((item: any) => <li key={item.id || item.text} className={done ? 'done' : ''}>
      <span>{item.text || item.title || 'Пункт'}</span>
      {item.comment && <em>{item.comment}</em>}
      {item.photo_url && <em>Фото приложено</em>}
    </li>)}
    {items.length > visibleItems.length && <li><span>Ещё {items.length - visibleItems.length}</span></li>}
  </ul>;
}

function EmployeeMetricsExpanded({ row }: { row: any }) {
  const checklistDetails = row.checklists?.details || [];
  const doneChecklists = checklistDetails.filter((item: any) => item.status === 'done');
  const notDoneChecklists = checklistDetails.filter((item: any) => item.status !== 'done');
  const taskDetails = row.tasks?.details || [];
  const openTasks = taskDetails.filter((task: any) => !task.done);
  const doneTasks = taskDetails.filter((task: any) => task.done);
  const documentDetails = row.documents?.details || [];
  const pendingDocuments = documentDetails.filter((doc: any) => doc.status === 'pending');
  const acknowledgedDocuments = documentDetails.filter((doc: any) => doc.status === 'acknowledged');
  const inventoryDetails = row.inventories?.details || [];
  const readyInventories = inventoryDetails.filter((item: any) => item.status === 'ready');
  const notReadyInventories = inventoryDetails.filter((item: any) => item.status !== 'ready');
  const requestDetails = row.requests?.details || [];
  const openRequests = requestDetails.filter((request: any) => !['received', 'done', 'cancelled'].includes(request.status));

  return <div className="employeeMetricsDetails detailed">
    <div className="employeeDetailsSummaryGrid">
      <div><span>Чек-листы выполнены</span><strong>{doneChecklists.length}</strong></div>
      <div><span>Чек-листы не выполнены</span><strong>{notDoneChecklists.length}</strong></div>
      <div><span>Документы ждут</span><strong>{pendingDocuments.length}</strong></div>
      <div><span>Документы ознакомлены</span><strong>{acknowledgedDocuments.length}</strong></div>
      <div><span>Открытые задачи</span><strong>{openTasks.length}</strong></div>
    </div>

    <div className="employeeDetailColumns">
      <EmployeeDetailList title="Чек-листы: не выполнено" count={notDoneChecklists.length} empty="Нет невыполненных чек-листов">
        {notDoneChecklists.map((checklist: any) => <article className="employeeDetailCard" key={checklist.id}>
          <div className="employeeDetailCardHead"><strong>{checklist.title}</strong><span className="badge warning">не выполнено</span></div>
          <p>{checklistTypes[checklist.type] || checklist.type || 'Чек-лист'} · {checklist.not_done_items?.length || 0} пунктов</p>
          <EmployeeDetailBullets items={checklist.not_done_items || []} />
        </article>)}
      </EmployeeDetailList>

      <EmployeeDetailList title="Чек-листы: выполнено" count={doneChecklists.length} empty="Выполненных чек-листов сегодня нет">
        {doneChecklists.map((checklist: any) => <article className="employeeDetailCard" key={checklist.id}>
          <div className="employeeDetailCardHead"><strong>{checklist.title}</strong><span className="badge active">выполнено</span></div>
          <p>{checklist.completed_at ? `Завершён: ${fmtDate(checklist.completed_at)}` : checklistTypes[checklist.type] || 'Чек-лист'}</p>
          {!!checklist.done_items?.length && <EmployeeDetailBullets items={checklist.done_items} done />}
          {!!checklist.not_done_items?.length && <><p>Неотмеченные пункты:</p><EmployeeDetailBullets items={checklist.not_done_items} /></>}
        </article>)}
      </EmployeeDetailList>

      <EmployeeDetailList title="Документы ждут ознакомления" count={pendingDocuments.length} empty="Нет документов, ожидающих ознакомления">
        {pendingDocuments.map((doc: any) => <article className="employeeDetailCard compact" key={doc.id}>
          <div className="employeeDetailCardHead"><strong>{doc.title}</strong><span className="badge warning">ждёт</span></div>
          <p>Версия {doc.version || 1}</p>
        </article>)}
      </EmployeeDetailList>

      <EmployeeDetailList title="Документы ознакомлены" count={acknowledgedDocuments.length} empty="Ознакомленных документов пока нет">
        {acknowledgedDocuments.map((doc: any) => <article className="employeeDetailCard compact" key={doc.id}>
          <div className="employeeDetailCardHead"><strong>{doc.title}</strong><span className="badge active">ознакомлен</span></div>
          <p>{doc.acknowledged_at ? fmtDate(doc.acknowledged_at) : `Версия ${doc.version || 1}`}</p>
        </article>)}
      </EmployeeDetailList>

      <EmployeeDetailList title="Задачи" count={taskDetails.length} empty="Задач для сотрудника нет">
        {openTasks.map((task: any) => <article className="employeeDetailCard" key={task.id}>
          <div className="employeeDetailCardHead"><strong>{task.title}</strong><span className={cx('badge', task.overdue ? 'cancelled' : 'warning')}>{task.overdue ? 'просрочено' : 'в работе'}</span></div>
          <p>{task.description || 'Без описания'}{task.due_at ? ` · срок: ${fmtDate(task.due_at)}` : ''}</p>
        </article>)}
        {doneTasks.map((task: any) => <article className="employeeDetailCard compact" key={task.id}>
          <div className="employeeDetailCardHead"><strong>{task.title}</strong><span className="badge active">выполнено</span></div>
          <p>{task.completed_at ? fmtDate(task.completed_at) : task.comment || 'Задача закрыта'}</p>
        </article>)}
      </EmployeeDetailList>

      <EmployeeDetailList title="Инвентаризации" count={inventoryDetails.length} empty="Инвентаризаций для подразделения нет">
        {notReadyInventories.map((item: any) => <article className="employeeDetailCard compact" key={item.id}>
          <div className="employeeDetailCardHead"><strong>{item.title}</strong><span className="badge warning">не готово</span></div>
          <p>{departments[item.department] || item.department || 'Подразделение'}</p>
        </article>)}
        {readyInventories.map((item: any) => <article className="employeeDetailCard compact" key={item.id}>
          <div className="employeeDetailCardHead"><strong>{item.title}</strong><span className="badge active">готово</span></div>
          <p>{item.completed_at ? fmtDate(item.completed_at) : departments[item.department] || item.department || 'Подразделение'}</p>
        </article>)}
      </EmployeeDetailList>

      <EmployeeDetailList title="Заявки сотрудника" count={requestDetails.length} empty="Сотрудник ещё не создавал заявки">
        {requestDetails.slice(0, 8).map((request: any) => <article className="employeeDetailCard compact" key={request.id}>
          <div className="employeeDetailCardHead"><strong>{departments[request.department] || request.department || 'Заявка'}</strong><span className={cx('badge', request.status)}>{requestStatuses[request.status] || request.status}</span></div>
          <p>{request.items_count || 0} позиций · {fmtDate(request.created_at)}</p>
        </article>)}
        {openRequests.length > 0 && <p className="employeeDetailHint">Открытых заявок: {openRequests.length}</p>}
      </EmployeeDetailList>
    </div>
  </div>;
}

function OverviewEmployeeMetrics({ rows }: { rows: any[] }) {
  const [expandedEmployeeId, setExpandedEmployeeId] = useState('');
  const metricNumber = (value: any, tone: 'done' | 'todo' | 'neutral' = 'neutral') => {
    const count = Number(value || 0);
    return <span className={cx('statNumberPart', count === 0 ? 'zero' : tone)}>{count}</span>;
  };
  const metricPair = (done: any, todo: any) => (
    <span className="employeeMetricNumbers">
      {metricNumber(done, 'done')}
      <span className="statNumberSep">/</span>
      {metricNumber(todo, 'todo')}
    </span>
  );
  const taskNumbers = (metric: any = {}) => (
    <span className="employeeMetricNumbers triple">
      {metricNumber(metric.new, 'todo')}
      <span className="statNumberSep">/</span>
      {metricNumber(metric.done, 'done')}
      <span className="statNumberSep">/</span>
      {metricNumber(metric.not_done, 'todo')}
    </span>
  );

  return <section className="employeeMetricsPlain">
    <h3>Сотрудники и показатели</h3>
    {rows.length === 0 && <Empty text="Активных сотрудников пока нет" />}
    <div className="employeeMetricsList">
      {rows.map((row) => {
        const employeeId = String(row.user?.id || row.user?.name || 'employee');
        const expanded = expandedEmployeeId === employeeId;
        return <div className={cx('employeeMetricsEntry', expanded && 'open')} key={employeeId}>
          <button
            type="button"
            className="employeeMetricsRow"
            aria-expanded={expanded}
            onClick={() => setExpandedEmployeeId(expanded ? '' : employeeId)}
          >
            <div className="employeeMetricsPerson">
              <strong>{row.user?.name || 'Сотрудник'}</strong>
              <span>{roles[row.user?.role] || row.user?.role || 'Роль не указана'}</span>
            </div>
            <span className="employeeMetricValue" data-label="ЧЛ">{metricPair(row.checklists?.done, row.checklists?.not_done)}</span>
            <span className="employeeMetricValue" data-label="Заявки">{metricNumber(row.requests?.new, 'todo')}</span>
            <span className="employeeMetricValue wide" data-label="Задачи">{taskNumbers(row.tasks)}</span>
            <span className="employeeMetricValue" data-label="Док">{metricNumber(row.documents?.pending, 'todo')}</span>
            <span className="employeeMetricValue" data-label="Инв">{metricPair(row.inventories?.ready, row.inventories?.not_ready)}</span>
          </button>
          {expanded && <EmployeeMetricsExpanded row={row} />}
        </div>;
      })}
    </div>
  </section>;
}

function UsersAdmin({ user }: any) {
  const [users, setUsers] = useState<any[]>([]);
  const [form, setForm] = useState<any>({ name: '', login: '', password: '', role: 'waiter' });
  const [editingUserId, setEditingUserId] = useState('');
  const [editForm, setEditForm] = useState<any>({ name: '', login: '', password: '', role: 'waiter', active: true });
  const [msg, setMsg] = useState('');
  const canSeeEmployeePasswords = user?.is_super_admin || user?.role === 'owner' || user?.role === 'manager';
  async function load() { setUsers(await api('/api/admin/users')); }
  useEffect(() => { load(); }, []);
  async function submit(e: FormEvent) {
    e.preventDefault(); setMsg('');
    try { await api('/api/admin/users', { method: 'POST', body: JSON.stringify(form) }); setForm({ name: '', login: '', password: '', role: 'waiter' }); setMsg('Сотрудник добавлен'); load(); }
    catch (e: any) { setMsg(e.message); }
  }
  function startEdit(user: any) {
    if (user.role === 'owner') return;
    setEditingUserId(user.id);
    setEditForm({ name: user.name, login: user.login, password: '', role: user.role, active: user.active !== false });
    setMsg('');
  }
  function cancelEdit() {
    setEditingUserId('');
    setEditForm({ name: '', login: '', password: '', role: 'waiter', active: true });
  }
  async function saveEdit(e: FormEvent) {
    e.preventDefault();
    setMsg('');
    try {
      const payload: any = { name: editForm.name, login: editForm.login, role: editForm.role, active: editForm.active };
      if (editForm.password) payload.password = editForm.password;
      await api(`/api/admin/users/${editingUserId}`, { method: 'PATCH', body: JSON.stringify(payload) });
      setMsg('Сотрудник обновлён');
      cancelEdit();
      load();
    } catch (e: any) { setMsg(e.message); }
  }
  async function removeUser(user: any) {
    if (!window.confirm(`Удалить сотрудника "${user.name}"?`)) return;
    setMsg('');
    try {
      await api(`/api/admin/users/${user.id}`, { method: 'DELETE' });
      if (editingUserId === user.id) cancelEdit();
      setMsg('Сотрудник удалён');
      load();
    } catch (e: any) { setMsg(e.message); }
  }
  return <>
    <Card title="Создать сотрудника" className="adminCreateCard">
      <form className="form two compactAdminForm" onSubmit={submit}>
        <Field label="Имя" value={form.name} onChange={(e: any) => setForm({ ...form, name: e.target.value })} />
        <Field label="Логин" value={form.login} onChange={(e: any) => setForm({ ...form, login: e.target.value })} />
        <Field label="Пароль" value={form.password} onChange={(e: any) => setForm({ ...form, password: e.target.value })} />
        <Select label="Роль" value={form.role} onChange={(e: any) => setForm({ ...form, role: e.target.value })}>{executableRoles.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
        <Button>Добавить</Button>
      </form>
      {msg && <div className={msg.includes('удал') || msg.includes('обнов') || msg.includes('добав') ? 'notice compactNotice' : 'error compactNotice'}>{msg}</div>}
    </Card>

    <Card title="Сотрудники" right={<span className="muted adminHint">Нажмите на строку, чтобы редактировать</span>}>
      <div className="adminCompactList">{users.map(u => {
        const editing = editingUserId === u.id;
        return <div className={cx('adminEditableRow', editing && 'editing', u.role === 'owner' && 'locked')} key={u.id}>
          {editing ? <form className="adminInlineEditor" onSubmit={saveEdit}>
            <Field label="Имя" value={editForm.name} onChange={(e: any) => setEditForm({ ...editForm, name: e.target.value })} />
            <Field label="Логин" value={editForm.login} onChange={(e: any) => setEditForm({ ...editForm, login: e.target.value })} />
            <Field label="Новый пароль" value={editForm.password} onChange={(e: any) => setEditForm({ ...editForm, password: e.target.value })} placeholder="Не менять" />
            <Select label="Роль" value={editForm.role} onChange={(e: any) => setEditForm({ ...editForm, role: e.target.value })}>{executableRoles.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
            <label className="checkboxRow compactCheckbox"><input type="checkbox" checked={!!editForm.active} onChange={(e) => setEditForm({ ...editForm, active: e.target.checked })} /><span>{editForm.active ? 'Активен' : 'Отключён'}</span></label>
            <div className="adminInlineActions"><Button kind="soft" type="button" onClick={cancelEdit}>Отмена</Button><Button>Сохранить</Button><Button kind="danger" type="button" onClick={() => removeUser(u)}>Удалить</Button></div>
          </form> : <button type="button" className="adminRowButton" onClick={() => startEdit(u)} disabled={u.role === 'owner'}>
            <div className="adminRowMain">
              <b>{u.name}</b>
              <span>{u.login} · {roles[u.role]} · {departments[u.department]}</span>
              {canSeeEmployeePasswords && u.role !== 'owner' && <span className="adminPasswordLine">Пароль: <code>{u.access_password || 'задайте новый пароль'}</code></span>}
            </div>
            <div className="adminRowMeta"><span className={`badge ${u.active ? 'active' : 'cancelled'}`}>{u.active ? 'активен' : 'выкл'}</span><em>{u.role === 'owner' ? 'Владелец' : 'Изменить'}</em></div>
          </button>}
        </div>;
      })}</div>
    </Card>
  </>;
}

function EmployeeApp({ user, restaurant, onLogout }: any) {
  const [tab, setTab] = useState<Tab>('today');
  const [notificationCount, setNotificationCount] = useState(0);
  const [openTechComposer, setOpenTechComposer] = useState(false);
  const [openRequestComposer, setOpenRequestComposer] = useState(false);
  const [showNotificationCenter, setShowNotificationCenter] = useState(false);
  const isSenior = seniorRoles.includes(user.role);
  const tabs = withIcons([
    { id: 'today', title: 'Сегодня' }, { id: 'checklists', title: 'Чек-лист' }, { id: 'bookings', title: 'Брони' }, { id: 'requests', title: 'Заявки' },
    { id: 'inventory', title: 'Инвент.' }, { id: 'tasks', title: 'Задачи' }, { id: 'knowledge', title: 'База' },
    ...(isSenior ? [{ id: 'admin-checklists', title: 'Редактор ЧЛ' }, { id: 'admin-tasks', title: 'Задачи отдела' }] : [])
  ]);

  async function refreshNotifications() {
    try {
      const [notifications, tasks] = await Promise.all([api('/api/notifications').catch(() => []), api('/api/tasks').catch(() => [])]);
      setNotificationCount(notifications.filter((item: any) => !item.read_at).length + tasks.filter((task: any) => !task.assignment?.done).length);
    } catch {
      setNotificationCount(0);
    }
  }

  useEffect(() => { refreshNotifications(); }, [tab]);

  const mobileNavItems: MobileNavItem[] = [
    { id: 'today', title: 'Обзор', icon: 'overview', active: tab === 'today', onClick: () => setTab('today') },
    { id: 'checklists', title: 'Чек-листы', icon: 'checklists', active: tab === 'checklists', onClick: () => setTab('checklists') },
    { id: 'bookings', title: 'Брони', icon: 'bookings', active: tab === 'bookings', onClick: () => setTab('bookings') },
    { id: 'tasks', title: 'Задачи', icon: 'tasks', active: tab === 'tasks', onClick: () => setTab('tasks') },
    ...(isSenior ? [{ id: 'admin-tasks', title: 'Отдел', icon: 'users' as IconName, active: tab === 'admin-tasks' || tab === 'admin-checklists', onClick: () => setTab('admin-tasks') }] : [])
  ];

  const mobileMenuItems: MobileActionItem[] = [
    { id: 'today', title: 'Обзор', subtitle: 'Главная сводка по смене', icon: 'overview', onClick: () => setTab('today') },
    { id: 'checklists', title: 'Чек-листы', subtitle: 'Открытие, закрытие и фотоотчёты', icon: 'checklists', onClick: () => setTab('checklists') },
    { id: 'bookings', title: 'Брони', subtitle: 'Занятость столов и бронь гостей', icon: 'bookings', onClick: () => setTab('bookings') },
    { id: 'requests', title: 'Заявки', subtitle: 'Запросы по товарам и сервису', icon: 'requests', onClick: () => setTab('requests') },
    { id: 'inventory', title: 'Инвентаризация', subtitle: 'Остатки и позиции отдела', icon: 'inventory', onClick: () => setTab('inventory') },
    { id: 'tasks', title: 'Задачи', subtitle: 'Личные задачи', icon: 'tasks', onClick: () => setTab('tasks') },
    { id: 'knowledge', title: 'База знаний', subtitle: 'Инструкции и сервис-бук', icon: 'knowledge', onClick: () => setTab('knowledge') },
    ...(isSenior ? [
      { id: 'admin-checklists', title: 'Редактор чек-листов', subtitle: 'Шаблоны своего подразделения', icon: 'checklists' as IconName, onClick: () => setTab('admin-checklists') },
      { id: 'admin-tasks', title: 'Задачи подразделения', subtitle: 'Создать задачу для своей команды', icon: 'tasks' as IconName, onClick: () => setTab('admin-tasks') }
    ] : [])
  ];

  const mobileCreateItems: MobileActionItem[] = [
    { id: 'request', title: 'Создать заявку', subtitle: 'Заявка по товарам отдела', icon: 'requests', onClick: () => {
      setTab('requests');
      setOpenRequestComposer(true);
    } },
    { id: 'tech', title: 'Создать техзаявку', subtitle: 'Проблема для менеджера', icon: 'support', onClick: () => {
      setTab('tasks');
      setOpenTechComposer(true);
    } }
  ];

  const mobileProfileItems: MobileActionItem[] = [
    { id: 'profile', title: `${roles[user.role]} · ${restaurant?.name}`, subtitle: 'Ваш рабочий кабинет', icon: 'user', onClick: () => setTab('today') },
    { id: 'knowledge', title: 'База знаний', subtitle: 'Инструкции и сервис-бук', icon: 'knowledge', onClick: () => setTab('knowledge') },
    { id: 'logout', title: 'Выйти из аккаунта', subtitle: 'Завершить сессию', icon: 'logout', onClick: onLogout }
  ];

  return <div className="employeeMobileOnly"><BasicWorkspace
    user={user}
    subtitle={`${roles[user.role]} · ${restaurant?.name}`}
    tabs={tabs}
    active={tab}
    setActive={setTab}
    onLogout={onLogout}
    mobile={{
      title: tab === 'today' ? <>Добро пожаловать, <em>{user.name}</em></> : '',
      subtitle: tab === 'today' ? roles[user.role] : '',
      isOverview: tab === 'today',
      showMenuButton: true,
      showNotifications: true,
      navItems: mobileNavItems,
      menuItems: mobileMenuItems,
      createItems: mobileCreateItems,
      profileItems: mobileProfileItems,
      notificationCount,
      onNotifications: () => setShowNotificationCenter(true)
    }}
  >
    <OfflineSyncBanner />
    {tab === 'today' && <Today user={user} onOpenTasks={() => setTab('tasks')} onOpenChecklists={() => setTab('checklists')} onOpenBookings={() => setTab('bookings')} onOpenInventory={() => setTab('inventory')} />}
    {tab === 'checklists' && <Checklists user={user} />}
    {tab === 'bookings' && <Bookings user={user} />}
    {tab === 'requests' && <Requests user={user} openComposer={openRequestComposer} onCloseComposer={() => setOpenRequestComposer(false)} />}
    {tab === 'inventory' && <Inventory user={user} />}
    {tab === 'tasks' && <Tasks user={user} showTechComposer={openTechComposer} onCloseComposer={() => setOpenTechComposer(false)} />}
    {tab === 'admin-checklists' && <Checklists user={user} admin />}
    {tab === 'admin-tasks' && <Tasks user={user} admin />}
    {tab === 'knowledge' && <Knowledge user={user} />}
    <NotificationCenter open={showNotificationCenter} onClose={() => setShowNotificationCenter(false)} onChanged={refreshNotifications} />
  </BasicWorkspace></div>;
}

function Today({
  user,
  onOpenTasks,
  onOpenChecklists,
  onOpenBookings,
  onOpenInventory
}: {
  user: any;
  onOpenTasks: () => void;
  onOpenChecklists: () => void;
  onOpenBookings: () => void;
  onOpenInventory: () => void;
}) {
  const [overview, setOverview] = useState<any | null>(null);

  useEffect(() => {
    let active = true;

    Promise.all([
      api('/api/checklists/templates').catch(() => []),
      api('/api/bookings').catch(() => []),
      api('/api/tasks').catch(() => []),
      api('/api/inventory/templates').catch(() => [])
    ]).then(([checklists, bookings, tasks, templates]) => {
      if (!active) return;
      setOverview({
        checklists,
        bookings,
        tasks,
        templates
      });
    });

    return () => {
      active = false;
    };
  }, []);

  if (!overview) {
    return <div className="mobileSectionStack">
      <div className="mobileStatsGrid">
        {Array.from({ length: 4 }).map((_, index) => <div key={index} className="mobileSkeletonCard" />)}
      </div>
      <Card className="mobileCard">
        <Empty text="Собираем обзор смены" />
      </Card>
    </div>;
  }

  const openTasks = overview.tasks.filter((task: any) => !task.assignment?.done);
  const completedTasks = overview.tasks.filter((task: any) => task.assignment?.done);
  const activeBookings = overview.bookings.filter((booking: any) => ['booked', 'seated'].includes(booking.status));
  const inventoryItems = overview.templates.reduce((total: number, template: any) => total + (template.items?.length || 0), 0);

  return <div className="mobileSectionStack">
    <SectionTitle title="Сегодня" action={<button type="button" className="sectionLink" onClick={onOpenTasks}>Все задачи</button>} />

    <div className="mobileOverviewList">
      <button type="button" className="mobileOverviewRow" onClick={onOpenChecklists}>
        <div className="mobileOverviewIcon blue"><AppIcon name="checklists" className="navIcon" /></div>
        <div className="mobileOverviewCopy">
          <strong>Чек-листы</strong>
          <span>{overview.checklists.length} на сегодня</span>
        </div>
        <b>{overview.checklists.length}</b>
      </button>
      <button type="button" className="mobileOverviewRow" onClick={onOpenTasks}>
        <div className="mobileOverviewIcon green"><AppIcon name="tasks" className="navIcon" /></div>
        <div className="mobileOverviewCopy">
          <strong>Задачи</strong>
          <span>{openTasks.length} в работе</span>
        </div>
        <b>{openTasks.length}</b>
      </button>
      <button type="button" className="mobileOverviewRow" onClick={onOpenBookings}>
        <div className="mobileOverviewIcon rose"><AppIcon name="bookings" className="navIcon" /></div>
        <div className="mobileOverviewCopy">
          <strong>Брони</strong>
          <span>{activeBookings.length} активных</span>
        </div>
        <b>{activeBookings.length}</b>
      </button>
      <button type="button" className="mobileOverviewRow" onClick={onOpenInventory}>
        <div className="mobileOverviewIcon purple"><AppIcon name="inventory" className="navIcon" /></div>
        <div className="mobileOverviewCopy">
          <strong>Инвентаризация</strong>
          <span>{inventoryItems} позиций</span>
        </div>
        <b>{inventoryItems}</b>
      </button>
    </div>

    <Card title="Приоритет" className="mobileCard compactMobileCard">
      <div className="mobileTaskList">
        {openTasks.slice(0, 3).map((task: any) => <button key={task.id} type="button" className="mobileTaskRow compact" onClick={onOpenTasks}>
          <span className="mobileTaskStatus" />
          <div className="mobileTaskCopy">
            <strong>{task.title}</strong>
            <span>{task.description || 'Открыть задачу'}</span>
          </div>
          <AppIcon name="chevron" className="navIcon" />
        </button>)}
        {openTasks.length === 0 && <Empty text="Нет открытых задач на эту смену" />}
      </div>
      {completedTasks.length > 0 && <div className="mobileInlineHint">Выполнено за смену: {completedTasks.length}</div>}
    </Card>
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
  const [isTemplateEditorOpen, setTemplateEditorOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [templateForm, setTemplateForm] = useState<any>({
    title: '',
    role: 'manager',
    type: 'open',
    items: [{ id: '', text: '', required: true, needs_photo: false, needs_comment: false }]
  });
  const editableRoleEntries = admin ? executableRoles.filter(([key]) => manageableRolesFor(user).includes(key)) : executableRoles;
  const editorRoleOptions = editableRoleEntries.length ? editableRoleEntries : executableRoles;
  const defaultTemplateRole = editorRoleOptions[0]?.[0] || 'manager';
  useEffect(() => {
    if (admin && editorRoleOptions.length && !editorRoleOptions.some(([key]) => key === templateForm.role)) {
      setTemplateForm((current: any) => ({ ...current, role: editorRoleOptions[0][0] }));
    }
  }, [admin, user.role]);

  function resetTemplateEditor() {
    setEditingTemplateId(null);
    setTemplateEditorOpen(false);
    setTemplateForm({
      title: '',
      role: defaultTemplateRole,
      type: 'open',
      items: [{ id: '', text: '', required: true, needs_photo: false, needs_comment: false }]
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

  function updateTemplateItemFlag(index: number, key: string, value: boolean) {
    setTemplateForm((current: any) => ({
      ...current,
      items: current.items.map((item: any, itemIndex: number) => itemIndex === index ? { ...item, [key]: value } : item)
    }));
  }

  function addTemplateItem() {
    setTemplateForm((current: any) => ({
      ...current,
      items: [...current.items, { id: '', text: '', required: true, needs_photo: false, needs_comment: false }]
    }));
  }

  function removeTemplateItem(index: number) {
    setTemplateForm((current: any) => {
      const nextItems = current.items.filter((_: any, itemIndex: number) => itemIndex !== index);
      return {
        ...current,
        items: nextItems.length ? nextItems : [{ id: '', text: '', required: true, needs_photo: false, needs_comment: false }]
      };
    });
  }

  function moveTemplateItem(index: number, direction: number) {
    setTemplateForm((current: any) => {
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= current.items.length) return current;
      const nextItems = [...current.items];
      const [movedItem] = nextItems.splice(index, 1);
      nextItems.splice(targetIndex, 0, movedItem);
      return { ...current, items: nextItems };
    });
  }

  function startTemplateEdit(template: any) {
    setEditorMsg('');
    setEditingTemplateId(template.id);
    setTemplateEditorOpen(true);
    setTemplateForm({
      title: template.title,
      role: template.role,
      type: template.type,
      items: template.items.map((item: any) => ({ id: item.id, text: item.text, required: item.required !== false, needs_photo: !!item.needs_photo, needs_comment: !!item.needs_comment }))
    });
  }

  function startTemplateCreate() {
    setEditorMsg('');
    setEditingTemplateId(null);
    setTemplateEditorOpen(true);
    setTemplateForm({
      title: '',
      role: defaultTemplateRole,
      type: 'open',
      items: [{ id: '', text: '', required: true, needs_photo: false, needs_comment: false }]
    });
  }

  async function deleteTemplate(template: any) {
    const title = String(template?.title || 'чек-лист').trim();
    if (!window.confirm(`Удалить чек-лист «${title}»? Выполненные отчёты останутся в истории.`)) return;
    setEditorMsg('');
    try {
      await api(`/api/admin/checklists/templates/${template.id}`, { method: 'DELETE' });
      if (editingTemplateId === template.id) resetTemplateEditor();
      setEditorMsg('Чек-лист удалён');
      load();
    } catch (error: any) {
      setEditorMsg(error.message);
    }
  }

  async function saveTemplate(e: FormEvent) {
    e.preventDefault();
    setEditorMsg('');
    const payload = {
      title: String(templateForm.title || '').trim(),
      role: templateForm.role,
      type: templateForm.type,
      items: templateForm.items
        .map((item: any) => ({ id: item.id || undefined, text: String(item.text || '').trim(), required: item.required !== false, needs_photo: !!item.needs_photo, needs_comment: !!item.needs_comment }))
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
    const missingRequired = template.items.find((i: any) => i.required !== false && !templateAnswers[i.id]?.done);
    if (missingRequired) { setRunMsg(`Обязательный пункт "${missingRequired.text}" не выполнен`); return; }
    const missingPhoto = template.items.find((i: any) => i.needs_photo && templateAnswers[i.id]?.done && !templateAnswers[i.id]?.photo_url);
    if (missingPhoto) { setRunMsg(`Для пункта "${missingPhoto.text}" нужно сделать фото`); return; }
    const missingComment = template.items.find((i: any) => i.needs_comment && templateAnswers[i.id]?.done && !String(templateAnswers[i.id]?.comment || '').trim());
    if (missingComment) { setRunMsg(`Для пункта "${missingComment.text}" нужен комментарий`); return; }
    const result = await api('/api/checklists/runs', { method: 'POST', body: JSON.stringify({ template_id: template.id, answers: templateAnswers }) });
    setRunMsg(result?.offline ? 'Чек-лист сохранён офлайн' : 'Чек-лист сохранён'); setAnswers({}); load().catch(() => undefined);
  }

  const availableTemplates = admin
    ? templates
    : templates.filter((template) => !template.role || template.role === user.role);
  const adminTemplates = admin
    ? [...availableTemplates].sort((a, b) => String(roles[a.role] || a.role).localeCompare(String(roles[b.role] || b.role), 'ru') || String(a.title || '').localeCompare(String(b.title || ''), 'ru'))
    : [];
  const completedRuns = runs.filter((run) => ['completed', 'done'].includes(run.status));

  useEffect(() => {
    if (admin) return;
    if (!availableTemplates.length) {
      setSelectedTemplateId('');
      return;
    }
    if (!availableTemplates.some((template) => template.id === selectedTemplateId)) {
      setSelectedTemplateId(availableTemplates[0].id);
    }
  }, [admin, availableTemplates, selectedTemplateId]);

  const selectedTemplate = !admin
    ? availableTemplates.find((template) => template.id === selectedTemplateId) || availableTemplates[0]
    : null;

  const completedChecklistItems = selectedTemplate
    ? selectedTemplate.items.filter((item: any) => answers[item.id]?.done).length
    : 0;

  const checklistRequiresPhoto = selectedTemplate?.items.some((item: any) => item.needs_photo && answers[item.id]?.done && !answers[item.id]?.photo_url);

  function toggleChecklistItem(item: any) {
    const current = answers[item.id] || {};
    if (current.done) {
      updateAnswer(item.id, { done: false, photo_url: '', comment: '' });
      return;
    }
    if (item.needs_photo) { setCameraTarget({ itemId: item.id, title: item.text }); return; }
    updateAnswer(item.id, { done: true });
  }

  function renderTemplateEditorForm() {
    return <>
      <form className="form" onSubmit={saveTemplate}>
        <div className="form two">
          <Field label="Название чек-листа" value={templateForm.title} onChange={(e: any) => setTemplateForm({ ...templateForm, title: e.target.value })} placeholder="Например: Проверка открытия зала" />
          <Select label="Для роли" value={templateForm.role} onChange={(e: any) => setTemplateForm({ ...templateForm, role: e.target.value })}>
            {editorRoleOptions.map(([key, value]) => <option key={key} value={key}>{value}</option>)}
          </Select>
          <Select label="Тип" value={templateForm.type} onChange={(e: any) => setTemplateForm({ ...templateForm, type: e.target.value })}>
            {Object.entries(checklistTypes).map(([key, value]) => <option key={key} value={key}>{value}</option>)}
          </Select>
        </div>

        <div className="editorItems">
          {templateForm.items.map((item: any, index: number) => <div className="editorItemRow smartChecklistEditorRow" key={item.id || `new-${index}`}>
            <div className="checklistItemOrderControls">
              <button type="button" className="iconBtn" onClick={() => moveTemplateItem(index, -1)} disabled={index === 0} aria-label="Поднять пункт выше">↑</button>
              <span>{index + 1}</span>
              <button type="button" className="iconBtn" onClick={() => moveTemplateItem(index, 1)} disabled={index === templateForm.items.length - 1} aria-label="Опустить пункт ниже">↓</button>
            </div>
            <div className="checklistItemEditorBody">
              <input value={item.text} onChange={(e) => updateTemplateItem(index, e.target.value)} placeholder={`Пункт ${index + 1}`} />
              <div className="smartChecklistFlags">
                <label><input type="checkbox" checked={item.required !== false} onChange={(e) => updateTemplateItemFlag(index, 'required', e.target.checked)} />Обяз.</label>
                <label><input type="checkbox" checked={!!item.needs_photo} onChange={(e) => updateTemplateItemFlag(index, 'needs_photo', e.target.checked)} />Фото</label>
                <label><input type="checkbox" checked={!!item.needs_comment} onChange={(e) => updateTemplateItemFlag(index, 'needs_comment', e.target.checked)} />Коммент.</label>
              </div>
            </div>
            <button type="button" className="iconBtn checklistItemRemove" onClick={() => removeTemplateItem(index)} aria-label="Удалить пункт">×</button>
          </div>)}
        </div>

        <div className="actions">
          <Button kind="soft" type="button" onClick={addTemplateItem}>Добавить пункт</Button>
          {(editingTemplateId || isTemplateEditorOpen) && <Button kind="soft" type="button" onClick={resetTemplateEditor}>Отмена</Button>}
          <Button>{editingTemplateId ? 'Сохранить изменения' : 'Создать чек-лист'}</Button>
        </div>
      </form>
      {editorMsg && <div className={editorMsg.includes('обновл') || editorMsg.includes('создан') ? 'notice' : 'error'}>{editorMsg}</div>}
    </>;
  }

  if (!admin) {
    return <div className="mobileSectionStack">
      <SectionTitle title="Чек-листы" subtitle="Отмечайте пункты по смене. Фото и комментарии появятся там, где они нужны." />

      {!availableTemplates.length && <Card className="mobileCard compactMobileCard">
        <Empty text="Для вашей роли пока нет активных чек-листов" />
      </Card>}

      {!!availableTemplates.length && <div className="mobileChecklistPicker">
        {availableTemplates.map((template) => <button
          key={template.id}
          type="button"
          className={cx('mobileChecklistPickerItem', selectedTemplate?.id === template.id && 'active')}
          onClick={() => setSelectedTemplateId(template.id)}
        >
          <strong>{template.title}</strong>
          <span>{template.items.length} пунктов</span>
        </button>)}
      </div>}

      {selectedTemplate && <Card className="mobileCard compactMobileCard mobileChecklistProgressCard">
        <div className="mobileProgressCardCopy compact">
          <div>
            <h3>{selectedTemplate.title}</h3>
            <p>Выполнено {completedChecklistItems} из {selectedTemplate.items.length}</p>
          </div>
          <span className="badge active mobileProgressBadge">{completedChecklistItems}/{selectedTemplate.items.length}</span>
        </div>
        <ProgressBar value={completedChecklistItems} max={selectedTemplate.items.length} />
      </Card>}

      {selectedTemplate && <div className="mobileChecklistPlainList">
        {selectedTemplate.items.map((item: any, index: number) => {
          const itemAnswer = answers[item.id] || {};
          const isDone = !!itemAnswer.done;
          return <div key={item.id} className={cx('mobileChecklistLine', isDone && 'done', item.required !== false && 'required')}>
            <button
              type="button"
              className={cx('mobileChecklistToggle', isDone && 'done')}
              onClick={() => toggleChecklistItem(item)}
              aria-label={isDone ? 'Снять отметку' : 'Отметить выполненным'}
              aria-pressed={isDone}
            >
              {isDone && <span>✓</span>}
            </button>
            <div className="mobileChecklistLineBody">
              <div className="mobileChecklistLineHead">
                <strong>{item.text}</strong>
                <span className="mobileChecklistIndex">{index + 1}</span>
              </div>
              <div className="mobileChecklistSmartTags">{item.required !== false && <em>обязательный</em>}{item.needs_photo && <em>фото</em>}{item.needs_comment && <em>комментарий</em>}<b className={isDone ? 'done' : 'pending'}>{isDone ? 'готово' : 'ожидает'}</b></div>
              {itemAnswer.done && item.needs_photo && <div className="mobileChecklistLineMeta">
                <span className="mobileChecklistPhotoStatus">
                  <AppIcon name="camera" className="navIcon" />
                  Фото добавлено
                </span>
                <button
                  type="button"
                  className="mobileChecklistRetake"
                  onClick={() => setCameraTarget({ itemId: item.id, title: item.text })}
                >
                  Переснять
                </button>
              </div>}
              {itemAnswer.done && itemAnswer.photo_url && <img className="mobileChecklistPhoto" src={itemAnswer.photo_url} alt={`Фото: ${item.text}`} />}
              {itemAnswer.done && <Textarea
                label={item.needs_comment ? 'Комментарий обязателен' : 'Комментарий'}
                value={itemAnswer.comment || ''}
                onChange={(e: any) => updateAnswer(item.id, { comment: e.target.value })}
                placeholder="Комментарий"
              />}
            </div>
          </div>;
        })}
      </div>}

      {selectedTemplate && <div className="mobileChecklistActions single">
        <Button
          type="button"
          className="mobilePrimaryButton"
          disabled={!selectedTemplate || !!checklistRequiresPhoto}
          onClick={() => submit(selectedTemplate)}
        >
          Завершить чек-лист
        </Button>
      </div>}

      {runMsg && <div className={runMsg.includes('сохранён') ? 'notice mobileInlineNotice' : 'error mobileInlineNotice'}>{runMsg}</div>}
      {cameraTarget && <CameraCapture
        title={cameraTarget.title}
        onClose={() => setCameraTarget(null)}
        onCapture={(photo) => updateAnswer(cameraTarget.itemId, { done: true, photo_url: photo })}
      />}
    </div>;
  }

  return <>
    {admin && <Card
      title="Все чек-листы"
      right={<div className="actions compact"><span className="badge active">{adminTemplates.length} шаблонов</span><Button kind="soft" type="button" onClick={startTemplateCreate}>Создать чек-лист</Button></div>}
    >
      {adminTemplates.length === 0 && <Empty text="Пока нет созданных чек-листов" />}
      {adminTemplates.length > 0 && <div className="adminChecklistTemplateList">
        {adminTemplates.map((template) => {
          const isEditing = editingTemplateId === template.id && isTemplateEditorOpen;
          return <article
            key={template.id}
            className={cx('checklistTemplateCard', isEditing && 'active editing')}
          >
            <button
              type="button"
              className="checklistTemplateCardSummary"
              onClick={() => startTemplateEdit(template)}
            >
              <div className="checklistTemplateCardHead">
                <div>
                  <strong>{template.title}</strong>
                  <span>{roles[template.role] || template.role} · {checklistTypes[template.type] || template.type}</span>
                </div>
                <em>{template.items?.length || 0} пунктов</em>
              </div>
              {!isEditing && <div className="checklistTemplatePreview">
                {(template.items || []).slice(0, 4).map((item: any, index: number) => <span key={item.id || index}>{index + 1}. {item.text}</span>)}
                {(template.items || []).length > 4 && <span>+ ещё {(template.items || []).length - 4}</span>}
              </div>}
              <div className="checklistTemplateCardFoot">{isEditing ? 'Редактирование открыто' : 'Редактировать'}</div>
            </button>
            <div className="checklistTemplateActions">
              {!isEditing && <Button kind="soft" type="button" onClick={() => startTemplateEdit(template)}>Редактировать</Button>}
              <Button kind="danger" type="button" onClick={() => deleteTemplate(template)}>Удалить</Button>
            </div>
            {isEditing && <div className="inlineChecklistEditor">
              {renderTemplateEditorForm()}
            </div>}
          </article>;
        })}
      </div>}
    </Card>}

    {admin && !editingTemplateId && isTemplateEditorOpen && <Card title="Новый чек-лист">
      {renderTemplateEditorForm()}
    </Card>}

    {cameraTarget && <CameraCapture
      title={cameraTarget.title}
      onClose={() => setCameraTarget(null)}
      onCapture={(photo) => updateAnswer(cameraTarget.itemId, { done: true, photo_url: photo })}
    />}
  </>;
}


function isKnowledgeFileType(type: string) {
  return ['pdf', 'ttk', 'service_book'].includes(String(type || ''));
}

function filenameToTitle(fileName = '') {
  return String(fileName || '').replace(/\.[^.]+$/, '').trim();
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Не удалось прочитать файл'));
    reader.readAsDataURL(file);
  });
}

function Inventory({ user, admin = false }: any) {
  const [templates, setTemplates] = useState<any[]>([]);
  const [runs, setRuns] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [values, setValues] = useState<any>({});
  const [msg, setMsg] = useState('');
  const [productMsg, setProductMsg] = useState('');
  const [importMsg, setImportMsg] = useState('');
  const [importLoading, setImportLoading] = useState(false);
  const [importForm, setImportForm] = useState<any>({ section: 'bar', file: null });
  const [importPreview, setImportPreview] = useState<any | null>(null);
  const [editingProduct, setEditingProduct] = useState<any>(null);
  const [inventoryFilter, setInventoryFilter] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [productForm, setProductForm] = useState<any>({
    section: 'bar',
    name: '',
    unit: '',
    category: ''
  });

  async function load() {
    const [templateRows, productRows, runRows] = await Promise.all([
      api('/api/inventory/templates'),
      admin ? api('/api/products') : Promise.resolve([]),
      admin ? api('/api/admin/inventory/runs') : Promise.resolve([])
    ]);
    setTemplates(templateRows);
    if (admin) {
      setProducts(productRows);
      setRuns(runRows);
    }
  }
  useEffect(() => { load(); }, []);

  const groupedProducts = useMemo(() => {
    if (!admin) return [];
    return inventorySections.map(section => ({
      ...section,
      products: products.filter((product: any) => productMatchesInventorySection(product, section.id))
    }));
  }, [admin, products]);

  async function addProduct(e: FormEvent) {
    e.preventDefault();
    setProductMsg('');
    const section = inventorySectionMeta(productForm.section as InventorySectionId);
    const payload = {
      name: String(productForm.name || '').trim(),
      unit: String(productForm.unit || '').trim(),
      department: section.department,
      category: String(productForm.category || '').trim() || section.defaultCategory
    };

    try {
      await api('/api/admin/products', { method: 'POST', body: JSON.stringify(payload) });
      setProductForm({ section: productForm.section, name: '', unit: '', category: '' });
      setProductMsg(`Товар добавлен в список "${section.title}"`);
      load();
    } catch (error: any) {
      setProductMsg(error.message);
    }
  }

  async function importInventoryBlank(e: FormEvent) {
    e.preventDefault();
    setImportMsg('');
    setImportPreview(null);
    const file: File | null = importForm.file;
    if (!file) {
      setImportMsg('Выберите PDF или Excel-бланк');
      return;
    }
    setImportLoading(true);
    try {
      const data = await readFileAsDataUrl(file);
      const result = await api('/api/admin/inventory/import-template', {
        method: 'POST',
        body: JSON.stringify({ section: importForm.section, file_name: file.name, mime_type: file.type, data, dry_run: true })
      });
      const section = inventorySectionMeta(importForm.section as InventorySectionId);
      setImportPreview({ ...result, section: importForm.section, sectionTitle: section.title, fileName: file.name, data, mime_type: file.type });
      setImportMsg(`Проверка бланка: найдено ${result.detected?.length || 0}, новых ${result.will_add?.length || 0}, уже есть ${result.skipped?.length || 0}. Проверьте список перед добавлением.`);
    } catch (error: any) {
      setImportMsg(error.message || 'Не удалось прочитать бланк');
    } finally {
      setImportLoading(false);
    }
  }

  async function applyInventoryImport() {
    if (!importPreview) return;
    setImportLoading(true);
    setImportMsg('');
    try {
      const result = await api('/api/admin/inventory/import-template', {
        method: 'POST',
        body: JSON.stringify({ section: importPreview.section, file_name: importPreview.fileName, mime_type: importPreview.mime_type, data: importPreview.data })
      });
      setImportMsg(`Ассортимент обновлён: найдено ${result.detected?.length || 0}, добавлено ${result.added?.length || 0}, уже было ${result.skipped?.length || 0}.`);
      setImportPreview(null);
      setImportForm({ section: importPreview.section, file: null });
      load();
    } catch (error: any) {
      setImportMsg(error.message || 'Не удалось добавить товары');
    } finally {
      setImportLoading(false);
    }
  }

  function startProductEdit(product: any, sectionId: InventorySectionId) {
    setProductMsg('');
    setEditingProduct({
      id: product.id,
      section: sectionId,
      name: product.name,
      unit: product.unit,
      category: product.category || ''
    });
  }

  async function saveProductEdit(e: FormEvent) {
    e.preventDefault();
    if (!editingProduct) return;
    setProductMsg('');
    const section = inventorySectionMeta(editingProduct.section as InventorySectionId);
    const payload = {
      name: String(editingProduct.name || '').trim(),
      unit: String(editingProduct.unit || '').trim(),
      department: section.department,
      category: String(editingProduct.category || '').trim() || section.defaultCategory
    };

    try {
      await api(`/api/admin/products/${editingProduct.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      setEditingProduct(null);
      setProductMsg(`Товар обновлён в списке "${section.title}"`);
      load();
    } catch (error: any) {
      setProductMsg(error.message);
    }
  }

  async function removeProduct() {
    if (!editingProduct) return;
    const section = inventorySectionMeta(editingProduct.section as InventorySectionId);
    if (!window.confirm(`Удалить товар "${editingProduct.name}" из списка "${section.title}"?`)) return;
    setProductMsg('');
    try {
      await api(`/api/admin/products/${editingProduct.id}`, { method: 'DELETE' });
      setEditingProduct(null);
      setProductMsg(`Товар удалён из списка "${section.title}"`);
      load();
    } catch (error: any) {
      setProductMsg(error.message);
    }
  }

  function previewInventoryTotal(rawValue: any) {
    const raw = String(rawValue || '').trim();
    if (!raw) return '';
    const normalized = raw.replace(/\s+/g, '').replace(/,/g, '.');
    const parts = normalized.split('+');
    if (!parts.length || parts.some(part => !/^\d+(?:\.\d+)?$/.test(part))) return '';
    const total = parts.reduce((sum, part) => sum + Number(part), 0);
    return String(Math.round(total * 1000) / 1000).replace('.', ',');
  }

  async function submit(t: any) {
    const payload: any = {};
    t.items.forEach((i: any) => { payload[i.product_id] = { qty: values[i.product_id] || '', comment: '' }; });
    const result = await api('/api/inventory/runs', { method: 'POST', body: JSON.stringify({ template_id: t.id, values: payload }) });
    setValues({}); setMsg(result?.offline ? 'Инвентаризация сохранена офлайн' : 'Инвентаризация сохранена'); load().catch(() => undefined);
  }

  useEffect(() => {
    if (admin) return;
    if (!templates.length) {
      setSelectedTemplateId('');
      return;
    }
    if (!templates.some((template) => template.id === selectedTemplateId)) {
      setSelectedTemplateId(templates[0].id);
    }
  }, [admin, templates, selectedTemplateId]);

  if (!admin) {
    const selectedTemplate = templates.find((template) => template.id === selectedTemplateId) || templates[0];
    const filteredItems = selectedTemplate?.items.filter((item: any) => {
      if (!inventoryFilter.trim()) return true;
      return String(item.product?.name || '').toLowerCase().includes(inventoryFilter.trim().toLowerCase());
    }) || [];

    return <div className="mobileSectionStack">
      <SectionTitle title="Инвентаризация" />

      <Card className="mobileCard">
        <Field
          label="Поиск товара"
          icon="search"
          value={inventoryFilter}
          onChange={(e: any) => setInventoryFilter(e.target.value)}
          placeholder="Например: салфетки"
        />
        <div className="mobileChipRow">
          {templates.map((template) => <button
            key={template.id}
            type="button"
            className={cx('mobileChip', selectedTemplate?.id === template.id && 'active')}
            onClick={() => setSelectedTemplateId(template.id)}
          >
            <span>{template.title}</span>
            <b>{template.items.length}</b>
          </button>)}
        </div>
      </Card>

      <Card title={selectedTemplate?.title || 'Бланк инвентаризации'} className="mobileCard inventoryPlainCard">
        {filteredItems.length === 0 && <Empty text="Нет товаров по этому фильтру" />}
        <div className="inventoryPlainList">
          {filteredItems.map((item: any) => {
            const rawValue = values[item.product_id] || '';
            const preview = previewInventoryTotal(rawValue);
            return <label key={item.product_id} className="inventoryPlainItem">
              <div className="inventoryPlainTitle">
                <strong>{item.product?.name}</strong>
                <span>{item.product?.unit || 'шт.'}</span>
              </div>
              <input
                type="text"
                inputMode="tel"
                pattern="[0-9+,.\s]*"
                autoComplete="off"
                value={rawValue}
                onChange={(e) => setValues({ ...values, [item.product_id]: e.target.value })}
                placeholder="Например: 3+2,2+0,04"
              />
              {preview && <em>Итого: {preview}</em>}
            </label>;
          })}
        </div>
        {selectedTemplate && <Button type="button" className="mobilePrimaryButton" onClick={() => submit(selectedTemplate)}>Сохранить остатки</Button>}
        {msg && <div className="notice mobileInlineNotice">{msg}</div>}
      </Card>
    </div>;
  }

  return <>
    {admin
      ? <>
        <Card title="Списки товаров для инвентаризации" right={<span className="badge active">Бар · Кухня · Хозтовары · Посуда</span>}>
          <form className="form inventoryImportForm" onSubmit={importInventoryBlank}>
            <div className="form two inventoryOwnerFormGrid">
              <Select label="В какой список загрузить" value={importForm.section} onChange={(e: any) => setImportForm({ ...importForm, section: e.target.value })}>
                {inventorySections.map(section => <option key={section.id} value={section.id}>{section.title}</option>)}
              </Select>
              <label className="field">
                <span>PDF или Excel-бланк</span>
                <input
                  type="file"
                  accept=".pdf,.xlsx,.xls,.csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
                  onChange={(e) => setImportForm({ ...importForm, file: e.target.files?.[0] || null })}
                />
              </label>
            </div>
            <div className="actions">
              <Button type="submit" disabled={importLoading}>{importLoading ? 'Ищу позиции…' : 'Проверить бланк'}</Button>
            </div>
          </form>
          {importMsg && <div className={importMsg.includes('обновл') || importMsg.includes('Проверка') ? 'notice' : 'error'}>{importMsg}</div>}
          {importPreview && <div className="inventoryImportPreview">
            <div className="inventoryImportPreviewHead">
              <div>
                <strong>Предпросмотр импорта</strong>
                <span>{importPreview.fileName} · список «{importPreview.sectionTitle}»</span>
              </div>
              <div className="inventoryImportPreviewStats">
                <span>{importPreview.detected?.length || 0} найдено</span>
                <span>{importPreview.will_add?.length || 0} новых</span>
                <span>{importPreview.skipped?.length || 0} дублей</span>
              </div>
            </div>
            <div className="inventoryImportPreviewList">
              {(importPreview.preview || []).slice(0, 18).map((item: any, index: number) => <div className="inventoryImportPreviewRow" key={`${item.name}-${index}`}>
                <div><strong>{item.name}</strong><span>{item.category || importPreview.sectionTitle}</span></div>
                <em>{item.unit}</em>
                <span className={cx('badge', item.status === 'new' ? 'active' : 'trial')}>{item.status === 'new' ? 'добавится' : 'уже есть'}</span>
              </div>)}
              {(importPreview.preview || []).length > 18 && <span className="muted">И ещё {(importPreview.preview || []).length - 18} позиций</span>}
            </div>
            <div className="actions">
              <Button type="button" kind="soft" onClick={() => setImportPreview(null)}>Отменить</Button>
              <Button type="button" disabled={importLoading || !(importPreview.will_add || []).length} onClick={applyInventoryImport}>Добавить новые позиции</Button>
            </div>
          </div>}
          <div className="inventoryImportHint">Приложение сначала показывает найденные позиции: новые товары можно проверить перед добавлением, дубли не попадут в список повторно.</div>

          <form className="form inventoryOwnerForm" onSubmit={addProduct}>
            <div className="form two inventoryOwnerFormGrid">
              <Select label="Список" value={productForm.section} onChange={(e: any) => setProductForm({ ...productForm, section: e.target.value })}>
                {inventorySections.map(section => <option key={section.id} value={section.id}>{section.title}</option>)}
              </Select>
              <Field label="Название товара" value={productForm.name} onChange={(e: any) => setProductForm({ ...productForm, name: e.target.value })} placeholder="Например: Джин, салфетки, тарелка" />
              <Field label="Единица" value={productForm.unit} onChange={(e: any) => setProductForm({ ...productForm, unit: e.target.value })} placeholder="бут., кг, шт., уп." />
              <Field label="Категория" value={productForm.category} onChange={(e: any) => setProductForm({ ...productForm, category: e.target.value })} placeholder="Можно оставить пустым" />
            </div>
            <div className="actions">
              <Button>Добавить в список</Button>
            </div>
          </form>
          {productMsg && <div className={productMsg.includes('добавлен') || productMsg.includes('обновл') || productMsg.includes('удал') ? 'notice' : 'error'}>{productMsg}</div>}

          <div className="inventoryOwnerGrid">
            {groupedProducts.map(section => <div className="miniCard inventorySectionCard" key={section.id}>
              <div className="rowBetween">
                <b>{section.title}</b>
                <span className="badge">{section.products.length} поз.</span>
              </div>
              <div className="inventorySectionList">
                {section.products.length === 0 && <span className="muted">Список пока пуст</span>}
                {section.products.map((product: any) => <button type="button" className="inventorySectionItem inventorySectionButton" key={product.id} onClick={() => startProductEdit(product, section.id)}>
                  <div>
                    <strong>{product.name}</strong>
                    <span>{product.category || section.defaultCategory}</span>
                  </div>
                  <em>{product.unit}</em>
                </button>)}
              </div>
            </div>)}
          </div>
        </Card>

        <Card title="Бланки, которые заполняют сотрудники">
          <div className="grid cardsGrid">
            {templates.map(template => <div className="miniCard" key={template.id}>
              <div className="rowBetween"><b>{template.title}</b><span className="badge">{departments[template.department]}</span></div>
              <p>Позиций в бланке: {template.items.length}</p>
              <div className="inventoryPreviewList">
                {template.items.slice(0, 5).map((item: any) => <span key={item.product_id}>{item.product?.name || 'Товар'} · {item.product?.unit || 'шт.'}</span>)}
                {template.items.length > 5 && <span className="muted">И ещё {template.items.length - 5} позиций</span>}
              </div>
            </div>)}
          </div>
        </Card>

        <Card title="Заполненные Excel-файлы сотрудников" right={<span className="badge active">Скачать отчёт</span>}>
          {runs.length === 0 && <Empty text="Сотрудники ещё не отправляли инвентаризации" />}
          <div className="list">
            {runs.map(run => <div className="listRow inventoryRunRow" key={run.id}>
              <div>
                <b>{run.template?.title}</b>
                <span>{run.user?.name} · {roles[run.user?.role] || 'Сотрудник'} · {fmtDate(run.created_at)}</span>
                <span>Строк в отправке: {run.values?.length || 0}</span>
              </div>
              <Button kind="soft" onClick={() => download(`/api/admin/inventory/runs/${run.id}/export.xlsx`, `inventory-${run.id}.xlsx`)}>Скачать общий Excel</Button>
            </div>)}
          </div>
        </Card>
      </>
      : <Card title="Бланки инвентаризации">
        <div className="grid">{templates.map(t => <div className="miniCard" key={t.id}>
          <div className="rowBetween"><b>{t.title}</b><span className="badge">{departments[t.department]}</span></div>
          <div className="productsGrid">{t.items.map((i: any) => <label className="productQty" key={i.product_id}><span>{i.product?.name}<em>{i.product?.unit}</em></span><input type="number" min="0" value={values[i.product_id] || ''} onChange={(e) => setValues({ ...values, [i.product_id]: e.target.value })} /></label>)}</div>
          <Button onClick={() => submit(t)}>Сохранить остатки</Button>
        </div>)}</div>
        {msg && <div className="notice">{msg}</div>}
      </Card>}
    {admin && editingProduct && <div className="modal" onClick={() => setEditingProduct(null)}>
      <div className="modalCard infoModalCard" onClick={(e) => e.stopPropagation()}>
        <div className="rowBetween">
          <h2>Редактировать товар</h2>
          <button className="iconBtn" onClick={() => setEditingProduct(null)}>×</button>
        </div>
        <form className="form inventoryOwnerForm" onSubmit={saveProductEdit}>
          <div className="form two inventoryOwnerFormGrid">
            <Select label="Список" value={editingProduct.section} onChange={(e: any) => setEditingProduct({ ...editingProduct, section: e.target.value })}>
              {inventorySections.map(section => <option key={section.id} value={section.id}>{section.title}</option>)}
            </Select>
            <Field label="Название товара" value={editingProduct.name} onChange={(e: any) => setEditingProduct({ ...editingProduct, name: e.target.value })} />
            <Field label="Единица" value={editingProduct.unit} onChange={(e: any) => setEditingProduct({ ...editingProduct, unit: e.target.value })} />
            <Field label="Категория" value={editingProduct.category} onChange={(e: any) => setEditingProduct({ ...editingProduct, category: e.target.value })} />
          </div>
          <div className="actions inventoryEditActions">
            <Button kind="danger" type="button" onClick={removeProduct}>Удалить товар</Button>
            <div className="adminInlineActions">
              <Button kind="soft" type="button" onClick={() => setEditingProduct(null)}>Отмена</Button>
              <Button>Сохранить товар</Button>
            </div>
          </div>
        </form>
      </div>
    </div>}
  </>;
}

function KnowledgeDocumentBody({ doc }: { doc: any }) {
  const ingredients = Array.isArray(doc?.ingredients) ? doc.ingredients : [];
  const contentLines = String(doc?.content || '').split('\n').map(line => line.trim()).filter(Boolean);
  const titleFromContent = contentLines.find(line => /^Блюдо\/напиток:/i.test(line))?.replace(/^Блюдо\/напиток:\s*/i, '').trim();
  const ttkDisplayTitle = (titleFromContent || doc?.title || '').replace(/(\d+)\s+(мл|л|г|кг|шт|порц)\b/gi, '$1$2');
  const ttkMeta = contentLines.filter(line => !line.startsWith('-') && !['Состав:'].includes(line) && !/^Блюдо\/напиток:/i.test(line));
  const isTtk = doc?.type === 'ttk';

  if (isTtk) {
    return <div className="ttkRecipeView">
      {doc?.photo_url && <img className="knowledgeDocPhoto ttkHeroPhoto" src={doc.photo_url} alt={doc.title || 'Фото'} />}
      <div className="ttkRecipeHeader">
        <span className="badge active">ТТК</span>
        <strong>{ttkDisplayTitle}</strong>
        {ttkMeta.slice(0, 2).map((line, index) => <em key={`${line}-${index}`}>{line}</em>)}
      </div>
      <div className="ttkIngredients">
        <strong>Состав</strong>
        {ingredients.length > 0
          ? ingredients.map((item: any, index: number) => <div key={item.name + index}><span>{item.name}</span><em>{item.display_qty || item.qty} {item.unit}</em></div>)
          : <p>Состав не удалось извлечь автоматически. Проверьте исходный PDF или обновите ТТК.</p>}
      </div>
      {doc?.file_url && <a className="fileLink ttkSourceLink" href={doc.file_url} target="_blank" rel="noreferrer">Исходный PDF</a>}
    </div>;
  }

  if (doc?.type === 'text') {
    return <>{doc?.content || ''}</>;
  }

  return <>
    {doc?.photo_url && <img className="knowledgeDocPhoto" src={doc.photo_url} alt={doc.title || 'Фото'} />}
    {doc?.content && <pre>{doc.content}</pre>}
    {doc?.file_url && <a className="fileLink" href={doc.file_url} target="_blank" rel="noreferrer">Открыть PDF</a>}
  </>;
}


function KnowledgeDocumentModal({ doc, onClose, onAck }: { doc: any; onClose: () => void; onAck: (doc: any) => void }) {
  const rawContent = String(doc?.content || '').trim();
  const isPlainText = doc?.type === 'text' || (!!rawContent && !doc?.file_url && doc?.type !== 'ttk');

  if (isPlainText) {
    return <div className="plainTextDocOverlay" onClick={onClose}>
      <button className="plainTextDocClose" onClick={onClose} aria-label="Закрыть документ">×</button>
      <pre className="plainTextDocumentOnly" onClick={(e) => e.stopPropagation()}>{rawContent || 'Текст документа не заполнен'}</pre>
      {doc.requires_acknowledgement && !doc.acknowledged && <button className="plainTextAckButton" type="button" onClick={(e) => { e.stopPropagation(); onAck(doc); }}>Ознакомился</button>}
    </div>;
  }

  return <div className="modal" onClick={onClose}>
    <div className="modalCard mobileDocModal" onClick={(e) => e.stopPropagation()}>
      <div className="rowBetween">
        <h2>{doc.title}</h2>
        <button className="iconBtn" onClick={onClose}>×</button>
      </div>
      <KnowledgeDocumentBody doc={doc} />
      {doc.requires_acknowledgement && !doc.acknowledged && <Button onClick={() => onAck(doc)}>Ознакомился</Button>}
    </div>
  </div>;
}

function Knowledge({ user, admin = false }: any) {
  const emptyDocForm = { category_id: '', title: '', type: 'text', content: '', file: null, photo: null, allowed_roles: [], requires_acknowledgement: true };
  const [categories, setCategories] = useState<any[]>([]);
  const [stats, setStats] = useState<any[]>([]);
  const [openDoc, setOpenDoc] = useState<any>(null);
  const [search, setSearch] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [knowledgeMsg, setKnowledgeMsg] = useState('');
  const [catForm, setCatForm] = useState<any>({ title: '', allowed_roles: [] });
  const [docForm, setDocForm] = useState<any>(emptyDocForm);
  const [editingCategoryId, setEditingCategoryId] = useState('');
  const [categoryEditTitle, setCategoryEditTitle] = useState('');
  const [editingDocId, setEditingDocId] = useState('');
  const [docEditForm, setDocEditForm] = useState<any>(emptyDocForm);

  async function load(preferredCategoryId = selectedCategoryId) {
    const cats = await api('/api/knowledge');
    setCategories(cats);
    if (admin) setStats(await api('/api/admin/knowledge/stats'));

    if (!admin) return;
    const categoryExists = preferredCategoryId && cats.some((category: any) => category.id === preferredCategoryId);
    setSelectedCategoryId(categoryExists ? preferredCategoryId : (cats[0]?.id || ''));
  }

  useEffect(() => { load(); }, []);

  async function viewDoc(doc: any) {
    setOpenDoc(doc);
    await api(`/api/knowledge/${doc.id}/view`, { method: 'POST', body: '{}' });
  }

  async function ack(doc: any) {
    const result = await api(`/api/knowledge/${doc.id}/ack`, { method: 'POST', body: '{}' });
    setOpenDoc({ ...doc, acknowledged: true, offlineAck: !!result?.offline });
    load().catch(() => undefined);
  }

  async function createCat(e: FormEvent) {
    e.preventDefault();
    setKnowledgeMsg('');
    try {
      const created = await api('/api/admin/knowledge/categories', { method: 'POST', body: JSON.stringify({ ...catForm, allowed_roles: [] }) });
      setCatForm({ title: '', allowed_roles: [] });
      setDocForm((current: any) => ({ ...current, category_id: created.id }));
      setSelectedCategoryId(created.id);
      setKnowledgeMsg('Папка создана');
      load(created.id);
    } catch (error: any) {
      setKnowledgeMsg(error.message || 'Не удалось создать папку');
    }
  }

  function startEditCategory(category: any) {
    setEditingCategoryId(category.id);
    setCategoryEditTitle(category.title || '');
    setKnowledgeMsg('');
  }

  async function saveCategory(categoryId: string) {
    setKnowledgeMsg('');
    try {
      await api(`/api/admin/knowledge/categories/${categoryId}`, { method: 'PATCH', body: JSON.stringify({ title: categoryEditTitle, allowed_roles: [] }) });
      setEditingCategoryId('');
      setCategoryEditTitle('');
      setKnowledgeMsg('Папка сохранена');
      load(categoryId);
    } catch (error: any) {
      setKnowledgeMsg(error.message || 'Не удалось сохранить папку');
    }
  }

  async function deleteCategory(category: any) {
    if (!window.confirm(`Удалить папку "${category.title}" и все документы внутри?`)) return;
    setKnowledgeMsg('');
    try {
      await api(`/api/admin/knowledge/categories/${category.id}`, { method: 'DELETE' });
      if (selectedCategoryId === category.id) setSelectedCategoryId('');
      setKnowledgeMsg('Папка удалена');
      load('');
    } catch (error: any) {
      setKnowledgeMsg(error.message || 'Не удалось удалить папку');
    }
  }

  async function attachDocFile(file?: File | null) {
    if (!file) return;
    const data = await readFileAsDataUrl(file);
    setDocForm((current: any) => ({ ...current, file: { file_name: file.name, mime_type: file.type, data } }));
  }

  async function attachDocPhoto(file?: File | null) {
    if (!file) return;
    const data = await readFileAsDataUrl(file);
    setDocForm((current: any) => ({ ...current, photo: { file_name: file.name, mime_type: file.type, data } }));
  }

  async function attachEditDocFile(file?: File | null) {
    if (!file) return;
    const data = await readFileAsDataUrl(file);
    setDocEditForm((current: any) => ({ ...current, file: { file_name: file.name, mime_type: file.type, data } }));
  }

  async function attachEditDocPhoto(file?: File | null) {
    if (!file) return;
    const data = await readFileAsDataUrl(file);
    setDocEditForm((current: any) => ({ ...current, photo: { file_name: file.name, mime_type: file.type, data } }));
  }

  async function createDoc(e: FormEvent) {
    e.preventDefault();
    setKnowledgeMsg('');
    try {
      const nextType = docForm.type || 'text';
      if (isKnowledgeFileType(nextType) && !docForm.file) {
        setKnowledgeMsg('Выберите PDF-файл');
        return;
      }
      const payload = {
        ...docForm,
        title: docForm.title || (nextType !== 'ttk' ? filenameToTitle(docForm.file?.file_name) : ''),
        category_id: docForm.category_id || selectedCategoryId || categories[0]?.id || '',
        allowed_roles: []
      };
      const created = await api('/api/admin/knowledge/documents', { method: 'POST', body: JSON.stringify(payload) });
      setDocForm({ ...emptyDocForm, category_id: payload.category_id, type: docForm.type });
      setKnowledgeMsg(created?.created ? 'Документы сохранены: ' + created.created : 'Документ сохранён');
      load(payload.category_id);
    } catch (error: any) {
      setKnowledgeMsg(error.message || 'Не удалось сохранить документ');
    }
  }

  function startEditDoc(doc: any, fallbackCategoryId = '') {
    setEditingDocId(doc.id);
    setDocEditForm({
      category_id: doc.category_id || fallbackCategoryId,
      title: doc.title || '',
      type: doc.type || 'text',
      content: doc.content || '',
      file: null,
      photo: null,
      allowed_roles: Array.isArray(doc.allowed_roles) ? doc.allowed_roles : [],
      requires_acknowledgement: doc.requires_acknowledgement !== false
    });
    setKnowledgeMsg('');
  }

  async function saveDoc(docId: string) {
    setKnowledgeMsg('');
    try {
      await api(`/api/admin/knowledge/documents/${docId}`, { method: 'PATCH', body: JSON.stringify({ ...docEditForm, allowed_roles: [] }) });
      setEditingDocId('');
      setDocEditForm(emptyDocForm);
      setKnowledgeMsg('Документ сохранён');
      load(docEditForm.category_id || selectedCategoryId);
    } catch (error: any) {
      setKnowledgeMsg(error.message || 'Не удалось сохранить документ');
    }
  }

  async function deleteDoc(doc: any) {
    if (!window.confirm(`Удалить документ "${doc.title}"?`)) return;
    setKnowledgeMsg('');
    try {
      await api(`/api/admin/knowledge/documents/${doc.id}`, { method: 'DELETE' });
      if (openDoc?.id === doc.id) setOpenDoc(null);
      if (editingDocId === doc.id) setEditingDocId('');
      setKnowledgeMsg('Документ удалён');
      load(selectedCategoryId);
    } catch (error: any) {
      setKnowledgeMsg(error.message || 'Не удалось удалить документ');
    }
  }

  if (!admin) {
    const visibleCategories = categories
      .map((category) => ({
        ...category,
        documents: category.documents.filter((document: any) => {
          const haystack = `${document.title} ${document.content || ''}`.toLowerCase();
          return !search.trim() || haystack.includes(search.trim().toLowerCase()) || category.title.toLowerCase().includes(search.trim().toLowerCase());
        })
      }))
      .filter((category) => category.documents.length || !search.trim());

    const selectedCategory = visibleCategories.find((category) => category.id === selectedCategoryId) || visibleCategories[0];

    return <>
      <div className="mobileSectionStack">
        <SectionTitle
          title={selectedCategoryId && selectedCategory ? selectedCategory.title : 'База знаний'}
          action={selectedCategoryId ? <button type="button" className="sectionLink" onClick={() => setSelectedCategoryId('')}>Папки</button> : undefined}
        />

        <div className="mobileKnowledgeSearch">
          <Field label="Поиск" icon="search" value={search} onChange={(e: any) => setSearch(e.target.value)} placeholder="Найти документ" />
        </div>

        {!selectedCategoryId && <div className="mobileKnowledgeFolderList">
          {visibleCategories.map((category) => <button key={category.id} type="button" className="mobileKnowledgeFolderRow" onClick={() => setSelectedCategoryId(category.id)}>
            <div className="mobileKnowledgeFolderIcon"><AppIcon name="folder" className="navIcon" /></div>
            <div>
              <strong>{category.title}</strong>
              <span>{category.documents.length} документов</span>
            </div>
            <AppIcon name="chevron" className="navIcon" />
          </button>)}
          {visibleCategories.length === 0 && <Empty text="Ничего не найдено по этому запросу" />}
        </div>}

          {selectedCategoryId && selectedCategory && <div className="mobileKnowledgeDocList">
          {selectedCategory.documents.map((document: any) => <button key={document.id} type="button" className="mobileKnowledgeDocRow" onClick={() => viewDoc(document)}>
            <div>
              <strong>{document.title}</strong>
              <span>{document.type === 'ttk' ? 'ТТК · рецепт и состав' : document.acknowledged ? 'Ознакомлен' : document.requires_acknowledgement ? 'Нужно ознакомиться' : 'Документ'}</span>
            </div>
            <AppIcon name="chevron" className="navIcon" />
          </button>)}
          {selectedCategory.documents.length === 0 && <Empty text="В этой папке пока нет документов" />}
        </div>}
      </div>

      {openDoc && <KnowledgeDocumentModal doc={openDoc} onClose={() => setOpenDoc(null)} onAck={ack} />}
    </>;
  }

  return <>
    <Card title="Добавить документацию">
      <form className="form two" onSubmit={createCat}>
        <Field label="Новая папка" value={catForm.title} onChange={(e: any) => setCatForm({ ...catForm, title: e.target.value })} placeholder="Например: Сервис-бук" />
        <Button kind="soft">Создать папку</Button>
      </form>
      <form className="form" onSubmit={createDoc}>
        <div className="form two">
          <Select label="Папка" value={docForm.category_id || selectedCategoryId} onChange={(e: any) => {
            setSelectedCategoryId(e.target.value);
            setDocForm({ ...docForm, category_id: e.target.value });
          }}><option value="">Выбрать папку</option>{categories.map(c => <option value={c.id} key={c.id}>{c.title}</option>)}</Select>
          <Select label="Тип документа" value={docForm.type} onChange={(e: any) => setDocForm({ ...docForm, type: e.target.value })}>
            <option value="text">Текст</option>
            <option value="pdf">PDF-документ</option>
            <option value="ttk">ТТК из PDF</option>
            <option value="service_book">Сервис-бук PDF</option>
          </Select>
        </div>
        <Field label="Название" value={docForm.title} onChange={(e: any) => setDocForm({ ...docForm, title: e.target.value })} placeholder={docForm.type === 'ttk' ? 'Можно оставить пустым - возьмём из ТТК' : 'Название документа'} />
        {docForm.type === 'text' && <Textarea label="Текст" rows={8} value={docForm.content} onChange={(e: any) => setDocForm({ ...docForm, content: e.target.value })} />}
        {docForm.type !== 'text' && <div className="fileUploadGrid">
          <label className="fileUploadBox">
            <span>{docForm.type === 'ttk' ? 'PDF с ТТК' : 'PDF-файл'}</span>
            <input type="file" accept="application/pdf,.pdf" onChange={(e) => attachDocFile(e.target.files?.[0])} />
            <em>{docForm.file?.file_name || 'Файл не выбран'}</em>
          </label>
          {docForm.type === 'ttk' && <label className="fileUploadBox">
            <span>Фото блюда / напитка</span>
            <input type="file" accept="image/*" onChange={(e) => attachDocPhoto(e.target.files?.[0])} />
            <em>{docForm.photo?.file_name || 'Фото можно добавить позже'}</em>
          </label>}
        </div>}
        <Button>{docForm.type === 'ttk' ? 'Загрузить и разобрать ТТК' : 'Добавить документ'}</Button>
      </form>
      {knowledgeMsg && <div className={knowledgeMsg.includes('создан') || knowledgeMsg.includes('сохран') || knowledgeMsg.includes('удал') ? 'notice' : 'error'}>{knowledgeMsg}</div>}
    </Card>

    <Card title="База знаний / ТТК / сервис-бук">
      {categories.length === 0 && <Empty text="Документов нет" />}
      <div className="knowledgeAdminList">{categories.map(c => <div className="knowledgeAdminFolder" key={c.id}>
        <div className="knowledgeAdminFolderHead">
          {editingCategoryId === c.id
            ? <input value={categoryEditTitle} onChange={(e) => setCategoryEditTitle(e.target.value)} placeholder="Название папки" />
            : <div><b>{c.title}</b><span>{c.documents.length} документов</span></div>}
          <div className="adminInlineActions">
            {editingCategoryId === c.id ? <>
              <Button kind="soft" type="button" onClick={() => setEditingCategoryId('')}>Отмена</Button>
              <Button type="button" onClick={() => saveCategory(c.id)}>Сохранить</Button>
            </> : <>
              <Button kind="soft" type="button" onClick={() => startEditCategory(c)}>Редактировать</Button>
              <Button kind="danger" type="button" onClick={() => deleteCategory(c)}>Удалить</Button>
            </>}
          </div>
        </div>

        <div className="knowledgeAdminDocs">
          {c.documents.map((d: any) => <div className="knowledgeAdminDocRow" key={d.id}>
            {editingDocId === d.id ? <div className="knowledgeDocEditForm">
              <div className="form two">
                <Select label="Папка" value={docEditForm.category_id || c.id} onChange={(e: any) => setDocEditForm({ ...docEditForm, category_id: e.target.value })}>{categories.map(cat => <option value={cat.id} key={cat.id}>{cat.title}</option>)}</Select>
                <Select label="Тип" value={docEditForm.type} onChange={(e: any) => setDocEditForm({ ...docEditForm, type: e.target.value })}>
                  <option value="text">Текст</option>
                  <option value="pdf">PDF-документ</option>
                  <option value="ttk">ТТК из PDF</option>
                  <option value="service_book">Сервис-бук PDF</option>
                </Select>
              </div>
              <Field label="Название" value={docEditForm.title} onChange={(e: any) => setDocEditForm({ ...docEditForm, title: e.target.value })} />
              {docEditForm.type === 'text' && <Textarea label="Текст" rows={6} value={docEditForm.content} onChange={(e: any) => setDocEditForm({ ...docEditForm, content: e.target.value })} />}
              {docEditForm.type !== 'text' && <div className="fileUploadGrid">
                <label className="fileUploadBox">
                  <span>{docEditForm.type === 'ttk' ? 'Новый PDF с ТТК' : 'Новый PDF-файл'}</span>
                  <input type="file" accept="application/pdf,.pdf" onChange={(e) => attachEditDocFile(e.target.files?.[0])} />
                  <em>{docEditForm.file?.file_name || 'Оставьте пустым, чтобы не менять файл'}</em>
                </label>
                {docEditForm.type === 'ttk' && <label className="fileUploadBox">
                  <span>Новое фото</span>
                  <input type="file" accept="image/*" onChange={(e) => attachEditDocPhoto(e.target.files?.[0])} />
                  <em>{docEditForm.photo?.file_name || 'Оставьте пустым, чтобы не менять фото'}</em>
                </label>}
              </div>}
              <div className="actions">
                <Button kind="soft" type="button" onClick={() => setEditingDocId('')}>Отмена</Button>
                <Button type="button" onClick={() => saveDoc(d.id)}>Сохранить</Button>
              </div>
            </div> : <>
              <button className="docRow knowledgeDocOpenButton" type="button" onClick={() => viewDoc(d)}>
                <span>{d.title}</span>
                <em>{d.type === 'ttk' ? 'ТТК' : d.type === 'service_book' ? 'сервис-бук' : d.acknowledged ? 'ознакомлен' : d.requires_acknowledgement ? 'нужно ознакомиться' : 'документ'}</em>
              </button>
              <div className="adminInlineActions">
                <Button kind="soft" type="button" onClick={() => startEditDoc(d, c.id)}>Редактировать</Button>
                <Button kind="danger" type="button" onClick={() => deleteDoc(d)}>Удалить</Button>
              </div>
            </>}
          </div>)}
          {c.documents.length === 0 && <Empty text="В папке пока нет документов" />}
        </div>
      </div>)}</div>
    </Card>

    {openDoc && <KnowledgeDocumentModal doc={openDoc} onClose={() => setOpenDoc(null)} onAck={ack} />}
    <Card title="Статистика ознакомления"><div className="list">{stats.map(s => <div className="listRow" key={s.id}><div><b>{s.title}</b><span>Просмотры: {s.views}</span></div><span className="badge active">Ознакомились: {s.acknowledgements}</span></div>)}</div></Card>
  </>;
}
