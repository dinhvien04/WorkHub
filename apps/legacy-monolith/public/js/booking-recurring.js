'use strict';

(function () {
  const $ = (id) => document.getElementById(id);
  function err(msg) {
    const el = $('rc-error');
    if (!el) return;
    if (!msg) {
      el.classList.add('hidden');
      el.textContent = '';
      return;
    }
    el.classList.remove('hidden');
    el.textContent = msg;
  }

  function payload() {
    const dow = ($('rc-dow').value || '')
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => n >= 0 && n <= 6);
    return {
      spaceId: $('rc-space').value.trim(),
      frequency: $('rc-freq').value,
      interval: Number($('rc-interval').value) || 1,
      daysOfWeek: dow,
      startTimeOfDay: $('rc-tod').value,
      durationMinutes: Number($('rc-dur').value) || 60,
      seriesStart: $('rc-start').value,
      occurrenceCount: Number($('rc-count').value) || 4,
    };
  }

  async function preview() {
    err('');
    const body = payload();
    if (!body.spaceId || !body.seriesStart) {
      err('Nhập spaceId và series start.');
      return;
    }
    const res = await WorkHubAPI.api('/api/bookings/recurring/preview', {
      method: 'POST',
      body,
    });
    const data = await res.json();
    if (!res.ok) {
      err(data.error || 'Preview thất bại');
      $('rc-create').disabled = true;
      return;
    }
    const p = data.preview;
    $('rc-est').textContent = p.estimatedTotal
      ? `Ước tính tổng ${Number(p.estimatedTotal).toLocaleString('vi-VN')}đ · ${p.occurrenceCount} lần`
      : `${p.occurrenceCount} lần (chưa tính được giá)`;
    const list = $('rc-list');
    DomSafe.clearElement(list);
    (p.occurrences || []).forEach((o) => {
      const line = `${new Date(o.startTime).toLocaleString('vi-VN')} → ${new Date(o.endTime).toLocaleTimeString('vi-VN')}`;
      const price =
        o.totalAmount != null ? ` · ${Number(o.totalAmount).toLocaleString('vi-VN')}đ` : '';
      list.appendChild(DomSafe.createTextElement('li', '', line + price));
    });
    $('rc-create').disabled = !(p.occurrences && p.occurrences.length);
  }

  async function create() {
    err('');
    const body = payload();
    const res = await WorkHubAPI.api('/api/bookings/recurring', { method: 'POST', body });
    const data = await res.json();
    if (!res.ok) {
      err(data.error || 'Tạo series thất bại');
      return;
    }
    err('');
    alert(`Đã tạo ${data.createdCount || 0} booking. Thất bại: ${(data.failed || []).length}`);
    loadMine();
  }

  async function loadMine() {
    const box = $('rc-mine');
    if (!box) return;
    DomSafe.clearElement(box);
    try {
      const res = await WorkHubAPI.api('/api/bookings/recurring', { redirectOn401: false });
      if (!res.ok) {
        box.appendChild(DomSafe.createTextElement('li', 'text-slate-400', 'Đăng nhập để xem series.'));
        return;
      }
      const data = await res.json();
      (data.series || []).forEach((s) => {
        const li = document.createElement('li');
        li.className = 'border rounded-xl p-3 flex justify-between gap-2 items-center';
        li.appendChild(
          DomSafe.createTextElement(
            'span',
            '',
            `${s.Frequency} · ${s.StartTimeOfDay} · ${s.Status} · ${s.BookingIDs?.length || 0} bookings`
          )
        );
        if (s.Status === 'active') {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'text-xs font-bold text-red-600';
          btn.textContent = 'Hủy';
          btn.addEventListener('click', async () => {
            await WorkHubAPI.api(`/api/bookings/recurring/${s._id}/cancel`, { method: 'PUT' });
            loadMine();
          });
          li.appendChild(btn);
        }
        box.appendChild(li);
      });
      if (!(data.series || []).length) {
        box.appendChild(DomSafe.createTextElement('li', 'text-slate-400', 'Chưa có series.'));
      }
    } catch {
      box.appendChild(DomSafe.createTextElement('li', 'text-slate-400', 'Không tải được.'));
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const d = new Date();
    d.setDate(d.getDate() + 2);
    if ($('rc-start')) $('rc-start').value = d.toISOString().slice(0, 10);
    const q = new URLSearchParams(location.search);
    if (q.get('spaceId') && $('rc-space')) $('rc-space').value = q.get('spaceId');
    $('rc-preview')?.addEventListener('click', preview);
    $('rc-create')?.addEventListener('click', create);
    loadMine();
  });
})();
