'use strict';

document.addEventListener('DOMContentLoaded', async () => {
  const el = document.getElementById('health-json');
  try {
    const res = await WorkHubAPI.api('/api/admin/system-health');
    const data = await res.json();
    el.textContent = JSON.stringify(data, null, 2);
  } catch (e) {
    el.textContent = e.message || 'Lỗi';
  }

  function msg(text, ok) {
    const m = document.getElementById('ops-msg');
    if (!m) return;
    m.textContent = text;
    m.className =
      'mb-4 text-sm p-3 rounded-xl border ' +
      (ok ? 'bg-teal-50 text-teal-800 border-teal-100' : 'bg-red-50 text-red-700 border-red-100');
    m.classList.remove('hidden');
  }

  async function loadDeadLetters() {
    const box = document.getElementById('dl-list');
    if (!box) return;
    DomSafe.clearElement(box);
    const res = await WorkHubAPI.api('/api/admin/dead-letters');
    const data = await res.json();
    if (!res.ok) {
      box.appendChild(DomSafe.createTextElement('li', 'text-red-600', data.error || 'Lỗi'));
      return;
    }
    const items = data.items || data.deadLetters || [];
    if (!items.length) {
      box.appendChild(DomSafe.createTextElement('li', 'text-slate-400', 'Không có dead letter.'));
      return;
    }
    items.forEach((item) => {
      const li = document.createElement('li');
      li.className = 'border rounded-xl p-3 flex flex-wrap justify-between gap-2 items-start';
      const left = document.createElement('div');
      left.appendChild(
        DomSafe.createTextElement(
          'p',
          'font-semibold',
          (item.Type || item.JobType || item.type || 'job') +
            ' · ' +
            (item.Status || item.status || '')
        )
      );
      left.appendChild(
        DomSafe.createTextElement(
          'p',
          'text-xs text-slate-500 font-mono',
          String(item._id || item.id || '')
        )
      );
      const err = item.LastError || item.error || item.Error || item.reason || '';
      if (err) {
        left.appendChild(
          DomSafe.createTextElement('p', 'text-xs text-red-600', String(err).slice(0, 200))
        );
      }
      li.appendChild(left);
      const actions = document.createElement('div');
      actions.className = 'flex gap-2';
      const replay = document.createElement('button');
      replay.type = 'button';
      replay.className = 'text-xs font-black uppercase bg-teal-600 text-white px-3 py-1.5 rounded-xl';
      replay.textContent = 'Replay';
      replay.addEventListener('click', async () => {
        const r = await WorkHubAPI.api(`/api/admin/dead-letters/${item._id || item.id}/replay`, {
          method: 'POST',
          body: {},
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) return msg(d.error || 'Replay thất bại');
        msg('Đã replay', true);
        loadDeadLetters();
      });
      const discard = document.createElement('button');
      discard.type = 'button';
      discard.className = 'text-xs font-bold text-red-600 border px-3 py-1.5 rounded-xl';
      discard.textContent = 'Discard';
      discard.addEventListener('click', async () => {
        if (!confirm('Discard dead letter?')) return;
        const r = await WorkHubAPI.api(`/api/admin/dead-letters/${item._id || item.id}`, {
          method: 'DELETE',
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) return msg(d.error || 'Discard thất bại');
        msg('Đã discard', true);
        loadDeadLetters();
      });
      actions.appendChild(replay);
      actions.appendChild(discard);
      li.appendChild(actions);
      box.appendChild(li);
    });
  }

  async function loadPayouts() {
    const box = document.getElementById('po-list');
    if (!box) return;
    DomSafe.clearElement(box);
    const res = await WorkHubAPI.api('/api/admin/payouts?status=requested&limit=40');
    const data = await res.json();
    if (!res.ok) {
      box.appendChild(DomSafe.createTextElement('li', 'text-red-600', data.error || 'Lỗi'));
      return;
    }
    const items = data.payouts || [];
    if (!items.length) {
      box.appendChild(DomSafe.createTextElement('li', 'text-slate-400', 'Không có payout requested.'));
      return;
    }
    items.forEach((p) => {
      const li = document.createElement('li');
      li.className = 'border rounded-xl p-3 flex flex-wrap justify-between gap-2 items-center';
      const hostName =
        p.HostID?.FullName || p.HostID?.Email || String(p.HostID || '');
      const left = document.createElement('div');
      left.appendChild(
        DomSafe.createTextElement(
          'p',
          'font-semibold',
          `${Number(p.Amount || 0).toLocaleString('vi-VN')}đ · ${p.Status}`
        )
      );
      left.appendChild(
        DomSafe.createTextElement(
          'p',
          'text-xs text-slate-500',
          hostName + ' · ' + String(p._id)
        )
      );
      li.appendChild(left);
      const actions = document.createElement('div');
      actions.className = 'flex gap-2';
      const ok = document.createElement('button');
      ok.type = 'button';
      ok.className = 'text-xs font-black uppercase bg-teal-600 text-white px-3 py-1.5 rounded-xl';
      ok.textContent = 'Approve';
      ok.addEventListener('click', async () => {
        const transferReference =
          window.prompt('Transfer reference (bắt buộc khi chuyển khoản):') || '';
        if (!transferReference) {
          msg('Cần transfer reference để approve payout');
          return;
        }
        const r = await WorkHubAPI.api(`/api/admin/payouts/${p._id}/process`, {
          method: 'PUT',
          body: { approve: true, transferReference },
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) return msg(d.error || 'Approve thất bại');
        msg('Payout → ' + (d.payout?.Status || 'paid'), true);
        loadPayouts();
      });
      const rej = document.createElement('button');
      rej.type = 'button';
      rej.className = 'text-xs font-bold text-red-600 border px-3 py-1.5 rounded-xl';
      rej.textContent = 'Reject';
      rej.addEventListener('click', async () => {
        if (!confirm('Từ chối payout?')) return;
        const r = await WorkHubAPI.api(`/api/admin/payouts/${p._id}/process`, {
          method: 'PUT',
          body: { approve: false },
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) return msg(d.error || 'Reject thất bại');
        msg('Payout rejected', true);
        loadPayouts();
      });
      actions.appendChild(ok);
      actions.appendChild(rej);
      li.appendChild(actions);
      box.appendChild(li);
    });
  }

  async function loadRefunds() {
    const box = document.getElementById('admin-rf-list');
    if (!box) return;
    DomSafe.clearElement(box);
    const res = await WorkHubAPI.api('/api/admin/refunds?limit=40');
    const data = await res.json();
    if (!res.ok) {
      box.appendChild(DomSafe.createTextElement('li', 'text-red-600', data.error || 'Lỗi'));
      return;
    }
    const items = (data.refunds || []).filter((r) =>
      [
        'requested',
        'approved',
        'processing',
        'manual_action_required',
        'manual_refund_required',
      ].includes(r.Status)
    );
    if (!items.length) {
      box.appendChild(DomSafe.createTextElement('li', 'text-slate-400', 'Không có refund pending.'));
      return;
    }
    items.forEach((r) => {
      const li = document.createElement('li');
      li.className = 'border rounded-xl p-3 flex flex-wrap justify-between gap-2 items-center';
      const left = document.createElement('div');
      left.appendChild(
        DomSafe.createTextElement(
          'p',
          'font-semibold',
          `${Number(r.Amount || 0).toLocaleString('vi-VN')}đ · ${r.Status}`
        )
      );
      left.appendChild(
        DomSafe.createTextElement(
          'p',
          'text-xs text-slate-500 font-mono',
          String(r._id) + ' · booking ' + String(r.BookingID || '')
        )
      );
      li.appendChild(left);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'text-xs font-black uppercase bg-amber-600 text-white px-3 py-1.5 rounded-xl';
      btn.textContent = 'Process';
      btn.addEventListener('click', async () => {
        const transferReference =
          window.prompt('Transfer reference (nếu manual refund):') || '';
        const r2 = await WorkHubAPI.api(`/api/admin/refunds/${r._id}/process`, {
          method: 'PUT',
          body: {
            approve: true,
            transferReference: transferReference || undefined,
          },
        });
        const d = await r2.json().catch(() => ({}));
        if (!r2.ok) return msg(d.error || 'Process refund thất bại');
        msg('Refund → ' + (d.refund?.Status || 'ok'), true);
        loadRefunds();
      });
      li.appendChild(btn);
      box.appendChild(li);
    });
  }

  document.getElementById('dl-refresh')?.addEventListener('click', loadDeadLetters);
  document.getElementById('po-refresh')?.addEventListener('click', loadPayouts);
  document.getElementById('rf-refresh')?.addEventListener('click', loadRefunds);

  loadDeadLetters();
  loadPayouts();
  loadRefunds();
});
