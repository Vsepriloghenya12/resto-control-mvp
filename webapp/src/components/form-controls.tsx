import { AppIcon, type IconName } from './dashboard-ui';

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

function fieldHints(label: string, type?: string): any {
  const value = String(label || '').toLowerCase();
  if (type === 'password' || value.includes('парол')) {
    return { type: type || 'password', name: 'password', autoComplete: 'current-password' };
  }
  if (value.includes('email') || value.includes('почт')) {
    return { type: type || 'email', name: 'email', autoComplete: 'email', inputMode: 'email' };
  }
  if (value.includes('тел')) {
    return { type: type || 'tel', name: 'phone', autoComplete: 'tel', inputMode: 'tel' };
  }
  if (value.includes('логин')) {
    return { type: type || 'text', name: 'login', autoComplete: 'username', spellCheck: false };
  }
  if (value.includes('город')) return { type: type || 'text', name: 'city', autoComplete: 'address-level2' };
  if (value.includes('ресторан')) return { type: type || 'text', name: 'restaurant', autoComplete: 'organization' };
  if (value.includes('имя') || value.includes('владел') || value.includes('сотрудник')) return { type: type || 'text', name: 'name', autoComplete: 'name' };
  return { type: type || 'text' };
}

export function Field({ label, icon, ...props }: any) {
  const resolvedIcon = fieldIcon(label, props.type, icon);
  const hints = fieldHints(label, props.type);
  return <label className="field">
    <span>{label}</span>
    <div className={resolvedIcon ? 'fieldControl hasIcon' : 'fieldControl'}>
      {resolvedIcon && <AppIcon name={resolvedIcon} className="fieldIcon" />}
      <input {...hints} {...props} />
    </div>
  </label>;
}

export function Select({ label, children, icon, ...props }: any) {
  const resolvedIcon = fieldIcon(label, undefined, icon);
  return <label className="field">
    <span>{label}</span>
    <div className={resolvedIcon ? 'fieldControl hasIcon' : 'fieldControl'}>
      {resolvedIcon && <AppIcon name={resolvedIcon} className="fieldIcon" />}
      <select name={props.name || String(label || 'select').toLowerCase()} {...props}>{children}</select>
    </div>
  </label>;
}

export function Textarea({ label, icon, ...props }: any) {
  const resolvedIcon = fieldIcon(label, undefined, icon);
  return <label className="field">
    <span>{label}</span>
    <div className={resolvedIcon ? 'fieldControl hasIcon textareaControl' : 'fieldControl textareaControl'}>
      {resolvedIcon && <AppIcon name={resolvedIcon} className="fieldIcon" />}
      <textarea name={props.name || String(label || 'textarea').toLowerCase()} {...props} />
    </div>
  </label>;
}

export function Empty({ text }: { text: string }) {
  return <div className="empty">{text}</div>;
}
