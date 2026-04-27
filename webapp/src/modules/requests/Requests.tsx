import { FormEvent, useEffect, useState } from 'react';
import { api } from '../../api';
import { AppIcon, Button, Card } from '../../components/dashboard-ui';
import { Field, Empty } from '../../components/form-controls';
import { MobileSheetModal } from '../../components/mobile-sheet-modal';
import { SectionTitle } from '../../components/mobile-ui';
import { CommentsPanel } from '../../components/comments-panel';
import { cx } from '../../lib/cx';
import { departments, requestStatuses } from '../../lib/dictionaries';
import { fmtDate } from '../../lib/format';

export function Requests({ user, admin = false }: any) {
  const [products, setProducts] = useState<any[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  const [qty, setQty] = useState<any>({});
  const [received, setReceived] = useState<any>({});
  const [msg, setMsg] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showComposer, setShowComposer] = useState(false);
  async function load() { setProducts(await api('/api/products')); setRequests(await api('/api/requests')); }
  useEffect(() => { load(); }, []);
  async function submit() {
    const items = Object.entries(qty).map(([product_id, q]) => ({ product_id, qty_ordered: Number(q) })).filter(i => i.qty_ordered > 0);
    if (items.length === 0) {
      setMsg('Укажите количество хотя бы одного товара');
      return;
    }
    const result = await api('/api/requests', { method: 'POST', body: JSON.stringify({ department: user.department, items }) });
    setQty({});
    setShowComposer(false);
    setMsg(result?.offline ? 'Заявка сохранена офлайн и отправится после сети' : 'Заявка отправлена');
    load().catch(() => undefined);
  }
  async function receive(req: any) {
    const result = await api(`/api/requests/${req.id}/receive`, { method: 'PATCH', body: JSON.stringify({ received: received[req.id] || {} }) });
    setMsg(result?.offline ? 'Приход сохранён офлайн' : 'Приход товара обновлён'); load().catch(() => undefined);
  }

  const visibleRequests = statusFilter === 'all'
    ? requests
    : requests.filter((request) => {
      if (statusFilter === 'processing') return !['received', 'done', 'cancelled'].includes(request.status);
      if (statusFilter === 'done') return ['received', 'done'].includes(request.status);
      if (statusFilter === 'rejected') return ['not_received', 'cancelled'].includes(request.status);
      return true;
    });

  if (!admin) {
    const selectedCount = Object.values(qty).filter((value) => Number(value) > 0).length;

    return <>
      <div className="mobileSectionStack">
        <SectionTitle title="Заявки" action={<button type="button" className="sectionLink" onClick={() => setShowComposer(true)}>Новая заявка</button>} />
        {msg && <div className="notice mobileInlineNotice">{msg}</div>}

        <button type="button" className="mobileOverviewRow" onClick={() => setShowComposer(true)}>
          <div className="mobileOverviewIcon green"><AppIcon name="requests" className="navIcon" /></div>
          <div className="mobileOverviewCopy">
            <strong>Создать заявку</strong>
            <span>{products.length} товаров доступно для заказа</span>
          </div>
          <b>+</b>
        </button>

        <div className="mobileChipRow">
          <button type="button" className={cx('mobileChip', statusFilter === 'all' && 'active')} onClick={() => setStatusFilter('all')}><span>Все</span><b>{requests.length}</b></button>
          <button type="button" className={cx('mobileChip', statusFilter === 'processing' && 'active')} onClick={() => setStatusFilter('processing')}><span>В обработке</span><b>{requests.filter((request) => !['received', 'done', 'cancelled'].includes(request.status)).length}</b></button>
          <button type="button" className={cx('mobileChip', statusFilter === 'done' && 'active')} onClick={() => setStatusFilter('done')}><span>Выполнено</span><b>{requests.filter((request) => ['received', 'done'].includes(request.status)).length}</b></button>
          <button type="button" className={cx('mobileChip', statusFilter === 'rejected' && 'active')} onClick={() => setStatusFilter('rejected')}><span>Отклонено</span><b>{requests.filter((request) => ['not_received', 'cancelled'].includes(request.status)).length}</b></button>
        </div>

        <Card title="История заявок" className="mobileCard">
          {visibleRequests.length === 0 && <Empty text="Под выбранный статус заявок пока нет" />}
          <div className="mobileRequestList">
            {visibleRequests.map((request) => <article key={request.id} className="mobileRequestCard">
              <div className="rowBetween">
                <div>
                  <strong>{departments[request.department] || 'Отдел'}</strong>
                  <span>{fmtDate(request.created_at)}</span>
                </div>
                <span className={`badge ${request.status}`}>{requestStatuses[request.status] || request.status}</span>
              </div>
              <div className="mobileRequestItems">
                {request.items.map((item: any) => <div key={item.id} className="mobileRequestItem">
                  <span>{item.product?.name}</span>
                  <strong>{item.qty_ordered} {item.product?.unit}</strong>
                </div>)}
              </div>
              <CommentsPanel entityType="product_request" entityId={request.id} />
            </article>)}
          </div>
        </Card>
      </div>

      {showComposer && <MobileSheetModal
        title="Новая заявка"
        subtitle={selectedCount > 0 ? `Выбрано позиций: ${selectedCount}` : 'Укажите фактическую потребность'}
        onClose={() => setShowComposer(false)}
        className="mobileRequestComposer"
        footer={<Button type="button" className="mobilePrimaryButton" onClick={submit}>Отправить заявку</Button>}
      >
        <div className="mobileProductsList">
          {products.map((product) => <label className="mobileProductRow" key={product.id}>
            <div>
              <strong>{product.name}</strong>
              <span>{departments[product.department] || 'Отдел'} · {product.unit}</span>
            </div>
            <input
              type="number"
              min="0"
              value={qty[product.id] || ''}
              onChange={(e) => setQty({ ...qty, [product.id]: e.target.value })}
              placeholder="0"
            />
          </label>)}
        </div>
      </MobileSheetModal>}
    </>;
  }

  return <>
    <Card title={admin ? 'Все заявки ресторана' : 'Заявки коллег'}>
      {requests.length === 0 && <Empty text="Заявок пока нет" />}
      <div className="grid">{requests.map(r => <div className="miniCard" key={r.id}>
        <div className="rowBetween"><b>{departments[r.department]}</b><span className={`badge ${r.status}`}>{requestStatuses[r.status] || r.status}</span></div>
        <p>{r.created_by_user?.name} · {fmtDate(r.created_at)}</p>
        {r.items.map((i: any) => <div className="receiveRow" key={i.id}>
          <span>{i.product?.name}: заказано {i.qty_ordered} {i.product?.unit}, пришло {i.qty_received}</span>
          <input type="number" min="0" placeholder="пришло" onChange={(e) => setReceived({ ...received, [r.id]: { ...(received[r.id] || {}), [i.id]: e.target.value } })} />
        </div>)}
        <Button kind="soft" onClick={() => receive(r)}>Отметить приход</Button>
        <CommentsPanel entityType="product_request" entityId={r.id} />
      </div>)}</div>
    </Card>
  </>;
}
