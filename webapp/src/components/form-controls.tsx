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

export function Field({ label, icon, ...props }: any) {
  const resolvedIcon = fieldIcon(label, props.type, icon);
  return <label className="field">
    <span>{label}</span>
    <div className={resolvedIcon ? 'fieldControl hasIcon' : 'fieldControl'}>
      {resolvedIcon && <AppIcon name={resolvedIcon} className="fieldIcon" />}
      <input {...props} />
    </div>
  </label>;
}

export function Select({ label, children, icon, ...props }: any) {
  const resolvedIcon = fieldIcon(label, undefined, icon);
  return <label className="field">
    <span>{label}</span>
    <div className={resolvedIcon ? 'fieldControl hasIcon' : 'fieldControl'}>
      {resolvedIcon && <AppIcon name={resolvedIcon} className="fieldIcon" />}
      <select {...props}>{children}</select>
    </div>
  </label>;
}

export function Textarea({ label, icon, ...props }: any) {
  const resolvedIcon = fieldIcon(label, undefined, icon);
  return <label className="field">
    <span>{label}</span>
    <div className={resolvedIcon ? 'fieldControl hasIcon textareaControl' : 'fieldControl textareaControl'}>
      {resolvedIcon && <AppIcon name={resolvedIcon} className="fieldIcon" />}
      <textarea {...props} />
    </div>
  </label>;
}

export function Empty({ text }: { text: string }) {
  return <div className="empty">{text}</div>;
}
