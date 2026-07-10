'use strict';

(function () {
  const state = {
    step: 1,
    spaceId: null,
    space: null,
    branchId: '',
    date: '',
    slot: '',
    roomType: 'meeting',
    note: '',
    couponCode: '',
    discountAmount: 0,
    total: 0,
    deposit: 0,
    bookingId: null,
    holdExpiresAt: null,
  };

  const $ = (id) => document.getElementById(id);

  function showError(msg) {
    const el = $('wizard-error');
    if (!el) return;
    if (!msg) {
      el.classList.add('hidden');
      el.textContent = '';
      return;
    }
    el.classList.remove('hidden');
    el.textContent = msg;
  }

  function setStep(n) {
    state.step = n;
    document.querySelectorAll('.wizard-step').forEach((s) => s.classList.add('hidden'));
    const cur = document.getElementById('step-' + n);
    if (cur) cur.classList.remove('hidden');
    document.querySelectorAll('.step-pill').forEach((p) => {
      const sn = Number(p.getAttribute('data-step'));
      p.className =
        'flex-1 rounded-xl py-2 text-center step-pill ' +
        (sn === n ? 'bg-teal-600 text-white' : sn < n ? 'bg-teal-100 text-teal-800' : 'bg-slate-100 text-slate-500');
    });
    try {
      sessionStorage.setItem('bookingWizardDraft', JSON.stringify(state));
    } catch {
      /* ignore */
    }
  }

  function restoreDraft() {
    try {
      const raw = sessionStorage.getItem('bookingWizardDraft');
      if (!raw) return;
      Object.assign(state, JSON.parse(raw));
      if ($('wz-branch')) $('wz-branch').value = state.branchId || '';
      if ($('wz-date')) $('wz-date').value = state.date || '';
      if ($('wz-slot')) $('wz-slot').value = state.slot || $('wz-slot').value;
      if ($('wz-type')) $('wz-type').value = state.roomType || 'meeting';
      if ($('wz-note')) $('wz-note').value = state.note || '';
      if ($('wz-coupon')) $('wz-coupon').value = state.couponCode || '';
      if (state.step) setStep(state.step);
    } catch {
      /* ignore */
    }
  }

  async function checkAvailability() {
    showError('');
    state.branchId = $('wz-branch').value.trim();
    state.date = $('wz-date').value;
    state.slot = $('wz-slot').value;
    state.roomType = $('wz-type').value;
    if (!state.branchId || !state.date || !state.slot) {
      showError('Vui lòng nhập branch, ngày và khung giờ.');
      return;
    }
    const params = new URLSearchParams({
      branchId: state.branchId,
      date: state.date,
      timeSlot: state.slot,
      roomType: state.roomType,
    });
    const box = $('wz-spaces');
    DomSafe.clearElement(box);
    box.appendChild(DomSafe.createTextElement('p', 'text-sm text-slate-500', 'Đang tải...'));
    const res = await WorkHubAPI.api(`/api/customers/bookings/availability?${params}`, {
      redirectOn401: false,
    });
    const data = await res.json();
    DomSafe.clearElement(box);
    if (!res.ok) {
      showError(data.error || 'Không kiểm tra được chỗ trống');
      return;
    }
    if (!data.spaces || !data.spaces.length) {
      box.appendChild(
        DomSafe.createTextElement('p', 'text-sm text-slate-400', 'Không còn phòng. Đang gợi ý khung giờ khác…')
      );
      $('wz-next-1').disabled = true;
      try {
        const [a, b] = state.slot.split(' - ');
        const startTime = new Date(`${state.date}T${a}:00`).toISOString();
        const endTime = new Date(`${state.date}T${b}:00`).toISOString();
        // Use first space of branch if known; else skip detailed alts
        const altRes = await WorkHubAPI.api(
          `/api/availability/alternatives?spaceId=${encodeURIComponent(state.spaceId || '')}&startTime=${encodeURIComponent(startTime)}&endTime=${encodeURIComponent(endTime)}`,
          { redirectOn401: false }
        );
        const altData = await altRes.json();
        if (altData.alternatives && altData.alternatives.length) {
          const wrap = document.createElement('div');
          wrap.className = 'mt-3 space-y-1';
          wrap.appendChild(DomSafe.createTextElement('p', 'text-xs font-bold text-slate-600', 'Khung giờ thay thế:'));
          altData.alternatives.forEach((alt) => {
            wrap.appendChild(DomSafe.createTextElement('p', 'text-xs text-teal-700', alt.label));
          });
          box.appendChild(wrap);
        }
      } catch {
        /* ignore */
      }
      return;
    }
    DomSafe.renderSpaceList(box, data.spaces, (space) => {
      state.spaceId = space._id;
      state.space = space;
      document.querySelectorAll('.space-card').forEach((c) => c.classList.remove('ring-2', 'ring-teal-500'));
      // highlight by data-space-id
      const cards = box.querySelectorAll('[data-space-id]');
      cards.forEach((c) => {
        if (c.dataset.spaceId === String(space._id)) c.classList.add('ring-2', 'ring-teal-500');
      });
      const [a, b] = state.slot.split(' - ');
      const start = new Date(`${state.date}T${a}:00`);
      const end = new Date(`${state.date}T${b}:00`);
      const hours = (end - start) / 3600000;
      state.total = Math.round(hours * (space.PricePerHour || 0));
      state.deposit = Math.round(state.total * 0.3);
      $('wz-next-1').disabled = false;
    });
  }

  function renderSummary() {
    const el = $('wz-summary');
    DomSafe.clearElement(el);
    const lines = [
      `Phòng: ${state.space?.Name || state.spaceId || '—'}`,
      `Ngày: ${state.date} · ${state.slot}`,
      `Tạm tính: ${Number(state.total).toLocaleString('vi-VN')}đ`,
      `Cọc ước tính: ${Number(state.deposit).toLocaleString('vi-VN')}đ`,
    ];
    if (state.discountAmount) {
      lines.push(`Giảm giá: -${Number(state.discountAmount).toLocaleString('vi-VN')}đ`);
    }
    if (state.couponCode) lines.push(`Mã: ${state.couponCode}`);
    lines.forEach((t) => el.appendChild(DomSafe.createTextElement('p', '', t)));
  }

  async function applyCoupon() {
    const code = $('wz-coupon').value.trim();
    const msg = $('wz-coupon-msg');
    msg.textContent = '';
    if (!code || !state.total) {
      msg.textContent = 'Nhập mã và chọn phòng trước.';
      return;
    }
    const res = await WorkHubAPI.api('/api/me/coupons/preview', {
      method: 'POST',
      body: {
        code,
        orderAmount: state.total,
        branchId: state.branchId,
      },
    });
    const data = await res.json();
    if (!res.ok) {
      msg.textContent = data.error || 'Mã không hợp lệ';
      state.couponCode = '';
      state.discountAmount = 0;
      return;
    }
    state.couponCode = data.code;
    state.discountAmount = data.discountAmount;
    state.total = data.finalAmount;
    state.deposit = Math.round(state.total * 0.3);
    msg.textContent = `Giảm ${data.discountAmount.toLocaleString('vi-VN')}đ`;
  }

  async function submitBooking() {
    showError('');
    if (!$('wz-policy').checked) {
      showError('Vui lòng đồng ý chính sách.');
      return;
    }
    if (!state.spaceId) {
      showError('Chưa chọn phòng.');
      return;
    }
    const [a, b] = state.slot.split(' - ');
    const startTime = new Date(`${state.date}T${a}:00`).toISOString();
    const endTime = new Date(`${state.date}T${b}:00`).toISOString();
    const btn = $('wz-submit');
    btn.disabled = true;
    try {
      const res = await WorkHubAPI.api('/api/customers/me/bookings', {
        method: 'POST',
        body: {
          spaceId: state.spaceId,
          startTime,
          endTime,
          note: $('wz-note').value.trim(),
          couponCode: state.couponCode || undefined,
          holdMinutes: 15,
        },
      });
      const data = await res.json();
      if (!res.ok) {
        let msg = data.error || 'Không tạo được đơn';
        if (data.alternatives && data.alternatives.length) {
          msg +=
            ' · Gợi ý: ' +
            data.alternatives
              .slice(0, 3)
              .map((a) => a.label)
              .join('; ');
        }
        showError(msg);
        btn.disabled = false;
        return;
      }
      state.bookingId = data.booking._id;
      state.holdExpiresAt = data.holdExpiresAt || data.booking.HoldExpiresAt;
      sessionStorage.setItem(
        'pendingBooking',
        JSON.stringify({
          total: data.booking.TotalAmount,
          deposit: data.booking.DepositAmount,
          branchId: state.branchId,
          bookingId: state.bookingId,
        })
      );
      sessionStorage.removeItem('bookingWizardDraft');
      window.location.href = `/payment?bookingId=${state.bookingId}&branchId=${encodeURIComponent(state.branchId)}`;
    } catch (e) {
      showError('Lỗi kết nối');
      btn.disabled = false;
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    restoreDraft();
    const today = new Date().toISOString().slice(0, 10);
    if ($('wz-date') && !$('wz-date').value) $('wz-date').value = today;

    // Prefill branchId from query
    const q = new URLSearchParams(window.location.search);
    if (q.get('branchId') && $('wz-branch')) $('wz-branch').value = q.get('branchId');

    $('wz-check')?.addEventListener('click', checkAvailability);
    $('wz-next-1')?.addEventListener('click', () => {
      if (!state.spaceId) return showError('Chọn một phòng.');
      setStep(2);
    });
    $('wz-back-2')?.addEventListener('click', () => setStep(1));
    $('wz-next-2')?.addEventListener('click', () => {
      state.note = $('wz-note').value.trim();
      renderSummary();
      setStep(3);
    });
    $('wz-back-3')?.addEventListener('click', () => setStep(2));
    $('wz-apply-coupon')?.addEventListener('click', applyCoupon);
    $('wz-submit')?.addEventListener('click', submitBooking);
  });
})();
