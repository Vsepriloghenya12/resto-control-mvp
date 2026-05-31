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
import { Tasks } from './modules/tasks/Tasks';
import { cx } from './lib/cx';
import { APP_UPDATE_AVAILABLE_EVENT, applyAppUpdateNow, type AppVersionInfo } from './app-updates';
import { initialTabFromUrl, requestPwaInstall } from './pwa-install';
import { enablePushNotifications } from './push-notifications';
import {
  checklistRunStatuses,
  checklistRoles,
  checklistTypes,
  checklistRoleMatchesUser,
  departments,
  executableRoles,
  inventorySections,
  problemTypeLabels,
  roles,
  seniorRoles,
  techRequestCategories,
  techRequestStatuses,
  targetTypeLabels,
  taskRecipientRolesFor,
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
type WorkspaceModalKind = 'notifications' | 'support' | 'billing' | 'restaurant' | null;
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

type AdminOverviewPanelKey = 'employees' | 'shifts' | 'checklists' | 'tasks' | 'problems' | 'documents' | 'inventory';


function inputDateKey(value?: string | Date) {
  const date = value instanceof Date ? value : value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function shiftInputDate(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const brandLogoSrc = '/resto-control-logo.png';

const subscriptionTariffs = [
  { id: 'start', title: 'Старт', employees: 'до 10 сотрудников', price: '1 490 ₽', period: '/ мес', note: 'Счёт на оплату, закрывающие документы', featured: false },
  { id: 'team20', title: 'Команда 20', employees: 'до 20 сотрудников', price: '1 990 ₽', period: '/ мес', note: 'Для небольшой команды с запасом роста', featured: false },
  { id: 'standard', title: 'Стандарт', employees: 'до 30 сотрудников', price: '2 990 ₽', period: '/ мес', note: 'Оптимально для одного ресторана', featured: true },
  { id: 'team40', title: 'Команда 40', employees: 'до 40 сотрудников', price: '3 990 ₽', period: '/ мес', note: 'Для растущей команды ресторана', featured: false },
  { id: 'team50', title: 'Команда 50', employees: 'до 50 сотрудников', price: '4 990 ₽', period: '/ мес', note: 'Для большого зала и кухни', featured: false },
  { id: 'team60', title: 'Команда 60', employees: 'до 60 сотрудников', price: '5 990 ₽', period: '/ мес', note: 'Для плотных смен и расширенной команды', featured: false },
  { id: 'network', title: 'Сеть', employees: 'до 100 сотрудников', price: '9 990 ₽', period: '/ мес', note: 'Для нескольких смен и большой команды', featured: false },
  { id: 'enterprise', title: 'Enterprise', employees: '100+ сотрудников', price: 'Индивидуально', period: '', note: 'Индивидуальный договор и условия', featured: false }
];
const billingStatusLabels: Record<string, string> = {
  issued: 'выставлен',
  paid: 'оплачен',
  transfer_pending: 'ожидает перевода',
  payment_reported: 'клиент оплатил',
  payment_rejected: 'платёж не найден',
  payment_document_attached: 'поручение прикреплено',
  cancelled: 'отменён'
};
const supportStatusLabels: Record<string, string> = {
  open: 'новое',
  answered: 'отвечено',
  closed: 'закрыто'
};

function billingStatusLabel(status: string) {
  return billingStatusLabels[status] || status || 'нет';
}

function supportStatusLabel(status: string) {
  return supportStatusLabels[status] || status || 'новое';
}

function supportUnreadTotal(tickets: any[], field: 'client_unread_count' | 'platform_unread_count') {
  return tickets.reduce((total, ticket) => total + Number(ticket?.[field] || 0), 0);
}

function transferValue(value: any) {
  return String(value || '').trim() || '—';
}

function planCardFromBillingPlan(plan: any) {
  const fallback = subscriptionTariffs.find((tariff) => tariff.id === plan.id);
  const amount = Number(plan.monthly_amount || 0);
  return {
    id: plan.id,
    title: plan.title,
    employees: plan.employees ? `до ${plan.employees} сотрудников` : 'Индивидуально',
    price: amount > 0 ? `${amount.toLocaleString('ru-RU')} ₽` : 'Индивидуально',
    period: amount > 0 ? '/ мес' : '',
    note: fallback?.note || 'Счёт на оплату, закрывающие документы',
    featured: fallback?.featured || false
  };
}

function TariffPlans({ plans, selectedPlan, onSelect, showEnterprise = true }: { plans?: any[]; selectedPlan?: string; onSelect?: (planId: string) => void; showEnterprise?: boolean }) {
  const tariffs = (plans?.length ? plans.map(planCardFromBillingPlan) : subscriptionTariffs)
    .filter((tariff) => showEnterprise || tariff.id !== 'enterprise');
  return <div className="tariffGrid">
    {tariffs.map((tariff) => {
      const clickable = Boolean(onSelect && tariff.id !== 'enterprise');
      const content = <>
        {tariff.featured && <span className="tariffBadge">Популярный</span>}
        <div className="tariffCardHead">
          <strong>{tariff.title}</strong>
          <span>{tariff.employees}</span>
        </div>
        <div className="tariffPrice">
          <b>{tariff.price}</b>
          {tariff.period && <em>{tariff.period}</em>}
        </div>
      </>;
      const className = cx('tariffCard', clickable && 'clickable', tariff.featured && 'featured', selectedPlan === tariff.id && 'selected');
      return clickable
        ? <button type="button" className={className} key={tariff.id} onClick={() => onSelect?.(tariff.id)} aria-pressed={selectedPlan === tariff.id}>{content}</button>
        : <div className={className} key={tariff.id}>{content}</div>;
    })}
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
        <button type="button" className="iconBtn" onClick={onClose} aria-label="Закрыть">×</button>
      </div>
      {text && <p className="infoModalText">{text}</p>}
      {details}
      {actions.length > 0 && <div className="actions">
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
      </div>}
    </div>
  </div>;
}

function SupportConversationList({ tickets, replyValues, onReplyChange, onReply, onStatusChange, onRead, admin = false }: any) {
  if (!tickets.length) return <Empty text="Обращений пока нет" />;
  return <div className="supportTicketList">
    {tickets.map((ticket: any) => {
      const unreadCount = Number(admin ? ticket.platform_unread_count : ticket.client_unread_count) || 0;
      const restaurantName = ticket.restaurant?.name || 'Ресторан';
      return <details className="compactAccordion supportTicket" key={ticket.id} onToggle={(e: any) => { if (e.currentTarget.open) onRead?.(ticket.id); }}>
      <summary className="compactAccordionSummary">
        <span><b>{admin ? `${restaurantName}: ${ticket.subject}` : ticket.subject}</b><small>{admin ? ticket.created_by_user?.name || 'Клиент' : restaurantName} · {fmtDate(ticket.updated_at || ticket.created_at)}</small></span>
        <span className="supportSummaryBadges">
          <em>{supportStatusLabel(ticket.status)}</em>
          {unreadCount > 0 && <b className="supportUnreadBadge">{unreadCount}</b>}
        </span>
      </summary>
      <div className="compactAccordionBody supportThread">
        {(ticket.messages || []).map((message: any) => <article className={cx('supportMessage', message.author_type === 'platform' && 'platform')} key={message.id}>
          <div className="supportMessageHead"><b>{message.author_type === 'platform' ? 'Техподдержка' : message.user?.name || 'Клиент'}</b><span>{fmtDate(message.created_at)}</span></div>
          <p>{message.body}</p>
        </article>)}
        {ticket.status !== 'closed' && <form className="supportReplyForm" onSubmit={(e) => { e.preventDefault(); onReply(ticket.id); }}>
          <Textarea label={admin ? 'Ответ клиенту' : 'Сообщение в поддержку'} value={replyValues[ticket.id] || ''} onChange={(e: any) => onReplyChange(ticket.id, e.target.value)} placeholder={admin ? 'Напишите ответ' : 'Дополните обращение'} />
          <div className="actions adminFormActions"><Button type="submit">{admin ? 'Ответить' : 'Отправить'}</Button></div>
        </form>}
        {admin && <div className="actions compact">
          {ticket.status !== 'closed' ? <Button type="button" kind="soft" onClick={() => onStatusChange(ticket.id, 'closed')}>Закрыть</Button> : <Button type="button" kind="soft" onClick={() => onStatusChange(ticket.id, 'open')}>Открыть снова</Button>}
        </div>}
      </div>
    </details>;
    })}
  </div>;
}

function ClientSupportPanel({ onUnreadChange }: { onUnreadChange?: (count: number) => void } = {}) {
  const [tickets, setTickets] = useState<any[]>([]);
  const [form, setForm] = useState({ subject: '', body: '' });
  const [replyValues, setReplyValues] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    const next = await api('/api/support/tickets');
    setTickets(next);
    onUnreadChange?.(supportUnreadTotal(next, 'client_unread_count'));
  }

  useEffect(() => {
    load().catch(() => setTickets([]));
    const timer = window.setInterval(() => load().catch(() => setTickets([])), 30000);
    return () => window.clearInterval(timer);
  }, []);

  async function createTicket(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      await api('/api/support/tickets', { method: 'POST', body: JSON.stringify(form) });
      setForm({ subject: '', body: '' });
      setMessage('Обращение отправлено');
      await load();
    } catch (error: any) {
      setMessage(error.message || 'Не удалось отправить обращение');
    } finally {
      setBusy(false);
    }
  }

  async function sendReply(ticketId: string) {
    const body = String(replyValues[ticketId] || '').trim();
    if (!body) return;
    setBusy(true);
    setMessage('');
    try {
      await api(`/api/support/tickets/${ticketId}/messages`, { method: 'POST', body: JSON.stringify({ body }) });
      setReplyValues((current) => ({ ...current, [ticketId]: '' }));
      await load();
    } catch (error: any) {
      setMessage(error.message || 'Не удалось отправить сообщение');
    } finally {
      setBusy(false);
    }
  }

  async function markRead(ticketId: string) {
    const next = tickets.map((ticket) => ticket.id === ticketId ? { ...ticket, client_unread_count: 0 } : ticket);
    setTickets(next);
    onUnreadChange?.(supportUnreadTotal(next, 'client_unread_count'));
    try {
      const updated = await api(`/api/support/tickets/${ticketId}/read`, { method: 'POST', body: JSON.stringify({}) });
      const refreshed = tickets.map((ticket) => ticket.id === ticketId ? updated : ticket);
      setTickets(refreshed);
      onUnreadChange?.(supportUnreadTotal(refreshed, 'client_unread_count'));
    } catch {
      await load().catch(() => undefined);
    }
  }

  return <div className="supportPanel">
    <form className="supportCreateForm" onSubmit={createTicket}>
      <Field label="Тема" value={form.subject} onChange={(e: any) => setForm({ ...form, subject: e.target.value })} placeholder="Что нужно помочь решить" />
      <Textarea label="Сообщение" value={form.body} onChange={(e: any) => setForm({ ...form, body: e.target.value })} placeholder="Опишите вопрос или проблему" />
      <div className="actions adminFormActions"><Button type="submit" disabled={busy}>Написать в поддержку</Button></div>
    </form>
    {message && <div className={message.includes('Не удалось') ? 'error' : 'notice'}>{message}</div>}
    <SupportConversationList tickets={tickets} replyValues={replyValues} onReplyChange={(id: string, value: string) => setReplyValues((current) => ({ ...current, [id]: value }))} onReply={sendReply} onRead={markRead} />
  </div>;
}

function SuperSupportAdmin() {
  const [tickets, setTickets] = useState<any[]>([]);
  const [replyValues, setReplyValues] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    setTickets(await api('/api/super/support/tickets'));
  }

  useEffect(() => {
    load().catch(() => setTickets([]));
    const timer = window.setInterval(() => load().catch(() => setTickets([])), 30000);
    return () => window.clearInterval(timer);
  }, []);

  async function sendReply(ticketId: string) {
    const body = String(replyValues[ticketId] || '').trim();
    if (!body) return;
    setBusy(true);
    setMessage('');
    try {
      await api(`/api/super/support/tickets/${ticketId}/messages`, { method: 'POST', body: JSON.stringify({ body }) });
      setReplyValues((current) => ({ ...current, [ticketId]: '' }));
      setMessage('Ответ отправлен');
      await load();
    } catch (error: any) {
      setMessage(error.message || 'Не удалось отправить ответ');
    } finally {
      setBusy(false);
    }
  }

  async function updateStatus(ticketId: string, status: string) {
    setBusy(true);
    setMessage('');
    try {
      await api(`/api/super/support/tickets/${ticketId}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      await load();
    } catch (error: any) {
      setMessage(error.message || 'Не удалось обновить обращение');
    } finally {
      setBusy(false);
    }
  }

  async function markRead(ticketId: string) {
    const next = tickets.map((ticket) => ticket.id === ticketId ? { ...ticket, platform_unread_count: 0 } : ticket);
    setTickets(next);
    try {
      const updated = await api(`/api/super/support/tickets/${ticketId}/read`, { method: 'POST', body: JSON.stringify({}) });
      setTickets((current) => current.map((ticket) => ticket.id === ticketId ? updated : ticket));
    } catch {
      await load().catch(() => undefined);
    }
  }

  const openCount = tickets.filter((ticket) => ticket.status !== 'closed').length;
  const unreadCount = supportUnreadTotal(tickets, 'platform_unread_count');
  return <Card title="Техподдержка" right={<span className={cx('badge', unreadCount > 0 ? 'danger' : 'active')}>{unreadCount > 0 ? `${unreadCount} новых` : `${openCount} открыто`}</span>}>
    {message && <div className={message.includes('Не удалось') ? 'error compactNotice' : 'notice compactNotice'}>{message}</div>}
    <SupportConversationList
      tickets={tickets}
      replyValues={replyValues}
      onReplyChange={(id: string, value: string) => setReplyValues((current) => ({ ...current, [id]: value }))}
      onReply={sendReply}
      onStatusChange={updateStatus}
      onRead={markRead}
      admin
      busy={busy}
    />
  </Card>;
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
        <button type="button" className="iconBtn" onClick={onClose} aria-label="Закрыть">×</button>
      </div>
      {busy && <div className="notice">Подключаем камеру...</div>}
      {error && <div className="error">{error}</div>}
      {!error && <video ref={videoRef} className="cameraVideo" autoPlay playsInline muted />}
      <div className="actions cameraActions">
        <Button type="button" kind="soft" onClick={onClose}>Отмена</Button>
        <Button type="button" disabled={busy || !!error} onClick={takePhoto}>Сделать фото</Button>
      </div>
    </div>
  </div>;
}

function AppUpdateBanner({ update, onDismiss }: { update: AppVersionInfo | null; onDismiss: () => void }) {
  if (!update) return null;
  return <div className="appUpdateBanner" role="status">
    <span><b>Доступно обновление</b><small>Новая версия программы готова к установке</small></span>
    <button type="button" className="appUpdateButton" onClick={() => void applyAppUpdateNow(update)}>Обновить</button>
    <button type="button" className="appUpdateDismiss" onClick={onDismiss} aria-label="Скрыть обновление">×</button>
  </div>;
}

async function runPwaInstall(mode: 'app' | 'bookings') {
  const result = await requestPwaInstall(mode);
  if (result.message) window.alert(result.message);
}

async function runPushNotificationsEnable() {
  try {
    window.alert(await enablePushNotifications());
  } catch (error: any) {
    window.alert(error?.message || 'Не удалось включить уведомления');
  }
}

export default function App() {
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [availableUpdate, setAvailableUpdate] = useState<AppVersionInfo | null>(null);

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
  useEffect(() => {
    const onUpdate = (event: Event) => setAvailableUpdate((event as CustomEvent<AppVersionInfo>).detail || {});
    window.addEventListener(APP_UPDATE_AVAILABLE_EVENT, onUpdate);
    return () => window.removeEventListener(APP_UPDATE_AVAILABLE_EVENT, onUpdate);
  }, []);

  function onLogout() {
    clearToken();
    setSession(null);
  }

  async function switchRestaurant(restaurantId: string) {
    if (!restaurantId || restaurantId === session?.restaurant?.id) return;
    const data = await api('/api/auth/switch-restaurant', { method: 'POST', body: JSON.stringify({ restaurant_id: restaurantId }) });
    setToken(data.token);
    setSession(data);
  }

  function updateSession(data: any) {
    if (data?.token) setToken(data.token);
    setSession(data);
  }

  if (loading) return <>
    <div className="splash">
      <img className="splashLogo" src={brandLogoSrc} alt="Resto Control" />
      <b>Загружаем Resto Control</b>
      <span>Подготавливаем рабочее пространство</span>
    </div>
    <AppUpdateBanner update={availableUpdate} onDismiss={() => setAvailableUpdate(null)} />
  </>;
  if (!session) return <>
    <AuthScreen onLogin={(data: any) => { setToken(data.token); setSession(data); }} error={error} setError={setError} />
    <AppUpdateBanner update={availableUpdate} onDismiss={() => setAvailableUpdate(null)} />
  </>;

  const user = session.user;
  return <div className="appShell">
    {user.is_super_admin
      ? <SuperAdmin user={user} onLogout={onLogout} />
      : ['owner', 'manager'].includes(user.role)
        ? <RestaurantAdmin user={user} restaurant={session.restaurant} restaurants={session.restaurants || []} onRestaurantSwitch={switchRestaurant} onRestaurantCreated={updateSession} onLogout={onLogout} />
        : <EmployeeApp user={user} restaurant={session.restaurant} onLogout={onLogout} />}
    <AppUpdateBanner update={availableUpdate} onDismiss={() => setAvailableUpdate(null)} />
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

function WorkspaceNotificationsPanel({ onBilling, onChanged }: { onBilling: () => void; onChanged?: () => void }) {
  const [items, setItems] = useState<any[]>([]);
  const unread = items.filter(item => !item.read_at).length;
  async function load() { setItems(await api('/api/notifications')); }
  useEffect(() => { load().catch(() => setItems([])); }, []);
  async function markAllRead() {
    await api('/api/notifications/read-all', { method: 'POST', body: '{}' });
    await load();
    onChanged?.();
  }

  return <div className="mobileListSurface mobileNotificationList">
    {items.length === 0 && <Empty text="Уведомлений пока нет" />}
    {items.map(item => <article key={item.id} className={cx('mobileNotificationItem', !item.read_at && 'unread')}>
      <div><strong>{item.title}</strong><span>{item.body || 'Новое событие'} · {fmtDate(item.created_at)}</span></div>
      {item.entity_type === 'billing_invoice' && <Button type="button" kind="soft" onClick={onBilling}>{String(item.title || '').includes('не прош') ? 'Прикрепить' : 'Открыть оплату'}</Button>}
      {!item.read_at && <span className="mobileNotificationDot" />}
    </article>)}
    {items.length > 0 && <div className="actions adminFormActions"><Button type="button" kind="soft" onClick={markAllRead}>{unread > 0 ? 'Отметить прочитанными' : 'Обновить'}</Button></div>}
  </div>;
}

function ShiftControl({ user, onChanged }: { user: any; onChanged?: () => void }) {
  const [shiftState, setShiftState] = useState<any>({ current: null, last_closed: null });
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  async function load() { try { setShiftState(await api('/api/shifts/current')); } catch { setShiftState({ current: null, last_closed: null }); } }
  useEffect(() => { load(); }, []);
  async function startShift() {
    setMsg('');
    setBusy(true);
    try {
      const result = await api('/api/shifts/start', { method: 'POST', body: JSON.stringify({ location: departments[user.department] || '' }) });
      setMsg(result?.offline ? 'Смена сохранена офлайн' : 'Смена начата');
      await load();
      onChanged?.();
    } catch (error: any) {
      setMsg(error.message);
    } finally {
      setBusy(false);
    }
  }
  const current = shiftState.current;
  return <section className={cx('mobileShiftCard', current && 'active')}>
    <div className="mobileShiftCardHead"><div><span>{roles[user.role]} · {departments[user.department]}</span><strong>{current ? 'Смена идёт' : 'Смена не начата'}</strong></div><span className={cx('badge', current ? 'active' : 'trial')}>{current ? 'активна' : 'начать'}</span></div>
    <p>{current ? `Начата ${fmtDate(current.opened_at)}. Закрытие произойдёт после чек-листа закрытия смены.` : shiftState.last_closed ? `Последняя смена: ${fmtDate(shiftState.last_closed.closed_at)}` : 'Начните смену перед чек-листами и задачами.'}</p>
    <div className="mobileShiftActions">{current ? <span className="mobileShiftNote">Закрывается чек-листом</span> : <Button type="button" disabled={busy} onClick={startShift}>{busy ? 'Начинаем...' : 'Начать смену'}</Button>}</div>
    {msg && <div className={msg.includes('начата') || msg.includes('офлайн') ? 'notice mobileInlineNotice' : 'error mobileInlineNotice'}>{msg}</div>}
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
    if (problem.type === 'tech_request' || problem.type === 'task') onNavigate?.('tasks');
    else if (problem.type === 'checklist_run') onNavigate?.('checklists');
  }
  return <><Card title="Пульт контроля" right={<Button type="button" kind="soft" onClick={() => download('/api/admin/reports/operations.csv', 'operations-report.csv')}>Экспорт CSV</Button>}>
    <div className="problemMetrics">
      <button type="button" onClick={() => onNavigate?.('checklists')}><strong>{metrics.open_shifts || 0}</strong><span>смен сейчас</span></button>
      <button type="button" onClick={() => onNavigate?.('tasks')}><strong>{metrics.overdue_tasks || 0}</strong><span>просрочено</span></button>
      <button type="button" onClick={() => onNavigate?.('tasks')}><strong>{metrics.new_tech_requests || 0}</strong><span>новых проблем</span></button>
      <button type="button" onClick={() => onNavigate?.('tasks')}><strong>{metrics.not_done_tech_requests || metrics.open_tech_requests || 0}</strong><span>невыполненных</span></button>
      <button type="button" onClick={() => onNavigate?.('tasks')}><strong>{metrics.in_progress_tech_requests || 0}</strong><span>в работе</span></button>
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
      <p className="authLead">Чек-листы, инвентаризация, задачи, проблемы и сервис-бук для ресторанов.</p>
      <div className="switcher">
        <button type="button" className={view === 'login' ? 'active' : ''} onClick={() => switchView('login')}>Войти</button>
        <button type="button" className={view === 'register' ? 'active' : ''} onClick={() => switchView('register')}>14 дней бесплатно</button>
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
        <Button type="submit" disabled={busy}>{busy ? 'Проверяем...' : view === 'login' ? 'Войти' : 'Создать ресторан'}</Button>
      </form>
    </div>
  </main>;
}

const navIcons: Record<string, IconName> = {
  overview: 'overview',
  users: 'users',
  checklists: 'checklists',
  bookings: 'bookings',
  inventory: 'inventory',
  tasks: 'tasks',
  knowledge: 'knowledge',
  support: 'support',
  restaurants: 'overview',
  payments: 'trial',
  billingSettings: 'trial',
  create: 'spark',
  today: 'overview'
};

function withIcons(tabs: { id: string; title: string }[]): NavTab[] {
  return tabs.map(tab => ({ ...tab, icon: navIcons[tab.id] || 'overview' }));
}

function Nav({ tabs, active, setActive }: { tabs: NavTab[]; active: string; setActive: (v: string) => void }) {
  return <nav className="tabs">{tabs.map(t => <button key={t.id} type="button" className={active === t.id ? 'active' : ''} onClick={() => setActive(t.id)}>
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
  restaurants = [],
  tabs,
  active,
  setActive,
  onLogout,
  onRestaurantSwitch,
  onRestaurantCreated,
  banner,
  onBillingPlanSelect,
  children
}: {
  user: any;
  restaurant: any;
  restaurants?: any[];
  tabs: NavTab[];
  active: string;
  setActive: (next: string) => void;
  onLogout: () => void;
  onRestaurantSwitch?: (restaurantId: string) => void | Promise<void>;
  onRestaurantCreated?: (session: any) => void;
  banner: (openBilling: () => void) => any;
  onBillingPlanSelect?: (planId: string) => void;
  children: any;
}) {
  const [modalKind, setModalKind] = useState<WorkspaceModalKind>(null);
  const [sheet, setSheet] = useState<MobileSheetKind>(null);
  const [supportUnread, setSupportUnread] = useState(0);
  const [notificationCount, setNotificationCount] = useState(0);
  const [restaurantForm, setRestaurantForm] = useState({ name: '', city: restaurant?.city || '', phone: restaurant?.phone || '', email: restaurant?.email || '' });
  const [restaurantMsg, setRestaurantMsg] = useState('');
  const [restaurantBusy, setRestaurantBusy] = useState(false);

  async function loadSupportUnread() {
    if (!['owner', 'manager'].includes(user.role)) {
      setSupportUnread(0);
      return;
    }
    try {
      const tickets = await api('/api/support/tickets');
      setSupportUnread(supportUnreadTotal(tickets, 'client_unread_count'));
    } catch {
      setSupportUnread(0);
    }
  }

  useEffect(() => {
    loadSupportUnread();
    const timer = window.setInterval(loadSupportUnread, 30000);
    return () => window.clearInterval(timer);
  }, [user.role, user.restaurant_id]);

  async function refreshNotifications() {
    try {
      const notifications = await api('/api/notifications').catch(() => []);
      setNotificationCount(notifications.filter((item: any) => !item.read_at).length);
    } catch {
      setNotificationCount(0);
    }
  }

  useEffect(() => { refreshNotifications(); }, [active, user.restaurant_id]);

  function openNotifications() {
    setModalKind('notifications');
  }

  function openSupport() {
    setModalKind('support');
  }

  function openBilling() {
    setModalKind('billing');
  }

  function openRestaurantCreate() {
    setRestaurantForm({ name: '', city: restaurant?.city || '', phone: restaurant?.phone || '', email: restaurant?.email || '' });
    setRestaurantMsg('');
    setModalKind('restaurant');
  }

  function closeModal() {
    setModalKind(null);
  }

  async function submitRestaurantCreate(event: FormEvent) {
    event.preventDefault();
    setRestaurantBusy(true);
    setRestaurantMsg('');
    try {
      const data = await api('/api/owner/restaurants', { method: 'POST', body: JSON.stringify(restaurantForm) });
      onRestaurantCreated?.(data);
      setRestaurantMsg('Ресторан добавлен');
      closeModal();
    } catch (error: any) {
      setRestaurantMsg(error?.message || 'Не удалось добавить ресторан');
    } finally {
      setRestaurantBusy(false);
    }
  }

  const modal: { title: string; text?: string; details?: ReactNode; actions: { label: string; kind?: string; onClick: () => void }[] } | null = modalKind === 'notifications'
    ? {
        title: 'Центр действий',
        details: <WorkspaceNotificationsPanel onBilling={() => {
          setActive('billing');
          closeModal();
        }} onChanged={refreshNotifications} />,
        actions: [
          { label: 'Открыть оплату', kind: 'primary', onClick: () => setActive('billing') },
          { label: 'Открыть задачи', onClick: () => setActive('tasks') }
        ]
      }
    : modalKind === 'support'
      ? {
          title: 'Техподдержка',
          text: 'Напишите владельцу приложения, если нужна помощь с оплатой, доступом или работой сервиса.',
          details: <ClientSupportPanel onUnreadChange={setSupportUnread} />,
          actions: []
        }
      : modalKind === 'billing'
        ? {
            title: 'Оплата и документы',
            details: <TariffPlans
              selectedPlan={restaurant?.plan}
              onSelect={(planId) => {
                onBillingPlanSelect?.(planId);
                setActive('billing');
                closeModal();
              }}
            />,
            actions: [
              { label: 'Открыть оплату', kind: 'primary', onClick: () => setActive('billing') },
              { label: 'Открыть обзор', onClick: () => setActive('overview') }
            ]
          }
        : null;
  const restaurantCreateForm = <form className="form two compactAdminForm" onSubmit={submitRestaurantCreate}>
    <Field label="Название ресторана" value={restaurantForm.name} onChange={(e: any) => setRestaurantForm({ ...restaurantForm, name: e.target.value })} />
    <Field label="Город" value={restaurantForm.city} onChange={(e: any) => setRestaurantForm({ ...restaurantForm, city: e.target.value })} />
    <Field label="Телефон" value={restaurantForm.phone} onChange={(e: any) => setRestaurantForm({ ...restaurantForm, phone: e.target.value })} />
    <Field label="Эл. почта" value={restaurantForm.email} onChange={(e: any) => setRestaurantForm({ ...restaurantForm, email: e.target.value })} />
    <div className="formActionsWide">
      <Button type="button" kind="soft" onClick={closeModal}>Отмена</Button>
      <Button type="submit" disabled={restaurantBusy}>{restaurantBusy ? 'Создаём...' : 'Добавить ресторан'}</Button>
    </div>
    {restaurantMsg && <div className={restaurantMsg.includes('добав') ? 'notice compactNotice formNoticeWide' : 'error compactNotice formNoticeWide'}>{restaurantMsg}</div>}
  </form>;

  const activeModal = modalKind === 'restaurant'
    ? { title: 'Добавить ресторан', text: 'Новый ресторан получит отдельные сотрудники, чек-листы, базу знаний и данные. Вход владельца останется тем же.', details: restaurantCreateForm, actions: [] }
    : modal;

  const managerMode = user.role === 'manager';
  const showMobileWorkspace = true;
  const ownerRestaurants = user.role === 'owner' ? restaurants.filter(Boolean) : [];
  const showRestaurantTabs = ownerRestaurants.length > 1;

  const mobileNavItems: MobileNavItem[] = [
    { id: 'overview', title: 'Обзор', icon: 'overview', active: active === 'overview', onClick: () => setActive('overview') },
    { id: 'bookings', title: 'Брони', icon: 'bookings', active: active === 'bookings', onClick: () => setActive('bookings') },
    { id: 'tasks', title: 'Проблемы', icon: 'tasks', active: active === 'tasks', onClick: () => setActive('tasks') },
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
      { id: 'tasks', title: 'Создать задачу', subtitle: 'Поставить задачу команде', icon: 'tasks', onClick: () => setActive('tasks') },
      { id: 'assign-inventory', title: 'Назначить инвентаризацию', subtitle: 'Выдать бланк подразделению', icon: 'inventory', onClick: () => setActive('inventory') }
    ]
    : [
      { id: 'users', title: 'Добавить сотрудника', subtitle: 'Открыть управление доступами', icon: 'users', onClick: () => setActive('users') },
      { id: 'assign-inventory', title: 'Назначить инвентаризацию', subtitle: 'Выдать бланк подразделению', icon: 'inventory', onClick: () => setActive('inventory') },
      { id: 'inventory', title: 'Добавить товар', subtitle: 'Открыть номенклатуру', icon: 'inventory', onClick: () => setActive('inventory') }
    ];

  const mobileProfileItems: MobileActionItem[] = managerMode
    ? [
      { id: 'support', title: 'База знаний', subtitle: 'Инструкции и документы', icon: 'knowledge', onClick: () => setActive('knowledge') },
      { id: 'billing', title: 'Оплата и документы', subtitle: 'Счета, реквизиты, акты', icon: 'trial', onClick: () => setActive('billing') },
      { id: 'install-app', title: 'Установить на телефон', subtitle: 'Добавить приложение на главный экран', icon: 'phone', onClick: () => void runPwaInstall('app') },
      { id: 'push', title: 'Уведомления телефона', subtitle: 'Задачи и комментарии с текстом', icon: 'notification', onClick: () => void runPushNotificationsEnable() },
      { id: 'install-bookings', title: 'Установить план зала', subtitle: 'Ярлык сразу откроет брони и столы', icon: 'bookings', onClick: () => {
        setActive('bookings');
        void runPwaInstall('bookings');
      } },
      { id: 'logout', title: 'Выйти', subtitle: 'Завершить рабочую сессию', icon: 'logout', onClick: onLogout }
    ]
    : [
      { id: 'support', title: 'База знаний', subtitle: 'Инструкции и документы', icon: 'knowledge', onClick: () => setActive('knowledge') },
      { id: 'billing', title: 'Оплата и документы', subtitle: 'Счета, реквизиты, акты', icon: 'trial', onClick: () => setActive('billing') },
      { id: 'install-app', title: 'Установить на телефон', subtitle: 'Добавить приложение на главный экран', icon: 'phone', onClick: () => void runPwaInstall('app') },
      { id: 'push', title: 'Уведомления телефона', subtitle: 'Задачи и комментарии с текстом', icon: 'notification', onClick: () => void runPushNotificationsEnable() },
      { id: 'install-bookings', title: 'Установить план зала', subtitle: 'Ярлык сразу откроет брони и столы', icon: 'bookings', onClick: () => {
        setActive('bookings');
        void runPwaInstall('bookings');
      } },
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
      supportBadgeCount={supportUnread}
    />
    <section className="workspaceMain">
      {showMobileWorkspace && <div className="mobileWorkspaceChrome">
        <MobileHeader
          mode={active === 'overview' ? 'overview' : 'page'}
          title={active === 'overview' ? <>Добро пожаловать, <em>{user.name}</em></> : mobileTabTitle(active, tabs)}
          subtitle={active === 'overview' ? `${roles[user.role]} в рабочем кабинете` : restaurant?.name}
          logoSrc={brandLogoSrc}
          userInitials={userInitials(user.name)}
          notificationCount={notificationCount}
          onMenu={() => setSheet('menu')}
          onBack={() => setActive('overview')}
          onNotifications={() => setActive('tasks')}
          onAction={() => setSheet('profile')}
        />
        {showRestaurantTabs && <RestaurantSwitcher restaurants={ownerRestaurants} activeRestaurantId={restaurant?.id} onSelect={onRestaurantSwitch} compact />}
      </div>}

      <div className="desktopWorkspaceChrome">
        <WorkspaceHeader
          userName={user.name}
          roleLabel={`${roles[user.role]} в рабочем кабинете`}
          onLogout={onLogout}
          onNotifications={openNotifications}
          notificationCount={notificationCount}
          extraActions={user.role === 'owner' ? <Button type="button" kind="soft" icon="plus" onClick={openRestaurantCreate}>Добавить ресторан</Button> : null}
        />
        <div className="workspaceSubline">{restaurant?.name}</div>
        {showRestaurantTabs && <RestaurantSwitcher restaurants={ownerRestaurants} activeRestaurantId={restaurant?.id} onSelect={onRestaurantSwitch} />}
        <div className="mobileTabsWrap">
          <Nav tabs={tabs} active={active} setActive={setActive} />
        </div>
      </div>

      <div className="pageContainer workspacePageContainer">
        {banner(openBilling)}
        <div className="workspaceContent">{children}</div>
      </div>
    </section>
    {activeModal && <WorkspaceInfoModal title={activeModal.title} text={activeModal.text} details={activeModal.details} actions={activeModal.actions} onClose={closeModal} />}
    {showMobileWorkspace && <>
      <BottomNavigation items={mobileNavItems} onCreate={() => setSheet('create')} />
      <BottomSheet open={sheet === 'menu'} title="Разделы кабинета" items={mobileMenuItems} onClose={() => setSheet(null)} />
      <BottomSheet open={sheet === 'create'} title="Быстрые действия" items={mobileCreateItems} onClose={() => setSheet(null)} />
      <BottomSheet open={sheet === 'profile'} title="Профиль и доступ" items={mobileProfileItems} onClose={() => setSheet(null)} />
    </>}
  </main>;
}

function RestaurantSwitcher({ restaurants, activeRestaurantId, onSelect, compact = false }: { restaurants: any[]; activeRestaurantId?: string; onSelect?: (restaurantId: string) => void | Promise<void>; compact?: boolean }) {
  return <div className={cx('restaurantTabs', compact && 'compact')} role="tablist" aria-label="Рестораны владельца">
    {restaurants.map((item) => {
      const active = item.id === activeRestaurantId;
      return <button
        type="button"
        role="tab"
        aria-selected={active}
        className={cx('restaurantTab', active && 'active')}
        key={item.id}
        onClick={() => !active && onSelect?.(item.id)}
      >
        <span>{item.name || 'Ресторан'}</span>
        {!compact && <small>{item.city || item.owner_name || 'Отдельная база'}</small>}
      </button>;
    })}
  </div>;
}

function SuperAdmin({ user, onLogout }: any) {
  const [tab, setTab] = useState<Tab>('restaurants');
  const [restaurants, setRestaurants] = useState<any[]>([]);
  const [billingInvoices, setBillingInvoices] = useState<any[]>([]);
  const [billingSettingsForm, setBillingSettingsForm] = useState<any>({ seller_requisites: {}, transfer_requisites: {} });
  const [issueInvoiceForm, setIssueInvoiceForm] = useState<any>({ restaurant_id: '', plan: 'standard', months: 1, period_start: new Date().toISOString().slice(0, 10) });
  const [form, setForm] = useState<any>({ name: '', owner_name: '', city: '', phone: '', email: '', login: '', password: '' });
  const [msg, setMsg] = useState('');
  const [settingsMsg, setSettingsMsg] = useState('');

  async function load() {
    setRestaurants(await api('/api/super/restaurants'));
  }
  async function loadBilling() {
    setBillingInvoices(await api('/api/super/billing/invoices'));
  }
  async function loadBillingSettings() {
    const next = await api('/api/super/billing/settings');
    setBillingSettingsForm({
      seller_requisites: next.seller_requisites || {},
      transfer_requisites: next.transfer_requisites || {}
    });
  }
  useEffect(() => { load(); loadBilling(); loadBillingSettings(); }, []);
  useEffect(() => {
    if (!issueInvoiceForm.restaurant_id && restaurants[0]?.id) {
      setIssueInvoiceForm((current: any) => ({ ...current, restaurant_id: restaurants[0].id }));
    }
  }, [restaurants]);

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

  async function deleteRestaurant(restaurant: any) {
    const name = restaurant?.name || 'ресторан';
    if (!window.confirm(`Удалить ресторан "${name}" и все его данные? Это действие нельзя отменить.`)) return;
    setMsg('');
    try {
      await api(`/api/super/restaurants/${restaurant.id}`, { method: 'DELETE' });
      setMsg('Ресторан удалён');
      await load();
      await loadBilling();
    } catch (error: any) {
      setMsg(error.message || 'Не удалось удалить ресторан');
    }
  }

  async function markPaid(id: string) {
    await api(`/api/super/billing/invoices/${id}/mark-paid`, { method: 'POST', body: JSON.stringify({}) });
    load();
    loadBilling();
  }

  async function markNoPayment(id: string) {
    await api(`/api/super/billing/invoices/${id}/no-payment`, { method: 'POST', body: JSON.stringify({}) });
    load();
    loadBilling();
  }

  async function issueInvoice(e: FormEvent) {
    e.preventDefault();
    setMsg('');
    try {
      const invoice = await api('/api/super/billing/invoices', { method: 'POST', body: JSON.stringify(issueInvoiceForm) });
      setMsg(`Счёт № ${invoice.number} выставлен`);
      load();
      loadBilling();
    } catch (error: any) {
      setMsg(error.message || 'Не удалось выставить счёт');
    }
  }

  async function saveBillingSettings(e: FormEvent) {
    e.preventDefault();
    setSettingsMsg('');
    try {
      const next = await api('/api/super/billing/settings', { method: 'PATCH', body: JSON.stringify(billingSettingsForm) });
      setBillingSettingsForm({
        seller_requisites: next.seller_requisites || {},
        transfer_requisites: next.transfer_requisites || {}
      });
      setSettingsMsg('Реквизиты оплаты сохранены');
    } catch (error: any) {
      setSettingsMsg(error.message || 'Не удалось сохранить реквизиты');
    }
  }

  function money(value: any) {
    return `${Number(value || 0).toLocaleString('ru-RU')} ₽`;
  }

  function updateBillingSettings(section: 'seller_requisites' | 'transfer_requisites', key: string, value: string) {
    setBillingSettingsForm((current: any) => ({ ...current, [section]: { ...(current[section] || {}), [key]: value } }));
  }

  const sellerSettings = billingSettingsForm.seller_requisites || {};
  const transferSettings = billingSettingsForm.transfer_requisites || {};
  const paymentActionCount = billingInvoices.filter((invoice: any) => ['payment_reported', 'payment_document_attached', 'transfer_pending'].includes(invoice.status)).length;

  return <BasicWorkspace
    user={user}
    subtitle="Супер-админ создателя"
    tabs={withIcons([{ id: 'restaurants', title: 'Рестораны' }, { id: 'payments', title: paymentActionCount ? `Оплаты (${paymentActionCount})` : 'Оплаты' }, { id: 'support', title: 'Техподдержка' }, { id: 'billingSettings', title: 'Реквизиты' }, { id: 'create', title: 'Создать' }])}
    active={tab}
    setActive={setTab}
    onLogout={onLogout}
  >
    {tab === 'restaurants' && <Card title="Рестораны платформы">
      <div className="compactAccordionList superRestaurantList">
        {restaurants.length ? restaurants.map((r: any) => {
          const latestInvoice = r.latest_invoice;
          return <details className="compactAccordion" key={r.id}>
            <summary className="compactAccordionSummary superRestaurantSummary">
              <span>
                <b>{r.name}</b>
                <small>{r.city || 'Город не указан'} · {r.owner_name || 'владелец не указан'} · сотрудников: {r.users_count}</small>
              </span>
              <span className="supportSummaryBadges">
                {r.pending_transfer_count > 0 && <em className="badge transfer_pending">{r.pending_transfer_count} оплат</em>}
                <em className={cx('badge', r.computed_status)}>{subscriptionLabel(r.computed_status)}</em>
              </span>
            </summary>
            <div className="compactAccordionBody superRestaurantDetails">
              <div className="superRestaurantInfoGrid">
                <div><span>Контакты</span><b>{r.phone || 'телефон не указан'}</b><small>{r.email || 'email не указан'}</small></div>
                <div><span>Доступ</span><b>{r.plan || 'trial'}</b><small>до {fmtDate(r.subscription_ends_at || r.trial_ends_at)}</small></div>
                <div><span>Активность</span><b>{r.checklist_runs_count} чек-листов</b><small>{r.billing_invoices_count || 0} оплат</small></div>
              </div>
              {latestInvoice ? <div className="adminRowButton readonly">
                <span>
                  <b>Последняя оплата № {latestInvoice.number}</b>
                  <small>{latestInvoice.plan_title} · {money(latestInvoice.amount)} · {billingStatusLabel(latestInvoice.status)}</small>
                </span>
                {latestInvoice.receipt_url
                  ? <a className="receiptLink" href={latestInvoice.receipt_url} target="_blank" rel="noreferrer">Открыть чек</a>
                  : <em>чека нет</em>}
              </div> : <Empty text="Оплат пока нет" />}
              <div className="actions">
                <Button type="button" kind="soft" onClick={() => extend(r.id, 30)}>+30 дней</Button>
                <Button type="button" kind="danger" onClick={() => block(r.id)}>Блок</Button>
                <Button type="button" kind="danger" onClick={() => deleteRestaurant(r)}>Удалить ресторан</Button>
              </div>
            </div>
          </details>;
        }) : <Empty text="Ресторанов пока нет" />}
      </div>
      {msg && <div className={msg.includes('удал') || msg.includes('создан') ? 'notice compactNotice' : 'error compactNotice'}>{msg}</div>}
    </Card>}
    {tab === 'payments' && <div className="contentStack">
      <Card title="Выставить счёт ресторану">
        <form className="form two compactAdminForm billingInvoiceForm" onSubmit={issueInvoice}>
          <Select label="Ресторан" value={issueInvoiceForm.restaurant_id} onChange={(e: any) => setIssueInvoiceForm({ ...issueInvoiceForm, restaurant_id: e.target.value })}>
            <option value="">Выбрать ресторан</option>
            {restaurants.map((restaurant: any) => <option key={restaurant.id} value={restaurant.id}>{restaurant.name}</option>)}
          </Select>
          <Select label="Период" value={issueInvoiceForm.months} onChange={(e: any) => setIssueInvoiceForm({ ...issueInvoiceForm, months: Number(e.target.value) })}>
            <option value={1}>1 месяц</option>
            <option value={3}>3 месяца</option>
            <option value={6}>6 месяцев</option>
            <option value={12}>12 месяцев</option>
          </Select>
          <Field label="Начало доступа" type="date" value={issueInvoiceForm.period_start} onChange={(e: any) => setIssueInvoiceForm({ ...issueInvoiceForm, period_start: e.target.value })} />
          <div className="billingPlanChooser">
            <span className="fieldCaption">Тариф</span>
            <TariffPlans selectedPlan={issueInvoiceForm.plan} showEnterprise={false} onSelect={(planId) => setIssueInvoiceForm({ ...issueInvoiceForm, plan: planId })} />
          </div>
          <div className="actions adminFormActions"><Button type="submit">Выставить счёт</Button></div>
        </form>
        {msg && <div className={msg.includes('Не удалось') ? 'error' : 'notice'}>{msg}</div>}
      </Card>

      <Card title="Счета ресторанов">
      <div className="compactAccordionList">
        {billingInvoices.length ? billingInvoices.map((invoice: any) => {
          return <details className="compactAccordion" key={invoice.id}>
            <summary className="compactAccordionSummary">
              <span>
                <b>№ {invoice.number} · {invoice.restaurant?.name || 'Ресторан'}</b>
                <small>{invoice.plan_title} · {money(invoice.amount)} · счёт</small>
              </span>
              <span className="supportSummaryBadges">
                {invoice.receipt_url && <em className="badge active">поручение</em>}
                <em className={cx('badge', invoice.status)}>{billingStatusLabel(invoice.status)}</em>
              </span>
            </summary>
            <div className="compactAccordionBody">
              <div className="adminRowButton readonly"><span><b>Период</b><small>{fmtDate(invoice.period_start)} — {fmtDate(invoice.period_end)}</small></span><em>{billingStatusLabel(invoice.status)}</em></div>
              <div className="adminRowButton readonly">
                <span><b>Платёжное поручение</b><small>{invoice.receipt_name || 'не прикреплено'}</small></span>
                {invoice.receipt_url ? <a className="receiptLink" href={invoice.receipt_url} target="_blank" rel="noreferrer">Открыть файл</a> : <em>нет</em>}
              </div>
              <div className="actions">
                <Button type="button" kind="soft" onClick={() => download(`/api/billing/invoices/${invoice.id}/html`, `invoice-${invoice.number}.html`)}>Скачать счёт</Button>
                {invoice.status !== 'paid' && <Button type="button" onClick={() => markPaid(invoice.id)}>Оплата есть</Button>}
                {invoice.status !== 'paid' && <Button type="button" kind="danger" onClick={() => markNoPayment(invoice.id)}>Нет платежа</Button>}
              </div>
            </div>
          </details>;
        }) : <Empty text="Счетов пока нет" />}
      </div>
    </Card>
    </div>}
    {tab === 'support' && <SuperSupportAdmin />}
    {tab === 'billingSettings' && <Card title="Реквизиты оплаты">
      <form className="form two compactAdminForm billingSettingsForm" onSubmit={saveBillingSettings}>
        <div className="billingSettingsGroup">
          <div className="rowBetween"><b>Оплата переводом</b><span className="badge active">карта / СБП</span></div>
          <div className="form two compactAdminForm">
            <Field label="Получатель" value={transferSettings.recipient || ''} onChange={(e: any) => updateBillingSettings('transfer_requisites', 'recipient', e.target.value)} placeholder="Resto Control" />
            <Field label="Телефон / СБП" value={transferSettings.phone || ''} onChange={(e: any) => updateBillingSettings('transfer_requisites', 'phone', e.target.value)} />
            <Field label="Карта" value={transferSettings.card || ''} onChange={(e: any) => updateBillingSettings('transfer_requisites', 'card', e.target.value)} />
            <Field label="Банк" value={transferSettings.bank || ''} onChange={(e: any) => updateBillingSettings('transfer_requisites', 'bank', e.target.value)} />
            <Field label="Комментарий" value={transferSettings.comment || ''} onChange={(e: any) => updateBillingSettings('transfer_requisites', 'comment', e.target.value)} />
            <Field label="НДС" value={transferSettings.tax_note || ''} onChange={(e: any) => updateBillingSettings('transfer_requisites', 'tax_note', e.target.value)} placeholder="Без НДС" />
          </div>
        </div>
        <div className="billingSettingsGroup">
          <div className="rowBetween"><b>Счета и документы</b><span className="badge">юр. реквизиты</span></div>
          <div className="form two compactAdminForm">
            <Field label="Юр. название" value={sellerSettings.legal_name || ''} onChange={(e: any) => updateBillingSettings('seller_requisites', 'legal_name', e.target.value)} placeholder="ИП Иванов Иван Иванович" />
            <Field label="ИНН" value={sellerSettings.inn || ''} onChange={(e: any) => updateBillingSettings('seller_requisites', 'inn', e.target.value)} />
            <Field label="КПП" value={sellerSettings.kpp || ''} onChange={(e: any) => updateBillingSettings('seller_requisites', 'kpp', e.target.value)} />
            <Field label="ОГРН/ОГРНИП" value={sellerSettings.ogrn || ''} onChange={(e: any) => updateBillingSettings('seller_requisites', 'ogrn', e.target.value)} />
            <Field label="Юр. адрес" value={sellerSettings.legal_address || ''} onChange={(e: any) => updateBillingSettings('seller_requisites', 'legal_address', e.target.value)} />
            <Field label="Банк" value={sellerSettings.bank_name || ''} onChange={(e: any) => updateBillingSettings('seller_requisites', 'bank_name', e.target.value)} />
            <Field label="БИК" value={sellerSettings.bik || ''} onChange={(e: any) => updateBillingSettings('seller_requisites', 'bik', e.target.value)} />
            <Field label="Расчётный счёт" value={sellerSettings.checking_account || ''} onChange={(e: any) => updateBillingSettings('seller_requisites', 'checking_account', e.target.value)} />
            <Field label="Корр. счёт" value={sellerSettings.correspondent_account || ''} onChange={(e: any) => updateBillingSettings('seller_requisites', 'correspondent_account', e.target.value)} />
            <Field label="Email" value={sellerSettings.email || ''} onChange={(e: any) => updateBillingSettings('seller_requisites', 'email', e.target.value)} />
            <Field label="Телефон" value={sellerSettings.phone || ''} onChange={(e: any) => updateBillingSettings('seller_requisites', 'phone', e.target.value)} />
            <Field label="НДС" value={sellerSettings.tax_note || ''} onChange={(e: any) => updateBillingSettings('seller_requisites', 'tax_note', e.target.value)} placeholder="Без НДС" />
          </div>
        </div>
        <div className="actions adminFormActions"><Button type="submit">Сохранить реквизиты</Button></div>
      </form>
      {settingsMsg && <div className={settingsMsg.includes('Не удалось') ? 'error' : 'notice'}>{settingsMsg}</div>}
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
        <Button type="submit">Создать ресторан</Button>
      </form>
      {msg && <div className="notice">{msg}</div>}
    </Card>}
  </BasicWorkspace>;
}

function RestaurantAdmin({ user, restaurant, restaurants = [], onRestaurantSwitch, onRestaurantCreated, onLogout }: any) {
  const [tab, setTab] = useState<Tab>(() => initialTabFromUrl('overview', ['overview', 'users', 'checklists', 'inventory', 'bookings', 'tasks', 'knowledge', 'integrations', 'billing']));
  const [preferredBillingPlan, setPreferredBillingPlan] = useState('');
  const isManager = user.role === 'manager';
  const tabs = withIcons([
    { id: 'overview', title: isManager ? 'Пульт смены' : 'Обзор' },
    { id: 'users', title: 'Сотрудники' },
    { id: 'checklists', title: 'Чек-листы' },
    { id: 'inventory', title: 'Номенклатура' },
    { id: 'bookings', title: 'Брони / залы' },
    { id: 'tasks', title: 'Проблемы' },
    { id: 'knowledge', title: 'База знаний' },
    ...(!isManager ? [{ id: 'integrations', title: 'Интеграции' }] : []),
    { id: 'billing', title: 'Оплата' }
  ]);
  const section = useMemo(() => {
    if (tab === 'overview') return <AdminOverview user={user} mode={user.role === 'manager' ? 'manager' : 'owner'} onNavigate={setTab} />;
    if (tab === 'users') return <UsersAdmin user={user} />;
    if (tab === 'checklists') return <Checklists user={user} admin />;
    if (tab === 'bookings') return <Bookings user={user} admin />;
    if (tab === 'inventory') return <Inventory user={user} admin />;
    if (tab === 'tasks') return <Tasks user={user} admin />;
    if (tab === 'integrations') return <IntegrationsAdmin />;
    if (tab === 'billing') return <BillingAdmin restaurant={restaurant} preferredPlan={preferredBillingPlan} />;
    return <Knowledge user={user} admin />;
  }, [tab, user, restaurant, preferredBillingPlan]);

  return <RestaurantWorkspace
    user={user}
    restaurant={restaurant}
    restaurants={restaurants}
    tabs={tabs}
    active={tab}
    setActive={setTab}
    onRestaurantSwitch={onRestaurantSwitch}
    onRestaurantCreated={onRestaurantCreated}
    onLogout={onLogout}
    onBillingPlanSelect={setPreferredBillingPlan}
    banner={(openBilling) => user.role === 'owner' ? <SubscriptionBanner restaurant={restaurant} openBilling={openBilling} /> : null}
  >
    <div className={cx('contentStack', tab === 'overview' && 'reportPage')}>{section}</div>
  </RestaurantWorkspace>;
}


function IntegrationsAdmin() {
  const [data, setData] = useState<any>(null);
  const [form, setForm] = useState<any>({ autonomous: true, api_login: '', organization_id: '', terminal_group_id: '', sync_interval_seconds: 60, sync_bookings: true, sync_shifts: true });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [organizations, setOrganizations] = useState<any[]>([]);

  async function load() {
    const next = await api('/api/admin/integrations/iiko');
    setData(next);
    const integration = next.integration || {};
    const autonomous = !integration.has_api_login || integration.status === 'autonomous';
    setForm({
      autonomous,
      api_login: '',
      organization_id: integration.organization_id || '',
      terminal_group_id: integration.terminal_group_id || '',
      sync_interval_seconds: integration.sync_interval_seconds || 60,
      sync_bookings: integration.sync_bookings !== false,
      sync_shifts: integration.sync_shifts !== false
    });
  }

  useEffect(() => { load(); }, []);

  async function save(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const payload = { ...form, api_login: form.autonomous ? '' : form.api_login, autonomous: Boolean(form.autonomous) };
      const result = await api('/api/admin/integrations/iiko', { method: 'POST', body: JSON.stringify(payload) });
      setData((current: any) => ({ ...(current || {}), integration: result.integration }));
      setForm((current: any) => ({ ...current, api_login: '', autonomous: result.integration?.status === 'autonomous' || !result.integration?.has_api_login }));
      setMessage(result.integration?.status === 'autonomous' ? 'Автономный режим включён' : 'Настройки iiko сохранены');
    } catch (error: any) {
      setMessage(error.message || 'Не удалось сохранить настройки');
    } finally {
      setBusy(false);
    }
  }

  async function testConnection() {
    setBusy(true);
    setMessage('');
    try {
      await save();
      const result = await api('/api/admin/integrations/iiko/test', { method: 'POST', body: JSON.stringify({}) });
      setOrganizations(result.organizations || []);
      setMessage(result.message || `Подключение работает. Организаций: ${(result.organizations || []).length}`);
      load();
    } catch (error: any) {
      setMessage(error.message || 'iiko не ответила');
    } finally {
      setBusy(false);
    }
  }

  async function syncNow() {
    setBusy(true);
    setMessage('');
    try {
      const result = await api('/api/admin/integrations/iiko/sync', { method: 'POST', body: JSON.stringify({}) });
      setOrganizations(result.organizations || []);
      setMessage(result.message || 'Синхронизация выполнена');
      load();
    } catch (error: any) {
      setMessage(error.message || 'Не удалось синхронизировать iiko');
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <Card><Empty text="Загружаем интеграции" /></Card>;
  const integration = data.integration || {};
  const mappings = data.mappings || {};
  const events = data.events || [];
  const autonomous = Boolean(form.autonomous);

  return <div className="contentStack integrationsAdmin">
    <Card title="Интеграции">
      <form className="form two compactAdminForm" onSubmit={save}>
        <label className="compactCheck integrationModeCheck"><input type="checkbox" checked={autonomous} onChange={(e) => setForm({ ...form, autonomous: e.target.checked })} /> Работать автономно без POS/API</label>
        <div className="integrationModeNote">{autonomous ? 'Брони, смены, чек-листы и задачи ведутся внутри приложения. Внешние API не вызываются.' : 'iiko Cloud будет использоваться только после сохранения API-ключа.'}</div>
        <Field label="API-логин iiko" type="password" value={form.api_login} onChange={(e: any) => setForm({ ...form, api_login: e.target.value, autonomous: false })} placeholder={integration.has_api_login ? 'Сохранён. Введите новый для замены' : 'Вставьте API-логин'} disabled={autonomous} />
        <Field label="Организация iiko" value={form.organization_id} onChange={(e: any) => setForm({ ...form, organization_id: e.target.value })} placeholder="organizationId" disabled={autonomous} />
        <Field label="Терминальная группа" value={form.terminal_group_id} onChange={(e: any) => setForm({ ...form, terminal_group_id: e.target.value })} placeholder="terminalGroupId" disabled={autonomous} />
        <Field label="Интервал сверки, сек" type="number" min="30" max="900" value={form.sync_interval_seconds} onChange={(e: any) => setForm({ ...form, sync_interval_seconds: Number(e.target.value) })} disabled={autonomous} />
        <label className="compactCheck"><input type="checkbox" checked={!autonomous && form.sync_bookings} disabled={autonomous} onChange={(e) => setForm({ ...form, sync_bookings: e.target.checked })} /> Брони</label>
        <label className="compactCheck"><input type="checkbox" checked={!autonomous && form.sync_shifts} disabled={autonomous} onChange={(e) => setForm({ ...form, sync_shifts: e.target.checked })} /> Смены</label>
        <div className="actions adminFormActions">
          <Button type="submit" disabled={busy}>Сохранить</Button>
          <Button type="button" kind="soft" disabled={busy} onClick={testConnection}>Проверить режим</Button>
          <Button type="button" kind="soft" disabled={busy} onClick={syncNow}>Сверить</Button>
        </div>
      </form>
      {message && <div className={message.includes('Не удалось') || message.includes('не ответила') ? 'error' : 'notice'}>{message}</div>}
    </Card>

    <div className="adminCompactGrid">
      <div className="miniCard">
        <div className="rowBetween"><b>Режим</b><span className={cx('badge', autonomous || integration.status === 'connected' ? 'active' : integration.status === 'error' ? 'cancelled' : '')}>{autonomous ? 'автономно' : integration.status || 'не подключено'}</span></div>
        <p>{autonomous ? 'Сторонняя POS-система не требуется.' : `Последняя сверка: ${integration.last_sync_at ? fmtDate(integration.last_sync_at) : 'ещё не было'}`}</p>
        {integration.last_error && !autonomous && <p>{integration.last_error}</p>}
      </div>
      <div className="miniCard">
        <div className="rowBetween"><b>Связи</b><span className="badge">{autonomous ? 'локально' : 'iiko'}</span></div>
        <p>Сотрудники: {mappings.employees || 0} · Столы: {mappings.tables || 0}</p>
        <p>Залы: {mappings.halls || 0} · Брони: {mappings.bookings || 0}</p>
      </div>
    </div>

    {!!organizations.length && !autonomous && <details className="compactAccordion" open>
      <summary className="compactAccordionSummary"><span>Организации iiko</span><em>{organizations.length}</em></summary>
      <div className="compactAccordionBody">
        {organizations.map((org: any) => <button type="button" className="adminRowButton" key={org.id} onClick={() => setForm({ ...form, organization_id: org.id })}>
          <span><b>{org.name || org.fullName || org.id}</b><small>{org.id}</small></span>
          <em>Выбрать</em>
        </button>)}
      </div>
    </details>}

    <details className="compactAccordion">
      <summary className="compactAccordionSummary"><span>Журнал интеграции</span><em>{events.length}</em></summary>
      <div className="compactAccordionBody">
        {events.length ? events.map((event: any) => <div className="adminRowButton readonly" key={event.id}>
          <span><b>{event.event_type}</b><small>{fmtDate(event.received_at)} · {event.status}</small></span>
          {event.error && <em>{event.error}</em>}
        </div>) : <Empty text="Событий пока нет" />}
      </div>
    </details>
  </div>;
}


function BillingAdmin({ restaurant, preferredPlan }: { restaurant: any; preferredPlan?: string }) {
  const [data, setData] = useState<any>(null);
  const [form, setForm] = useState<any>({ customer_type: 'ip', legal_name: '', inn: '', kpp: '', ogrn: '', legal_address: '', bank_name: '', bik: '', checking_account: '', correspondent_account: '', edo_operator: '', edo_id: '', email: '', phone: '' });
  const [paymentOrder, setPaymentOrder] = useState<any>(null);
  const [paymentOrderName, setPaymentOrderName] = useState('');
  const [paymentOrderInvoiceId, setPaymentOrderInvoiceId] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    const next = await api('/api/billing');
    setData(next);
    setForm({ ...form, ...(next.profile || {}) });
  }

  useEffect(() => { load(); }, []);
  useEffect(() => { void preferredPlan; }, [preferredPlan]);

  function money(value: any) {
    return `${Number(value || 0).toLocaleString('ru-RU')} ₽`;
  }

  async function saveRequisites(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const profile = await api('/api/billing/requisites', { method: 'PATCH', body: JSON.stringify(form) });
      setData((current: any) => ({ ...(current || {}), profile }));
      setMessage('Реквизиты сохранены');
    } catch (error: any) {
      setMessage(error.message || 'Не удалось сохранить реквизиты');
    } finally {
      setBusy(false);
    }
  }

  async function reportPaid(invoice: any) {
    setBusy(true);
    setMessage('');
    try {
      await api(`/api/billing/invoices/${invoice.id}/report-paid`, { method: 'POST', body: JSON.stringify({}) });
      setMessage(`Счёт № ${invoice.number} отправлен на проверку`);
      await load();
    } catch (error: any) {
      setMessage(error.message || 'Не удалось отправить отметку об оплате');
    } finally {
      setBusy(false);
    }
  }

  async function attachPaymentOrder(invoice: any) {
    setMessage('');
    if (!paymentOrder || paymentOrderInvoiceId !== invoice.id) {
      setMessage('Прикрепите платёжное поручение');
      return;
    }
    setBusy(true);
    try {
      await api(`/api/billing/invoices/${invoice.id}/payment-order`, { method: 'POST', body: JSON.stringify({ receipt: paymentOrder }) });
      setMessage(`Платёжное поручение по счёту № ${invoice.number} отправлено`);
      setPaymentOrder(null);
      setPaymentOrderName('');
      setPaymentOrderInvoiceId('');
      await load();
    } catch (error: any) {
      setMessage(error.message || 'Не удалось прикрепить платёжное поручение');
    } finally {
      setBusy(false);
    }
  }

  async function handlePaymentOrderChange(invoiceId: string, e: any) {
    const file: File | undefined = e.target.files?.[0];
    setMessage('');
    if (!file) {
      setPaymentOrder(null);
      setPaymentOrderName('');
      setPaymentOrderInvoiceId('');
      return;
    }
    try {
      setPaymentOrder(await uploadPayloadFromFile(file));
      setPaymentOrderName(file.name);
      setPaymentOrderInvoiceId(invoiceId);
    } catch (error: any) {
      setPaymentOrder(null);
      setPaymentOrderName('');
      setPaymentOrderInvoiceId('');
      setMessage(error.message || 'Не удалось прочитать платёжное поручение');
    }
  }

  if (!data) return <Card><Empty text="Загружаем оплату" /></Card>;
  const plans = data.plans || [];
  const invoices = data.invoices || [];
  const documents = data.documents || [];
  const currentPlan = plans.find((plan: any) => plan.id === restaurant?.plan) || plans.find((plan: any) => plan.id === 'standard') || {};
  const latestInvoice = invoices[0];
  const subscriptionDateText = restaurant?.subscription_ends_at
    ? `Оплачено до ${fmtDate(restaurant.subscription_ends_at)}`
    : restaurant?.trial_ends_at
      ? `Пробный период до ${fmtDate(restaurant.trial_ends_at)}`
      : 'Срок доступа не указан';

  return <div className="contentStack billingAdmin">
    <div className="subscriptionInfoBlock">
      <div className="subscriptionInfoMain">
        <span>Подписка</span>
        <strong>{currentPlan.title || restaurant?.plan || 'Тариф не выбран'}</strong>
        <p>{subscriptionLabel(restaurant?.subscription_status)} · {subscriptionDateText}</p>
      </div>
      <div className="subscriptionInfoMeta">
        <span>Последняя оплата</span>
        <b>{latestInvoice ? `№ ${latestInvoice.number} · ${money(latestInvoice.amount)}` : 'Оплат пока нет'}</b>
        {latestInvoice ? <em>{billingStatusLabel(latestInvoice.status)}</em> : <em>перевод или счёт</em>}
      </div>
      {latestInvoice && <Button type="button" kind="soft" onClick={() => download(`/api/billing/invoices/${latestInvoice.id}/html`, `invoice-${latestInvoice.number}.html`)}>Скачать</Button>}
    </div>

    <details className="compactAccordion" open={!data.profile}>
      <summary className="compactAccordionSummary"><span>Реквизиты ресторана</span><em>{form.legal_name || 'не заполнены'}</em></summary>
      <div className="compactAccordionBody">
        <form className="form two compactAdminForm billingRequisitesForm" onSubmit={saveRequisites}>
          <Select label="Тип" value={form.customer_type} onChange={(e: any) => setForm({ ...form, customer_type: e.target.value })}>
            <option value="ip">ИП</option>
            <option value="ooo">ООО</option>
          </Select>
          <Field label="Наименование" value={form.legal_name} onChange={(e: any) => setForm({ ...form, legal_name: e.target.value })} placeholder="ИП Иванов Иван Иванович" />
          <Field label="ИНН" value={form.inn} onChange={(e: any) => setForm({ ...form, inn: e.target.value })} />
          <Field label="КПП" value={form.kpp} onChange={(e: any) => setForm({ ...form, kpp: e.target.value })} disabled={form.customer_type === 'ip'} />
          <Field label="ОГРН/ОГРНИП" value={form.ogrn} onChange={(e: any) => setForm({ ...form, ogrn: e.target.value })} />
          <Field label="Юр. адрес" value={form.legal_address} onChange={(e: any) => setForm({ ...form, legal_address: e.target.value })} />
          <Field label="Банк" value={form.bank_name} onChange={(e: any) => setForm({ ...form, bank_name: e.target.value })} />
          <Field label="БИК" value={form.bik} onChange={(e: any) => setForm({ ...form, bik: e.target.value })} />
          <Field label="Расчётный счёт" value={form.checking_account} onChange={(e: any) => setForm({ ...form, checking_account: e.target.value })} />
          <Field label="Корр. счёт" value={form.correspondent_account} onChange={(e: any) => setForm({ ...form, correspondent_account: e.target.value })} />
          <Field label="ЭДО" value={form.edo_operator} onChange={(e: any) => setForm({ ...form, edo_operator: e.target.value })} placeholder="Диадок / СБИС / Контур" />
          <Field label="ID в ЭДО" value={form.edo_id} onChange={(e: any) => setForm({ ...form, edo_id: e.target.value })} />
          <Field label="Email для документов" value={form.email} onChange={(e: any) => setForm({ ...form, email: e.target.value })} />
          <Field label="Телефон бухгалтерии" value={form.phone} onChange={(e: any) => setForm({ ...form, phone: e.target.value })} />
          <div className="actions adminFormActions"><Button type="submit" disabled={busy}>Сохранить реквизиты</Button></div>
        </form>
      </div>
    </details>

    <details className="compactAccordion" open>
      <summary className="compactAccordionSummary"><span>Счета к оплате</span><em>{invoices.length}</em></summary>
      <div className="compactAccordionBody">
        {invoices.length ? invoices.map((invoice: any) => {
          return <div className="adminRowButton readonly" key={invoice.id}>
            <span><b>Счёт № {invoice.number}</b><small>{invoice.plan_title} · {money(invoice.amount)} · {fmtDate(invoice.issued_at)}</small></span>
            <span className="rowActions">
              {invoice.receipt_url && <a className="receiptLink" href={invoice.receipt_url} target="_blank" rel="noreferrer">Поручение</a>}
              <em className={cx('badge', invoice.status)}>{billingStatusLabel(invoice.status)}</em>
              <Button type="button" kind="soft" onClick={() => download(`/api/billing/invoices/${invoice.id}/html`, `invoice-${invoice.number}.html`)}>Скачать</Button>
              {['issued', 'transfer_pending'].includes(invoice.status) && <Button type="button" disabled={busy} onClick={() => reportPaid(invoice)}>Оплатил</Button>}
            </span>
            {invoice.status === 'payment_rejected' && <div className="billingPaymentOrderInline">
              <label className="receiptUploadBox">
                <span>Платёжное поручение</span>
                <input type="file" accept="image/*,.pdf,application/pdf" onChange={(event) => handlePaymentOrderChange(invoice.id, event)} />
                <b>{paymentOrderInvoiceId === invoice.id && paymentOrderName ? paymentOrderName : 'Прикрепите фото или PDF'}</b>
              </label>
              <Button type="button" disabled={busy} onClick={() => attachPaymentOrder(invoice)}>Прикрепить</Button>
            </div>}
          </div>;
        }) : <Empty text="Оплат пока нет" />}
      </div>
    </details>

    <details className="compactAccordion">
      <summary className="compactAccordionSummary"><span>Закрывающие документы</span><em>{documents.length}</em></summary>
      <div className="compactAccordionBody">
        {documents.length ? documents.map((doc: any) => <div className="adminRowButton readonly" key={doc.id}>
          <span><b>{doc.type === 'upd' ? 'УПД' : 'Акт'} № {doc.number}</b><small>{money(doc.amount)} · период до {fmtDate(doc.period_end)}</small></span>
          <span className="rowActions"><em className={cx('badge', doc.status)}>{doc.status}</em><Button type="button" kind="soft" onClick={() => download(`/api/billing/documents/${doc.id}/html`, `${doc.type}-${doc.number}.html`)}>Скачать</Button></span>
        </div>) : <Empty text="Документы появятся после отметки оплаты" />}
      </div>
    </details>

    {message && <div className={message.includes('Не удалось') || message.includes('Заполните') || message.includes('Прикрепите') ? 'error' : 'notice'}>{message}</div>}
  </div>;
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

function AdminOverview({ user, mode = 'owner' }: { user: any; mode?: 'owner' | 'manager'; onNavigate?: (tab: string) => void }) {
  const today = inputDateKey();
  const [data, setData] = useState<any>(null);
  const [activePanel, setActivePanel] = useState<AdminOverviewPanelKey>('employees');
  const [taskRange, setTaskRange] = useState({ from: today, to: today });
  const [updatingProblemId, setUpdatingProblemId] = useState('');
  const [overviewMsg, setOverviewMsg] = useState('');
  const [overviewMsgKind, setOverviewMsgKind] = useState<'notice' | 'error'>('notice');
  const [taskForm, setTaskForm] = useState<any>({ title: '', description: '', target_type: 'all', target_role: 'waiter', target_user_id: '', due_at: '', require_photo: false });
  function loadOverview() {
    const query = new URLSearchParams({ task_from: taskRange.from, task_to: taskRange.to });
    return api(`/api/admin/overview?${query.toString()}`).then(setData);
  }
  useEffect(() => {
    loadOverview().catch(() => setData(null));
  }, [taskRange.from, taskRange.to]);
  async function updateOverviewProblemStatus(problem: any, status: string) {
    if (!problem?.id || status === problem.status) return;
    setOverviewMsg('');
    setOverviewMsgKind('notice');
    setUpdatingProblemId(problem.id);
    try {
      await api(`/api/tech-requests/${problem.id}`, { method: 'PATCH', body: JSON.stringify({ status, manager_comment: problem.manager_comment || '' }) });
      setOverviewMsgKind('notice');
      setOverviewMsg('Статус проблемы обновлён');
      await loadOverview();
    } catch (error: any) {
      setOverviewMsgKind('error');
      setOverviewMsg(error.message || 'Не удалось обновить проблему');
    } finally {
      setUpdatingProblemId('');
    }
  }
  async function createOverviewTask(e: FormEvent) {
    e.preventDefault();
    setOverviewMsg('');
    setOverviewMsgKind('notice');
    try {
      const result = await api('/api/tasks', { method: 'POST', body: JSON.stringify(taskForm) });
      setTaskForm((current: any) => ({ ...current, title: '', description: '', target_user_id: '', due_at: '', require_photo: false }));
      setOverviewMsgKind('notice');
      setOverviewMsg(result?.offline ? 'Задача сохранена офлайн' : 'Задача создана');
      await loadOverview();
      setActivePanel('tasks');
    } catch (error: any) {
      setOverviewMsgKind('error');
      setOverviewMsg(error.message || 'Не удалось создать задачу');
    }
  }
  if (!data) return <Card><Empty text="Загружаем обзор" /></Card>;
  const managerMode = mode === 'manager';
  const employeeLimit = data.employee_limit === null ? '∞' : data.employee_limit;
  const employeesValue = employeeLimit ? `${data.users} из ${employeeLimit}` : data.users;
  const summary = data.summary || {};
  const checklistSummary = summary.checklists || {};
  const taskSummary = summary.tasks || {};
  const problemSummary = summary.problems || {};
  const documentSummary = summary.documents || {};
  const inventorySummary = summary.inventories || {};
  const employeeMetrics = data.employee_metrics || [];
  const employees = (data.employees || employeeMetrics.map((row: any) => row.user).filter(Boolean)).filter((employee: any) => employee && employee.active !== false);
  const openShifts = Array.isArray(data.open_shifts) ? data.open_shifts : [];
  const openShiftsFromToday = Array.isArray(data.open_shifts_today) ? data.open_shifts_today : [];
  const openShiftsToday = openShiftsFromToday.length > 0 ? openShiftsFromToday : openShifts;
  const openTasksCount = taskSummary.not_done ?? taskSummary.open ?? data.tasks_open;
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
      <StatCard icon="users" title="Сотрудники" value={employeesValue} active={activePanel === 'employees'} onClick={() => setActivePanel('employees')} />
      <StatCard icon="users" title="Сотрудники на смене" value={statNumber(openShiftsToday.length, openShiftsToday.length ? 'done' : 'neutral')} active={activePanel === 'shifts'} onClick={() => setActivePanel('shifts')} />
      <StatCard icon="checklists" title="Чек-листы сегодня" value={statNumbers({ value: checklistSummary.done ?? data.checklists_today, tone: 'done' }, { value: checklistSummary.not_done, tone: 'todo' })} active={activePanel === 'checklists'} onClick={() => setActivePanel('checklists')} />
      <StatCard icon="tasks" title="Задачи" value={statNumbers({ value: openTasksCount, tone: 'todo' }, { value: taskSummary.overdue, tone: 'todo' }, { value: taskSummary.done, tone: 'done' })} active={activePanel === 'tasks'} onClick={() => setActivePanel('tasks')} />
      <StatCard icon="tasks" title="Проблемы" value={statNumbers({ value: problemSummary.new, tone: 'todo' }, { value: problemSummary.not_done, tone: 'todo' }, { value: problemSummary.in_progress, tone: 'neutral' })} active={activePanel === 'problems'} onClick={() => setActivePanel('problems')} />
      <StatCard icon="document" title="Документы" value={statNumber(documentSummary.total ?? data.docs, 'neutral')} active={activePanel === 'documents'} onClick={() => setActivePanel('documents')} />
      <StatCard icon="inventory" title="Инвентаризации" value={statNumbers({ value: inventorySummary.ready, tone: 'done' }, { value: inventorySummary.not_ready, tone: 'todo' })} active={activePanel === 'inventory'} onClick={() => setActivePanel('inventory')} />
    </div>

    {overviewMsg && <div className={overviewMsgKind}>{overviewMsg}</div>}
    <AdminOverviewDetailPanel activePanel={activePanel} user={user} employees={employees} rows={employeeMetrics} shifts={openShiftsToday} taskRange={taskRange} onTaskRangeChange={setTaskRange} taskForm={taskForm} onTaskFormChange={setTaskForm} onTaskCreate={createOverviewTask} problems={problemSummary.details || []} updatingProblemId={updatingProblemId} onProblemStatusChange={updateOverviewProblemStatus} inventoryAssignments={data.inventory_assignments_today || []} />
  </>;
}

function AdminOverviewDetailPanel({ activePanel, user, employees, rows, shifts, taskRange, onTaskRangeChange, taskForm, onTaskFormChange, onTaskCreate, problems, updatingProblemId, onProblemStatusChange, inventoryAssignments }: { activePanel: AdminOverviewPanelKey; user: any; employees: any[]; rows: any[]; shifts: any[]; taskRange: any; onTaskRangeChange: (range: any) => void; taskForm: any; onTaskFormChange: (next: any) => void; onTaskCreate: (e: FormEvent) => void; problems: any[]; updatingProblemId: string; onProblemStatusChange: (problem: any, status: string) => void; inventoryAssignments: any[] }) {
  if (activePanel === 'employees') return <OverviewEmployeesList employees={employees} rows={rows} />;
  if (activePanel === 'shifts') return <OpenShiftEmployees shifts={shifts} rows={rows} />;
  if (activePanel === 'checklists') return <OverviewChecklistLists rows={rows} />;
  if (activePanel === 'tasks') return <OverviewTaskLists user={user} employees={employees} rows={rows} taskRange={taskRange} onTaskRangeChange={onTaskRangeChange} taskForm={taskForm} onTaskFormChange={onTaskFormChange} onTaskCreate={onTaskCreate} />;
  if (activePanel === 'problems') return <OverviewProblemLists problems={problems} updatingProblemId={updatingProblemId} onStatusChange={onProblemStatusChange} />;
  if (activePanel === 'documents') return <OverviewDocumentLists rows={rows} />;
  return <OverviewInventoryLists assignments={inventoryAssignments} rows={rows} />;
}

function OverviewEmployeesList({ employees, rows }: { employees: any[]; rows: any[] }) {
  const [expandedEmployeeId, setExpandedEmployeeId] = useState('');
  const metricsByUserId = useMemo(() => new Map(rows.map((row: any) => [String(row.user?.id || ''), row])), [rows]);
  return <section className="overviewListPanel employeeMetricsPlain">
    <h3>Сотрудники</h3>
    {employees.length === 0 && <Empty text="Сотрудники пока не добавлены" />}
    <div className="employeeMetricsList">
      {employees.map((employee) => {
        const employeeId = String(employee.id || employee.login || employee.name || 'employee');
        const metrics = metricsByUserId.get(employeeId);
        const expanded = expandedEmployeeId === employeeId;
        const inactive = employee.active === false;
        return <div className={cx('employeeMetricsEntry', expanded && 'open', inactive && 'inactive')} key={employeeId}>
          <button type="button" className="employeeMetricsRow overviewEmployeeRow" aria-expanded={expanded} onClick={() => setExpandedEmployeeId(expanded ? '' : employeeId)}>
            <div className="employeeMetricsPerson"><strong>{employee.name || 'Сотрудник'}</strong><span>{roles[employee.role] || employee.role || 'Роль не указана'} · {departments[employee.department] || employee.department || 'Подразделение не указано'}</span></div>
            <span className={cx('badge', inactive ? 'cancelled' : 'active')}>{inactive ? 'выкл' : 'активен'}</span>
            <span className="employeeMetricValue" data-label="Чек-листы"><span className="employeeMetricNumbers"><span className={cx('statNumberPart', Number(metrics?.checklists?.done || 0) ? 'done' : 'zero')}>{metrics?.checklists?.done || 0}</span><span className="statNumberSep">/</span><span className={cx('statNumberPart', Number(metrics?.checklists?.not_done || 0) ? 'todo' : 'zero')}>{metrics?.checklists?.not_done || 0}</span></span></span>
            <span className="employeeMetricValue" data-label="Задачи"><span className="employeeMetricNumbers"><span className={cx('statNumberPart', Number(metrics?.tasks?.not_done || 0) ? 'todo' : 'zero')}>{metrics?.tasks?.not_done || 0}</span><span className="statNumberSep">/</span><span className={cx('statNumberPart', Number(metrics?.tasks?.done || 0) ? 'done' : 'zero')}>{metrics?.tasks?.done || 0}</span></span></span>
          </button>
          {expanded && (metrics ? <EmployeeMetricsExpanded row={metrics} /> : <div className="employeeMetricsDetails"><p className="employeeDetailEmpty">Для отключённого сотрудника нет показателей за сегодня.</p></div>)}
        </div>;
      })}
    </div>
  </section>;
}

function overviewChecklists(rows: any[]) { return rows.flatMap((row: any) => (row.checklists?.details || []).map((checklist: any) => ({ id: `${row.user?.id || 'employee'}-${checklist.id}`, user: row.user, checklist }))); }
function overviewTasks(rows: any[]) { return rows.flatMap((row: any) => (row.tasks?.details || []).map((task: any) => ({ id: `${row.user?.id || 'employee'}-${task.id}`, user: row.user, task }))); }
function overviewDocuments(rows: any[]) { return rows.flatMap((row: any) => (row.documents?.details || []).map((document: any) => ({ id: `${row.user?.id || 'employee'}-${document.id}`, user: row.user, document }))); }
function overviewInventories(rows: any[]) { return rows.flatMap((row: any) => (row.inventories?.details || []).map((inventory: any) => ({ id: `${row.user?.id || 'employee'}-${inventory.id}`, user: row.user, inventory }))); }

function OverviewChecklistLists({ rows }: { rows: any[] }) {
  const items = overviewChecklists(rows);
  const doneItems = items.filter((item: any) => item.checklist.status === 'done');
  const notDoneItems = items.filter((item: any) => item.checklist.status !== 'done');
  return <section className="overviewListPanel employeeMetricsPlain"><h3>Чек-листы сегодня</h3><div className="employeeDetailColumns overviewDetailColumns"><EmployeeDetailList title="Не выполнено" count={notDoneItems.length} empty="Нет невыполненных чек-листов" defaultOpen>{notDoneItems.map((item: any) => <OverviewChecklistCard item={item} key={item.id} />)}</EmployeeDetailList><EmployeeDetailList title="Выполнено" count={doneItems.length} empty="Выполненных чек-листов сегодня нет" defaultOpen>{doneItems.map((item: any) => <OverviewChecklistCard item={item} key={item.id} />)}</EmployeeDetailList></div></section>;
}

function OverviewChecklistCard({ item }: { item: any }) {
  const checklist = item.checklist || {}; const completed = checklist.status === 'done'; const doneItems = checklist.done_items || []; const notDoneItems = checklist.not_done_items || [];
  return <article className="employeeDetailCard overviewDetailCard"><div className="employeeDetailCardHead"><strong>{checklist.title || 'Чек-лист'}</strong><span className={cx('badge', completed ? 'active' : 'warning')}>{completed ? 'выполнено' : 'не выполнено'}</span></div><p>{item.user?.name || 'Сотрудник'} · {roles[item.user?.role] || item.user?.role || 'роль не указана'}{checklist.completed_at ? ` · ${fmtDate(checklist.completed_at)}` : ''}</p>{notDoneItems.length > 0 && <EmployeeDetailBullets items={notDoneItems} />}{completed && doneItems.length > 0 && <EmployeeDetailBullets items={doneItems} done />}</article>;
}

function OverviewTaskLists({ user, employees, rows, taskRange, onTaskRangeChange, taskForm, onTaskFormChange, onTaskCreate }: { user: any; employees: any[]; rows: any[]; taskRange: any; onTaskRangeChange: (range: any) => void; taskForm: any; onTaskFormChange: (next: any) => void; onTaskCreate: (e: FormEvent) => void }) {
  const items = overviewTasks(rows);
  const overdueItems = items.filter((item: any) => !item.task.done && item.task.overdue);
  const openItems = items.filter((item: any) => !item.task.done && !item.task.overdue);
  const doneItems = items.filter((item: any) => item.task.done);
  const today = inputDateKey();
  const setQuickRange = (from: string, to = from) => onTaskRangeChange({ from, to });
  const recipientRoleKeys = taskRecipientRolesFor(user);
  const roleOptions = executableRoles.filter(([key]) => recipientRoleKeys.includes(key));
  const targetUsers = employees
    .filter((employee: any) => employee.active !== false && recipientRoleKeys.includes(employee.role) && employee.id !== user.id)
    .sort((a: any, b: any) => String(departments[a.department] || a.department || '').localeCompare(String(departments[b.department] || b.department || ''), 'ru') || String(a.name || '').localeCompare(String(b.name || ''), 'ru'));
  const selectedRoleIsAvailable = roleOptions.some(([key]) => key === taskForm.target_role);
  const normalizedTaskForm = selectedRoleIsAvailable ? taskForm : { ...taskForm, target_role: roleOptions[0]?.[0] || 'waiter' };
  return <section className="overviewListPanel employeeMetricsPlain">
    <div className="overviewPanelHead overviewTaskPanelHead">
      <div><h3>Задачи</h3><p>Показаны задачи только за выбранный день или период</p></div>
      <div className="overviewDateTools">
        <Button type="button" kind="soft" onClick={() => setQuickRange(today)}>Сегодня</Button>
        <Button type="button" kind="soft" onClick={() => setQuickRange(shiftInputDate(today, -1))}>Вчера</Button>
        <Button type="button" kind="soft" onClick={() => setQuickRange(shiftInputDate(today, -6), today)}>7 дней</Button>
        <label><span>с</span><input type="date" value={taskRange.from} onChange={(e: any) => onTaskRangeChange({ ...taskRange, from: e.target.value || today })} /></label>
        <label><span>по</span><input type="date" value={taskRange.to} onChange={(e: any) => onTaskRangeChange({ ...taskRange, to: e.target.value || taskRange.from })} /></label>
      </div>
    </div>
    <form className="overviewTaskCreateForm" onSubmit={onTaskCreate}>
      <Field label="Новая задача" value={normalizedTaskForm.title} onChange={(e: any) => onTaskFormChange({ ...normalizedTaskForm, title: e.target.value })} placeholder="Что нужно выполнить" />
      <Field label="Срок" type="datetime-local" value={normalizedTaskForm.due_at} onChange={(e: any) => onTaskFormChange({ ...normalizedTaskForm, due_at: e.target.value })} />
      <Select label="Кому" value={normalizedTaskForm.target_type} onChange={(e: any) => onTaskFormChange({ ...normalizedTaskForm, target_type: e.target.value, target_user_id: '' })}>
        {Object.entries(targetTypeLabels).map(([key, value]) => <option key={key} value={key}>{value}</option>)}
      </Select>
      {normalizedTaskForm.target_type === 'role' && <Select label="Роль" value={normalizedTaskForm.target_role} onChange={(e: any) => onTaskFormChange({ ...normalizedTaskForm, target_role: e.target.value })}>
        {roleOptions.map(([key, value]) => <option key={key} value={key}>{value}</option>)}
      </Select>}
      {normalizedTaskForm.target_type === 'user' && <Select label="Сотрудник" required value={normalizedTaskForm.target_user_id} onChange={(e: any) => onTaskFormChange({ ...normalizedTaskForm, target_user_id: e.target.value })}>
        <option value="">Выбрать сотрудника</option>
        {targetUsers.map((employee: any) => <option key={employee.id} value={employee.id}>{employee.name} · {roles[employee.role] || employee.role}</option>)}
      </Select>}
      <Textarea label="Описание" value={normalizedTaskForm.description} onChange={(e: any) => onTaskFormChange({ ...normalizedTaskForm, description: e.target.value })} placeholder="Детали задачи" />
      <label className="smartTaskFlag overviewTaskPhotoFlag"><input type="checkbox" checked={!!normalizedTaskForm.require_photo} onChange={(e: any) => onTaskFormChange({ ...normalizedTaskForm, require_photo: e.target.checked })} /><span>Нужно фото</span></label>
      <div className="actions adminFormActions"><Button type="submit">Создать задачу</Button></div>
    </form>
    <div className="employeeDetailColumns overviewDetailColumns">
      <EmployeeDetailList title="Не выполнено" count={openItems.length} empty="Невыполненных задач за период нет" defaultOpen>{openItems.map((item: any) => <OverviewTaskCard item={item} key={item.id} />)}</EmployeeDetailList>
      <EmployeeDetailList title="Просрочено" count={overdueItems.length} empty="Просроченных задач за период нет" defaultOpen>{overdueItems.map((item: any) => <OverviewTaskCard item={item} key={`overdue-${item.id}`} />)}</EmployeeDetailList>
      <EmployeeDetailList title="Выполнено" count={doneItems.length} empty="Выполненных задач за период нет" defaultOpen>{doneItems.map((item: any) => <OverviewTaskCard item={item} key={item.id} />)}</EmployeeDetailList>
    </div>
  </section>;
}

function OverviewTaskCard({ item }: { item: any }) {
  const task = item.task || {}; const done = Boolean(task.done);
  return <article className="employeeDetailCard overviewDetailCard"><div className="employeeDetailCardHead"><strong>{task.title || 'Задача'}</strong><span className={cx('badge', done ? 'active' : task.overdue ? 'cancelled' : 'warning')}>{done ? 'выполнено' : task.overdue ? 'просрочено' : task.source === 'tech_request' ? 'проблема' : 'в работе'}</span></div><p>{item.user?.name || 'Сотрудник'} · {done ? employeeDoneTaskDescription(task) : employeeTaskDescription(task)}</p></article>;
}

function OverviewProblemLists({ problems, updatingProblemId, onStatusChange }: { problems: any[]; updatingProblemId: string; onStatusChange: (problem: any, status: string) => void }) {
  const newItems = problems.filter((problem: any) => problem.status === 'new');
  const inProgressItems = problems.filter((problem: any) => problem.status === 'in_progress');
  return <section className="overviewListPanel employeeMetricsPlain">
    <h3>Проблемы</h3>
    <div className="employeeDetailColumns overviewDetailColumns">
      <EmployeeDetailList title="Новые" count={newItems.length} empty="Новых проблем нет" defaultOpen>{newItems.map((problem: any) => <OverviewProblemCard problem={problem} updating={updatingProblemId === problem.id} onStatusChange={onStatusChange} key={problem.id} />)}</EmployeeDetailList>
      <EmployeeDetailList title="В работе" count={inProgressItems.length} empty="Проблем в работе нет" defaultOpen>{inProgressItems.map((problem: any) => <OverviewProblemCard problem={problem} updating={updatingProblemId === problem.id} onStatusChange={onStatusChange} key={problem.id} />)}</EmployeeDetailList>
    </div>
  </section>;
}

function OverviewProblemCard({ problem, updating, onStatusChange }: { problem: any; updating: boolean; onStatusChange: (problem: any, status: string) => void }) {
  const inProgress = problem.status === 'in_progress';
  return <article className="employeeDetailCard overviewDetailCard">
    <div className="employeeDetailCardHead"><strong>{problem.title || 'Проблема'}</strong><span className={cx('badge', inProgress ? 'trial' : 'warning')}>{techRequestStatuses[problem.status] || problem.status || 'новая'}</span></div>
    <p>{problem.created_by_user?.name || 'Сотрудник'} · {techRequestCategories[problem.category] || 'Другое'} · {fmtDate(problem.created_at)}</p>
    {problem.manager_comment && <p>{problem.manager_comment}</p>}
    <div className="overviewProblemActions">
      <Select label="Статус" value={problem.status || 'new'} disabled={updating} onChange={(event: any) => onStatusChange(problem, event.target.value)}>
        {Object.entries(techRequestStatuses).map(([key, value]) => <option key={key} value={key}>{value}</option>)}
      </Select>
    </div>
  </article>;
}

function OverviewDocumentLists({ rows }: { rows: any[] }) {
  const items = overviewDocuments(rows); const pendingItems = items.filter((item: any) => item.document.status === 'pending'); const acknowledgedItems = items.filter((item: any) => item.document.status === 'acknowledged');
  return <section className="overviewListPanel employeeMetricsPlain"><h3>Документы</h3><div className="employeeDetailColumns overviewDetailColumns"><EmployeeDetailList title="Ждут ознакомления" count={pendingItems.length} empty="Нет документов, ожидающих ознакомления" defaultOpen>{pendingItems.map((item: any) => <OverviewDocumentCard item={item} key={item.id} />)}</EmployeeDetailList><EmployeeDetailList title="Ознакомлены" count={acknowledgedItems.length} empty="Ознакомленных документов пока нет" defaultOpen>{acknowledgedItems.map((item: any) => <OverviewDocumentCard item={item} key={item.id} />)}</EmployeeDetailList></div></section>;
}

function OverviewDocumentCard({ item }: { item: any }) {
  const document = item.document || {}; const acknowledged = document.status === 'acknowledged';
  return <article className="employeeDetailCard compact overviewDetailCard"><div className="employeeDetailCardHead"><strong>{document.title || 'Документ'}</strong><span className={cx('badge', acknowledged ? 'active' : 'warning')}>{acknowledged ? 'ознакомлен' : 'ждёт'}</span></div><p>{item.user?.name || 'Сотрудник'} · {acknowledged && document.acknowledged_at ? fmtDate(document.acknowledged_at) : `версия ${document.version || 1}`}</p></article>;
}

function OverviewInventoryLists({ assignments, rows }: { assignments: any[]; rows: any[] }) {
  const sourceItems = assignments.length
    ? assignments.map((assignment: any) => ({ id: assignment.id, inventory: { ...assignment, title: assignment.template?.title || assignment.title, status: assignment.status === 'completed' ? 'ready' : 'not_ready' }, user: assignment.completed_by }))
    : overviewInventories(rows);
  const readyItems = sourceItems.filter((item: any) => item.inventory.status === 'ready');
  const notReadyItems = sourceItems.filter((item: any) => item.inventory.status !== 'ready');
  return <section className="overviewListPanel employeeMetricsPlain"><h3>Инвентаризации</h3><div className="employeeDetailColumns overviewDetailColumns"><EmployeeDetailList title="Назначены" count={notReadyItems.length} empty="На сегодня инвентаризации не назначены" defaultOpen>{notReadyItems.map((item: any) => <OverviewInventoryCard item={item} key={item.id} />)}</EmployeeDetailList><EmployeeDetailList title="Готово" count={readyItems.length} empty="Готовых инвентаризаций сегодня нет" defaultOpen>{readyItems.map((item: any) => <OverviewInventoryCard item={item} key={item.id} />)}</EmployeeDetailList></div></section>;
}

function OverviewInventoryCard({ item }: { item: any }) {
  const inventory = item.inventory || {}; const ready = inventory.status === 'ready';
  const performer = ready ? (inventory.completed_by?.name || item.user?.name || 'Сотрудник') : 'ожидает сотрудника подразделения';
  return <article className="employeeDetailCard compact overviewDetailCard"><div className="employeeDetailCardHead"><strong>{inventory.title || 'Инвентаризация'}</strong><span className={cx('badge', ready ? 'active' : 'warning')}>{ready ? 'готово' : 'назначено'}</span></div><p>{departments[inventory.department] || inventory.department || 'Подразделение'} · {performer}{ready && inventory.completed_at ? ` · ${fmtDate(inventory.completed_at)}` : ''}</p></article>;
}

function EmployeeDetailList({ title, count, empty, children, defaultOpen = false }: { title: string; count?: number; empty: string; children: ReactNode; defaultOpen?: boolean }) {
  return <details className="employeeDetailSection compactAccordion" open={defaultOpen}>
    <summary className="employeeDetailSectionHead compactAccordionSummary"><strong>{title}</strong>{count !== undefined && <span>{count}</span>}</summary>
    <div className="employeeDetailSectionBody compactAccordionBody">
      {count === 0 ? <p className="employeeDetailEmpty">{empty}</p> : children}
    </div>
  </details>;
}

function PhotoPreviewLink({ src, alt, linkClassName, imageClassName }: { src?: string; alt: string; linkClassName: string; imageClassName: string }) {
  const [failed, setFailed] = useState(false);
  if (!src) return null;
  if (failed) return <span className="photoUnavailable">Фото недоступно</span>;
  return <a className={linkClassName} href={src} target="_blank" rel="noreferrer">
    <img className={imageClassName} src={src} alt={alt} onError={() => setFailed(true)} />
  </a>;
}

function EmployeeDetailBullets({ items, done = false }: { items: any[]; done?: boolean }) {
  const visibleItems = items.slice(0, 6);
  return <ul className="employeeDetailBullets">
    {visibleItems.map((item: any) => <li key={item.id || item.text} className={done ? 'done' : ''}>
      <span>{item.text || item.title || 'Пункт'}</span>
      {item.comment && <em>{item.comment}</em>}
      <PhotoPreviewLink src={item.photo_url} linkClassName="employeeDetailBulletPhotoLink" imageClassName="employeeDetailBulletPhoto" alt={`Фото к пункту: ${item.text || item.title || 'чек-лист'}`} />
    </li>)}
    {items.length > visibleItems.length && <li><span>Ещё {items.length - visibleItems.length}</span></li>}
  </ul>;
}

function EmployeeChecklistAuditCard({ checklist }: { checklist: any }) {
  const items = checklist.items || [...(checklist.done_items || []), ...(checklist.not_done_items || [])];
  const doneCount = items.filter((item: any) => item.done).length;
  const totalCount = items.length || (checklist.done_items?.length || 0) + (checklist.not_done_items?.length || 0);
  const completed = checklist.status === 'done';

  return <article className="employeeChecklistAuditCard">
    <div className="employeeDetailCardHead">
      <strong>{checklist.title}</strong>
      <span className={cx('badge', completed ? 'active' : 'warning')}>{completed ? 'выполнено' : 'не выполнено'}</span>
    </div>
    <p>{checklistTypes[checklist.type] || checklist.type || 'Чек-лист'} · {doneCount}/{totalCount}{checklist.completed_at ? ` · ${fmtDate(checklist.completed_at)}` : ''}</p>
    <div className="employeeChecklistAuditItems">
      {items.length === 0 && <p className="employeeDetailEmpty">Пунктов в чек-листе нет</p>}
      {items.map((item: any, index: number) => <div className={cx('employeeChecklistAuditItem', item.done && 'done')} key={item.id || `${checklist.id}-${index}`}>
        <div className="employeeChecklistAuditItemHead">
          <span>{index + 1}</span>
          <strong>{item.text || item.title || 'Пункт чек-листа'}</strong>
          <em>{item.done ? 'готово' : 'не выполнено'}</em>
        </div>
        {item.comment && <p className="employeeChecklistAuditComment">{item.comment}</p>}
        <PhotoPreviewLink src={item.photo_url} linkClassName="employeeChecklistAuditPhotoLink" imageClassName="employeeChecklistAuditPhoto" alt={`Фото к пункту: ${item.text || item.title || 'чек-лист'}`} />
      </div>)}
    </div>
  </article>;
}

function employeeTaskDescription(task: any) {
  if (task.source === 'tech_request') {
    const category = techRequestCategories[task.category] || 'Проблема';
    return `${category}${task.description ? ` · ${task.description}` : ''}`;
  }
  return `${task.description || 'Без описания'}${task.due_at ? ` · срок: ${fmtDate(task.due_at)}` : ''}`;
}

function employeeDoneTaskDescription(task: any) {
  if (task.source === 'tech_request') {
    return task.comment || task.description || 'Проблема решена менеджером';
  }
  return task.comment || (task.completed_at ? fmtDate(task.completed_at) : 'Задача закрыта');
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
          <div className="employeeDetailCardHead"><strong>{task.title}</strong><span className={cx('badge', task.overdue ? 'cancelled' : 'warning')}>{task.overdue ? 'просрочено' : task.source === 'tech_request' ? 'проблема' : 'в работе'}</span></div>
          <p>{employeeTaskDescription(task)}</p>
        </article>)}
        {doneTasks.map((task: any) => <article className="employeeDetailCard compact" key={task.id}>
          <div className="employeeDetailCardHead"><strong>{task.title}</strong><span className="badge active">выполнено</span></div>
          <p>{employeeDoneTaskDescription(task)}{task.completed_at && task.source === 'tech_request' ? ` · ${fmtDate(task.completed_at)}` : ''}</p>
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

    </div>
  </div>;
}

function OpenShiftEmployees({ shifts, rows }: { shifts: any[]; rows: any[] }) {
  const [expandedShiftId, setExpandedShiftId] = useState('');
  const metricsByUserId = useMemo(() => new Map(rows.map((row: any) => [String(row.user?.id || ''), row])), [rows]);

  return <section className="openShiftPanel">
    <h3>Сотрудники на смене</h3>
    {shifts.length === 0 && <Empty text="Сейчас нет сотрудников на смене" />}
    {shifts.length > 0 && <div className="openShiftList">
      {shifts.map((shift) => {
        const employeeId = String(shift.user_id || shift.user?.id || '');
        const metrics = metricsByUserId.get(employeeId) || {};
        const checklistDetails = metrics.checklists?.details || [];
        const doneChecklists = checklistDetails.filter((item: any) => item.status === 'done');
        const notDoneChecklists = checklistDetails.filter((item: any) => item.status !== 'done');
        const taskDetails = metrics.tasks?.details || [];
        const openTasks = taskDetails.filter((task: any) => !task.done);
        const doneTasks = taskDetails.filter((task: any) => task.done);
        const shiftId = String(shift.id || employeeId);
        const expanded = expandedShiftId === shiftId;

        return <div className={cx('openShiftEntry', expanded && 'open')} key={shiftId}>
          <button type="button" className="openShiftRow" aria-expanded={expanded} onClick={() => setExpandedShiftId(expanded ? '' : shiftId)}>
            <div className="openShiftPerson">
              <strong>{shift.user?.name || metrics.user?.name || 'Сотрудник'}</strong>
              <span>{roles[shift.user?.role || metrics.user?.role] || shift.user?.role || metrics.user?.role || 'Роль не указана'}</span>
            </div>
            <span className="openShiftStarted">С {fmtDate(shift.opened_at)}</span>
            <span className="openShiftTaskNumbers"><b className={openTasks.length ? 'todo' : 'zero'}>{openTasks.length}</b><em>/</em><b className={doneTasks.length ? 'done' : 'zero'}>{doneTasks.length}</b></span>
          </button>

          {expanded && <div className="openShiftDetails">
            <EmployeeDetailList title="Чек-листы: не выполнено" count={notDoneChecklists.length} empty="Нет невыполненных чек-листов">
              {notDoneChecklists.map((checklist: any) => <EmployeeChecklistAuditCard checklist={checklist} key={checklist.id} />)}
            </EmployeeDetailList>
            <EmployeeDetailList title="Чек-листы: выполнено" count={doneChecklists.length} empty="Выполненных чек-листов сегодня нет">
              {doneChecklists.map((checklist: any) => <EmployeeChecklistAuditCard checklist={checklist} key={checklist.id} />)}
            </EmployeeDetailList>
            <EmployeeDetailList title="Невыполненные задачи" count={openTasks.length} empty="Невыполненных задач нет">
              {openTasks.map((task: any) => <article className="employeeDetailCard compact" key={task.id}>
                <div className="employeeDetailCardHead"><strong>{task.title}</strong><span className={cx('badge', task.overdue ? 'cancelled' : 'warning')}>{task.overdue ? 'просрочено' : task.source === 'tech_request' ? 'проблема' : 'в работе'}</span></div>
                <p>{employeeTaskDescription(task)}</p>
              </article>)}
            </EmployeeDetailList>
            <EmployeeDetailList title="Выполненные задачи" count={doneTasks.length} empty="Выполненных задач пока нет">
              {doneTasks.map((task: any) => <article className="employeeDetailCard compact" key={task.id}>
                <div className="employeeDetailCardHead"><strong>{task.title}</strong><span className="badge active">выполнено</span></div>
                <p>{employeeDoneTaskDescription(task)}{task.completed_at && task.source === 'tech_request' ? ` · ${fmtDate(task.completed_at)}` : ''}</p>
              </article>)}
            </EmployeeDetailList>
          </div>}
        </div>;
      })}
    </div>}
  </section>;
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
            <span className="employeeMetricValue" data-label="Чек-листы">{metricPair(row.checklists?.done, row.checklists?.not_done)}</span>
            <span className="employeeMetricValue wide" data-label="Задачи">{taskNumbers(row.tasks)}</span>
            <span className="employeeMetricValue" data-label="Документы">{metricNumber(row.documents?.pending, 'todo')}</span>
            <span className="employeeMetricValue" data-label="Учёт">{metricPair(row.inventories?.ready, row.inventories?.not_ready)}</span>
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
        <Button type="submit">Добавить</Button>
      </form>
      {msg && <div className={msg.includes('удал') || msg.includes('обнов') || msg.includes('добав') ? 'notice compactNotice' : 'error compactNotice'}>{msg}</div>}
    </Card>

    <Card title="Сотрудники" right={<span className="badge">{users.length}</span>}>
      <div className="adminCompactList">{users.map(u => {
        const editing = editingUserId === u.id;
        return <div className={cx('adminEditableRow', editing && 'editing', u.role === 'owner' && 'locked')} key={u.id}>
          {editing ? <form className="adminInlineEditor" onSubmit={saveEdit}>
            <Field label="Имя" value={editForm.name} onChange={(e: any) => setEditForm({ ...editForm, name: e.target.value })} />
            <Field label="Логин" value={editForm.login} onChange={(e: any) => setEditForm({ ...editForm, login: e.target.value })} />
            <Field label="Новый пароль" value={editForm.password} onChange={(e: any) => setEditForm({ ...editForm, password: e.target.value })} placeholder="Не менять" />
            <Select label="Роль" value={editForm.role} onChange={(e: any) => setEditForm({ ...editForm, role: e.target.value })}>{executableRoles.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
            <label className="checkboxRow compactCheckbox"><input type="checkbox" checked={!!editForm.active} onChange={(e) => setEditForm({ ...editForm, active: e.target.checked })} /><span>{editForm.active ? 'Активен' : 'Отключён'}</span></label>
            <div className="adminInlineActions"><Button kind="soft" type="button" onClick={cancelEdit}>Отмена</Button><Button type="submit">Сохранить</Button><Button kind="danger" type="button" onClick={() => removeUser(u)}>Удалить</Button></div>
          </form> : <button type="button" className="adminRowButton" onClick={() => startEdit(u)} disabled={u.role === 'owner'}>
            <div className="adminRowMain">
              <b>{u.name}</b>
              <span>{u.login} · {roles[u.role]} · {departments[u.department]}</span>
            </div>
            <div className="adminRowMeta"><span className={`badge ${u.active ? 'active' : 'cancelled'}`}>{u.active ? 'активен' : 'выкл'}</span><em>{u.role === 'owner' ? 'Владелец' : 'Изменить'}</em></div>
          </button>}
        </div>;
      })}</div>
    </Card>
  </>;
}

function EmployeeApp({ user, restaurant, onLogout }: any) {
  const [tab, setTab] = useState<Tab>(() => initialTabFromUrl('today', ['today', 'checklists', 'bookings', 'inventory', 'tasks', 'knowledge', 'admin-checklists', 'admin-tasks']));
  const [notificationCount, setNotificationCount] = useState(0);
  const [openTechComposer, setOpenTechComposer] = useState(false);
  const [showNotificationCenter, setShowNotificationCenter] = useState(false);
  const isSenior = seniorRoles.includes(user.role);
  const tabs = withIcons([
    { id: 'today', title: 'Сегодня' }, { id: 'checklists', title: 'Чек-лист' }, { id: 'bookings', title: 'Брони' },
    { id: 'inventory', title: 'Учёт' }, { id: 'tasks', title: 'Проблемы' }, { id: 'knowledge', title: 'База' },
    ...(isSenior ? [{ id: 'admin-checklists', title: 'Редактор ЧЛ' }, { id: 'admin-tasks', title: 'Задачи отдела' }] : [])
  ]);

  async function refreshNotifications() {
    try {
      const notifications = await api('/api/notifications').catch(() => []);
      setNotificationCount(notifications.filter((item: any) => !item.read_at).length);
    } catch {
      setNotificationCount(0);
    }
  }

  useEffect(() => { refreshNotifications(); }, [tab]);

  const mobileNavItems: MobileNavItem[] = [
    { id: 'today', title: 'Обзор', icon: 'overview', active: tab === 'today', onClick: () => setTab('today') },
    { id: 'checklists', title: 'Чек-листы', icon: 'checklists', active: tab === 'checklists', onClick: () => setTab('checklists') },
    { id: 'bookings', title: 'Брони', icon: 'bookings', active: tab === 'bookings', onClick: () => setTab('bookings') },
    { id: 'tasks', title: 'Проблемы', icon: 'tasks', active: tab === 'tasks', onClick: () => setTab('tasks') },
    ...(isSenior ? [{ id: 'admin-tasks', title: 'Отдел', icon: 'users' as IconName, active: tab === 'admin-tasks' || tab === 'admin-checklists', onClick: () => setTab('admin-tasks') }] : [])
  ];

  const mobileMenuItems: MobileActionItem[] = [
    { id: 'today', title: 'Обзор', subtitle: 'Главная сводка по смене', icon: 'overview', onClick: () => setTab('today') },
    { id: 'checklists', title: 'Чек-листы', subtitle: 'Открытие, закрытие и фотоотчёты', icon: 'checklists', onClick: () => setTab('checklists') },
    { id: 'bookings', title: 'Брони', subtitle: 'Занятость столов и бронь гостей', icon: 'bookings', onClick: () => setTab('bookings') },
    { id: 'inventory', title: 'Инвентаризация', subtitle: 'Остатки и позиции отдела', icon: 'inventory', onClick: () => setTab('inventory') },
    { id: 'tasks', title: 'Проблемы и задачи', subtitle: 'Личные задачи и обращения менеджеру', icon: 'tasks', onClick: () => setTab('tasks') },
    { id: 'knowledge', title: 'База знаний', subtitle: 'Инструкции и сервис-бук', icon: 'knowledge', onClick: () => setTab('knowledge') },
    ...(isSenior ? [
      { id: 'admin-checklists', title: 'Редактор чек-листов', subtitle: 'Шаблоны своего подразделения', icon: 'checklists' as IconName, onClick: () => setTab('admin-checklists') },
      { id: 'admin-tasks', title: 'Задачи подразделения', subtitle: 'Создать задачу для своей команды', icon: 'tasks' as IconName, onClick: () => setTab('admin-tasks') }
    ] : [])
  ];

  const mobileCreateItems: MobileActionItem[] = [
    { id: 'tech', title: 'Сообщить о проблеме', subtitle: 'Поломка или сервисная ситуация', icon: 'support', onClick: () => {
      setTab('tasks');
      setOpenTechComposer(true);
    } },
    ...(isSenior ? [{ id: 'assign-inventory', title: 'Назначить инвентаризацию', subtitle: 'Бланк для своего подразделения', icon: 'inventory' as IconName, onClick: () => setTab('inventory') }] : [])
  ];

  const mobileProfileItems: MobileActionItem[] = [
    { id: 'profile', title: `${roles[user.role]} · ${restaurant?.name}`, subtitle: 'Ваш рабочий кабинет', icon: 'user', onClick: () => setTab('today') },
    { id: 'knowledge', title: 'База знаний', subtitle: 'Инструкции и сервис-бук', icon: 'knowledge', onClick: () => setTab('knowledge') },
    { id: 'install-app', title: 'Установить на телефон', subtitle: 'Добавить приложение на главный экран', icon: 'phone', onClick: () => void runPwaInstall('app') },
    { id: 'push', title: 'Уведомления телефона', subtitle: 'Задачи и комментарии с текстом', icon: 'notification', onClick: () => void runPushNotificationsEnable() },
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
      api('/api/inventory/templates').catch(() => []),
      api('/api/tech-requests').catch(() => []),
      api('/api/checklists/runs').catch(() => []),
      api('/api/inventory/runs').catch(() => [])
    ]).then(([checklists, bookings, tasks, templates, techRequests, checklistRuns, inventoryRuns]) => {
      if (!active) return;
      setOverview({
        checklists,
        bookings,
        tasks,
        templates,
        techRequests,
        checklistRuns,
        inventoryRuns
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
  const todayKey = new Date().toISOString().slice(0, 10);
  const activeBookings = overview.bookings.filter((booking: any) => ['booked', 'seated'].includes(booking.status));
  const upcomingBookings = activeBookings
    .filter((booking: any) => String(booking.reserved_for || '').slice(0, 10) === todayKey)
    .sort((a: any, b: any) => String(a.reserved_for || '').localeCompare(String(b.reserved_for || '')))
    .slice(0, 3);
  const completedChecklistTemplateIds = new Set((overview.checklistRuns || []).filter((run: any) => String(run.created_at || '').slice(0, 10) === todayKey).map((run: any) => run.template_id));
  const completedInventoryTemplateIds = new Set((overview.inventoryRuns || []).filter((run: any) => String(run.created_at || '').slice(0, 10) === todayKey).map((run: any) => run.template_id));
  const openTechRequests = (overview.techRequests || []).filter((request: any) => !['done', 'cancelled'].includes(request.status));
  const readyInventoryTemplates = overview.templates.filter((template: any) => template.items?.length);
  const pendingChecklists = overview.checklists.filter((template: any) => !completedChecklistTemplateIds.has(template.id));
  const pendingInventoryTemplates = readyInventoryTemplates;
  const priorityItems = [
    ...pendingChecklists.map((template: any) => ({ id: `checklist-${template.id}`, title: template.title, subtitle: `${checklistTypes[template.type] || 'Чек-лист'} · не выполнен сегодня`, onClick: onOpenChecklists, icon: 'checklists' as IconName })),
    ...openTasks.map((task: any) => ({ id: `task-${task.id}`, title: task.title, subtitle: `${task.description || 'Открыть задачу'}${task.due_at ? ` · срок: ${fmtDate(task.due_at)}` : ''}`, onClick: onOpenTasks, icon: 'tasks' as IconName })),
    ...openTechRequests.map((request: any) => ({ id: `tech-${request.id}`, title: request.title, subtitle: request.manager_comment || 'Проблема ожидает реакции менеджера', onClick: onOpenTasks, icon: 'support' as IconName })),
    ...upcomingBookings.map((booking: any) => ({ id: `booking-${booking.id}`, title: `${booking.guest_name || 'Гость'} · ${booking.guests_count} гост.`, subtitle: `${fmtDate(booking.reserved_for)} · ${booking.tables?.map((table: any) => table.label).join(', ') || 'стол не выбран'}`, onClick: onOpenBookings, icon: 'bookings' as IconName })),
    ...pendingInventoryTemplates.map((template: any) => ({ id: `inventory-${template.id}`, title: template.title, subtitle: completedInventoryTemplateIds.has(template.id) ? 'Подсчёт отправлен, ждёт закрытия' : 'Инвентаризация назначена', onClick: onOpenInventory, icon: 'inventory' as IconName }))
  ];

  return <div className="mobileSectionStack">
    <SectionTitle title="Сегодня" action={<button type="button" className="sectionLink" onClick={onOpenTasks}>Все задачи</button>} />
    <ShiftControl user={user} />

    <div className="mobileOverviewList">
      <button type="button" className="mobileOverviewRow" onClick={onOpenChecklists}>
        <div className="mobileOverviewIcon blue"><AppIcon name="checklists" className="navIcon" /></div>
        <div className="mobileOverviewCopy">
          <strong>Чек-листы</strong>
          <span>{completedChecklistTemplateIds.size} из {overview.checklists.length} выполнено</span>
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
          <span>{upcomingBookings.length ? `ближайшая: ${fmtDate(upcomingBookings[0].reserved_for)}` : `${activeBookings.length} активных`}</span>
        </div>
        <b>{activeBookings.length}</b>
      </button>
      <button type="button" className="mobileOverviewRow" onClick={onOpenInventory}>
        <div className="mobileOverviewIcon purple"><AppIcon name="inventory" className="navIcon" /></div>
        <div className="mobileOverviewCopy">
          <strong>Инвентаризация</strong>
          <span>{pendingInventoryTemplates.length ? `${pendingInventoryTemplates.length} нужно отправить` : 'отправлено сегодня'}</span>
        </div>
        <b>{readyInventoryTemplates.length}</b>
      </button>
    </div>

    <Card title="Приоритет" className="mobileCard compactMobileCard mobilePriorityCard">
      <div className="mobileTaskList">
        {priorityItems.slice(0, 4).map((item: any) => <button key={item.id} type="button" className="mobileTaskRow compact" onClick={item.onClick}>
          <span className="mobileTaskStatus" />
          <div className="mobileTaskCopy">
            <strong>{item.title}</strong>
            <span>{item.subtitle}</span>
          </div>
          <AppIcon name="chevron" className="navIcon" />
        </button>)}
        {priorityItems.length === 0 && <Empty text="На смену нет срочных действий" />}
      </div>
      {completedTasks.length > 0 && <div className="mobileInlineHint">Выполнено за смену: {completedTasks.length}</div>}
    </Card>
  </div>;
}

function Checklists({ user, admin = false }: any) {
  const [templates, setTemplates] = useState<any[]>([]);
  const [runs, setRuns] = useState<any[]>([]);
  const [employeeRuns, setEmployeeRuns] = useState<any[]>([]);
  const [answers, setAnswers] = useState<any>({});
  const [repeatingTemplates, setRepeatingTemplates] = useState<Record<string, boolean>>({});
  const [runMsg, setRunMsg] = useState('');
  const [editorMsg, setEditorMsg] = useState('');
  const [cameraTarget, setCameraTarget] = useState<{ itemId: string; title: string } | null>(null);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [isTemplateEditorOpen, setTemplateEditorOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [shiftState, setShiftState] = useState<any>({ current: null, last_closed: null });
  const [templateForm, setTemplateForm] = useState<any>({
    title: '',
    role: 'waiter',
    type: 'open',
    items: [{ id: '', text: '', required: true, needs_photo: false, needs_comment: false }]
  });
  const checklistRoleEntries = Object.entries(checklistRoles);
  const editableRoleEntries = admin ? checklistRoleEntries.filter(([key]) => manageableRolesFor(user).includes(key)) : checklistRoleEntries;
  const editorRoleOptions = editableRoleEntries.length ? editableRoleEntries : checklistRoleEntries;
  const defaultTemplateRole = editorRoleOptions[0]?.[0] || 'waiter';
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
    else setEmployeeRuns(await api('/api/checklists/runs'));
  }
  useEffect(() => { load(); }, []);
  async function loadShift() {
    if (admin) return;
    try {
      setShiftState(await api('/api/shifts/current'));
    } catch {
      setShiftState({ current: null, last_closed: null });
    }
  }
  useEffect(() => { loadShift(); }, [admin]);
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

  async function startShiftFromChecklist() {
    setRunMsg('');
    try {
      const result = await api('/api/shifts/start', { method: 'POST', body: JSON.stringify({ location: departments[user.department] || '' }) });
      setRunMsg(result?.offline ? 'Смена сохранена офлайн' : 'Смена начата');
      await loadShift();
    } catch (error: any) {
      setRunMsg(error.message || 'Не удалось начать смену');
    }
  }

  async function submit(template: any) {
    setRunMsg('');
    if (!shiftState.current) { setRunMsg('Сначала начните смену'); return; }
    const templateAnswers: any = {};
    template.items.forEach((i: any) => {
      const answer = answers[i.id] || {};
      const rawStatus = answer.status || (answer.done ? 'ok' : '');
      const status = rawStatus === 'na' ? '' : rawStatus;
      templateAnswers[i.id] = {
        ...answer,
        status,
        done: status === 'ok',
        comment: status === 'problem' ? (answer.comment || '') : ''
      };
    });
    const missingRequired = template.items.find((i: any) => i.required !== false && !['ok', 'problem'].includes(templateAnswers[i.id]?.status));
    if (missingRequired) { setRunMsg(`Выберите статус для обязательного пункта "${missingRequired.text}"`); return; }
    const missingPhoto = template.items.find((i: any) => i.needs_photo && templateAnswers[i.id]?.status === 'ok' && !templateAnswers[i.id]?.photo_url);
    if (missingPhoto) { setRunMsg(`Для пункта "${missingPhoto.text}" нужно сделать фото`); return; }
    const missingComment = template.items.find((i: any) => {
      const value = templateAnswers[i.id] || {};
      return value.status === 'problem' && !String(value.comment || '').trim();
    });
    if (missingComment) { setRunMsg(`Для пункта "${missingComment.text}" нужен комментарий`); return; }
    const result = await api('/api/checklists/runs', { method: 'POST', body: JSON.stringify({ template_id: template.id, answers: templateAnswers }) });
    setRunMsg(result?.offline ? 'Чек-лист сохранён офлайн' : result?.shift_closed ? 'Чек-лист сохранён, смена закрыта' : 'Чек-лист сохранён');
    setAnswers({});
    setRepeatingTemplates((current) => ({ ...current, [template.id]: false }));
    load().catch(() => undefined);
    loadShift().catch(() => undefined);
  }

  const availableTemplates = admin
    ? templates
    : templates.filter((template) => checklistRoleMatchesUser(template.role, user.role));
  const adminTemplates = admin
    ? [...availableTemplates].sort((a, b) => String(checklistRoles[a.role] || roles[a.role] || a.role).localeCompare(String(checklistRoles[b.role] || roles[b.role] || b.role), 'ru') || String(a.title || '').localeCompare(String(b.title || ''), 'ru'))
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

  const latestRunByTemplate = useMemo(() => {
    const map = new Map<string, any>();
    employeeRuns
      .filter((run: any) => String(run.created_at || '').slice(0, 10) === new Date().toISOString().slice(0, 10))
      .forEach((run: any) => {
        const current = map.get(run.template_id);
        if (!current || String(run.created_at || '').localeCompare(String(current.created_at || '')) > 0) map.set(run.template_id, run);
      });
    return map;
  }, [employeeRuns]);

  const completedChecklistItems = selectedTemplate
    ? selectedTemplate.items.filter((item: any) => answers[item.id]?.status === 'ok' || (answers[item.id]?.done && !['problem', 'na'].includes(answers[item.id]?.status))).length
    : 0;
  const problemChecklistItems = selectedTemplate
    ? selectedTemplate.items.filter((item: any) => answers[item.id]?.status === 'problem').length
    : 0;
  const selectedCompletedRun = selectedTemplate ? latestRunByTemplate.get(selectedTemplate.id) : null;
  const selectedTemplateCompleted = Boolean(selectedCompletedRun && !repeatingTemplates[selectedTemplate?.id || '']);

  const checklistRequiresPhoto = selectedTemplate?.items.some((item: any) => item.needs_photo && answers[item.id]?.status === 'ok' && !answers[item.id]?.photo_url);

  function setChecklistItemStatus(item: any, status: 'ok' | 'problem') {
    if (status === 'ok' && item.needs_photo && !answers[item.id]?.photo_url) {
      updateAnswer(item.id, { status, done: true, comment: '' });
      setCameraTarget({ itemId: item.id, title: item.text });
      return;
    }
    updateAnswer(item.id, {
      status,
      done: status === 'ok',
      photo_url: status === 'ok' ? answers[item.id]?.photo_url || '' : '',
      comment: status === 'problem' ? answers[item.id]?.comment || '' : ''
    });
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
          <Button type="submit">{editingTemplateId ? 'Сохранить изменения' : 'Создать чек-лист'}</Button>
        </div>
      </form>
      {editorMsg && <div className={editorMsg.includes('обновл') || editorMsg.includes('создан') ? 'notice' : 'error'}>{editorMsg}</div>}
    </>;
  }

  if (!admin) {
    return <div className="mobileSectionStack mobileChecklistScreen">
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
            <p>{selectedTemplateCompleted ? `Выполнено сегодня: ${fmtDate(selectedCompletedRun.created_at)}` : `Готово ${completedChecklistItems} из ${selectedTemplate.items.length}${problemChecklistItems ? ` · проблем: ${problemChecklistItems}` : ''}`}</p>
          </div>
          <span className="badge active mobileProgressBadge">{completedChecklistItems}/{selectedTemplate.items.length}</span>
        </div>
        <ProgressBar value={completedChecklistItems + problemChecklistItems} max={selectedTemplate.items.length} />
      </Card>}

      {selectedTemplate && selectedTemplateCompleted && <div className="mobileCompletedNotice">
        <strong>Чек-лист уже выполнен сегодня</strong>
        <span>{fmtDate(selectedCompletedRun.created_at)}</span>
        <button type="button" className="sectionLink" onClick={() => setRepeatingTemplates((current) => ({ ...current, [selectedTemplate.id]: true }))}>Повторить</button>
      </div>}

      {selectedTemplate && !selectedTemplateCompleted && <div className="mobileChecklistPlainList">
        {selectedTemplate.items.map((item: any, index: number) => {
          const itemAnswer = answers[item.id] || {};
          const status = itemAnswer.status || '';
          const isDone = status === 'ok' || (!!itemAnswer.done && !['problem', 'na'].includes(status));
          return <div key={item.id} className={cx('mobileChecklistLine', isDone && 'done', status === 'problem' && 'problem', item.required !== false && 'required')}>
            <div className="mobileChecklistLineBody">
              <div className="mobileChecklistLineHead">
                <strong>{item.text}</strong>
                <span className="mobileChecklistIndex">{index + 1}</span>
              </div>
              <div className="mobileChecklistSmartTags">{item.required !== false && <em>обязательный</em>}{item.needs_photo && <em>фото</em>}<b className={status === 'problem' ? 'problem' : isDone ? 'done' : 'pending'}>{status === 'problem' ? 'проблема' : isDone ? 'готово' : 'ожидает'}</b></div>
              <div className="checklistStatusButtons">
                <button type="button" className={cx(status === 'ok' && 'active')} onClick={() => setChecklistItemStatus(item, 'ok')}>Готово</button>
                <button type="button" className={cx(status === 'problem' && 'active problem')} onClick={() => setChecklistItemStatus(item, 'problem')}>Проблема</button>
              </div>
              {status === 'ok' && item.needs_photo && <div className="mobileChecklistLineMeta">
                <span className="mobileChecklistPhotoStatus">
                  <AppIcon name="camera" className="navIcon" />
                  {itemAnswer.photo_url ? 'Фото добавлено' : 'Фото нужно добавить'}
                </span>
                <button
                  type="button"
                  className="mobileChecklistRetake"
                  onClick={() => setCameraTarget({ itemId: item.id, title: item.text })}
                >
                  {itemAnswer.photo_url ? 'Переснять' : 'Снять'}
                </button>
              </div>}
              {status === 'ok' && itemAnswer.photo_url && <img className="mobileChecklistPhoto" src={itemAnswer.photo_url} alt={`Фото: ${item.text}`} />}
              {status === 'problem' && <Textarea
                label="Комментарий к проблеме"
                value={itemAnswer.comment || ''}
                onChange={(e: any) => updateAnswer(item.id, { comment: e.target.value })}
                placeholder="Что не так"
              />}
            </div>
          </div>;
        })}
      </div>}

      {selectedTemplate && !selectedTemplateCompleted && <div className="mobileChecklistActions single">
        <Button
          type="button"
          className="mobilePrimaryButton"
          disabled={!selectedTemplate || !!checklistRequiresPhoto || !shiftState.current}
          onClick={() => submit(selectedTemplate)}
        >
          {selectedTemplate.type === 'close' ? 'Завершить и закрыть смену' : 'Завершить чек-лист'}
        </Button>
        {!shiftState.current && <div className="mobileInlineHint withAction"><span>Перед чек-листом нужно начать смену.</span><Button kind="soft" type="button" onClick={startShiftFromChecklist}>Начать смену</Button></div>}
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
                  <span>{checklistRoles[template.role] || roles[template.role] || template.role} · {checklistTypes[template.type] || template.type}</span>
                </div>
                <em>{template.items?.length || 0} пунктов</em>
              </div>
            </button>
            <div className="checklistTemplateActions">
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

    {admin && <Card title="Выполненные чек-листы">
      {completedRuns.length === 0 && <Empty text="Сотрудники ещё не отправляли чек-листы" />}
      {completedRuns.length > 0 && <div className="adminChecklistReportList employeeChecklistAuditItems">
        {completedRuns.slice(0, 20).map((run: any) => {
          const template = templates.find((item: any) => item.id === run.template_id) || run.template || {};
          const templateItems = template.items || [];
          const items = templateItems.map((item: any) => {
            const answer = (run.answers || []).find((candidate: any) => candidate.item_id === item.id);
            return { ...item, done: Boolean(answer?.done), comment: answer?.comment || '', photo_url: answer?.photo_url || '' };
          });
          return <EmployeeChecklistAuditCard
            key={run.id}
            checklist={{
              id: run.id,
              title: `${template.title || 'Чек-лист'} · ${run.user?.name || 'Сотрудник'}`,
              type: template.type || run.template?.type,
              status: run.status,
              completed_at: run.completed_at || run.created_at,
              items
            }}
          />;
        })}
      </div>}
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

async function uploadPayloadFromFile(file: File) {
  return {
    name: file.name,
    file_name: file.name,
    type: file.type,
    mime_type: file.type,
    size: file.size,
    data: await readFileAsDataUrl(file)
  };
}

function Inventory({ user, admin = false }: any) {
  const [templates, setTemplates] = useState<any[]>([]);
  const [assignableTemplates, setAssignableTemplates] = useState<any[]>([]);
  const [inventoryAssignments, setInventoryAssignments] = useState<any[]>([]);
  const [assignmentForm, setAssignmentForm] = useState<any>({ template_id: '', due_date: inputDateKey() });
  const [assignmentMsg, setAssignmentMsg] = useState('');
  const [runs, setRuns] = useState<any[]>([]);
  const [employeeRuns, setEmployeeRuns] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [values, setValues] = useState<any>({});
  const [repeatingInventory, setRepeatingInventory] = useState<Record<string, boolean>>({});
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
    const canAssignInventory = admin || seniorRoles.includes(user.role);
    const today = inputDateKey();
    const [templateRows, productRows, runRows, assignableRows, assignmentRows] = await Promise.all([
      api('/api/inventory/templates'),
      admin ? api('/api/products') : Promise.resolve([]),
      admin ? api('/api/admin/inventory/runs') : api('/api/inventory/runs'),
      canAssignInventory ? api('/api/inventory/templates?assignable=1') : Promise.resolve([]),
      canAssignInventory ? api(`/api/admin/inventory/assignments?from=${today}&to=${today}`) : Promise.resolve([])
    ]);
    setTemplates(templateRows);
    setAssignableTemplates(assignableRows);
    setInventoryAssignments(assignmentRows);
    setAssignmentForm((current: any) => ({ ...current, template_id: current.template_id || assignableRows[0]?.id || '', due_date: current.due_date || today }));
    if (admin) {
      setProducts(productRows);
      setRuns(runRows);
    } else {
      setEmployeeRuns(runRows);
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

  async function removeProduct(targetProduct = editingProduct) {
    if (!targetProduct) return;
    const section = inventorySectionMeta(targetProduct.section as InventorySectionId);
    if (!window.confirm(`Удалить товар "${targetProduct.name}" из списка "${section.title}"?`)) return;
    setProductMsg('');
    try {
      await api(`/api/admin/products/${targetProduct.id}`, { method: 'DELETE' });
      if (editingProduct?.id === targetProduct.id) setEditingProduct(null);
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

  async function assignInventory(e?: FormEvent) {
    e?.preventDefault();
    setAssignmentMsg('');
    if (!assignmentForm.template_id) {
      setAssignmentMsg('Выберите бланк инвентаризации');
      return;
    }
    try {
      const result = await api('/api/admin/inventory/assignments', { method: 'POST', body: JSON.stringify(assignmentForm) });
      setAssignmentMsg(`Инвентаризация назначена: ${result.template?.title || 'бланк'}`);
      await load();
    } catch (error: any) {
      setAssignmentMsg(error.message || 'Не удалось назначить инвентаризацию');
    }
  }

  async function completeInventoryAssignment(assignment: any) {
    if (!assignment?.id) return;
    if (!window.confirm(`Отметить инвентаризацию "${assignment.template?.title || 'Инвентаризация'}" сданной? После этого она исчезнет из задач сотрудников.`)) return;
    setAssignmentMsg('');
    try {
      const result = await api(`/api/admin/inventory/assignments/${assignment.id}/complete`, { method: 'PATCH', body: JSON.stringify({}) });
      setAssignmentMsg(`Инвентаризация сдана: ${result.template?.title || 'бланк'}`);
      await load();
    } catch (error: any) {
      setAssignmentMsg(error.message || 'Не удалось закрыть инвентаризацию');
    }
  }

  async function submit(t: any) {
    const payload: any = {};
    t.items.forEach((i: any) => { payload[i.product_id] = { qty: values[i.product_id] || '', comment: '' }; });
    const result = await api('/api/inventory/runs', { method: 'POST', body: JSON.stringify({ template_id: t.id, values: payload }) });
    setValues({});
    setRepeatingInventory((current) => ({ ...current, [t.id]: false }));
    setMsg(result?.offline ? 'Инвентаризация сохранена офлайн' : 'Инвентаризация сохранена');
    load().catch(() => undefined);
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

  const canAssignInventory = admin || seniorRoles.includes(user.role);
  const assignmentPanel = canAssignInventory ? <Card title="Назначить инвентаризацию" right={<span className="badge active">только после назначения</span>}>
    <form className="form two compactAdminForm inventoryAssignForm" onSubmit={assignInventory}>
      <Select label="Бланк" value={assignmentForm.template_id} onChange={(e: any) => setAssignmentForm({ ...assignmentForm, template_id: e.target.value })}>
        {assignableTemplates.map((template: any) => <option key={template.id} value={template.id}>{template.title} · {departments[template.department] || template.department}</option>)}
      </Select>
      <Field label="Дата" type="date" value={assignmentForm.due_date} onChange={(e: any) => setAssignmentForm({ ...assignmentForm, due_date: e.target.value || inputDateKey() })} />
      <div className="actions adminFormActions"><Button type="submit">Назначить</Button></div>
    </form>
    {assignmentMsg && <div className={assignmentMsg.includes('назначена') || assignmentMsg.includes('сдана') ? 'notice' : 'error'}>{assignmentMsg}</div>}
    <div className="compactAccordionList inventoryAssignmentList">
      {inventoryAssignments.length === 0 ? <Empty text="На сегодня инвентаризации не назначены" /> : inventoryAssignments.map((assignment: any) => <div className="adminRowButton readonly inventoryAssignmentRow" key={assignment.id}>
        <span>
          <b>{assignment.template?.title || 'Инвентаризация'}</b>
          <small>{departments[assignment.department] || assignment.department} · {assignment.due_date} · подсчётов: {assignment.runs_count || 0}</small>
        </span>
        <div className="inventoryAssignmentActions">
          <em className={cx('badge', assignment.status === 'completed' ? 'active' : 'warning')}>{assignment.status === 'completed' ? 'сдано' : 'назначено'}</em>
          {assignment.status !== 'completed' && <Button type="button" kind="soft" onClick={() => completeInventoryAssignment(assignment)}>Отметить сданной</Button>}
        </div>
        {!!assignment.totals?.length && <div className="inventoryAssignmentTotals">
          {assignment.totals.slice(0, 8).map((item: any) => <span key={item.product_id}>
            <b>{item.product?.name || 'Товар'}</b>
            <em>{item.qty} {item.product?.unit || ''}</em>
          </span>)}
          {assignment.totals.length > 8 && <small>И ещё {assignment.totals.length - 8} позиций</small>}
        </div>}
      </div>)}
    </div>
  </Card> : null;

  if (!admin) {
    const selectedTemplate = templates.find((template) => template.id === selectedTemplateId) || templates[0];
    const filteredItems = selectedTemplate?.items.filter((item: any) => {
      if (!inventoryFilter.trim()) return true;
      return String(item.product?.name || '').toLowerCase().includes(inventoryFilter.trim().toLowerCase());
    }) || [];
    const selectedCompletedRun = selectedTemplate ? employeeRuns.find((run: any) => run.template_id === selectedTemplate.id) : null;
    const selectedTemplateCompleted = Boolean(selectedCompletedRun && !repeatingInventory[selectedTemplate?.id || '']);

    return <div className="mobileSectionStack mobileInventoryScreen">
      {assignmentPanel}
      <div className="mobileInventoryToolbar">
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

      <div className="mobileInventoryPlainPanel">
        <div className="mobileListSectionHead"><h3>{selectedTemplate?.title || 'Бланк инвентаризации'}</h3><span className="mobileSectionCount">{filteredItems.length}</span></div>
        {selectedTemplateCompleted ? <div className="mobileCompletedNotice">
          <strong>Инвентаризация уже отправлена сегодня</strong>
          <span>{fmtDate(selectedCompletedRun?.created_at)}</span>
          <Button kind="soft" type="button" onClick={() => setRepeatingInventory((current) => ({ ...current, [selectedTemplate.id]: true }))}>Отправить повторно</Button>
        </div> : <>
          {filteredItems.length === 0 && <Empty text="Нет товаров по этому фильтру" />}
          <div className="inventoryPlainList">
            {filteredItems.map((item: any) => {
              const rawValue = values[item.product_id] || '';
              const preview = previewInventoryTotal(rawValue);
              return <div key={item.product_id} className="inventoryPlainItem">
                <label className="inventoryPlainMain">
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
                    placeholder="0"
                  />
                  {preview && <em>Итого: {preview}</em>}
                </label>
              </div>;
            })}
          </div>
          {selectedTemplate && <Button type="button" className="mobilePrimaryButton" onClick={() => submit(selectedTemplate)}>Сохранить остатки</Button>}
        </>}
        {msg && <div className="notice mobileInlineNotice">{msg}</div>}
      </div>
    </div>;
  }

  return <>
    {admin
      ? <>
        {assignmentPanel}
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
              <Button type="submit">Добавить в список</Button>
            </div>
          </form>
          {productMsg && <div className={productMsg.includes('добавлен') || productMsg.includes('обновл') || productMsg.includes('удал') ? 'notice' : 'error'}>{productMsg}</div>}

          <div className="inventoryOwnerGrid compactInventoryOwnerGrid">
            {groupedProducts.map(section => <details className="inventorySectionBlock inventoryAccordion" key={section.id}>
              <summary className="inventoryAccordionSummary">
                <span>
                  <b>{section.title}</b>
                  <em>{section.products.length ? `${section.products.length} позиций` : 'Список пока пуст'}</em>
                </span>
                <span className="inventoryAccordionMeta">
                  <span className="badge">{section.products.length} поз.</span>
                  <AppIcon name="chevron" className="navIcon inventoryAccordionChevron" />
                </span>
              </summary>
              <div className="inventorySectionList">
                {section.products.length === 0 && <span className="muted inventorySectionEmpty">Список пока пуст</span>}
                {section.products.map((product: any) => <div className="inventorySectionItem" key={product.id}>
                  <div className="inventorySectionProductCopy">
                    <strong>{product.name}</strong>
                    <span>{product.category || section.defaultCategory}</span>
                  </div>
                  <em>{product.unit}</em>
                  <div className="inventorySectionItemActions">
                    <Button kind="soft" type="button" onClick={() => startProductEdit(product, section.id)}>Редактировать</Button>
                    <Button kind="danger" type="button" onClick={() => removeProduct({ id: product.id, section: section.id, name: product.name })}>Удалить</Button>
                  </div>
                </div>)}
              </div>
            </details>)}
          </div>
        </Card>

        <Card title="Бланки, которые заполняют сотрудники">
          <div className="compactAccordionList">
            {templates.map(template => <details className="compactAccordion" key={template.id}>
              <summary className="compactAccordionSummary">
                <div><b>{template.title}</b><span>{departments[template.department]}</span></div>
                <em>{template.items.length} поз.</em>
              </summary>
              <div className="compactAccordionBody inventoryPreviewList">
                {template.items.map((item: any) => <span key={item.product_id}>{item.product?.name || 'Товар'} · {item.product?.unit || 'шт.'}</span>)}
              </div>
            </details>)}
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
              <Button type="button" kind="soft" onClick={() => download(`/api/admin/inventory/runs/${run.id}/export.xlsx`, `inventory-${run.id}.xlsx`)}>Скачать общий Excel</Button>
            </div>)}
          </div>
        </Card>
      </>
      : <Card title="Бланки инвентаризации">
        <div className="grid">{templates.map(t => <div className="miniCard" key={t.id}>
          <div className="rowBetween"><b>{t.title}</b><span className="badge">{departments[t.department]}</span></div>
          <div className="productsGrid">{t.items.map((i: any) => <label className="productQty" key={i.product_id}><span>{i.product?.name}<em>{i.product?.unit}</em></span><input type="number" min="0" value={values[i.product_id] || ''} onChange={(e) => setValues({ ...values, [i.product_id]: e.target.value })} /></label>)}</div>
          <Button type="button" onClick={() => submit(t)}>Сохранить остатки</Button>
        </div>)}</div>
        {msg && <div className="notice">{msg}</div>}
      </Card>}
    {admin && editingProduct && <div className="modal" onClick={() => setEditingProduct(null)}>
      <div className="modalCard infoModalCard" onClick={(e) => e.stopPropagation()}>
        <div className="rowBetween">
          <h2>Редактировать товар</h2>
          <button type="button" className="iconBtn" onClick={() => setEditingProduct(null)} aria-label="Закрыть">×</button>
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
              <Button type="submit">Сохранить товар</Button>
            </div>
          </div>
        </form>
      </div>
    </div>}
  </>;
}

function cleanKnowledgeDocumentLine(value: any) {
  return String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeKnowledgeTtkTitle(value: any) {
  return cleanKnowledgeDocumentLine(value)
    .replace(/^Блюдо\/напиток:\s*/i, '')
    .replace(/^Название на чеке:\s*/i, '')
    .replace(/(\d+)\s+(мл|л|г|кг|шт|порц)\b/gi, '$1$2')
    .replace(/\s+(\d+(?:мл|л|г|кг|шт|порц)\b)/gi, '\u00a0$1')
    .trim();
}

function isTtkTitleContinuation(line: string) {
  return /^\d+\s*(?:мл|л|г|кг|шт|порц)\b/i.test(cleanKnowledgeDocumentLine(line));
}

function getTtkTitleFromDocument(doc: any) {
  const lines = String(doc?.content || '').split('\n').map(cleanKnowledgeDocumentLine).filter(Boolean);
  const titleIndex = lines.findIndex(line => /^Блюдо\/напиток:/i.test(line));
  if (titleIndex >= 0) {
    const pieces = [lines[titleIndex].replace(/^Блюдо\/напиток:\s*/i, '')];
    for (let i = titleIndex + 1; i < Math.min(lines.length, titleIndex + 4); i += 1) {
      if (isTtkTitleContinuation(lines[i])) pieces.push(lines[i]);
      else break;
    }
    const title = normalizeKnowledgeTtkTitle(pieces.join(' '));
    if (title) return title;
  }
  return normalizeKnowledgeTtkTitle(doc?.title || 'ТТК');
}

function buildPlainKnowledgeText(doc: any) {
  const rawContent = String(doc?.content || '').trim();

  if (doc?.type === 'ttk') {
    const contentLines = rawContent.split('\n').map(cleanKnowledgeDocumentLine).filter(Boolean);
    const title = getTtkTitleFromDocument(doc);
    const headerLine = contentLines.find(line => /^Технологическая карта/i.test(line));
    const dateLine = contentLines.find(line => /^Дата:/i.test(line));
    const ingredients = Array.isArray(doc?.ingredients) ? doc.ingredients : [];
    const textLines: string[] = [];

    if (headerLine) textLines.push(headerLine);
    if (dateLine) textLines.push(dateLine);
    if (title) textLines.push(title);
    if (textLines.length) textLines.push('');
    textLines.push('Состав');

    if (ingredients.length > 0) {
      ingredients.forEach((item: any, index: number) => {
        const name = cleanKnowledgeDocumentLine(item?.name);
        const unit = cleanKnowledgeDocumentLine(item?.unit);
        const qty = cleanKnowledgeDocumentLine(item?.display_qty || item?.qty);
        if (name && qty) textLines.push(`${index + 1}. ${name} — ${qty}${unit ? ` ${unit}` : ''}`);
      });
    } else {
      const rawIngredientLines = contentLines
        .filter(line => /^[-–—]\s+/.test(line))
        .map(line => line.replace(/^[-–—]\s+/, '').trim());
      if (rawIngredientLines.length) rawIngredientLines.forEach((line, index) => textLines.push(`${index + 1}. ${line}`));
      else textLines.push('Состав не удалось извлечь автоматически. Проверьте исходный PDF или обновите ТТК.');
    }

    return textLines.join('\n');
  }

  if (rawContent) return rawContent;
  if (doc?.file_url) return `Открыть документ: ${doc.file_url}`;
  return 'Текст документа не заполнен';
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


function KnowledgeDocumentModal({ doc, onClose, onAck, plainMobile = false }: { doc: any; onClose: () => void; onAck: (doc: any) => void; plainMobile?: boolean }) {
  const rawContent = String(doc?.content || '').trim();
  const isPlainText = doc?.type === 'text' || doc?.type === 'ttk' || (plainMobile && !!rawContent) || (!!rawContent && !doc?.file_url);

  if (isPlainText) {
    return <div className="plainTextDocOverlay" onClick={onClose}>
      <button type="button" className="plainTextDocClose" onClick={onClose} aria-label="Закрыть документ">×</button>
      <pre className="plainTextDocumentOnly" onClick={(e) => e.stopPropagation()}>{buildPlainKnowledgeText(doc)}</pre>
      {doc.requires_acknowledgement && !doc.acknowledged && <button className="plainTextAckButton" type="button" onClick={(e) => { e.stopPropagation(); onAck(doc); }}>Ознакомился</button>}
    </div>;
  }

  return <div className="modal" onClick={onClose}>
    <div className="modalCard mobileDocModal" onClick={(e) => e.stopPropagation()}>
      <div className="rowBetween">
        <h2>{doc.title}</h2>
        <button type="button" className="iconBtn" onClick={onClose} aria-label="Закрыть">×</button>
      </div>
      <KnowledgeDocumentBody doc={doc} />
      {doc.requires_acknowledgement && !doc.acknowledged && <Button type="button" onClick={() => onAck(doc)}>Ознакомился</Button>}
    </div>
  </div>;
}

function RoleAccessPicker({ value, onChange }: { value: string[]; onChange: (roles: string[]) => void }) {
  const selected = Array.isArray(value) ? value : [];
  function toggle(role: string) {
    onChange(selected.includes(role) ? selected.filter(item => item !== role) : [...selected, role]);
  }
  return <div className="roleAccessPicker">
    <div className="roleAccessHead"><strong>Доступ</strong><span>{selected.length ? `${selected.length} ролей` : 'Все сотрудники'}</span></div>
    <div className="roleAccessGrid">
      {executableRoles.map(([key, label]) => <label key={key} className="roleAccessOption">
        <input type="checkbox" checked={selected.includes(key)} onChange={() => toggle(key)} />
        <span>{label}</span>
      </label>)}
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
        allowed_roles: Array.isArray(docForm.allowed_roles) ? docForm.allowed_roles : [],
        requires_acknowledgement: docForm.requires_acknowledgement !== false
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
      await api(`/api/admin/knowledge/documents/${docId}`, { method: 'PATCH', body: JSON.stringify({ ...docEditForm, allowed_roles: Array.isArray(docEditForm.allowed_roles) ? docEditForm.allowed_roles : [], requires_acknowledgement: docEditForm.requires_acknowledgement !== false }) });
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

      {openDoc && <KnowledgeDocumentModal doc={openDoc} onClose={() => setOpenDoc(null)} onAck={ack} plainMobile />}
    </>;
  }

  return <>
    <Card title="Добавить документацию">
      <form className="form two" onSubmit={createCat}>
        <Field label="Новая папка" value={catForm.title} onChange={(e: any) => setCatForm({ ...catForm, title: e.target.value })} placeholder="Например: Сервис-бук" />
        <Button type="submit" kind="soft">Создать папку</Button>
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
        <RoleAccessPicker value={docForm.allowed_roles} onChange={(allowed_roles) => setDocForm({ ...docForm, allowed_roles })} />
        <label className="checkboxRow compactCheckbox"><input type="checkbox" checked={docForm.requires_acknowledgement !== false} onChange={(e) => setDocForm({ ...docForm, requires_acknowledgement: e.target.checked })} /><span>Требовать ознакомление</span></label>
        <Button type="submit">{docForm.type === 'ttk' ? 'Загрузить и разобрать ТТК' : 'Добавить документ'}</Button>
      </form>
      {knowledgeMsg && <div className={knowledgeMsg.includes('создан') || knowledgeMsg.includes('сохран') || knowledgeMsg.includes('удал') ? 'notice' : 'error'}>{knowledgeMsg}</div>}
    </Card>

    <Card title="База знаний / ТТК / сервис-бук">
      {categories.length === 0 && <Empty text="Документов нет" />}
      <div className="knowledgeAdminList">{categories.map(c => <details className="knowledgeAdminFolder compactAccordion" key={c.id}>
        <summary className="knowledgeAdminFolderHead compactAccordionSummary">
          {editingCategoryId === c.id
            ? <input value={categoryEditTitle} onChange={(e) => setCategoryEditTitle(e.target.value)} placeholder="Название папки" />
            : <div><b>{c.title}</b><span>{c.documents.length} документов</span></div>}
          <div className="adminInlineActions" onClick={(event) => event.stopPropagation()}>
            {editingCategoryId === c.id ? <>
              <Button kind="soft" type="button" onClick={() => setEditingCategoryId('')}>Отмена</Button>
              <Button type="button" onClick={() => saveCategory(c.id)}>Сохранить</Button>
            </> : <>
              <Button kind="soft" type="button" onClick={() => startEditCategory(c)}>Редактировать</Button>
              <Button kind="danger" type="button" onClick={() => deleteCategory(c)}>Удалить</Button>
            </>}
          </div>
        </summary>

        <div className="knowledgeAdminDocs compactAccordionBody">
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
              <RoleAccessPicker value={docEditForm.allowed_roles} onChange={(allowed_roles) => setDocEditForm({ ...docEditForm, allowed_roles })} />
              <label className="checkboxRow compactCheckbox"><input type="checkbox" checked={docEditForm.requires_acknowledgement !== false} onChange={(e) => setDocEditForm({ ...docEditForm, requires_acknowledgement: e.target.checked })} /><span>Требовать ознакомление</span></label>
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
      </details>)}</div>
    </Card>

    {openDoc && <KnowledgeDocumentModal doc={openDoc} onClose={() => setOpenDoc(null)} onAck={ack} />}
    <Card title="Статистика ознакомления"><div className="list">{stats.map(s => <details className="knowledgeStatsRow compactAccordion" key={s.id}><summary className="listRow compactAccordionSummary"><div><b>{s.title}</b><span>Просмотры: {s.views}</span></div><span className="badge active">Ознакомились: {s.acknowledgements} из {s.targets_count || 0}</span></summary>{s.pending_users?.length > 0 && <div className="compactAccordionBody knowledgePendingUsers">{s.pending_users.map((employee: any) => <span key={employee.id}>{employee.name}</span>)}</div>}</details>)}</div></Card>
  </>;
}
