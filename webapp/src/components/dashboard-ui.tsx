import { ReactNode } from 'react';

export type IconName =
  | 'overview'
  | 'users'
  | 'checklists'
  | 'requests'
  | 'bookings'
  | 'inventory'
  | 'tasks'
  | 'knowledge'
  | 'notification'
  | 'logout'
  | 'trial'
  | 'support'
  | 'chevron'
  | 'menu'
  | 'back'
  | 'plus'
  | 'more'
  | 'close'
  | 'user'
  | 'login'
  | 'password'
  | 'phone'
  | 'email'
  | 'city'
  | 'role'
  | 'restaurant'
  | 'document'
  | 'spark'
  | 'camera'
  | 'search'
  | 'filter'
  | 'folder'
  | 'file';

export type NavTab = {
  id: string;
  title: string;
  icon?: IconName;
};

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

export function AppIcon({ name, className }: { name: IconName; className?: string }) {
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const
  };

  switch (name) {
    case 'overview':
      return <svg className={className} viewBox="0 0 24 24" aria-hidden="true"><path d="M4.75 6.25A1.5 1.5 0 0 1 6.25 4.75h4a1.5 1.5 0 0 1 1.5 1.5v4a1.5 1.5 0 0 1-1.5 1.5h-4a1.5 1.5 0 0 1-1.5-1.5v-4Z" {...common} /><path d="M12.25 6.25a1.5 1.5 0 0 1 1.5-1.5h4a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-4a1.5 1.5 0 0 1-1.5-1.5v-8Z" {...common} /><path d="M4.75 15.75a1.5 1.5 0 0 1 1.5-1.5h4a1.5 1.5 0 0 1 1.5 1.5v2a1.5 1.5 0 0 1-1.5 1.5h-4a1.5 1.5 0 0 1-1.5-1.5v-2Z" {...common} /></svg>;
    case 'users':
      return <svg className={className} viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.1" {...common} /><path d="M3.75 18.25A4.75 4.75 0 0 1 8.5 13.5h1A4.75 4.75 0 0 1 14.25 18.25" {...common} /><path d="M16.5 5.2a2.85 2.85 0 1 1 0 5.6" {...common} /><path d="M16.25 13.75c2.3 0 4 1.72 4 4.1" {...common} /></svg>;
    case 'checklists':
      return <svg className={className} viewBox="0 0 24 24" aria-hidden="true"><rect x="4.5" y="4.5" width="15" height="15" rx="3" {...common} /><path d="m8 8.25 1.4 1.4 2.2-2.4" {...common} /><path d="M12.5 8.6h3.75" {...common} /><path d="m8 12.15 1.4 1.4 2.2-2.4" {...common} /><path d="M12.5 12.5h3.75" {...common} /><path d="m8 16.05 1.4 1.4 2.2-2.4" {...common} /><path d="M12.5 16.4h3.75" {...common} /></svg>;
    case 'requests':
      return <svg className={className} viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 8.25h9l2 2.3v6.95a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-6.95l2-2.3Z" {...common} /><path d="M7.5 8.25 8.9 5.5h6.2l1.4 2.75" {...common} /><path d="M8.5 12h7" {...common} /><path d="M10.25 14.75h3.5" {...common} /></svg>;
    case 'bookings':
      return <svg className={className} viewBox="0 0 24 24" aria-hidden="true"><rect x="4.75" y="5.25" width="14.5" height="13.5" rx="2.4" {...common} /><path d="M8 3.75v3" {...common} /><path d="M16 3.75v3" {...common} /><path d="M4.75 9.5h14.5" {...common} /><path d="M8 13.25h3.25" {...common} /><path d="M12.95 15.1 14.7 16.85 18.1 12.95" {...common} /></svg>;
    case 'inventory':
      return <svg className={className} viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3.75 7 3.9v8.7l-7 3.9-7-3.9v-8.7l7-3.9Z" {...common} /><path d="m5 7.65 7 3.85 7-3.85" {...common} /><path d="M12 11.55v8.7" {...common} /></svg>;
    case 'tasks':
      return <svg className={className} viewBox="0 0 24 24" aria-hidden="true"><rect x="4.5" y="4.5" width="15" height="15" rx="3" {...common} /><path d="m8.2 12.2 2.1 2.15 5.55-5.55" {...common} /></svg>;
    case 'knowledge':
      return <svg className={className} viewBox="0 0 24 24" aria-hidden="true"><path d="M6.25 5.25h4.2a3.3 3.3 0 0 1 3.3 3.3v10a3.3 3.3 0 0 0-3.3-3.3h-4.2v-10Z" {...common} /><path d="M17.75 5.25h-4.2a3.3 3.3 0 0 0-3.3 3.3v10a3.3 3.3 0 0 1 3.3-3.3h4.2v-10Z" {...common} /><path d="M14.5 8.7h2.2" {...common} /><path d="M14.5 11.8h2.2" {...common} /></svg>;
    case 'notification':
      return <svg className={className} viewBox="0 0 24 24" aria-hidden="true"><path d="M9.75 18.25a2.25 2.25 0 0 0 4.5 0" {...common} /><path d="M18.25 16.5v-4a6.25 6.25 0 1 0-12.5 0v4l-1.5 1.75h15.5l-1.5-1.75Z" {...common} /><path d="M12 4V3" {...common} /></svg>;
    case 'logout':
      return <svg className={className} viewBox="0 0 24 24" aria-hidden="true"><path d="m15.5 16.75 4.25-4.25-4.25-4.25" {...common} /><path d="M19.4 12.5H10.5" {...common} /><path d="M11 19.25H6.75a2 2 0 0 1-2-2V7.75a2 2 0 0 1 2-2H11" {...common} /></svg>;
    case 'trial':
      return <svg className={className} viewBox="0 0 24 24" aria-hidden="true"><path d="M8.25 4h7.5" {...common} /><path d="M9.25 4.25v2.4a3.4 3.4 0 0 0 1.1 2.5l1.65 1.5-1.65 1.5a3.4 3.4 0 0 0-1.1 2.5v2.35" {...common} /><path d="M14.75 4.25v2.4a3.4 3.4 0 0 1-1.1 2.5L12 10.65l1.65 1.5a3.4 3.4 0 0 1 1.1 2.5v2.35" {...common} /><path d="M8.25 20h7.5" {...common} /></svg>;
    case 'support':
      return <svg className={className} viewBox="0 0 24 24" aria-hidden="true"><path d="M12 18.75c-3.9 0-7-2.78-7-6.25s3.1-6.25 7-6.25 7 2.78 7 6.25c0 1.34-.47 2.58-1.28 3.6L18.5 20l-3.38-1.5c-.9.17-1.88.25-3.12.25Z" {...common} /><path d="M9.6 10.15a2.4 2.4 0 1 1 4.15 1.62c-.62.6-1.1.98-1.1 1.88" {...common} /><path d="M12 15.85h.01" {...common} /></svg>;
    case 'chevron':
      return <svg className={className} viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" {...common} /></svg>;
    case 'menu':
      return <svg className={className} viewBox="0 0 24 24" aria-hidden="true"><path d="M4.75 7.25h14.5" {...common} /><path d="M4.75 12h14.5" {...common} /><path d="M4.75 16.75h10.5" {...common} /></svg>;
    case 'back':
      return <svg className={className} viewBox="0 0 24 24" aria-hidden="true"><path d="m14.75 6.5-5.5 5.5 5.5 5.5" {...common} /><path d="M9.5 12h9" {...common} /></svg>;
    case 'plus':
      return <svg className={className} viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14" {...common} /><path d="M5 12h14" {...common} /></svg>;
    case 'more':
      return <svg className={className} viewBox="0 0 24 24" aria-hidden="true"><circle cx="6.5" cy="12" r="1.2" {...common} /><circle cx="12" cy="12" r="1.2" {...common} /><circle cx="17.5" cy="12" r="1.2" {...common} /></svg>;
    case 'close':
      return <svg className={className} viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10" {...common} /><path d="M17 7 7 17" {...common} /></svg>;
    case 'user':
    case 'login':
      return <svg className={className} viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="7.75" r="3.2" {...common} /><path d="M5.25 18.75a6.75 6.75 0 0 1 13.5 0" {...common} /></svg>;
    case 'password':
      return <svg className={className} viewBox="0 0 24 24" aria-hidden="true"><rect x="5.25" y="10.75" width="13.5" height="8.5" rx="2.2" {...common} /><path d="M8.3 10.75V8.5a3.7 3.7 0 0 1 7.4 0v2.25" {...common} /><path d="M12 14.2v1.6" {...common} /></svg>;
    case 'phone':
      return <svg className={className} viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.75h2.55L10.8 8.9l-1.65 1.55a13.8 13.8 0 0 0 4.4 4.4l1.55-1.65 4.15 1.25V17a2.1 2.1 0 0 1-2.32 2.1A16.4 16.4 0 0 1 4.9 7.07 2.1 2.1 0 0 1 7 4.75Z" {...common} /></svg>;
    case 'email':
      return <svg className={className} viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5.75" width="16" height="12.5" rx="2.4" {...common} /><path d="m5.5 7.5 6.5 4.9 6.5-4.9" {...common} /></svg>;
    case 'city':
      return <svg className={className} viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.75s5.75-5.15 5.75-9.5a5.75 5.75 0 1 0-11.5 0c0 4.35 5.75 9.5 5.75 9.5Z" {...common} /><circle cx="12" cy="11.25" r="2.15" {...common} /></svg>;
    case 'role':
      return <svg className={className} viewBox="0 0 24 24" aria-hidden="true"><path d="m12 4.25 6.75 2.8v4.85c0 4.2-2.95 6.95-6.75 7.85-3.8-.9-6.75-3.65-6.75-7.85V7.05L12 4.25Z" {...common} /><path d="m9.6 11.95 1.55 1.55 3.3-3.35" {...common} /></svg>;
    case 'restaurant':
      return <svg className={className} viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 9.25h15v8.95a2.05 2.05 0 0 1-2.05 2.05H6.55A2.05 2.05 0 0 1 4.5 18.2V9.25Z" {...common} /><path d="M5.3 9.25 6.6 4.75h10.8l1.3 4.5" {...common} /><path d="M9.25 13.5h4v6.75h-4Z" {...common} /></svg>;
    case 'document':
      return <svg className={className} viewBox="0 0 24 24" aria-hidden="true"><path d="M7.25 4.25h6.1l3.4 3.4v11a2 2 0 0 1-2 2h-7.5a2 2 0 0 1-2-2v-12.4a2 2 0 0 1 2-2Z" {...common} /><path d="M13.25 4.25v3.8h3.8" {...common} /><path d="M9.4 12h5.2" {...common} /><path d="M9.4 15.4h5.2" {...common} /></svg>;
    case 'spark':
      return <svg className={className} viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3.5 1.5 4.1 4.1 1.5-4.1 1.5L12 14.7l-1.5-4.1-4.1-1.5 4.1-1.5L12 3.5Z" {...common} /><path d="m18.25 12.75.8 2.1 2.1.8-2.1.8-.8 2.1-.8-2.1-2.1-.8 2.1-.8.8-2.1Z" {...common} /><path d="m6.5 14.5.9 2.35 2.35.9-2.35.9-.9 2.35-.9-2.35-2.35-.9 2.35-.9.9-2.35Z" {...common} /></svg>;
    case 'camera':
      return <svg className={className} viewBox="0 0 24 24" aria-hidden="true"><path d="M6.25 8.25h2.5l1.2-2h4.1l1.2 2h2.5a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-11.5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z" {...common} /><circle cx="12" cy="13" r="3.2" {...common} /></svg>;
    case 'search':
      return <svg className={className} viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.75" cy="10.75" r="5.75" {...common} /><path d="m15 15 4.25 4.25" {...common} /></svg>;
    case 'filter':
      return <svg className={className} viewBox="0 0 24 24" aria-hidden="true"><path d="M4.75 7.25h14.5" {...common} /><path d="M7.75 12h8.5" {...common} /><path d="M10.75 16.75h2.5" {...common} /></svg>;
    case 'folder':
      return <svg className={className} viewBox="0 0 24 24" aria-hidden="true"><path d="M4.75 7.25a2 2 0 0 1 2-2H10l1.6 1.75h5.65a2 2 0 0 1 2 2v7.75a2 2 0 0 1-2 2H6.75a2 2 0 0 1-2-2V7.25Z" {...common} /></svg>;
    case 'file':
      return <svg className={className} viewBox="0 0 24 24" aria-hidden="true"><path d="M7.25 4.75h6.6l3.15 3.15v11.35a2 2 0 0 1-2 2h-7.75a2 2 0 0 1-2-2V6.75a2 2 0 0 1 2-2Z" {...common} /><path d="M13.85 4.75v3.35h3.15" {...common} /><path d="M8.95 12.2h6.1" {...common} /><path d="M8.95 15.2h4.4" {...common} /></svg>;
    default:
      return null;
  }
}

export function Button({ children, kind = 'primary', icon, className, ...props }: any) {
  return <button className={cn('btn', kind, className)} {...props}>
    {icon && <AppIcon name={icon} className="btnIcon" />}
    <span>{children}</span>
  </button>;
}

export function Card({ title, children, right, className }: { title?: string; children: ReactNode; right?: ReactNode; className?: string }) {
  return <section className={cn('card', className)}>
    {title && <div className="cardHead"><h3>{title}</h3>{right}</div>}
    {children}
  </section>;
}

export function WorkspaceHeader({
  userName,
  roleLabel,
  onLogout,
  onNotifications
}: {
  userName: string;
  roleLabel: string;
  onLogout: () => void;
  onNotifications?: () => void;
}) {
  return <header className="workspaceHeader">
    <div className="workspaceGreeting">
      <h1>Добро пожаловать, <span>{userName}</span></h1>
      <p>{roleLabel}</p>
    </div>
    <div className="workspaceActions">
      <button type="button" className="iconGhost" aria-label="Уведомления" onClick={onNotifications}>
        <AppIcon name="notification" className="navIcon" />
        <span className="notificationDot" />
      </button>
      <Button type="button" kind="ghost" icon="logout" onClick={onLogout}>Выйти</Button>
    </div>
  </header>;
}

export function SidebarNav({
  logoSrc,
  tabs,
  active,
  onChange,
  onPromoClick,
  onSupportClick
}: {
  logoSrc: string;
  tabs: NavTab[];
  active: string;
  onChange: (next: string) => void;
  onPromoClick?: () => void;
  onSupportClick?: () => void;
}) {
  return <aside className="dashboardSidebar">
    <div className="sidebarBrand">
      <img src={logoSrc} alt="Resto Control" className="sidebarLogo" />
    </div>
    <nav className="sidebarNav">
      {tabs.map(tab => <button
        key={tab.id}
        type="button"
        className={cn('sidebarNavItem', active === tab.id && 'active')}
        onClick={() => onChange(tab.id)}
      >
        <AppIcon name={tab.icon || 'overview'} className="navIcon" />
        <span>{tab.title}</span>
      </button>)}
    </nav>

    <div className="sidebarPromo">
      <div className="sidebarPromoBadge">
        <AppIcon name="spark" className="navIcon" />
      </div>
      <div className="sidebarPromoBody">
        <strong>Профессиональный контроль ресторана</strong>
        <p>Автоматизируйте процессы и повышайте качество обслуживания.</p>
      </div>
      <button type="button" className="sidebarPromoAction" onClick={onPromoClick}>
        <span>Узнать больше</span>
        <AppIcon name="chevron" className="navIcon" />
      </button>
    </div>

    <button type="button" className="sidebarSupport" onClick={onSupportClick}>
      <AppIcon name="support" className="navIcon" />
      <span>Поддержка</span>
    </button>
  </aside>;
}

export function TrialBanner({
  headline,
  subline,
  onAction
}: {
  headline: string;
  subline: string;
  onAction?: () => void;
}) {
  return <section className="trialBanner">
    <div className="trialBannerCopy">
      <div className="trialBadge">
        <AppIcon name="trial" className="navIcon" />
      </div>
      <div className="trialText">
        <strong>{headline}</strong>
        <span>{subline}</span>
      </div>
    </div>
    <Button type="button" kind="ghost" icon="chevron" onClick={onAction}>Тарифы и оплата</Button>
  </section>;
}

export function StatCard({
  icon,
  title,
  value,
  caption,
  details,
  onClick
}: {
  icon: IconName;
  title: string;
  value: ReactNode;
  caption?: ReactNode;
  details?: Array<{ label: string; value: string | number }>;
  onClick?: () => void;
}) {
  const compactValue = (typeof value === 'string' || typeof value === 'number') && String(value).length > 5;
  const content = <>
    <div className="statBadge">
      <AppIcon name={icon} className="navIcon" />
    </div>
    <div className="statCopy">
      <span className="statLabel">{title}</span>
      <strong className={cn('statValue', compactValue && 'compact')}>{value}</strong>
      {caption ? <span className="statCaption">{caption}</span> : null}
      {details?.length ? <span className="statBreakdown">
        {details.map((item) => <span className="statBreakdownItem" key={item.label}>
          <span>{item.label}</span>
          <b>{item.value}</b>
        </span>)}
      </span> : null}
    </div>
  </>;

  if (onClick) {
    return <button type="button" className="statCard statCardButton" data-icon={icon} onClick={onClick}>{content}</button>;
  }

  return <article className="statCard" data-icon={icon}>{content}</article>;
}
