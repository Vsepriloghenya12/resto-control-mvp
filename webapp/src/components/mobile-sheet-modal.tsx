import { ReactNode } from 'react';
import { AppIcon } from './dashboard-ui';
import { cx } from '../lib/cx';

export function MobileSheetModal({
  title,
  subtitle,
  children,
  footer,
  onClose,
  className
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  className?: string;
}) {
  return <div className="mobileSheetModal" onClick={onClose}>
    <section className={cx('mobileSheetPanel', className)} onClick={(event) => event.stopPropagation()}>
      <div className="bottomSheetHandle" />
      <div className="mobileSheetModalHead">
        <div>
          <h3>{title}</h3>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button type="button" className="mobileIconButton" onClick={onClose} aria-label="Закрыть">
          <AppIcon name="close" className="navIcon" />
        </button>
      </div>
      <div className="mobileSheetContent">{children}</div>
      {footer && <div className="mobileSheetFooter">{footer}</div>}
    </section>
  </div>;
}
