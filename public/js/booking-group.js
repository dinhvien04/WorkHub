'use strict';

(function () {
  const $ = (id) => document.getElementById(id);
  function showErr(msg) {
    const el = $('gp-error');
    if (!el) return;
    if (!msg) {
      el.classList.add('hidden');
      el.textContent = '';
      return;
    }
    el.classList.remove('hidden');
    el.textContent = msg;
  }

  function parseAttendees(text) {
    return String(text || '')
      .split(/\n|,/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const m = line.match(/^(.+?)\s*<([^>]+)>$/);
        if (m) return { name: m[1].trim(), email: m[2].trim() };
        return { email: line, name: line.split('@')[0] };
      });
  }

  function toIso(localVal) {
    if (!localVal) return null;
    const d = new Date(localVal);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  document.addEventListener('DOMContentLoaded', () => {
    const q = new URLSearchParams(location.search);
    if (q.get('spaceId') && $('gp-space')) $('gp-space').value = q.get('spaceId');

    $('gp-submit')?.addEventListener('click', async () => {
      showErr('');
      $('gp-ok')?.classList.add('hidden');
      const body = {
        spaceId: $('gp-space').value.trim(),
        startTime: toIso($('gp-start').value),
        endTime: toIso($('gp-end').value),
        corporateName: $('gp-corp').value.trim(),
        note: $('gp-note').value.trim(),
        attendees: parseAttendees($('gp-attendees').value),
      };
      if (!body.spaceId || !body.startTime || !body.endTime) {
        showErr('Thiếu space hoặc thời gian.');
        return;
      }
      const btn = $('gp-submit');
      btn.disabled = true;
      try {
        const res = await WorkHubAPI.api('/api/bookings/group', { method: 'POST', body });
        const data = await res.json();
        if (!res.ok) {
          showErr(data.error || 'Tạo group thất bại');
          btn.disabled = false;
          return;
        }
        const ok = $('gp-ok');
        ok.textContent = `Đã tạo booking · ${data.group?.attendeeCount || 0} invite`;
        ok.classList.remove('hidden');
        const box = $('gp-result');
        box.classList.remove('hidden');
        const ul = $('gp-invites');
        DomSafe.clearElement(ul);
        (data.invites || []).forEach((inv) => {
          const li = document.createElement('li');
          li.className = 'border rounded-xl p-2';
          li.appendChild(DomSafe.createTextElement('p', 'font-semibold', inv.name || inv.email));
          const a = document.createElement('a');
          a.href = inv.invitePath || `/rsvp/${inv.token}`;
          a.className = 'text-teal-700 text-xs underline break-all';
          a.textContent = a.href;
          a.target = '_blank';
          li.appendChild(a);
          ul.appendChild(li);
        });
        const id = data.booking?._id || data.booking?.id;
        if (id) {
          $('gp-detail').href = `/booking/detail?id=${id}`;
        }
      } catch {
        showErr('Lỗi kết nối');
      }
      btn.disabled = false;
    });
  });
})();
