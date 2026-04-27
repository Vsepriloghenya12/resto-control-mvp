export const roles: Record<string, string> = {
  owner: 'Владелец',
  manager: 'Управляющий',
  hostess: 'Хостес',
  waiter: 'Официант',
  bartender: 'Бармен',
  cook: 'Повар'
};

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

export const requestStatuses: Record<string, string> = {
  sent: 'отправлена',
  ordered: 'заказано',
  partial: 'частично пришло',
  received: 'получено',
  done: 'завершена',
  not_received: 'не получено',
  cancelled: 'отменена'
};

export const techRequestCategories: Record<string, string> = {
  refrigeration: 'Холодильники',
  plumbing: 'Сантехника / засор',
  equipment: 'Оборудование',
  cleaning: 'Уборка и сервис',
  other: 'Другое'
};

export const techRequestStatuses: Record<string, string> = {
  new: 'новая',
  in_progress: 'в работе',
  done: 'выполнена',
  cancelled: 'отклонена'
};

export const entityTypeLabels: Record<string, string> = {
  task: 'Задача',
  tech_request: 'Техзаявка',
  product_request: 'Заявка на продукты',
  checklist_run: 'Выполнение чек-листа',
  booking: 'Бронь',
  floor_table: 'План зала',
  inventory_run: 'Инвентаризация',
  knowledge_document: 'Документ',
  shift: 'Смена'
};

export const problemTypeLabels: Record<string, string> = {
  task: 'Задача',
  tech_request: 'Техзаявка',
  product_request: 'Заявка',
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
