import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { api, clearToken, download, getToken, setToken } from './api';
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

type View = 'login' | 'register';
type Tab = string;
type WorkspaceModalKind = 'notifications' | 'support' | 'billing' | null;
type MobileSheetKind = 'menu' | 'create' | 'profile' | null;
type MobileWorkspaceConfig = {
  title: ReactNode;
  subtitle?: ReactNode;
  isOverview?: boolean;
  showMenuButton?: boolean;
  showBackButton?: boolean;
  showNotifications?: boolean;
  navItems: MobileNavItem[];
  menuItems: MobileActionItem[];
  createItems: MobileActionItem[];
  profileItems: MobileActionItem[];
  notificationCount?: number;
  onNotifications?: () => void;
  actionIcon?: IconName;
  onAction?: () => void;
  pageClassName?: string;
};

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

const techRequestCategories: Record<string, string> = {
  refrigeration: 'Холодильники',
  plumbing: 'Сантехника / засор',
  equipment: 'Оборудование',
  cleaning: 'Уборка и сервис',
  other: 'Другое'
};

const techRequestStatuses: Record<string, string> = {
  new: 'новая',
  in_progress: 'в работе',
  done: 'выполнена',
  cancelled: 'отклонена'
};

const inventorySections = [
  { id: 'bar', title: 'Бар', department: 'bar', defaultCategory: 'Бар' },
  { id: 'kitchen', title: 'Кухня', department: 'kitchen', defaultCategory: 'Кухня' },
  { id: 'household', title: 'Хозтовары', department: 'hall', defaultCategory: 'Хозтовары' },
  { id: 'dishes', title: 'Посуда', department: 'hall', defaultCategory: 'Посуда' }
] as const;

type InventorySectionId = typeof inventorySections[number]['id'];

const subscriptionStatuses: Record<string, string> = {
  active: 'активна',
  blocked: 'заблокирована',
  trial: 'trial',
  trial_expired: 'trial истёк',
  subscription_expired: 'подписка истекла'
};

const brandLogoSrc = '/resto-control-logo.png';

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

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

function userInitials(name?: string) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'RC';
  return parts.slice(0, 2).map(part => part[0]?.toUpperCase() || '').join('') || 'RC';
}

function mobileTabTitle(active: string, tabs: NavTab[]) {
  return tabs.find(tab => tab.id === active)?.title || 'Раздел';
}

function normalizedProductCategory(value?: string) {
  return String(value || '').trim().toLowerCase();
}

function inventorySectionMeta(sectionId: InventorySectionId) {
  return inventorySections.find(section => section.id === sectionId) || inventorySections[0];
}

function productMatchesInventorySection(product: any, sectionId: InventorySectionId) {
  const category = normalizedProductCategory(product?.category);
  if (sectionId === 'bar') return product?.department === 'bar';
  if (sectionId === 'kitchen') return product?.department === 'kitchen';
  if (sectionId === 'dishes') return ['hall', 'common'].includes(product?.department) && category.includes('посуд');
  return ['hall', 'common'].includes(product?.department) && !category.includes('посуд');
}

function fieldIcon(label: string, type?: string, explicit?: IconName): IconName | null {
  if (explicit) return explicit;
  const value = String(label || '').toLowerCase();
  if (type === 'password' || value.includes('парол')) return 'password';
  if (value.includes('логин')) return 'login';
  if (value.includes('email') || value.includes('почт')) return 'email';
  if (value.includes('тел')) return 'phone';
  if (value.includes('город')) return 'city';
  if (value.includes('роль')) return 'role';
  if (value.includes('ресторан')) return 'restaurant';
  if (value.includes('имя') || value.includes('сотрудник') || value.includes('владел')) return 'user';
  return null;
}

function Field({ label, icon, ...props }: any) {
  const resolvedIcon = fieldIcon(label, props.type, icon);
  return <label className="field">
    <span>{label}</span>
    <div className={resolvedIcon ? 'fieldControl hasIcon' : 'fieldControl'}>
      {resolvedIcon && <AppIcon name={resolvedIcon} className="fieldIcon" />}
      <input {...props} />
    </div>
  </label>;
}

function Select({ label, children, icon, ...props }: any) {
  const resolvedIcon = fieldIcon(label, undefined, icon);
  return <label className="field">
    <span>{label}</span>
    <div className={resolvedIcon ? 'fieldControl hasIcon' : 'fieldControl'}>
      {resolvedIcon && <AppIcon name={resolvedIcon} className="fieldIcon" />}
      <select {...props}>{children}</select>
    </div>
  </label>;
}

function Textarea({ label, icon, ...props }: any) {
  const resolvedIcon = fieldIcon(label, undefined, icon);
  return <label className="field">
    <span>{label}</span>
    <div className={resolvedIcon ? 'fieldControl hasIcon textareaControl' : 'fieldControl textareaControl'}>
      {resolvedIcon && <AppIcon name={resolvedIcon} className="fieldIcon" />}
      <textarea {...props} />
    </div>
  </label>;
}

function Empty({ text }: { text: string }) {
  return <div className="empty">{text}</div>;
}

function WorkspaceInfoModal({
  title,
  text,
  actions,
  onClose
}: {
  title: string;
  text: string;
  actions: { label: string; kind?: string; onClick: () => void }[];
  onClose: () => void;
}) {
  return <div className="modal" onClick={onClose}>
    <div className="modalCard infoModalCard" onClick={(e) => e.stopPropagation()}>
      <div className="rowBetween">
        <h2>{title}</h2>
        <button className="iconBtn" onClick={onClose}>×</button>
      </div>
      <p className="infoModalText">{text}</p>
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

function MobileSheetModal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  fullScreen = false,
  className
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  fullScreen?: boolean;
  className?: string;
}) {
  return <div className="modal mobileModalBackdrop" onClick={onClose}>
    <div
      className={cx('modalCard', fullScreen ? 'mobileFullScreenModal' : 'mobileSheetModal', className)}
      role="dialog"
      aria-modal="true"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="mobileModalHead">
        <div className="mobileModalHeadCopy">
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button type="button" className="mobileIconButton" onClick={onClose} aria-label="Закрыть">
          <AppIcon name="close" className="navIcon" />
        </button>
      </div>
      <div className="mobileModalBody">{children}</div>
      {footer && <div className="mobileModalFooter">{footer}</div>}
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

  return <MobileSheetModal
    title="Фотоотчёт"
    subtitle={title}
    onClose={onClose}
    fullScreen
    className="mobileCameraModal"
    footer={<div className="cameraFooterActions">
      <Button kind="soft" type="button" onClick={onClose}>Отмена</Button>
      <Button type="button" disabled={busy || !!error} onClick={takePhoto}>Сделать фото</Button>
    </div>}
  >
      {busy && <div className="notice">Подключаем камеру...</div>}
      {error && <div className="error">{error}</div>}
      {!error && <video ref={videoRef} className="cameraVideo" autoPlay playsInline muted />}
  </MobileSheetModal>;
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

const navIcons: Record<string, IconName> = {
  overview: 'overview',
  users: 'users',
  checklists: 'checklists',
  requests: 'requests',
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
        showBackButton={mobile.showBackButton !== false}
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

    <PageContainer className={mobile?.pageClassName}>{children}</PageContainer>

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

  const modal = modalKind === 'notifications'
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
            text: 'Здесь мы собрали быстрый доступ к статусу подписки. Для следующего шага можно вернуться в обзор или открыть раздел поддержки.',
            actions: [
              { label: 'Открыть обзор', kind: 'primary', onClick: () => setActive('overview') },
              { label: 'База знаний', onClick: () => setActive('knowledge') }
            ]
          }
        : null;

  const mobileNavItems: MobileNavItem[] = [
    { id: 'overview', title: 'Обзор', icon: 'overview', active: active === 'overview', onClick: () => setActive('overview') },
    { id: 'checklists', title: 'Чек-листы', icon: 'checklists', active: active === 'checklists', onClick: () => setActive('checklists') },
    { id: 'tasks', title: 'Задачи', icon: 'tasks', active: active === 'tasks', onClick: () => setActive('tasks') },
    { id: 'knowledge', title: 'Профиль', icon: 'user', active: active === 'knowledge', onClick: () => setActive('knowledge') }
  ];

  const mobileMenuItems: MobileActionItem[] = tabs.map((tab) => ({
    id: tab.id,
    title: tab.title,
    subtitle: restaurant?.name,
    icon: tab.icon || 'overview',
    onClick: () => setActive(tab.id)
  }));

  const mobileCreateItems: MobileActionItem[] = [
    { id: 'users', title: 'Сотрудники', subtitle: 'Добавить и управлять доступами', icon: 'users', onClick: () => setActive('users') },
    { id: 'requests', title: 'Заявки', subtitle: 'Открыть закупки и приёмку', icon: 'requests', onClick: () => setActive('requests') },
    { id: 'inventory', title: 'Инвентаризация', subtitle: 'Проверить остатки и Excel-отчёты', icon: 'inventory', onClick: () => setActive('inventory') }
  ];

  const mobileProfileItems: MobileActionItem[] = [
    { id: 'support', title: 'Поддержка', subtitle: 'База знаний и сопровождение', icon: 'support', onClick: openSupport },
    { id: 'billing', title: 'Тарифы и оплата', subtitle: 'Статус подписки и продление', icon: 'trial', onClick: openBilling },
    { id: 'logout', title: 'Выйти', subtitle: 'Завершить рабочую сессию', icon: 'logout', onClick: onLogout }
  ];

  return <main className="workspaceLayout">
    <SidebarNav
      logoSrc={brandLogoSrc}
      tabs={tabs}
      active={active}
      onChange={setActive}
      onPromoClick={() => setActive('overview')}
      onSupportClick={openSupport}
    />
    <section className="workspaceMain">
      <div className="mobileWorkspaceChrome">
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
      </div>

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
    {modal && <WorkspaceInfoModal title={modal.title} text={modal.text} actions={modal.actions} onClose={closeModal} />}
    <BottomNavigation items={mobileNavItems} onCreate={() => setSheet('create')} />
    <BottomSheet open={sheet === 'menu'} title="Разделы кабинета" items={mobileMenuItems} onClose={() => setSheet(null)} />
    <BottomSheet open={sheet === 'create'} title="Быстрые действия" items={mobileCreateItems} onClose={() => setSheet(null)} />
    <BottomSheet open={sheet === 'profile'} title="Профиль и доступ" items={mobileProfileItems} onClose={() => setSheet(null)} />
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
        <Field label="Email" value={form.email} onChange={(e: any) => setForm({ ...form, email: e.target.value })} />
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
  const tabs = withIcons([
    { id: 'overview', title: 'Обзор' }, { id: 'users', title: 'Сотрудники' }, { id: 'checklists', title: 'Чек-листы' },
    { id: 'requests', title: 'Заявки' }, { id: 'inventory', title: 'Инвент.' }, { id: 'tasks', title: 'Задачи' }, { id: 'knowledge', title: 'База знаний' }
  ]);
  const section = useMemo(() => {
    if (tab === 'overview') return <AdminOverview />;
    if (tab === 'users') return <UsersAdmin />;
    if (tab === 'checklists') return <Checklists user={user} admin />;
    if (tab === 'requests') return <Requests user={user} admin />;
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
    banner={(openBilling) => <SubscriptionBanner restaurant={restaurant} openBilling={openBilling} />}
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

function AdminOverview() {
  const [data, setData] = useState<any>(null);
  useEffect(() => { api('/api/admin/overview').then(setData); }, []);
  if (!data) return <Card><Empty text="Загружаем обзор" /></Card>;
  return <>
    <div className="statsGrid">
      <StatCard icon="users" title="Сотрудники" value={data.users} caption="Активных" />
      <StatCard icon="checklists" title="Чек-листы сегодня" value={data.checklists_today} caption="Выполнено" />
      <StatCard icon="requests" title="Открытые заявки" value={data.requests_open} caption="Новых" />
      <StatCard icon="tasks" title="Задачи открыты" value={data.tasks_open} caption="В работе" />
      <StatCard icon="document" title="Документы" value={data.docs} caption="Всего" />
      <StatCard icon="inventory" title="Инвентаризации" value={data.inventories} caption="Активных" />
    </div>

    <Card title="Операционный обзор" right={<span className="badge active">Рабочий кабинет</span>}>
      <div className="overviewHero">
        <div className="overviewHeroCopy">
          <strong>{data.restaurant?.name || 'Ресторан подключён'}</strong>
          <p>Следите за сотрудниками, чек-листами, заявками и инвентаризациями в одном аккуратном центре управления.</p>
        </div>
        <div className="overviewHighlights">
          <div><span className="muted">Ресторан</span><b>{data.restaurant?.name || '—'}</b></div>
          <div><span className="muted">Документы</span><b>{data.docs}</b></div>
          <div><span className="muted">Задачи в работе</span><b>{data.tasks_open}</b></div>
        </div>
      </div>
    </Card>
  </>;
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

function EmployeeApp({ user, restaurant, onLogout }: any) {
  const [tab, setTab] = useState<Tab>('today');
  const [notificationCount, setNotificationCount] = useState(0);
  const [openTechComposer, setOpenTechComposer] = useState(false);
  const tabs = withIcons([
    { id: 'today', title: 'Сегодня' }, { id: 'checklists', title: 'Чек-лист' }, { id: 'requests', title: 'Заявки' },
    { id: 'inventory', title: 'Инвент.' }, { id: 'tasks', title: 'Задачи' }, { id: 'knowledge', title: 'База' }
  ]);

  useEffect(() => {
    api('/api/tasks')
      .then((rows) => setNotificationCount(rows.filter((task: any) => !task.assignment?.done).length))
      .catch(() => setNotificationCount(0));
  }, [tab]);

  const mobileNavItems: MobileNavItem[] = [
    { id: 'today', title: 'Обзор', icon: 'overview', active: tab === 'today', onClick: () => setTab('today') },
    { id: 'checklists', title: 'Чек-листы', icon: 'checklists', active: tab === 'checklists', onClick: () => setTab('checklists') },
    { id: 'tasks', title: 'Задачи', icon: 'tasks', active: tab === 'tasks', onClick: () => setTab('tasks') },
    { id: 'knowledge', title: 'База знаний', icon: 'knowledge', active: tab === 'knowledge', onClick: () => setTab('knowledge') }
  ];

  const mobileMenuItems: MobileActionItem[] = [
    { id: 'today', title: 'Обзор', subtitle: 'Главная сводка по смене', icon: 'overview', onClick: () => setTab('today') },
    { id: 'checklists', title: 'Чек-листы', subtitle: 'Открытие, закрытие и фотоотчёты', icon: 'checklists', onClick: () => setTab('checklists') },
    { id: 'requests', title: 'Заявки', subtitle: 'Запросы по товарам и сервису', icon: 'requests', onClick: () => setTab('requests') },
    { id: 'inventory', title: 'Инвентаризация', subtitle: 'Остатки и позиции отдела', icon: 'inventory', onClick: () => setTab('inventory') },
    { id: 'tasks', title: 'Задачи', subtitle: 'Личные задачи и техзаявки', icon: 'tasks', onClick: () => setTab('tasks') },
    { id: 'knowledge', title: 'База знаний', subtitle: 'Инструкции и сервис-бук', icon: 'knowledge', onClick: () => setTab('knowledge') }
  ];

  const mobileCreateItems: MobileActionItem[] = [
    { id: 'request', title: 'Создать заявку', subtitle: 'Открыть запросы и отправить новую заявку', icon: 'requests', onClick: () => setTab('requests') },
    { id: 'inventory', title: 'Открыть инвентаризацию', subtitle: 'Быстро заполнить остатки', icon: 'inventory', onClick: () => setTab('inventory') },
    { id: 'tech', title: 'Сообщить о проблеме', subtitle: 'Техзаявка для менеджера', icon: 'tasks', onClick: () => {
      setTab('tasks');
      setOpenTechComposer(true);
    } }
  ];

  const mobileProfileItems: MobileActionItem[] = [
    { id: 'profile', title: `${roles[user.role]} · ${restaurant?.name}`, subtitle: 'Ваш рабочий кабинет', icon: 'user', onClick: () => setTab('today') },
    { id: 'logout', title: 'Выйти из аккаунта', subtitle: 'Завершить сессию', icon: 'logout', onClick: onLogout }
  ];

  return <BasicWorkspace
    user={user}
    subtitle={`${roles[user.role]} · ${restaurant?.name}`}
    tabs={tabs}
    active={tab}
    setActive={setTab}
    onLogout={onLogout}
    mobile={{
      title: tab === 'today' ? <>Добро пожаловать, <em>{user.name}</em></> : mobileTabTitle(tab, tabs),
      subtitle: tab === 'today' ? roles[user.role] : restaurant?.name,
      isOverview: tab === 'today',
      showMenuButton: false,
      showBackButton: false,
      showNotifications: false,
      navItems: mobileNavItems,
      menuItems: mobileMenuItems,
      createItems: mobileCreateItems,
      profileItems: mobileProfileItems,
      notificationCount,
      onNotifications: () => setTab('tasks'),
      pageClassName: 'employeeMobilePage'
    }}
  >
    <div className="hello"><b>{user.name}</b><span>{roles[user.role]} · {restaurant?.name}</span></div>
    {tab === 'today' && <Today user={user} onOpenTasks={() => setTab('tasks')} onOpenChecklists={() => setTab('checklists')} onOpenRequests={() => setTab('requests')} onOpenInventory={() => setTab('inventory')} />}
    {tab === 'checklists' && <Checklists user={user} />}
    {tab === 'requests' && <Requests user={user} />}
    {tab === 'inventory' && <Inventory user={user} />}
    {tab === 'tasks' && <Tasks user={user} showTechComposer={openTechComposer} onCloseComposer={() => setOpenTechComposer(false)} />}
    {tab === 'knowledge' && <Knowledge user={user} />}
  </BasicWorkspace>;
}

function Today({
  user,
  onOpenTasks,
  onOpenChecklists,
  onOpenRequests,
  onOpenInventory
}: {
  user: any;
  onOpenTasks: () => void;
  onOpenChecklists: () => void;
  onOpenRequests: () => void;
  onOpenInventory: () => void;
}) {
  const [overview, setOverview] = useState<any | null>(null);

  useEffect(() => {
    let active = true;

    Promise.all([
      api('/api/checklists/templates').catch(() => []),
      api('/api/tasks').catch(() => []),
      api('/api/requests').catch(() => []),
      api('/api/inventory/templates').catch(() => [])
    ]).then(([checklists, tasks, requests, templates]) => {
      if (!active) return;
      setOverview({
        checklists,
        tasks,
        requests,
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
  const openRequests = overview.requests.filter((request: any) => !['received', 'done', 'cancelled'].includes(request.status));
  const inventoryItems = overview.templates.reduce((total: number, template: any) => total + (template.items?.length || 0), 0);

  return <div className="mobileSectionStack">
    <section className="mobileSection">
      <SectionTitle title="Сегодня" action={<button type="button" className="sectionLink" onClick={onOpenTasks}>Все задачи</button>} />
      <div className="mobileListSurface">
        <button type="button" className="mobileOverviewRow" onClick={onOpenChecklists}>
          <div className="mobileOverviewIcon blue"><AppIcon name="checklists" className="navIcon" /></div>
          <div className="mobileOverviewCopy">
            <strong>Чек-листы</strong>
            <span>{overview.checklists.length} на сегодня</span>
          </div>
          <div className="mobileOverviewTrailing">
            <b>{overview.checklists.length}</b>
            <AppIcon name="chevron" className="navIcon" />
          </div>
        </button>
        <button type="button" className="mobileOverviewRow" onClick={onOpenTasks}>
          <div className="mobileOverviewIcon green"><AppIcon name="tasks" className="navIcon" /></div>
          <div className="mobileOverviewCopy">
            <strong>Задачи</strong>
            <span>{openTasks.length} в работе</span>
          </div>
          <div className="mobileOverviewTrailing">
            <b>{openTasks.length}</b>
            <AppIcon name="chevron" className="navIcon" />
          </div>
        </button>
        <button type="button" className="mobileOverviewRow" onClick={onOpenRequests}>
          <div className="mobileOverviewIcon amber"><AppIcon name="requests" className="navIcon" /></div>
          <div className="mobileOverviewCopy">
            <strong>Заявки</strong>
            <span>{openRequests.length} открыто</span>
          </div>
          <div className="mobileOverviewTrailing">
            <b>{openRequests.length}</b>
            <AppIcon name="chevron" className="navIcon" />
          </div>
        </button>
        <button type="button" className="mobileOverviewRow" onClick={onOpenInventory}>
          <div className="mobileOverviewIcon purple"><AppIcon name="inventory" className="navIcon" /></div>
          <div className="mobileOverviewCopy">
            <strong>Инвентаризация</strong>
            <span>{inventoryItems} позиций</span>
          </div>
          <div className="mobileOverviewTrailing">
            <b>{inventoryItems}</b>
            <AppIcon name="chevron" className="navIcon" />
          </div>
        </button>
      </div>
    </section>

    <section className="mobileSection">
      <SectionTitle title="Приоритетные задачи" />
      <div className="mobileListSurface">
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
    </section>
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
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
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

  const availableTemplates = admin
    ? templates
    : templates.filter((template) => !template.role || template.role === user.role);

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

  const checklistRequiresPhoto = selectedTemplate?.items.some((item: any) => answers[item.id]?.done && !answers[item.id]?.photo_url);

  function toggleChecklistItem(item: any) {
    const current = answers[item.id] || {};
    if (current.done) {
      updateAnswer(item.id, { done: false, photo_url: '', comment: '' });
      return;
    }
    setCameraTarget({ itemId: item.id, title: item.text });
  }

  if (!admin) {
    return <div className="mobileSectionStack">
      <SectionTitle title="Чек-листы" />

      {!availableTemplates.length && <div className="mobileListSurface mobileEmptySurface">
        <Empty text="Для вашей роли пока нет активных чек-листов" />
      </div>}

      {!!availableTemplates.length && <section className="mobileSection">
        <div className="mobileChecklistPicker">
          {availableTemplates.map((template) => <button
            key={template.id}
            type="button"
            className={cx('mobileChecklistPickerItem', selectedTemplate?.id === template.id && 'active')}
            onClick={() => setSelectedTemplateId(template.id)}
          >
            <strong>{template.title}</strong>
            <span>{template.items.length}</span>
          </button>)}
        </div>
      </section>}

      {selectedTemplate && <section className="mobileChecklistSummary">
        <div className="mobileChecklistSummaryHead">
          <div>
            <strong>{selectedTemplate.title}</strong>
            <span>{completedChecklistItems} из {selectedTemplate.items.length} выполнено</span>
          </div>
          <span className="badge active mobileProgressBadge">{completedChecklistItems}/{selectedTemplate.items.length}</span>
        </div>
        <ProgressBar value={completedChecklistItems} max={selectedTemplate.items.length} />
      </section>}

      {selectedTemplate && <div className="mobileListSurface mobileChecklistPlainList">
        {selectedTemplate.items.map((item: any, index: number) => {
          const itemAnswer = answers[item.id] || {};
          return <div key={item.id} className={cx('mobileChecklistLine', itemAnswer.done && 'done')}>
            <button
              type="button"
              className={cx('mobileChecklistToggle', itemAnswer.done && 'done')}
              onClick={() => toggleChecklistItem(item)}
              aria-label={itemAnswer.done ? 'Снять отметку' : 'Отметить выполненным'}
            >
              {itemAnswer.done && <span>✓</span>}
            </button>
            <div className="mobileChecklistLineBody">
              <div className="mobileChecklistLineHead">
                <strong>{item.text}</strong>
                <span>{index + 1} / {selectedTemplate.items.length}</span>
              </div>
              {itemAnswer.done && <div className="mobileChecklistLineMeta">
                <span className="mobileChecklistPhotoStatus">
                  <AppIcon name="camera" className="navIcon" />
                  {itemAnswer.photo_url ? 'Фото готово' : 'Нужно фото'}
                </span>
                <button
                  type="button"
                  className="mobileChecklistRetake"
                  onClick={() => setCameraTarget({ itemId: item.id, title: item.text })}
                >
                  {itemAnswer.photo_url ? 'Переснять' : 'Снять'}
                </button>
              </div>}
              {itemAnswer.done && itemAnswer.photo_url && <div className="mobileChecklistAttachment">
                <img className="mobileChecklistPhoto" src={itemAnswer.photo_url} alt={`Фото: ${item.text}`} />
              </div>}
              {itemAnswer.done && <textarea
                className="mobileInlineTextarea"
                value={itemAnswer.comment || ''}
                onChange={(e: any) => updateAnswer(item.id, { comment: e.target.value })}
                placeholder="Комментарий (необязательно)"
              />}
            </div>
          </div>;
        })}
      </div>}

      {selectedTemplate && <div className="mobileStickyActionBar">
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
  const [statusFilter, setStatusFilter] = useState('all');
  const [showComposer, setShowComposer] = useState(false);
  async function load() { setProducts(await api('/api/products')); setRequests(await api('/api/requests')); }
  useEffect(() => { load(); }, []);
  async function submit() {
    const items = Object.entries(qty).map(([product_id, q]) => ({ product_id, qty_ordered: Number(q) })).filter(i => i.qty_ordered > 0);
    await api('/api/requests', { method: 'POST', body: JSON.stringify({ department: user.department, items }) });
    setQty({}); setMsg('Заявка отправлена'); setShowComposer(false); load();
  }
  async function receive(req: any) {
    await api(`/api/requests/${req.id}/receive`, { method: 'PATCH', body: JSON.stringify({ received: received[req.id] || {} }) });
    setMsg('Приход товара обновлён'); load();
  }

  const visibleRequests = statusFilter === 'all'
    ? requests
    : requests.filter((request) => {
      if (statusFilter === 'processing') return !['received', 'done', 'cancelled'].includes(request.status);
      if (statusFilter === 'done') return ['received', 'done'].includes(request.status);
      if (statusFilter === 'rejected') return ['not_received', 'cancelled'].includes(request.status);
      return true;
    });
  const selectedProductsCount = Object.values(qty).filter((value) => Number(value) > 0).length;

  if (!admin) {
    return <div className="mobileSectionStack">
      <SectionTitle title="Заявки" action={<button type="button" className="sectionLink" onClick={() => setShowComposer(true)}>Создать</button>} />

      <div className="mobileChipRow">
        <button type="button" className={cx('mobileChip', statusFilter === 'all' && 'active')} onClick={() => setStatusFilter('all')}><span>Все</span><b>{requests.length}</b></button>
        <button type="button" className={cx('mobileChip', statusFilter === 'processing' && 'active')} onClick={() => setStatusFilter('processing')}><span>В обработке</span><b>{requests.filter((request) => !['received', 'done', 'cancelled'].includes(request.status)).length}</b></button>
        <button type="button" className={cx('mobileChip', statusFilter === 'done' && 'active')} onClick={() => setStatusFilter('done')}><span>Выполнено</span><b>{requests.filter((request) => ['received', 'done'].includes(request.status)).length}</b></button>
        <button type="button" className={cx('mobileChip', statusFilter === 'rejected' && 'active')} onClick={() => setStatusFilter('rejected')}><span>Отклонено</span><b>{requests.filter((request) => ['not_received', 'cancelled'].includes(request.status)).length}</b></button>
      </div>

      <section className="mobileSection">
        <div className="mobileListSurface">
        {visibleRequests.length === 0 && <Empty text="Под выбранный статус заявок пока нет" />}
        <div className="mobileRequestList">
          {visibleRequests.map((request) => <article key={request.id} className="mobileRequestCard">
            <div className="rowBetween">
              <div>
                <strong>{departments[request.department] || 'Отдел'}</strong>
                <span>{fmtDate(request.created_at)}</span>
              </div>
              <span className={`badge ${request.status}`}>{request.status}</span>
            </div>
            <div className="mobileRequestItems">
              {request.items.map((item: any) => <div key={item.id} className="mobileRequestItem">
                <span>{item.product?.name}</span>
                <strong>{item.qty_ordered} {item.product?.unit}</strong>
              </div>)}
            </div>
          </article>)}
        </div>
        </div>
      </section>
      {msg && <div className="notice mobileInlineNotice">{msg}</div>}

      {showComposer && <MobileSheetModal
        title="Новая заявка"
        subtitle={departments[user.department] || 'Ваш отдел'}
        onClose={() => setShowComposer(false)}
        className="mobileFormSheet"
        footer={<Button type="button" className="mobilePrimaryButton" disabled={selectedProductsCount === 0} onClick={submit}>Отправить заявку</Button>}
      >
        <div className="mobileSheetLead">Выберите товары и укажите количество.</div>
        <div className="mobileListSurface mobileSheetListSurface">
          <div className="mobileProductsList">
            {products.map((product) => <label className="mobileProductRow" key={product.id}>
              <div className="mobileInventoryCopy">
                <strong>{product.name}</strong>
                <span>{departments[product.department] || 'Отдел'} · {product.unit}</span>
              </div>
              <input
                type="number"
                min="0"
                value={qty[product.id] || ''}
                onChange={(e) => setQty({ ...qty, [product.id]: e.target.value })}
                placeholder="0"
              />
            </label>)}
          </div>
        </div>
      </MobileSheetModal>}
    </div>;
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
  const [products, setProducts] = useState<any[]>([]);
  const [values, setValues] = useState<any>({});
  const [msg, setMsg] = useState('');
  const [productMsg, setProductMsg] = useState('');
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

  async function submit(t: any) {
    const payload: any = {};
    t.items.forEach((i: any) => { payload[i.product_id] = { qty: Number(values[i.product_id] || 0), comment: '' }; });
    await api('/api/inventory/runs', { method: 'POST', body: JSON.stringify({ template_id: t.id, values: payload }) });
    setValues({}); setMsg('Инвентаризация сохранена'); load();
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

    function inventoryBadge(rawValue: any) {
      if (rawValue === '' || rawValue === undefined || rawValue === null) return { text: 'Не указано', tone: '' };
      const qty = Number(rawValue);
      if (Number.isNaN(qty)) return { text: 'Не указано', tone: '' };
      if (qty <= 0) return { text: 'Нет', tone: 'cancelled' };
      if (qty <= 2) return { text: 'Мало', tone: 'trial' };
      return { text: 'Норма', tone: 'active' };
    }

    return <div className="mobileSectionStack">
      <SectionTitle title="Инвентаризация" />

      <section className="mobileSection">
        <div className="mobileListSurface mobileFilterSurface">
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
        </div>
      </section>

      <section className="mobileSection">
        <div className="mobileListSectionHead">
          <h3>{selectedTemplate?.title || 'Бланк инвентаризации'}</h3>
          {selectedTemplate && <span className="mobileSectionCount">{filteredItems.length}</span>}
        </div>
        <div className="mobileListSurface">
        {filteredItems.length === 0 && <Empty text="Нет товаров по этому фильтру" />}
        <div className="mobileInventoryList">
          {filteredItems.map((item: any) => {
            const state = inventoryBadge(values[item.product_id]);
            return <label key={item.product_id} className={cx('mobileInventoryItem', state.tone === 'cancelled' && 'danger')}>
              <div className="mobileInventoryCopy">
                <strong>{item.product?.name}</strong>
                <span>{item.product?.unit || 'шт.'}</span>
              </div>
              <div className="mobileInventoryActions">
                <span className={cx('badge', state.tone)}>{state.text}</span>
                <input
                  type="number"
                  min="0"
                  value={values[item.product_id] || ''}
                  onChange={(e) => setValues({ ...values, [item.product_id]: e.target.value })}
                  placeholder="0"
                />
              </div>
            </label>;
          })}
        </div>
        </div>
      </section>
      {selectedTemplate && <div className="mobileStickyActionBar">
        <Button type="button" className="mobilePrimaryButton" onClick={() => submit(selectedTemplate)}>Сохранить остатки</Button>
      </div>}
      {msg && <div className="notice mobileInlineNotice">{msg}</div>}
    </div>;
  }

  return <>
    {admin
      ? <>
        <Card title="Списки товаров для инвентаризации" right={<span className="badge active">Бар · Кухня · Хозтовары · Посуда</span>}>
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
          {productMsg && <div className={productMsg.includes('добавлен') ? 'notice' : 'error'}>{productMsg}</div>}

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
                <span>Строк в файле: {run.values?.length || 0}</span>
              </div>
              <Button kind="soft" onClick={() => download(`/api/admin/inventory/runs/${run.id}/export.xlsx`, `inventory-${run.id}.xlsx`)}>Скачать Excel</Button>
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
          <div className="actions">
            <Button kind="soft" type="button" onClick={() => setEditingProduct(null)}>Отмена</Button>
            <Button>Сохранить товар</Button>
          </div>
        </form>
      </div>
    </div>}
  </>;
}

function Tasks({ user, admin = false, showTechComposer = false, onCloseComposer }: any) {
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
    await api('/api/tasks', { method: 'POST', body: JSON.stringify(form) });
    setForm({ ...form, title: '', description: '' });
    setTaskMsg('Задача создана');
    load();
  }
  async function done(id: string) { await api(`/api/tasks/${id}/done`, { method: 'PATCH', body: JSON.stringify({ comment: '' }) }); load(); }
  async function createTechRequest(e: FormEvent) {
    e.preventDefault();
    setTechMsg('');
    await api('/api/tech-requests', { method: 'POST', body: JSON.stringify(techForm) });
    setTechForm({ title: '', description: '', category: 'equipment' });
    setTechMsg('Техзаявка отправлена менеджеру');
    setShowTechForm(false);
    onCloseComposer?.();
    load();
  }
  async function updateTechRequest(request: any) {
    const draft = techDrafts[request.id] || {};
    await api(`/api/tech-requests/${request.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: draft.status || request.status,
        manager_comment: draft.manager_comment !== undefined ? draft.manager_comment : request.manager_comment || ''
      })
    });
    setTechMsg('Техзаявка обновлена');
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

        <section className="mobileSection">
          <div className="mobileListSectionHead">
            <h3>Сегодня</h3>
            <span className="mobileSectionCount">{activeTasks.length}</span>
          </div>
          <div className="mobileListSurface">
          <div className="mobileTaskList">
            {activeTasks.length === 0 && <Empty text="Нет активных задач на текущую смену" />}
            {activeTasks.map((task) => <div key={task.id} className="mobileTaskRow static">
              <span className="mobileTaskStatus" />
              <div className="mobileTaskCopy">
                <strong>{task.title}</strong>
                <span>{task.description || 'Без описания'}</span>
              </div>
              <Button type="button" kind="soft" onClick={() => done(task.id)}>Выполнено</Button>
            </div>)}
          </div>
          </div>
        </section>

        <section className="mobileSection">
          <div className="mobileListSectionHead">
            <h3>Техзаявки</h3>
            <span className="mobileSectionCount">{activeTechRequests.length}</span>
          </div>
          <div className="mobileListSurface">
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
            </article>)}
          </div>
          </div>
        </section>

        <section className="mobileSection">
          <div className="mobileListSectionHead">
            <h3>Выполнено</h3>
            <span className="mobileSectionCount">{completedTasks.length + finishedTechRequests.length}</span>
          </div>
          <div className="mobileListSurface">
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
                <span>{techRequestStatuses[request.status] || request.status}</span>
              </div>
              <span className={`badge ${request.status}`}>{request.manager_comment || 'Без комментария'}</span>
            </div>)}
          </div>
          </div>
        </section>
        {techMsg && <div className="notice mobileInlineNotice">{techMsg}</div>}
      </div>

      {showTechForm && <MobileSheetModal
        title="Техзаявка"
        subtitle="Опишите проблему для менеджера"
        onClose={() => {
          setShowTechForm(false);
          onCloseComposer?.();
        }}
        className="mobileFormSheet"
        footer={<Button form="tech-request-form" className="mobilePrimaryButton">Отправить техзаявку</Button>}
      >
        <form id="tech-request-form" className="form" onSubmit={createTechRequest}>
          <Field label="Тема заявки" value={techForm.title} onChange={(e: any) => setTechForm({ ...techForm, title: e.target.value })} placeholder="Например: вызвать мастера по холодильнику" />
          <Select label="Тип проблемы" value={techForm.category} onChange={(e: any) => setTechForm({ ...techForm, category: e.target.value })}>
            {Object.entries(techRequestCategories).map(([key, value]) => <option key={key} value={key}>{value}</option>)}
          </Select>
          <Textarea label="Что случилось" value={techForm.description} onChange={(e: any) => setTechForm({ ...techForm, description: e.target.value })} placeholder="Опишите проблему" />
        </form>
      </MobileSheetModal>}
    </>;
  }

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
      </div>)}</div>
    </Card>
  </>;
}

function Knowledge({ user, admin = false }: any) {
  const [categories, setCategories] = useState<any[]>([]);
  const [stats, setStats] = useState<any[]>([]);
  const [openDoc, setOpenDoc] = useState<any>(null);
  const [search, setSearch] = useState('');
  const [catForm, setCatForm] = useState<any>({ title: '', allowed_roles: ['waiter'] });
  const [docForm, setDocForm] = useState<any>({ category_id: '', title: '', content: '', allowed_roles: ['waiter'], requires_acknowledgement: true });
  async function load() { const cats = await api('/api/knowledge'); setCategories(cats); if (admin) setStats(await api('/api/admin/knowledge/stats')); }
  useEffect(() => { load(); }, []);
  async function viewDoc(doc: any) { setOpenDoc(doc); await api(`/api/knowledge/${doc.id}/view`, { method: 'POST', body: '{}' }); }
  async function ack(doc: any) { await api(`/api/knowledge/${doc.id}/ack`, { method: 'POST', body: '{}' }); setOpenDoc({ ...doc, acknowledged: true }); load(); }
  async function createCat(e: FormEvent) { e.preventDefault(); await api('/api/admin/knowledge/categories', { method: 'POST', body: JSON.stringify(catForm) }); setCatForm({ title: '', allowed_roles: ['waiter'] }); load(); }
  async function createDoc(e: FormEvent) { e.preventDefault(); await api('/api/admin/knowledge/documents', { method: 'POST', body: JSON.stringify(docForm) }); setDocForm({ ...docForm, title: '', content: '' }); load(); }

  if (!admin) {
    const visibleCategories = categories
      .map((category) => ({
        ...category,
        documents: category.documents.filter((document: any) => {
          const haystack = `${document.title} ${document.content || ''}`.toLowerCase();
          return !search.trim() || haystack.includes(search.trim().toLowerCase());
        })
      }))
      .filter((category) => category.documents.length || !search.trim());

    return <>
      <div className="mobileSectionStack">
        <SectionTitle title="База знаний" />
        <section className="mobileSection">
          <div className="mobileListSurface mobileFilterSurface">
          <Field label="Поиск инструкций" icon="search" value={search} onChange={(e: any) => setSearch(e.target.value)} placeholder="Поиск инструкций..." />
          </div>
        </section>
        <section className="mobileSection">
          <div className="mobileKnowledgeGrid">
            {visibleCategories.map((category) => <section key={category.id} className="mobileKnowledgeSection">
              <div className="mobileListSectionHead">
                <div className="mobileKnowledgeSectionTitle">
                  <div className="mobileKnowledgeDocIcon"><AppIcon name="folder" className="navIcon" /></div>
                  <h3>{category.title}</h3>
                </div>
                <span className="mobileSectionCount">{category.documents.length}</span>
              </div>
              <div className="mobileListSurface">
                <div className="mobileKnowledgeDocs">
                  {category.documents.map((document: any) => <button key={document.id} type="button" className="mobileKnowledgeDoc" onClick={() => viewDoc(document)}>
                    <div className="mobileKnowledgeDocIcon"><AppIcon name="file" className="navIcon" /></div>
                    <div className="mobileKnowledgeDocCopy">
                      <strong>{document.title}</strong>
                      <span>{document.acknowledged ? 'Ознакомлен' : document.requires_acknowledgement ? 'Нужно ознакомиться' : 'Документ'}</span>
                    </div>
                    <AppIcon name="chevron" className="navIcon" />
                  </button>)}
                </div>
              </div>
            </section>)}
            {visibleCategories.length === 0 && <Empty text="Ничего не найдено по этому запросу" />}
          </div>
        </section>
      </div>
      {openDoc && <MobileSheetModal
        title={openDoc.title}
        subtitle={openDoc.acknowledged ? 'Документ изучен' : openDoc.requires_acknowledgement ? 'Требуется подтверждение' : 'Документ'}
        onClose={() => setOpenDoc(null)}
        fullScreen
        className="mobileReaderModal"
        footer={openDoc.requires_acknowledgement && !openDoc.acknowledged
          ? <Button onClick={() => ack(openDoc)} className="mobilePrimaryButton">Ознакомился</Button>
          : null}
      >
        <pre className="mobileDocReaderContent">{openDoc.content}</pre>
      </MobileSheetModal>}
    </>;
  }

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
