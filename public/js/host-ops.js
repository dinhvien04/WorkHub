'use strict';

(function () {
  const $ = (id) => document.getElementById(id);

  function msg(text, ok) {
    const el = $('ops-msg');
    if (!el) return;
    el.textContent = text;
    el.className =
      'mb-4 text-sm p-3 rounded-xl border ' +
      (ok ? 'bg-teal-50 text-teal-800 border-teal-100' : 'bg-red-50 text-red-700 border-red-100');
    el.classList.remove('hidden');
  }

  function parseIds(raw) {
    return String(raw || '')
      .split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter((s) => /^[a-f\d]{24}$/i.test(s));
  }

  async function loadBlackouts() {
    const box = $('bo-list');
    if (!box) return;
    DomSafe.clearElement(box);
    const res = await WorkHubAPI.api('/api/host/blackouts', { redirectOn401: true });
    const data = await res.json();
    if (!res.ok) {
      box.appendChild(DomSafe.createTextElement('li', 'text-red-600', data.error || 'Lỗi'));
      return;
    }
    (data.blackouts || []).forEach((b) => {
      const li = document.createElement('li');
      li.className = 'border rounded-xl p-3 flex justify-between gap-2 items-center';
      li.appendChild(
        DomSafe.createTextElement(
          'span',
          '',
          `${b.SpaceID} · ${new Date(b.StartTime).toLocaleString('vi-VN')} → ${new Date(b.EndTime).toLocaleString('vi-VN')} · ${b.Reason}`
        )
      );
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'text-xs font-bold text-red-600';
      btn.textContent = 'Xóa';
      btn.addEventListener('click', async () => {
        await WorkHubAPI.api(`/api/host/blackouts/${b._id}`, { method: 'DELETE' });
        loadBlackouts();
      });
      li.appendChild(btn);
      box.appendChild(li);
    });
    if (!(data.blackouts || []).length) {
      box.appendChild(DomSafe.createTextElement('li', 'text-slate-400', 'Chưa có blackout.'));
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('ops-bulk-btn')?.addEventListener('click', async () => {
      const spaceIds = parseIds($('ops-space-ids').value);
      if (!spaceIds.length) return msg('Nhập ít nhất 1 spaceId hợp lệ.');
      const body = { spaceIds };
      if ($('ops-status').value) body.status = $('ops-status').value;
      if ($('ops-price').value !== '') body.pricePerHour = Number($('ops-price').value);
      if ($('ops-deposit').value !== '') body.depositAmount = Number($('ops-deposit').value);
      if ($('ops-fc').value !== '') body.freeCancelHours = Number($('ops-fc').value);
      if ($('ops-instant').checked) body.instantBook = true;
      const am = ($('ops-amenities').value || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (am.length) body.amenities = am;

      const res = await WorkHubAPI.api('/api/host/spaces/bulk', { method: 'POST', body });
      const data = await res.json();
      if (!res.ok) return msg(data.error || 'Bulk thất bại');
      msg(`Đã sửa ${data.modified}/${data.matched} spaces · fields: ${(data.fields || []).join(', ')}`, true);
    });

    $('bo-create')?.addEventListener('click', async () => {
      const body = {
        spaceId: $('bo-space').value.trim(),
        startTime: new Date($('bo-start').value).toISOString(),
        endTime: new Date($('bo-end').value).toISOString(),
        reason: $('bo-reason').value.trim() || 'maintenance',
        notifyCustomers: $('bo-notify').checked,
      };
      const res = await WorkHubAPI.api('/api/host/blackouts', { method: 'POST', body });
      const data = await res.json();
      if (!res.ok) return msg(data.error || 'Tạo blackout thất bại');
      msg(`Blackout OK · notified ${data.notified || 0} khách`, true);
      const alts = $('bo-alts');
      DomSafe.clearElement(alts);
      if (data.alternatives && data.alternatives.length) {
        alts.appendChild(DomSafe.createTextElement('p', 'font-bold', 'Gợi ý slot thay thế:'));
        data.alternatives.forEach((a) => {
          alts.appendChild(DomSafe.createTextElement('p', '', a.label || JSON.stringify(a)));
        });
      }
      loadBlackouts();
    });

    loadBlackouts();
    loadAddOns();
    loadPricingRules();
    loadHostRefunds();

    $('ao-create')?.addEventListener('click', async () => {
      const body = {
        name: ($('ao-name')?.value || '').trim(),
        price: Number($('ao-price')?.value || 0),
        unit: $('ao-unit')?.value || 'booking',
        description: ($('ao-desc')?.value || '').trim(),
      };
      const branchId = ($('ao-branch')?.value || '').trim();
      if (branchId) body.branchId = branchId;
      if (!body.name) return msg('Nhập tên add-on.');
      const res = await WorkHubAPI.api('/api/host/addons', { method: 'POST', body });
      const data = await res.json();
      if (!res.ok) return msg(data.error || 'Tạo add-on thất bại');
      msg('Đã tạo add-on ' + (data.addOn?.Name || body.name), true);
      if ($('ao-name')) $('ao-name').value = '';
      loadAddOns();
    });

    $('pr-create')?.addEventListener('click', async () => {
      const body = {
        name: ($('pr-name')?.value || '').trim(),
        type: $('pr-type')?.value || 'peak_hour',
        multiplier: Number($('pr-mult')?.value || 1),
        fixedAdjust: Number($('pr-fixed')?.value || 0),
        priority: Number($('pr-prio')?.value || 100),
      };
      const spaceId = ($('pr-space')?.value || '').trim();
      if (spaceId) body.spaceId = spaceId;
      if (!body.name) return msg('Nhập tên pricing rule.');
      const res = await WorkHubAPI.api('/api/host/pricing-rules', { method: 'POST', body });
      const data = await res.json();
      if (!res.ok) return msg(data.error || 'Tạo rule thất bại');
      msg('Đã tạo draft rule ' + (data.rule?.Name || body.name), true);
      loadPricingRules();
    });
  });

  async function loadAddOns() {
    const box = $('ao-list');
    if (!box) return;
    DomSafe.clearElement(box);
    const res = await WorkHubAPI.api('/api/host/addons', { redirectOn401: true });
    const data = await res.json();
    if (!res.ok) {
      box.appendChild(DomSafe.createTextElement('li', 'text-red-600', data.error || 'Lỗi'));
      return;
    }
    const items = data.addOns || [];
    if (!items.length) {
      box.appendChild(DomSafe.createTextElement('li', 'text-slate-400', 'Chưa có add-on.'));
      return;
    }
    items.forEach((a) => {
      const li = document.createElement('li');
      li.className = 'border rounded-xl p-3';
      li.appendChild(
        DomSafe.createTextElement(
          'span',
          'font-semibold',
          `${a.Name} · ${Number(a.Price || 0).toLocaleString('vi-VN')}đ / ${a.Unit || 'booking'}`
        )
      );
      li.appendChild(
        DomSafe.createTextElement(
          'p',
          'text-xs text-slate-500',
          `${a.Status || 'active'}${a.BranchID ? ' · branch ' + a.BranchID : ' · global'}`
        )
      );
      box.appendChild(li);
    });
  }

  async function loadPricingRules() {
    const box = $('pr-list');
    if (!box) return;
    DomSafe.clearElement(box);
    const res = await WorkHubAPI.api('/api/host/pricing-rules', { redirectOn401: true });
    const data = await res.json();
    if (!res.ok) {
      box.appendChild(DomSafe.createTextElement('li', 'text-red-600', data.error || 'Lỗi'));
      return;
    }
    const items = data.rules || data.pricingRules || [];
    if (!items.length) {
      box.appendChild(DomSafe.createTextElement('li', 'text-slate-400', 'Chưa có pricing rule.'));
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
          `${r.Name} · ${r.Type} · ×${r.Multiplier}` +
            (r.FixedAdjust ? ` +${Number(r.FixedAdjust).toLocaleString('vi-VN')}đ` : '')
        )
      );
      left.appendChild(
        DomSafe.createTextElement(
          'p',
          'text-xs text-slate-500',
          `status=${r.Status} · prio=${r.Priority}${r.SpaceID ? ' · space ' + r.SpaceID : ''}`
        )
      );
      li.appendChild(left);
      if (r.Status === 'draft') {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'text-xs font-black uppercase bg-teal-600 text-white px-3 py-1.5 rounded-xl';
        btn.textContent = 'Publish';
        btn.addEventListener('click', async () => {
          const res2 = await WorkHubAPI.api(`/api/host/pricing-rules/${r._id}/publish`, {
            method: 'PUT',
            body: {},
          });
          const d2 = await res2.json().catch(() => ({}));
          if (!res2.ok) return msg(d2.error || 'Publish thất bại');
          msg('Đã publish rule', true);
          loadPricingRules();
        });
        li.appendChild(btn);
      }
      box.appendChild(li);
    });
  }

  async function loadHostRefunds() {
    const box = $('rf-list');
    if (!box) return;
    DomSafe.clearElement(box);
    const res = await WorkHubAPI.api('/api/host/refunds?limit=30', { redirectOn401: true });
    const data = await res.json();
    if (!res.ok) {
      box.appendChild(DomSafe.createTextElement('li', 'text-red-600', data.error || 'Lỗi'));
      return;
    }
    const items = data.refunds || [];
    if (!items.length) {
      box.appendChild(DomSafe.createTextElement('li', 'text-slate-400', 'Không có refund.'));
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
      if (r.Reason) {
        left.appendChild(DomSafe.createTextElement('p', 'text-xs text-slate-500', r.Reason));
      }
      li.appendChild(left);
      const actionable = ['requested', 'approved', 'manual_action_required', 'manual_refund_required'].includes(
        r.Status
      );
      if (actionable) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'text-xs font-black uppercase bg-amber-600 text-white px-3 py-1.5 rounded-xl';
        btn.textContent = 'Xử lý';
        btn.addEventListener('click', async () => {
          const transferReference =
            window.prompt('Transfer reference (bắt buộc nếu hoàn offline/manual):') || '';
          const res2 = await WorkHubAPI.api(`/api/host/refunds/${r._id}/process`, {
            method: 'PUT',
            body: {
              approve: true,
              transferReference: transferReference || undefined,
            },
          });
          const d2 = await res2.json().catch(() => ({}));
          if (!res2.ok) return msg(d2.error || 'Xử lý refund thất bại');
          msg('Refund → ' + (d2.refund?.Status || 'ok'), true);
          loadHostRefunds();
        });
        li.appendChild(btn);
      }
      box.appendChild(li);
    });
  }
})();
