import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { Button, Card } from '../../components/dashboard-ui';
import { Field, Select, Textarea, Empty } from '../../components/form-controls';
import { MobileSheetModal } from '../../components/mobile-sheet-modal';
import { SectionTitle } from '../../components/mobile-ui';
import { CommentsPanel } from '../../components/comments-panel';
import { cx } from '../../lib/cx';
import { bookingStatuses } from '../../lib/dictionaries';
import { dateTimeInputValue, dayKey, fmtDate } from '../../lib/format';

export function Bookings({ user, admin = false }: any) {
  const initialDate = dayKey(new Date().toISOString()) || '';
  const [tables, setTables] = useState<any[]>([]);
  const [reservations, setReservations] = useState<any[]>([]);
  const [msg, setMsg] = useState('');
  const [dateFilter, setDateFilter] = useState(initialDate);
  const [showForm, setShowForm] = useState(false);
  const [editingReservationId, setEditingReservationId] = useState('');
  const [bulkForm, setBulkForm] = useState<any>({ count: 6, seats: 4, zone: 'Основной зал', prefix: 'Стол' });
  const [tableDrafts, setTableDrafts] = useState<any>({});
  const [reservationForm, setReservationForm] = useState<any>({ reserved_for: `${initialDate}T19:00`, guests_count: 2, guest_phone: '', guest_name: '', duration_minutes: 120, comment: '', status: 'booked', table_ids: [] });

  async function load() {
    const [tableRows, reservationRows] = await Promise.all([
      api('/api/bookings/tables'),
      api('/api/bookings')
    ]);
    setTables(tableRows);
    setReservations(reservationRows);
    setTableDrafts(Object.fromEntries(tableRows.map((table: any) => [table.id, { label: table.label, seats: table.seats, zone: table.zone || '' }])));
  }

  useEffect(() => { load(); }, []);

  function resetReservationForm(nextDate = dateFilter || initialDate) {
    setEditingReservationId('');
    setReservationForm({
      reserved_for: `${nextDate}T19:00`,
      guests_count: 2,
      guest_phone: '',
      guest_name: '',
      duration_minutes: 120,
      comment: '',
      status: 'booked',
      table_ids: []
    });
  }

  function openCreateForm() {
    if (!tables.length) {
      setMsg('Администратор должен сначала настроить зал и столы');
      return;
    }
    resetReservationForm();
    setMsg('');
    setShowForm(true);
  }

  function startEditReservation(reservation: any) {
    setEditingReservationId(reservation.id);
    setReservationForm({
      reserved_for: dateTimeInputValue(reservation.reserved_for),
      guests_count: reservation.guests_count || 1,
      guest_phone: reservation.guest_phone || '',
      guest_name: reservation.guest_name || '',
      duration_minutes: reservation.duration_minutes || 120,
      comment: reservation.comment || '',
      status: reservation.status || 'booked',
      table_ids: Array.isArray(reservation.table_ids) ? reservation.table_ids : []
    });
    setMsg('');
    setShowForm(true);
  }

  async function saveReservation(e?: FormEvent) {
    e?.preventDefault();
    setMsg('');
    try {
      const payload = {
        ...reservationForm,
        guests_count: Number(reservationForm.guests_count),
        duration_minutes: Number(reservationForm.duration_minutes),
        table_ids: reservationForm.table_ids
      };
      if (editingReservationId) {
        await api(`/api/bookings/${editingReservationId}`, { method: 'PATCH', body: JSON.stringify(payload) });
        setMsg('Бронь обновлена');
      } else {
        await api('/api/bookings', { method: 'POST', body: JSON.stringify(payload) });
        setMsg('Бронь создана');
      }
      setShowForm(false);
      resetReservationForm();
      load();
    } catch (error: any) {
      setMsg(error.message);
    }
  }

  async function cancelReservation(reservation: any) {
    if (!window.confirm(`Отменить бронь на ${fmtDate(reservation.reserved_for)}?`)) return;
    setMsg('');
    try {
      await api(`/api/bookings/${reservation.id}`, { method: 'DELETE' });
      setMsg('Бронь отменена');
      if (editingReservationId === reservation.id) {
        setShowForm(false);
        resetReservationForm();
      }
      load();
    } catch (error: any) {
      setMsg(error.message);
    }
  }

  async function createTables(e: FormEvent) {
    e.preventDefault();
    setMsg('');
    try {
      await api('/api/admin/bookings/tables/bulk', { method: 'POST', body: JSON.stringify(bulkForm) });
      setMsg('Столы добавлены в зал');
      load();
    } catch (error: any) {
      setMsg(error.message);
    }
  }

  async function saveTable(tableId: string) {
    setMsg('');
    try {
      await api(`/api/admin/bookings/tables/${tableId}`, { method: 'PATCH', body: JSON.stringify(tableDrafts[tableId]) });
      setMsg('Стол обновлён');
      load();
    } catch (error: any) {
      setMsg(error.message);
    }
  }

  async function removeTable(table: any) {
    if (!window.confirm(`Удалить ${table.label} из схемы зала?`)) return;
    setMsg('');
    try {
      await api(`/api/admin/bookings/tables/${table.id}`, { method: 'DELETE' });
      setMsg('Стол удалён из схемы');
      load();
    } catch (error: any) {
      setMsg(error.message);
    }
  }

  const bookingsForDate = reservations
    .filter((reservation: any) => !dateFilter || dayKey(reservation.reserved_for) === dateFilter)
    .sort((a: any, b: any) => String(a.reserved_for || '').localeCompare(String(b.reserved_for || '')));

  const hallGroups = useMemo(() => {
    const groups = new Map<string, { name: string; tables: any[]; seats: number }>();
    tables.forEach((table: any) => {
      const name = String(table.zone || 'Основной зал').trim() || 'Основной зал';
      const current = groups.get(name) || { name, tables: [], seats: 0 };
      current.tables.push(table);
      current.seats += Number(table.seats || 0);
      groups.set(name, current);
    });
    return Array.from(groups.values());
  }, [tables]);

  const selectedStart = reservationForm.reserved_for ? new Date(reservationForm.reserved_for).getTime() : NaN;
  const selectedDuration = Math.max(30, Number(reservationForm.duration_minutes || 120) || 120);
  const selectedEnd = Number.isNaN(selectedStart) ? NaN : selectedStart + selectedDuration * 60000;
  const unavailableTableIds = new Set(
    reservations
      .filter((reservation: any) => reservation.id !== editingReservationId)
      .filter((reservation: any) => ['booked', 'seated'].includes(reservation.status))
      .filter((reservation: any) => {
        if (Number.isNaN(selectedStart) || Number.isNaN(selectedEnd)) return false;
        const currentStart = new Date(reservation.reserved_for).getTime();
        const currentEnd = currentStart + Math.max(30, Number(reservation.duration_minutes || 120) || 120) * 60000;
        return selectedStart < currentEnd && currentStart < selectedEnd;
      })
      .flatMap((reservation: any) => Array.isArray(reservation.table_ids) ? reservation.table_ids : [])
  );

  function toggleTable(tableId: string) {
    setReservationForm((current: any) => {
      const selected = Array.isArray(current.table_ids) ? current.table_ids : [];
      if (selected.includes(tableId)) {
        return { ...current, table_ids: selected.filter((id: string) => id !== tableId) };
      }
      if (unavailableTableIds.has(tableId)) return current;
      return { ...current, table_ids: [...selected, tableId] };
    });
  }

  function tablesSummary(reservation: any) {
    return (reservation.tables || [])
      .map((table: any) => table.label)
      .join(', ');
  }

  function tableStateForDay(table: any) {
    const tableReservations = bookingsForDate
      .filter((reservation: any) => (Array.isArray(reservation.table_ids) ? reservation.table_ids : []).includes(table.id))
      .filter((reservation: any) => ['booked', 'seated'].includes(reservation.status));
    if (!tableReservations.length) return { tone: 'free', text: 'Свободен' };
    const nextReservation = tableReservations[0];
    const time = new Date(nextReservation.reserved_for).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    return {
      tone: nextReservation.status === 'seated' ? 'occupied' : 'reserved',
      text: `${time} · ${nextReservation.guests_count} г.`
    };
  }

  const bookingForm = <form className="form" id="booking-form" onSubmit={saveReservation}>
    <div className="form two">
      <Field label="Дата и время" type="datetime-local" value={reservationForm.reserved_for} onChange={(e: any) => setReservationForm({ ...reservationForm, reserved_for: e.target.value })} />
      <Field label="Гостей" type="number" min="1" value={reservationForm.guests_count} onChange={(e: any) => setReservationForm({ ...reservationForm, guests_count: e.target.value })} />
      <Field label="Телефон" value={reservationForm.guest_phone} onChange={(e: any) => setReservationForm({ ...reservationForm, guest_phone: e.target.value })} />
      <Field label="Имя гостя" value={reservationForm.guest_name} onChange={(e: any) => setReservationForm({ ...reservationForm, guest_name: e.target.value })} />
      <Field label="Длительность, мин" type="number" min="30" step="30" value={reservationForm.duration_minutes} onChange={(e: any) => setReservationForm({ ...reservationForm, duration_minutes: e.target.value })} />
      <Select label="Статус" value={reservationForm.status} onChange={(e: any) => setReservationForm({ ...reservationForm, status: e.target.value })}>
        {Object.entries(bookingStatuses).map(([key, value]) => <option key={key} value={key}>{value}</option>)}
      </Select>
    </div>
    <Textarea label="Комментарий" value={reservationForm.comment} onChange={(e: any) => setReservationForm({ ...reservationForm, comment: e.target.value })} placeholder="Например: детский стул, окно, день рождения" />
    <div className="bookingPicker">
      <div className="rowBetween">
        <strong>Выберите столы</strong>
        <span className="muted">{reservationForm.table_ids.length} выбрано</span>
      </div>
      <div className="bookingTableSelectGrid">
        {tables.map((table: any) => {
          const selected = reservationForm.table_ids.includes(table.id);
          const unavailable = unavailableTableIds.has(table.id) && !selected;
          return <button key={table.id} type="button" className={cx('bookingTableButton', selected && 'selected', unavailable && 'disabled')} onClick={() => toggleTable(table.id)}>
            <strong>{table.label}</strong>
            <span>{table.seats} мест · {table.zone || 'Зал'}</span>
          </button>;
        })}
      </div>
    </div>
  </form>;

  if (!admin) {
    return <>
      <div className="mobileSectionStack">
        <SectionTitle title="Брони" action={<button type="button" className="sectionLink" onClick={openCreateForm}>Новая</button>} />
        <section className="mobileSection">
          <div className="mobileListSurface mobileFilterSurface">
            <Field label="Дата" type="date" value={dateFilter} onChange={(e: any) => setDateFilter(e.target.value)} />
          </div>
        </section>
        <section className="mobileSection">
          <div className="mobileListSectionHead">
            <h3>Схема зала</h3>
            <span className="mobileSectionCount">{tables.length}</span>
          </div>
          {!tables.length && <div className="mobileListSurface"><Empty text="Администратор ещё не настроил зал и столы" /></div>}
          {!!tables.length && <div className="bookingTablesGrid">
            {tables.map((table: any) => {
              const state = tableStateForDay(table);
              return <div key={table.id} className={cx('bookingTableButton', 'static', state.tone)}>
                <strong>{table.label}</strong>
                <span>{table.seats} мест</span>
                <em>{state.text}</em>
              </div>;
            })}
          </div>}
        </section>
        <section className="mobileSection">
          <div className="mobileListSectionHead">
            <h3>Брони на день</h3>
            <span className="mobileSectionCount">{bookingsForDate.length}</span>
          </div>
          <div className="mobileListSurface">
            {bookingsForDate.length === 0 && <Empty text="На выбранную дату броней пока нет" />}
            <div className="mobileRequestList">
              {bookingsForDate.map((reservation: any) => <article key={reservation.id} className="mobileRequestCard bookingReservationCard">
                <div className="rowBetween">
                  <div>
                    <strong>{reservation.guest_name || 'Гость'}</strong>
                    <span>{fmtDate(reservation.reserved_for)} · {reservation.guests_count} гостей</span>
                  </div>
                  <span className={`badge ${reservation.status === 'cancelled' ? 'cancelled' : reservation.status === 'completed' ? 'active' : reservation.status === 'seated' ? 'trial' : 'warning'}`}>{bookingStatuses[reservation.status] || reservation.status}</span>
                </div>
                <div className="bookingTablesInline">{tablesSummary(reservation) || 'Столы не выбраны'}</div>
                <div className="mobileInlineHint">{reservation.guest_phone}{reservation.comment ? ` · ${reservation.comment}` : ''}</div>
                <div className="actions">
                  <Button kind="soft" type="button" onClick={() => startEditReservation(reservation)}>Редактировать</Button>
                  {reservation.status !== 'cancelled' && <Button kind="danger" type="button" onClick={() => cancelReservation(reservation)}>Отменить</Button>}
                </div>
              </article>)}
            </div>
          </div>
        </section>
        {msg && <div className={msg.includes('обнов') || msg.includes('создан') || msg.includes('отмен') ? 'notice mobileInlineNotice' : 'error mobileInlineNotice'}>{msg}</div>}
      </div>
      {showForm && <MobileSheetModal
        title={editingReservationId ? 'Редактировать бронь' : 'Новая бронь'}
        subtitle="Выберите столы, время и контакты гостя"
        onClose={() => {
          setShowForm(false);
          resetReservationForm();
        }}
        className="mobileFormSheet"
        footer={<div className="bookingSheetActions">
          <Button kind="soft" type="button" onClick={() => {
            setShowForm(false);
            resetReservationForm();
          }}>Отмена</Button>
          <Button type="submit" form="booking-form" className="mobilePrimaryButton">Сохранить бронь</Button>
        </div>}
      >
        {bookingForm}
      </MobileSheetModal>}
    </>;
  }

  return <>
    <Card title="Залы и столы" right={<span className="badge active">Настройка администратора</span>}>
      <form className="form two" onSubmit={createTables}>
        <Field label="Количество столов" type="number" min="1" value={bulkForm.count} onChange={(e: any) => setBulkForm({ ...bulkForm, count: e.target.value })} />
        <Field label="Мест за столом" type="number" min="1" value={bulkForm.seats} onChange={(e: any) => setBulkForm({ ...bulkForm, seats: e.target.value })} />
        <Field label="Зал" value={bulkForm.zone} onChange={(e: any) => setBulkForm({ ...bulkForm, zone: e.target.value })} />
        <Field label="Название столов" value={bulkForm.prefix} onChange={(e: any) => setBulkForm({ ...bulkForm, prefix: e.target.value })} />
        <Button>Добавить столы</Button>
      </form>
      <div className="mobileInlineHint">Чтобы добавить новый зал, укажите новое название в поле «Зал». Все сотрудники сразу увидят эти столы и смогут ставить на них брони.</div>
      {hallGroups.length > 0 && <div className="hallSummaryGrid">{hallGroups.map((hall) => <div className="hallSummaryCard" key={hall.name}>
        <strong>{hall.name}</strong>
        <span>{hall.tables.length} столов · {hall.seats} мест</span>
      </div>)}</div>}
      <div className="bookingAdminTableList">
        {tables.length === 0 && <Empty text="Схема пока пустая. Добавьте первый зал и столы." />}
        {tables.map((table: any) => <div key={table.id} className="listRow bookingAdminTableRow">
          <div className="bookingAdminTableDraft">
            <input value={tableDrafts[table.id]?.label || ''} onChange={(e) => setTableDrafts({ ...tableDrafts, [table.id]: { ...tableDrafts[table.id], label: e.target.value } })} placeholder="Название стола" />
            <input type="number" min="1" value={tableDrafts[table.id]?.seats || ''} onChange={(e) => setTableDrafts({ ...tableDrafts, [table.id]: { ...tableDrafts[table.id], seats: e.target.value } })} placeholder="Мест" />
            <input value={tableDrafts[table.id]?.zone || ''} onChange={(e) => setTableDrafts({ ...tableDrafts, [table.id]: { ...tableDrafts[table.id], zone: e.target.value } })} placeholder="Зал" />
          </div>
          <div className="adminUserActions">
            <Button kind="soft" type="button" onClick={() => saveTable(table.id)}>Сохранить</Button>
            <Button kind="danger" type="button" onClick={() => removeTable(table)}>Удалить</Button>
          </div>
        </div>)}
      </div>
    </Card>

    <Card title={editingReservationId ? 'Редактировать бронь' : 'Новая бронь'}>
      {tables.length === 0
        ? <Empty text="Сначала настройте зал и столы" />
        : <>
          {bookingForm}
          <div className="actions">
            {editingReservationId && <Button kind="soft" type="button" onClick={() => resetReservationForm()}>Сбросить</Button>}
            <Button type="button" onClick={() => saveReservation()}>{editingReservationId ? 'Сохранить бронь' : 'Создать бронь'}</Button>
          </div>
        </>}
    </Card>

    <Card title="Список броней" right={<div className="bookingAdminFilter"><input type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} /></div>}>
      <div className="list">
        {bookingsForDate.length === 0 && <Empty text="На выбранную дату броней пока нет" />}
        {bookingsForDate.map((reservation: any) => <div className="miniCard bookingAdminReservation" key={reservation.id}>
          <div className="rowBetween">
            <div><b>{reservation.guest_name || 'Гость'}</b><span>{fmtDate(reservation.reserved_for)} · {reservation.guests_count} гостей</span></div>
            <span className={`badge ${reservation.status === 'cancelled' ? 'cancelled' : reservation.status === 'completed' ? 'active' : reservation.status === 'seated' ? 'trial' : 'warning'}`}>{bookingStatuses[reservation.status] || reservation.status}</span>
          </div>
          <div className="mobileInlineHint">{reservation.guest_phone} · {tablesSummary(reservation) || 'Без столов'}</div>
          {reservation.comment && <p>{reservation.comment}</p>}
          <div className="actions">
            <Button kind="soft" type="button" onClick={() => startEditReservation(reservation)}>Редактировать</Button>
            {reservation.status !== 'cancelled' && <Button kind="danger" type="button" onClick={() => cancelReservation(reservation)}>Отменить</Button>}
          </div>
        </div>)}
      </div>
      {msg && <div className={msg.includes('обнов') || msg.includes('создан') || msg.includes('отмен') || msg.includes('добавлены') || msg.includes('удалён') ? 'notice' : 'error'}>{msg}</div>}
    </Card>
  </>;
}
