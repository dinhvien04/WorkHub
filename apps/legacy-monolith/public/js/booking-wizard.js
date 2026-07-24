'use strict';

/**
 * 3-step booking wizard:
 * 1 time+room · 2 note/coupon/add-ons · 3 server price breakdown + confirm
 * Draft: localStorage + sessionStorage; restored after login.
 */
(function () {
  const DRAFT_KEY = 'bookingWizardDraft';
  const DRAFT_TTL_MS = 7 * 24 * 3600 * 1000;

  const state = {
    step: 1,
    spaceId: null,
    space: null,
    branchId: '',
    hostId: '',
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
    addOns: [], // { addOnId, quantity, name, unitPrice }
    availableAddOns: [],
    quote: null,
    freeCancelHours: 24,
    policySummary: '',
    savedAt: 0,
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

  function persistDraft() {
    state.note = ($('wz-note') && $('wz-note').value.trim()) || state.note;
    state.couponCode = ($('wz-coupon') && $('wz-coupon').value.trim()) || state.couponCode;
    state.savedAt = Date.now();
    const payload = JSON.stringify(state);
    try {
      sessionStorage.setItem(DRAFT_KEY, payload);
    } catch {
      /* ignore */
    }
    try {
      localStorage.setItem(DRAFT_KEY, payload);
    } catch {
      /* ignore */
    }
  }

  function loadDraftRaw() {
    let raw = null;
    try {
      raw = sessionStorage.getItem(DRAFT_KEY) || localStorage.getItem(DRAFT_KEY);
    } catch {
      raw = null;
    }
    if (!raw) return null;
    try {
      const data = JSON.parse(raw);
      if (data.savedAt && Date.now() - data.savedAt > DRAFT_TTL_MS) {
        clearDraft();
        return null;
      }
      return data;
    } catch {
      return null;
    }
  }

  function clearDraft() {
    try {
      sessionStorage.removeItem(DRAFT_KEY);
    } catch {
      /* ignore */
    }
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* ignore */
    }
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
        (sn === n
          ? 'bg-teal-600 text-white'
          : sn < n
            ? 'bg-teal-100 text-teal-800'
            : 'bg-slate-100 text-slate-500');
    });
    persistDraft();
  }

  function restoreDraft() {
    const data = loadDraftRaw();
    if (!data) return;
    Object.assign(state, data);
    if ($('wz-branch')) $('wz-branch').value = state.branchId || '';
    if ($('wz-date')) $('wz-date').value = state.date || '';
    if ($('wz-slot') && state.slot) {
      const opt = Array.from($('wz-slot').options).find((o) => o.value === state.slot || o.text === state.slot);
      if (opt) $('wz-slot').value = opt.value;
      else $('wz-slot').value = state.slot;
    }
    if ($('wz-type')) $('wz-type').value = state.roomType || 'meeting';
    if ($('wz-note')) $('wz-note').value = state.note || '';
    if ($('wz-coupon')) $('wz-coupon').value = state.couponCode || '';
    if (state.step && state.step > 1) setStep(state.step);
  }

  function slotRange() {
    const [a, b] = String(state.slot || '').split(' - ').map((s) => s.trim());
    if (!a || !b || !state.date) return null;
    const startTime = new Date(`${state.date}T${a}:00`);
    const endTime = new Date(`${state.date}T${b}:00`);
    if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime())) return null;
    return { startTime, endTime };
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
        const range = slotRange();
        if (!range) return;
        const altRes = await WorkHubAPI.api(
          `/api/availability/alternatives?spaceId=${encodeURIComponent(state.spaceId || '')}&startTime=${encodeURIComponent(range.startTime.toISOString())}&endTime=${encodeURIComponent(range.endTime.toISOString())}`,
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
      state.hostId = space.HostID || space.hostId || state.hostId;
      document.querySelectorAll('.space-card').forEach((c) => c.classList.remove('ring-2', 'ring-teal-500'));
      box.querySelectorAll('[data-space-id]').forEach((c) => {
        if (c.dataset.spaceId === String(space._id)) c.classList.add('ring-2', 'ring-teal-500');
      });
      const range = slotRange();
      if (range) {
        const hours = (range.endTime - range.startTime) / 3600000;
        state.total = Math.round(hours * (space.PricePerHour || 0));
        state.deposit = Math.round(state.total * 0.3);
        state.freeCancelHours = space.FreeCancelHours != null ? space.FreeCancelHours : 24;
      }
      $('wz-next-1').disabled = false;
      loadAddOns();
      persistDraft();
    });

    // Prefill select spaceId from query
    const pref = new URLSearchParams(window.location.search).get('spaceId');
    if (pref) {
      const match = data.spaces.find((s) => String(s._id) === String(pref));
      if (match) {
        const card = box.querySelector(`[data-space-id="${pref}"]`);
        if (card) card.click();
      }
    }
  }

  async function loadAddOns() {
    const list = $('wz-addons');
    if (!list) return;
    DomSafe.clearElement(list);
    try {
      const q = state.hostId
        ? `hostId=${encodeURIComponent(state.hostId)}`
        : state.branchId
          ? `branchId=${encodeURIComponent(state.branchId)}`
          : '';
      if (!q) return;
      const res = await WorkHubAPI.api(`/api/addons?${q}`, { redirectOn401: false });
      const data = await res.json();
      state.availableAddOns = data.addOns || [];
      if (!state.availableAddOns.length) {
        list.appendChild(DomSafe.createTextElement('p', 'text-xs text-slate-400', 'Không có add-on.'));
        return;
      }
      state.availableAddOns.forEach((a) => {
        const id = String(a._id);
        const row = document.createElement('label');
        row.className = 'flex items-center gap-2 text-sm border rounded-xl px-3 py-2 cursor-pointer hover:border-teal-400';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.dataset.addonId = id;
        cb.checked = state.addOns.some((x) => String(x.addOnId) === id);
        const selected = state.addOns.find((x) => String(x.addOnId) === id);
        const qty = document.createElement('input');
        qty.type = 'number';
        qty.min = '1';
        qty.max = '10';
        qty.value = selected ? selected.quantity : 1;
        qty.className = 'w-14 border rounded-lg px-1 py-0.5 text-xs';
        qty.disabled = !cb.checked;
        cb.addEventListener('change', () => {
          qty.disabled = !cb.checked;
          syncAddOnsFromUi();
        });
        qty.addEventListener('change', syncAddOnsFromUi);
        row.appendChild(cb);
        row.appendChild(
          DomSafe.createTextElement(
            'span',
            'flex-1',
            `${a.Name || a.name} · ${Number(a.Price || 0).toLocaleString('vi-VN')}đ/${a.Unit || 'item'}`
          )
        );
        row.appendChild(qty);
        list.appendChild(row);
      });
    } catch {
      list.appendChild(DomSafe.createTextElement('p', 'text-xs text-slate-400', 'Không tải được add-on.'));
    }
  }

  function syncAddOnsFromUi() {
    const list = $('wz-addons');
    if (!list) return;
    const next = [];
    list.querySelectorAll('label').forEach((row) => {
      const cb = row.querySelector('input[type="checkbox"]');
      const qtyEl = row.querySelector('input[type="number"]');
      if (cb && cb.checked) {
        next.push({
          addOnId: cb.dataset.addonId,
          quantity: Math.max(1, Math.min(10, Number(qtyEl?.value) || 1)),
        });
      }
    });
    state.addOns = next;
    persistDraft();
  }

  function renderPriceBreakdown(quote) {
    const el = $('wz-summary');
    if (!el) return;
    DomSafe.clearElement(el);

    el.appendChild(
      DomSafe.createTextElement(
        'p',
        'font-bold text-slate-800',
        `${quote.spaceName || state.space?.Name || '—'} · ${state.date} · ${state.slot}`
      )
    );
    if (quote.instantBook) {
      el.appendChild(DomSafe.createTextElement('p', 'text-xs text-teal-700 font-bold', '⚡ Instant book'));
    }

    const table = document.createElement('div');
    table.className = 'mt-3 space-y-1 border-t border-slate-200 pt-3';
    (quote.lines || []).forEach((line) => {
      const row = document.createElement('div');
      row.className =
        'flex justify-between gap-2 text-sm ' + (line.emphasize ? 'font-black text-slate-900 mt-1' : 'text-slate-600');
      row.appendChild(DomSafe.createTextElement('span', '', line.label));
      const amt = Number(line.amount) || 0;
      row.appendChild(
        DomSafe.createTextElement(
          'span',
          amt < 0 ? 'text-emerald-600' : '',
          (amt < 0 ? '−' : '') + Math.abs(amt).toLocaleString('vi-VN') + 'đ'
        )
      );
      table.appendChild(row);
    });
    el.appendChild(table);

    if (quote.appliedRules && quote.appliedRules.length) {
      el.appendChild(
        DomSafe.createTextElement(
          'p',
          'text-[10px] text-slate-400 mt-2',
          'Quy tắc giá: ' + quote.appliedRules.map((r) => r.name || r.type).join(', ')
        )
      );
    }
    if (quote.remainderAmount > 0) {
      el.appendChild(
        DomSafe.createTextElement(
          'p',
          'text-xs text-slate-500 mt-2',
          `Thanh toán còn lại sau cọc: ${Number(quote.remainderAmount).toLocaleString('vi-VN')}đ`
        )
      );
    }
    if (quote.policy && quote.policy.summary) {
      el.appendChild(
        DomSafe.createTextElement('p', 'text-xs text-amber-700 mt-2', quote.policy.summary)
      );
      state.policySummary = quote.policy.summary;
      state.freeCancelHours = quote.freeCancelHours;
      const pol = $('wz-policy-text');
      if (pol) pol.textContent = quote.policy.summary;
    }

    state.quote = quote;
    state.total = quote.totalAmount;
    state.deposit = quote.depositAmount;
    state.discountAmount = quote.discountAmount || 0;
  }

  async function fetchQuote() {
    showError('');
    if (!state.spaceId) {
      showError('Chưa chọn phòng.');
      return null;
    }
    const range = slotRange();
    if (!range) {
      showError('Thời gian không hợp lệ.');
      return null;
    }
    syncAddOnsFromUi();
    const body = {
      spaceId: state.spaceId,
      startTime: range.startTime.toISOString(),
      endTime: range.endTime.toISOString(),
      addOns: state.addOns,
      couponCode: ($('wz-coupon') && $('wz-coupon').value.trim()) || state.couponCode || undefined,
    };
    const res = await WorkHubAPI.api('/api/bookings/quote', {
      method: 'POST',
      body,
      redirectOn401: false,
    });
    const data = await res.json();
    if (!res.ok || data.ok === false) {
      showError(data.error || 'Không lấy được báo giá server.');
      return null;
    }
    return data.quote;
  }

  async function applyCoupon() {
    const msg = $('wz-coupon-msg');
    if (msg) msg.textContent = '';
    state.couponCode = ($('wz-coupon') && $('wz-coupon').value.trim()) || '';
    const quote = await fetchQuote();
    if (!quote) return;
    if (quote.coupon && quote.coupon.pendingLogin) {
      if (msg) msg.textContent = 'Đăng nhập để áp dụng mã giảm giá khi tạo đơn.';
    } else if (quote.discountAmount > 0) {
      if (msg) msg.textContent = `Giảm ${quote.discountAmount.toLocaleString('vi-VN')}đ`;
    } else if (state.couponCode) {
      if (msg) msg.textContent = 'Mã chưa được áp dụng (kiểm tra đăng nhập / điều kiện).';
    }
    if (state.step === 3) renderPriceBreakdown(quote);
    persistDraft();
  }

  async function goStep3() {
    state.note = ($('wz-note') && $('wz-note').value.trim()) || '';
    const quote = await fetchQuote();
    if (!quote) return;
    renderPriceBreakdown(quote);
    setStep(3);
  }

  function holdCountdown() {
    const el = $('wz-hold-timer');
    if (!el || !state.holdExpiresAt) return;
    const end = new Date(state.holdExpiresAt).getTime();
    const tick = () => {
      const left = Math.max(0, end - Date.now());
      if (left <= 0) {
        el.textContent = 'Hold đã hết hạn — vui lòng tạo lại đơn.';
        return;
      }
      const m = Math.floor(left / 60000);
      const s = Math.floor((left % 60000) / 1000);
      el.textContent = `Giữ chỗ tạm: còn ${m}:${String(s).padStart(2, '0')}`;
      requestAnimationFrame(() => setTimeout(tick, 1000));
    };
    tick();
  }

  async function submitBooking() {
    showError('');
    if (!$('wz-policy') || !$('wz-policy').checked) {
      showError('Vui lòng đồng ý chính sách.');
      return;
    }
    if (!state.spaceId) {
      showError('Chưa chọn phòng.');
      return;
    }
    const range = slotRange();
    if (!range) {
      showError('Thời gian không hợp lệ.');
      return;
    }
    syncAddOnsFromUi();
    const btn = $('wz-submit');
    if (btn.disabled) return;
    btn.disabled = true;
    const idemKey =
      'wz-' +
      (state.spaceId || '') +
      '-' +
      range.startTime.getTime() +
      '-' +
      (state.couponCode || '') +
      '-' +
      Math.random().toString(36).slice(2, 8);

    try {
      // Fresh server quote immediately before create
      const quote = await fetchQuote();
      if (!quote) {
        btn.disabled = false;
        return;
      }
      renderPriceBreakdown(quote);

      const res = await WorkHubAPI.api('/api/customers/me/bookings', {
        method: 'POST',
        headers: { 'Idempotency-Key': idemKey },
        body: {
          spaceId: state.spaceId,
          startTime: range.startTime.toISOString(),
          endTime: range.endTime.toISOString(),
          note: state.note,
          couponCode: state.couponCode || undefined,
          holdMinutes: 15,
          addOns: state.addOns,
          preferInstant: true,
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
      holdCountdown();
      try {
        sessionStorage.setItem(
          'pendingBooking',
          JSON.stringify({
            total: data.booking.TotalAmount,
            deposit: data.booking.DepositAmount,
            branchId: state.branchId,
            bookingId: state.bookingId,
            priceBreakdown: data.priceBreakdown || null,
          })
        );
      } catch {
        /* ignore */
      }
      clearDraft();
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

    const q = new URLSearchParams(window.location.search);
    if (q.get('branchId') && $('wz-branch')) $('wz-branch').value = q.get('branchId');
    if (q.get('date') && $('wz-date')) $('wz-date').value = q.get('date');
    if (q.get('slot') && $('wz-slot')) $('wz-slot').value = q.get('slot');
    if (q.get('type') && $('wz-type')) $('wz-type').value = q.get('type');

    // After login return URL
    if (q.get('restore') === '1') {
      const draft = loadDraftRaw();
      if (draft && draft.step) setStep(draft.step);
    }

    $('wz-check')?.addEventListener('click', checkAvailability);
    $('wz-next-1')?.addEventListener('click', () => {
      if (!state.spaceId) return showError('Chọn một phòng.');
      loadAddOns();
      setStep(2);
    });
    $('wz-back-2')?.addEventListener('click', () => setStep(1));
    $('wz-next-2')?.addEventListener('click', goStep3);
    $('wz-back-3')?.addEventListener('click', () => setStep(2));
    $('wz-apply-coupon')?.addEventListener('click', applyCoupon);
    $('wz-submit')?.addEventListener('click', submitBooking);
    $('wz-note')?.addEventListener('change', persistDraft);
    $('wz-refresh-quote')?.addEventListener('click', async () => {
      const quote = await fetchQuote();
      if (quote) renderPriceBreakdown(quote);
    });

    // Auto-check if branch prefilled
    if ($('wz-branch')?.value && q.get('autocheck') === '1') {
      checkAvailability();
    }
  });
})();
