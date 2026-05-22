export const roles: Record<string, string> = {
  owner: 'Владелец',
  manager: 'Менеджер',
  senior_waiter: 'Старший официант',
  senior_bartender: 'Старший бармен',
  senior_cook: 'Старший повар',
  hostess: 'Хостес',
  waiter: 'Официант',
  bartender: 'Бармен',
  cook: 'Повар'
};

export const seniorRoles = ['senior_waiter', 'senior_bartender', 'senior_cook'];

export const departmentRoleMap: Record<string, string[]> = {
  hall: ['senior_waiter', 'waiter', 'hostess'],
  bar: ['senior_bartender', 'bartender'],
  kitchen: ['senior_cook', 'cook'],
  common: ['manager']
};

const checklistRoleViewers: Record<string, string[]> = {
  waiter: ['waiter', 'senior_waiter'],
  hostess: ['hostess', 'senior_waiter'],
  bartender: ['bartender', 'senior_bartender'],
  cook: ['cook', 'senior_cook']
};

export function roleDepartment(role?: string) {
  if (role === 'senior_waiter' || role === 'waiter' || role === 'hostess') return 'hall';
  if (role === 'senior_bartender' || role === 'bartender') return 'bar';
  if (role === 'senior_cook' || role === 'cook') return 'kitchen';
  return 'common';
}

export function manageableRolesFor(user: any) {
  if (!user) return [];
  if (user.role === 'manager' || user.role === 'owner' || user.is_super_admin) return Object.keys(roles).filter((key) => key !== 'owner');
  if (seniorRoles.includes(user.role)) return departmentRoleMap[roleDepartment(user.role)] || [];
  return [];
}

export function checklistRoleMatchesUser(templateRole?: string, userRole?: string) {
  if (!templateRole || templateRole === userRole) return true;
  return (checklistRoleViewers[templateRole] || [templateRole]).includes(String(userRole || ''));
}

export function taskRecipientRolesFor(user: any) {
  if (!user) return [];
  if (user.role === 'senior_bartender') return ['bartender'];
  if (user.role === 'senior_cook') return ['cook'];
  if (user.role === 'senior_waiter') return ['waiter', 'hostess'];
  return manageableRolesFor(user).filter((role) => role !== 'manager' && !seniorRoles.includes(role));
}

export const executableRoles = Object.entries(roles).filter(([key]) => key !== 'owner');

export const departments: Record<string, string> = {
  hall: 'Зал',
  bar: 'Бар',
  kitchen: 'Кухня',
  common: 'Общее'
};

export const checklistTypes: Record<string, string> = {
  open: 'Открытие',
  close: 'Закрытие',
  routine: 'Смена',
  custom: 'Произвольный'
};

export const checklistRunStatuses: Record<string, string> = {
  completed: 'выполнен',
  done: 'выполнен',
  missed: 'пропущен',
  draft: 'черновик'
};

export const bookingStatuses: Record<string, string> = {
  booked: 'забронирован',
  seated: 'гости пришли',
  completed: 'завершён',
  cancelled: 'отменён'
};

export const techRequestCategories: Record<string, string> = {
  refrigeration: 'Холодильники',
  plumbing: 'Сантехника / засор',
  equipment: 'Оборудование',
  cleaning: 'Уборка и сервис',
  other: 'Другое'
};


export const requestStatuses: Record<string, string> = {
  draft: 'черновик',
  sent: 'отправлена',
  approved: 'принята',
  received: 'получена',
  not_received: 'не получена',
  done: 'выполнена',
  cancelled: 'отменена'
};

export const techRequestStatuses: Record<string, string> = {
  new: 'новая',
  in_progress: 'в работе',
  done: 'выполнена',
  cancelled: 'отклонена'
};

export const entityTypeLabels: Record<string, string> = {
  task: 'Задача',
  tech_request: 'Проблема',
  checklist_run: 'Выполнение чек-листа',
  booking: 'Бронь',
  floor_table: 'План зала',
  inventory_run: 'Инвентаризация',
  knowledge_document: 'Документ',
  shift: 'Смена'
};

export const problemTypeLabels: Record<string, string> = {
  task: 'Задача',
  tech_request: 'Проблема',
  checklist_run: 'Чек-лист',
  booking: 'Бронь',
  inventory_run: 'Инвентаризация',
  shift: 'Смена'
};

export const targetTypeLabels: Record<string, string> = {
  all: 'Всем сотрудникам',
  role: 'По роли',
  user: 'Конкретному сотруднику'
};

export const inventorySections = [
  { id: 'bar', title: 'Бар', department: 'bar', defaultCategory: 'Бар' },
  { id: 'kitchen', title: 'Кухня', department: 'kitchen', defaultCategory: 'Кухня' },
  { id: 'household', title: 'Хозтовары', department: 'hall', defaultCategory: 'Хозтовары' },
  { id: 'dishes', title: 'Посуда', department: 'hall', defaultCategory: 'Посуда' }
] as const;

export type InventorySectionId = typeof inventorySections[number]['id'];

export const subscriptionStatuses: Record<string, string> = {
  active: 'активна',
  blocked: 'заблокирована',
  trial: 'пробный период',
  trial_expired: 'пробный период истёк',
  subscription_expired: 'подписка истекла'
};

export function labelFrom(map: Record<string, string>, value?: string, fallback = '—') {
  if (!value) return fallback;
  return map[value] || value;
}
