import { inventorySections, subscriptionStatuses, type InventorySectionId } from './dictionaries';
import type { NavTab } from '../components/dashboard-ui';

export function fmtDate(value?: string) {
  if (!value) return '—';
  return new Date(value).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
}

export function dayKey(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('sv-SE');
}

export function dateTimeInputValue(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function daysLeft(value?: string) {
  if (!value) return 0;
  return Math.max(0, Math.ceil((new Date(value).getTime() - Date.now()) / 86400000));
}

export function subscriptionLabel(status?: string) {
  if (!status) return 'неизвестно';
  return subscriptionStatuses[status] || status;
}

export function userInitials(name?: string) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'RC';
  return parts.slice(0, 2).map(part => part[0]?.toUpperCase() || '').join('') || 'RC';
}

export function mobileTabTitle(active: string, tabs: NavTab[]) {
  return tabs.find(tab => tab.id === active)?.title || 'Раздел';
}

export function normalizedProductCategory(value?: string) {
  return String(value || '').trim().toLowerCase();
}

export function inventorySectionMeta(sectionId: InventorySectionId) {
  return inventorySections.find(section => section.id === sectionId) || inventorySections[0];
}

export function productMatchesInventorySection(product: any, sectionId: InventorySectionId) {
  const category = normalizedProductCategory(product?.category);
  if (sectionId === 'bar') return product?.department === 'bar';
  if (sectionId === 'kitchen') return product?.department === 'kitchen';
  if (sectionId === 'dishes') return ['hall', 'common'].includes(product?.department) && category.includes('посуд');
  return ['hall', 'common'].includes(product?.department) && !category.includes('посуд');
}
