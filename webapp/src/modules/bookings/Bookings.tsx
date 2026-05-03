import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { Button, Card } from '../../components/dashboard-ui';
import { Field, Select, Textarea, Empty } from '../../components/form-controls';
import { MobileSheetModal } from '../../components/mobile-sheet-modal';
import { SectionTitle } from '../../components/mobile-ui';
import { cx } from '../../lib/cx';
import { bookingStatuses } from '../../lib/dictionaries';
import { dateTimeInputValue, dayKey, fmtDate } from '../../lib/format';

export function Bookings({ admin = false }: any) {
  const initialDate = dayKey(new Date().toISOString()) || '';
  const [tables, setTables] = useState<any[]>([]);
  const [reservations, setReservations] = useState<any[]>([]);
  const [msg, setMsg] = useState('');
  const [dateFilter, setDateFilter] = useState(initialDate);
  const [showForm, setShowForm] = useState(false);
  const [viewingReservation, setViewingReservation] = useState<any>(null);
  const [freeTable, setFreeTable] = useState<any>(null);
  const [editingReservationId, setEditingReservationId] = useState('');
  const [editingTableId, setEditingTableId] = useState('');
  const [bulkForm, setBulkForm] = useState<any>({ count: 6, seats: 4, zone: 'Основной зал', prefix: 'Стол' });
  const [tableDrafts, setTableDrafts] = useState<any>({});
  const [reservationForm, setReservationForm] = useState<any>(() => buildReservationForm(initialDate));

  function buildReservationForm(nextDate = dateFilter || initialDate, tableIds: string[] = []) {
    return { reserved_for: `${nextDate || initialDate}T19:00`, guests_count: 2, guest_phone: '', guest_name: '', duration_minutes: 120, comment: '', status: 'booked', table_ids: tableIds };
  }

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

  function resetReservationForm(nextDate = dateFilter || initialDate, tableIds: string[] = []) {
    setEditingReservationId('');
    setReservationForm(buildReservationForm(nextDate, tableIds));
  }

  function openCreateForm(table?: any) {
    if (!tables.length) {
      setMsg('Администратор должен сначала настроить зал и столы');
      return;
    }
    resetReservationForm(dateFilter, table?.id ? [table.id] : []);
    setViewingReservation(null);
    setFreeTable(null);
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
    setViewingReservation(null);
    setFreeTable(null);
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
      setViewingReservation(null);
      if (editingReservationId === reservation.id) {
        setShowForm(false);
        resetReservationForm();
      }
      load();
    } catch (error: any) {
      setMsg(error.message);
    }
  }


  async function seatTable(table: any) {
    setMsg('');
    try {
      const reservation = await api(`/api/bookings/tables/${table.id}/seat`, { method: 'POST', body: JSON.stringify({}) });
      setMsg('Стол отмечен занятым');
      setFreeTable(null);
      setViewingReservation(reservation);
      load();
    } catch (error: any) {
      setMsg(error.message);
    }
  }

  async function freeOccupiedTable(reservation: any) {
    const tableId = Array.isArray(reservation.table_ids) ? reservation.table_ids[0] : '';
    if (!tableId) return;
    setMsg('');
    try {
      await api(`/api/bookings/tables/${tableId}/free`, { method: 'POST', body: JSON.stringify({}) });
      setMsg('Стол освобождён');
      setViewingReservation(null);
      load();
    } catch (error: any) {
      setMsg(error.message);
    }
  }

  async function seatReservation(reservation: any) {
    setMsg('');
    try {
      const updated = await api(`/api/bookings/${reservation.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'seated' }) });
      setMsg('Гости посажены за стол');
      setViewingReservation(updated);
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
      setEditingTableId('');
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
      setEditingTableId('');
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
      if (selected.includes(tableId)) return { ...current, table_ids: selected.filter((id: string) => id !== tableId) };
      if (unavailableTableIds.has(tableId)) return current;
      return { ...current, table_ids: [...selected, tableId] };
    });
  }

  function tablesSummary(reservation: any) {
    return (reservation.tables || []).map((table: any) => table.label).join(', ');
  }

  function tableNumberLabel(label: string) {
    const text = String(label || '').trim();
    const match = text.match(/(\d+)$/);
    if (match) return match[1];
    return text.replace(/^стол\s*/i, '').trim() || text || '—';
  }

  function tableStateForDay(table: any) {
    const tableReservations = bookingsForDate
      .filter((reservation: any) => (Array.isArray(reservation.table_ids) ? reservation.table_ids : []).includes(table.id))
      .filter((reservation: any) => ['booked', 'seated'].includes(reservation.status))
      .sort((a: any, b: any) => String(a.reserved_for || '').localeCompare(String(b.reserved_for || '')));
    if (!tableReservations.length) return { tone: 'free', badge: 'Свободен', reservation: null as any };
    const nextReservation = tableReservations[0];
    return {
      tone: nextReservation.status === 'seated' ? 'occupied' : 'reserved',
      badge: nextReservation.status === 'seated' ? 'Занято' : 'Забронировано',
      reservation: nextReservation
    };
  }

  function openTable(table: any) {
    const state = tableStateForDay(table);
    setShowForm(false);
    setMsg('');
    if (state.reservation) {
      setFreeTable(null);
      setViewingReservation(state.reservation);
    } else {
      setViewingReservation(null);
      setFreeTable(table);
      resetReservationForm(dateFilter, [table.id]);
    }
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
      <div className="rowBetween"><strong>Столы</strong><span className="muted">{reservationForm.table_ids.length} выбрано</span></div>
      <div className="bookingTableSelectGrid">
        {tables.map((table: any) => {
          const selected = reservationForm.table_ids.includes(table.id);
          const unavailable = unavailableTableIds.has(table.id) && !selected;
          return <button key={table.id} type="button" className={cx('bookingTableButton', selected && 'selected', unavailable && 'disabled')} onClick={() => toggleTable(table.id)}>
            <strong>{table.label}</strong><span>{table.seats} мест · {table.zone || 'Зал'}</span>
          </button>;
        })}
      </div>
    </div>
  </form>;

  if (!admin) {
    return <>
      <div className="mobileSectionStack bookingMobileScreen">
        <section className="mobileSection">
          <div className="mobileListSurface mobileFilterSurface"><Field label="Дата" type="date" value={dateFilter} onChange={(e: any) => setDateFilter(e.target.value)} /></div>
        </section>
        {hallGroups.length === 0 && <section className="mobileSection"><div className="mobileListSurface"><Empty text="Администратор ещё не настроил зал и столы" /></div></section>}
        {hallGroups.map((hall) => <section className="mobileSection" key={hall.name}>
          <div className="mobileListSectionHead"><h3>{hall.name}</h3><span className="mobileSectionCount">{hall.tables.length}</span></div>
          <div className="bookingTablesGrid floorTablesGrid">
            {hall.tables.map((table: any) => {
              const state = tableStateForDay(table);
              return <button key={table.id} type="button" className={cx('bookingTableButton', 'floorTableTile', state.tone)} onClick={() => openTable(table)}>
                <div className="floorTableTileHead">
                  <strong className="floorTableNumber">{tableNumberLabel(table.label)}</strong>
                  <span className={cx('floorTableStatusBadge', state.tone)}>{state.badge}</span>
                </div>
                <span className="floorTableSeats">{table.seats} мест</span>
              </button>;
            })}
          </div>
        </section>)}
        {msg && <div className={msg.includes('обнов') || msg.includes('создан') || msg.includes('отмен') ? 'notice mobileInlineNotice' : 'error mobileInlineNotice'}>{msg}</div>}
      </div>

      {freeTable && <MobileSheetModal
        title={freeTable.label}
        subtitle={`${freeTable.seats} мест · ${freeTable.zone || 'Зал'} · свободен`}
        onClose={() => setFreeTable(null)}
        className="mobileFormSheet bookingDetailsSheet"
        footer={<div className="bookingSheetActions"><Button type="button" onClick={() => seatTable(freeTable)}>Занято</Button><Button kind="soft" type="button" onClick={() => openCreateForm(freeTable)}>Создать бронь</Button></div>}
      >
        <div className="bookingDetailsList">
          <div><span>Статус</span><strong>Свободен</strong></div>
          <div><span>Действие</span><strong>Отметьте «Занято», если гости уже сели, или создайте бронь на время.</strong></div>
        </div>
      </MobileSheetModal>}

      {viewingReservation && <MobileSheetModal
        title={viewingReservation.guest_name || (viewingReservation.status === 'seated' ? 'Гости за столом' : 'Бронь')}
        subtitle={`${fmtDate(viewingReservation.reserved_for)} · ${bookingStatuses[viewingReservation.status] || viewingReservation.status}`}
        onClose={() => setViewingReservation(null)}
        className="mobileFormSheet bookingDetailsSheet"
        footer={<div className="bookingSheetActions">{viewingReservation.status === 'seated' ? <Button type="button" onClick={() => freeOccupiedTable(viewingReservation)}>Свободен</Button> : <Button type="button" onClick={() => seatReservation(viewingReservation)}>Занято</Button>}<Button kind="soft" type="button" onClick={() => startEditReservation(viewingReservation)}>Редактировать</Button>{viewingReservation.status !== 'cancelled' && <Button kind="danger" type="button" onClick={() => cancelReservation(viewingReservation)}>Отменить</Button>}</div>}
      >
        <div className="bookingDetailsList">
          <div><span>Столы</span><strong>{tablesSummary(viewingReservation) || 'Не выбраны'}</strong></div>
          <div><span>Гостей</span><strong>{viewingReservation.guests_count}</strong></div>
          <div><span>Телефон</span><strong>{viewingReservation.guest_phone || 'Не указан'}</strong></div>
          {viewingReservation.comment && <div><span>Комментарий</span><strong>{viewingReservation.comment}</strong></div>}
        </div>
      </MobileSheetModal>}

      {showForm && <MobileSheetModal
        title={editingReservationId ? 'Редактировать бронь' : 'Новая бронь'}
        subtitle="Заполните время, гостя и стол"
        onClose={() => { setShowForm(false); setFreeTable(null); resetReservationForm(); }}
        className="mobileFormSheet"
        footer={<div className="bookingSheetActions"><Button kind="soft" type="button" onClick={() => { setShowForm(false); setFreeTable(null); resetReservationForm(); }}>Отмена</Button><Button type="submit" form="booking-form" className="mobilePrimaryButton">Сохранить бронь</Button></div>}
      >
        {bookingForm}
      </MobileSheetModal>}
    </>;
  }

  return <>
    <Card title="Залы и столы" right={<span className="badge active">Настройка администратора</span>}>
      <form className="form two compactAdminForm" onSubmit={createTables}>
        <Field label="Количество столов" type="number" min="1" value={bulkForm.count} onChange={(e: any) => setBulkForm({ ...bulkForm, count: e.target.value })} />
        <Field label="Мест за столом" type="number" min="1" value={bulkForm.seats} onChange={(e: any) => setBulkForm({ ...bulkForm, seats: e.target.value })} />
        <Field label="Зал" value={bulkForm.zone} onChange={(e: any) => setBulkForm({ ...bulkForm, zone: e.target.value })} />
        <Field label="Название столов" value={bulkForm.prefix} onChange={(e: any) => setBulkForm({ ...bulkForm, prefix: e.target.value })} />
        <Button>Добавить</Button>
      </form>
      <div className="mobileInlineHint">Новый зал создаётся названием в поле «Зал». Сотрудники сразу увидят столы и смогут ставить брони.</div>
      {hallGroups.length > 0 && <div className="hallSummaryGrid">{hallGroups.map((hall) => <div className="hallSummaryCard" key={hall.name}><strong>{hall.name}</strong><span>{hall.tables.length} столов · {hall.seats} мест</span></div>)}</div>}
      <div className="bookingAdminTableList compactTableList">
        {tables.length === 0 && <Empty text="Схема пока пустая. Добавьте первый зал и столы." />}
        {tables.map((table: any) => {
          const editing = editingTableId === table.id;
          return <div key={table.id} className={cx('tableEditableRow', editing && 'editing')}>
            {editing ? <form className="tableInlineEditor" onSubmit={(e) => { e.preventDefault(); saveTable(table.id); }}>
              <input value={tableDrafts[table.id]?.label || ''} onChange={(e) => setTableDrafts({ ...tableDrafts, [table.id]: { ...tableDrafts[table.id], label: e.target.value } })} placeholder="Стол" />
              <input type="number" min="1" value={tableDrafts[table.id]?.seats || ''} onChange={(e) => setTableDrafts({ ...tableDrafts, [table.id]: { ...tableDrafts[table.id], seats: e.target.value } })} placeholder="Мест" />
              <input value={tableDrafts[table.id]?.zone || ''} onChange={(e) => setTableDrafts({ ...tableDrafts, [table.id]: { ...tableDrafts[table.id], zone: e.target.value } })} placeholder="Зал" />
              <div className="adminInlineActions"><Button kind="soft" type="button" onClick={() => setEditingTableId('')}>Отмена</Button><Button>Сохранить</Button><Button kind="danger" type="button" onClick={() => removeTable(table)}>Удалить</Button></div>
            </form> : <button type="button" className="tableCompactRow" onClick={() => setEditingTableId(table.id)}>
              <div><b>{table.label}</b><span>{table.zone || 'Основной зал'}</span></div>
              <strong>{table.seats} мест</strong>
              <em>Изменить</em>
            </button>}
          </div>;
        })}
      </div>
    </Card>

    <Card title={editingReservationId ? 'Редактировать бронь' : 'Новая бронь'} className="adminBookingFormCard">
      {tables.length === 0 ? <Empty text="Сначала настройте зал и столы" /> : <>{bookingForm}<div className="actions">{editingReservationId && <Button kind="soft" type="button" onClick={() => resetReservationForm()}>Сбросить</Button>}<Button type="button" onClick={() => saveReservation()}>{editingReservationId ? 'Сохранить бронь' : 'Создать бронь'}</Button></div></>}
    </Card>

    <Card title="Брони" right={<div className="bookingAdminFilter"><input type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} /></div>}>
      <div className="reservationCompactList">
        {bookingsForDate.length === 0 && <Empty text="На выбранную дату броней пока нет" />}
        {bookingsForDate.map((reservation: any) => <button type="button" className="reservationCompactRow" key={reservation.id} onClick={() => startEditReservation(reservation)}>
          <div><b>{reservation.guest_name || 'Гость'}</b><span>{fmtDate(reservation.reserved_for)} · {reservation.guests_count} гостей · {tablesSummary(reservation) || 'без стола'}</span></div>
          <span className={`badge ${reservation.status === 'cancelled' ? 'cancelled' : reservation.status === 'completed' ? 'active' : reservation.status === 'seated' ? 'trial' : 'warning'}`}>{bookingStatuses[reservation.status] || reservation.status}</span>
        </button>)}
      </div>
      {msg && <div className={msg.includes('обнов') || msg.includes('создан') || msg.includes('отмен') || msg.includes('добавлены') || msg.includes('удалён') ? 'notice compactNotice' : 'error compactNotice'}>{msg}</div>}
    </Card>
  </>;
}
