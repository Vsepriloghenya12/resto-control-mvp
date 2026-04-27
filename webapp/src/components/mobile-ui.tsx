import { ReactNode } from 'react';
import { AppIcon, type IconName } from './dashboard-ui';

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

export type MobileNavItem = {
  id: string;
  title: string;
  icon: IconName;
  active?: boolean;
  onClick: () => void;
};

export type MobileActionItem = {
  id: string;
  title: string;
  subtitle?: string;
  icon: IconName;
  onClick: () => void;
};

export function PageContainer({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('pageContainer', className)}>{children}</div>;
}

export function SectionTitle({
  title,
  subtitle,
  action
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return <div className="sectionTitle">
    <div>
      <h2>{title}</h2>
      {subtitle && <p>{subtitle}</p>}
    </div>
    {action}
  </div>;
}

export function ProgressBar({ value, max }: { value: number; max: number }) {
  const safeMax = Math.max(1, max);
  const percent = Math.max(0, Math.min(100, Math.round((value / safeMax) * 100)));
  return <div className="progressBar" aria-hidden="true">
    <div className="progressBarFill" style={{ width: `${percent}%` }} />
  </div>;
}

export function CircularProgress({ value, max }: { value: number; max: number }) {
  const safeMax = Math.max(1, max);
  const percent = Math.max(0, Math.min(100, Math.round((value / safeMax) * 100)));
  return <div
    className="circularProgress"
    style={{ background: `conic-gradient(#22C55E ${percent * 3.6}deg, rgba(255,255,255,0.08) 0deg)` }}
    aria-hidden="true"
  >
    <div className="circularProgressInner">{percent}%</div>
  </div>;
}

export function MobileHeader({
  mode = 'page',
  title,
  subtitle,
  logoSrc,
  userInitials,
  notificationCount = 0,
  showMenuButton = true,
  showNotifications = true,
  onMenu,
  onBack,
  onNotifications,
  onAction,
  actionIcon = 'more'
}: {
  mode?: 'overview' | 'page';
  title: ReactNode;
  subtitle?: ReactNode;
  logoSrc: string;
  userInitials: string;
  notificationCount?: number;
  showMenuButton?: boolean;
  showNotifications?: boolean;
  onMenu?: () => void;
  onBack?: () => void;
  onNotifications?: () => void;
  onAction?: () => void;
  actionIcon?: IconName;
}) {
  return <header className="mobileHeader">
    <div className="mobileTopbar">
      <div className="mobileTopbarLeft">
        {(mode !== 'overview' || showMenuButton) && <button type="button" className="mobileIconButton" onClick={mode === 'overview' ? onMenu : onBack} aria-label={mode === 'overview' ? 'Открыть меню' : 'Назад'}>
          <AppIcon name={mode === 'overview' ? 'menu' : 'back'} className="navIcon" />
        </button>}
        <div className="mobileBrand">
          <img src={logoSrc} alt="Resto Control" className="mobileLogo" />
        </div>
      </div>

      <div className="mobileTopbarRight">
        {showNotifications && <button type="button" className="mobileIconButton notificationButton" onClick={onNotifications} aria-label="Уведомления">
          <AppIcon name="notification" className="navIcon" />
          {notificationCount > 0 && <span className="mobileNotificationBadge">{notificationCount > 9 ? '9+' : notificationCount}</span>}
        </button>}
        {mode === 'overview'
          ? <button type="button" className="mobileAvatarButton" onClick={onAction} aria-label="Профиль">
            <span>{userInitials}</span>
          </button>
          : <button type="button" className="mobileIconButton" onClick={onAction} aria-label="Действия">
            <AppIcon name={actionIcon} className="navIcon" />
          </button>}
      </div>
    </div>

    <div className={cn('mobileHeaderCopy', mode === 'overview' && 'overview')}>
      <h1>{title}</h1>
      {subtitle && <p>{subtitle}</p>}
    </div>
  </header>;
}

export function BottomNavigation({
  items,
  onCreate
}: {
  items: MobileNavItem[];
  onCreate: () => void;
}) {
  const leftItems = items.slice(0, 2);
  const rightItems = items.slice(2, 4);

  return <nav className="bottomNavigation" aria-label="Основная навигация">
    <div className="bottomNavigationRail">
      {leftItems.map(item => <button key={item.id} type="button" className={cn('bottomNavItem', item.active && 'active')} onClick={item.onClick}>
        <AppIcon name={item.icon} className="navIcon" />
        <span>{item.title}</span>
      </button>)}
      <button type="button" className="bottomNavItem bottomNavCreateItem" onClick={onCreate} aria-label="Создать">
        <span className="bottomNavCreateBadge">
          <AppIcon name="plus" className="navIcon" />
        </span>
        <span>Создать</span>
      </button>
      {rightItems.map(item => <button key={item.id} type="button" className={cn('bottomNavItem', item.active && 'active')} onClick={item.onClick}>
        <AppIcon name={item.icon} className="navIcon" />
        <span>{item.title}</span>
      </button>)}
    </div>
  </nav>;
}

export function BottomSheet({
  open,
  title,
  items,
  onClose
}: {
  open: boolean;
  title: string;
  items: MobileActionItem[];
  onClose: () => void;
}) {
  if (!open) return null;

  return <div className="bottomSheetBackdrop" onClick={onClose}>
    <div className="bottomSheet" onClick={(event) => event.stopPropagation()}>
      <div className="bottomSheetHandle" />
      <div className="bottomSheetHead">
        <h3>{title}</h3>
        <button type="button" className="mobileIconButton" onClick={onClose} aria-label="Закрыть">
          <AppIcon name="close" className="navIcon" />
        </button>
      </div>
      <div className="bottomSheetList">
        {items.map(item => <button key={item.id} type="button" className="bottomSheetItem" onClick={() => {
          item.onClick();
          onClose();
        }}>
          <div className="bottomSheetItemIcon">
            <AppIcon name={item.icon} className="navIcon" />
          </div>
          <div className="bottomSheetItemCopy">
            <strong>{item.title}</strong>
            {item.subtitle && <span>{item.subtitle}</span>}
          </div>
          <AppIcon name="chevron" className="navIcon" />
        </button>)}
      </div>
    </div>
  </div>;
}
