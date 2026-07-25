'use strict';
document.addEventListener('DOMContentLoaded', async () => {
  const bal = document.getElementById('fin-balance');
  const led = document.getElementById('fin-ledger');
  const payoutList = document.getElementById('fin-payouts');
  const amountInput = document.getElementById('payout-amount');
  const requestBtn = document.getElementById('payout-request-btn');
  const payoutMsg = document.getElementById('payout-msg');

  async function loadBalance() {
    const bRes = await WorkHubAPI.api('/api/host/balance');
    const bData = await bRes.json();
    const b = bData.balance || {};
    bal.replaceChildren();
    [
      ['Available', b.available],
      ['Pending', b.pending],
      ['Paid out', b.paidOut],
    ].forEach(([label, val]) => {
      const card = document.createElement('div');
      card.className = 'bg-white border rounded-2xl p-4';
      card.appendChild(DomSafe.createTextElement('p', 'text-xs text-slate-400 font-bold uppercase', label));
      card.appendChild(
        DomSafe.createTextElement(
          'p',
          'text-xl font-black text-teal-700',
          Number(val || 0).toLocaleString('vi-VN') + 'đ'
        )
      );
      bal.appendChild(card);
    });
    return b;
  }

  async function loadLedger() {
    if (!led) return;
    led.replaceChildren();
    const lRes = await WorkHubAPI.api('/api/host/ledger?limit=50');
    const lData = await lRes.json();
    (lData.items || []).forEach((e) => {
      const tr = document.createElement('tr');
      tr.className = 'border-t';
      [e.Type, e.Direction, Number(e.Amount || 0).toLocaleString('vi-VN') + 'đ', e.Description || ''].forEach(
        (t, i) => {
          const td = document.createElement('td');
          td.className = i === 2 ? 'p-3 text-right font-bold' : 'p-3';
          td.textContent = t;
          tr.appendChild(td);
        }
      );
      led.appendChild(tr);
    });
  }

  async function loadPayouts() {
    if (!payoutList) return;
    payoutList.replaceChildren();
    const res = await WorkHubAPI.api('/api/host/payouts');
    const data = await res.json();
    const items = data.payouts || [];
    if (!items.length) {
      payoutList.appendChild(
        DomSafe.createTextElement('p', 'text-sm text-slate-400 p-4', 'Chưa có yêu cầu rút tiền.')
      );
      return;
    }
    items.forEach((p) => {
      const row = document.createElement('div');
      row.className = 'flex justify-between items-center border-t p-3 text-sm';
      row.appendChild(
        DomSafe.createTextElement(
          'span',
          'font-bold',
          Number(p.Amount || 0).toLocaleString('vi-VN') + 'đ'
        )
      );
      const right = document.createElement('div');
      right.className = 'text-right';
      right.appendChild(DomSafe.createTextElement('span', 'font-black uppercase text-xs text-slate-500', p.Status));
      if (p.BankNumberMasked) {
        right.appendChild(DomSafe.createTextElement('p', 'text-[10px] text-slate-400', p.BankNumberMasked));
      }
      row.appendChild(right);
      payoutList.appendChild(row);
    });
  }

  if (requestBtn) {
    requestBtn.addEventListener('click', async () => {
      payoutMsg.textContent = '';
      const amount = Math.round(Number(amountInput && amountInput.value));
      if (!amount || amount < 50000) {
        payoutMsg.textContent = 'Số tiền tối thiểu 50.000đ.';
        payoutMsg.className = 'text-sm text-red-600 mt-2';
        return;
      }
      requestBtn.disabled = true;
      try {
        const res = await WorkHubAPI.api('/api/host/payouts', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': 'payout-' + Date.now() + '-' + Math.random().toString(36).slice(2),
          },
          body: JSON.stringify({ amount }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.message || data.error || 'Không rút được tiền');
        }
        payoutMsg.textContent = 'Đã gửi yêu cầu rút ' + amount.toLocaleString('vi-VN') + 'đ.';
        payoutMsg.className = 'text-sm text-teal-700 mt-2 font-bold';
        if (amountInput) amountInput.value = '';
        await loadBalance();
        await loadPayouts();
        await loadLedger();
      } catch (err) {
        payoutMsg.textContent = err.message || 'Lỗi';
        payoutMsg.className = 'text-sm text-red-600 mt-2';
      } finally {
        requestBtn.disabled = false;
      }
    });
  }

  const exportStatus = document.getElementById('fin-export-status');
  const jobsBox = document.getElementById('fin-jobs');

  function setExportStatus(text) {
    if (!exportStatus) return;
    exportStatus.classList.remove('hidden');
    DomSafe.clearElement(exportStatus);
    exportStatus.appendChild(DomSafe.createTextElement('span', '', text));
  }

  async function pollJob(jobId, attempts) {
    const max = attempts || 40;
    for (let i = 0; i < max; i++) {
      const res = await WorkHubAPI.api(`/api/jobs/${jobId}`, { redirectOn401: false });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setExportStatus(data.error || 'Không lấy được job status');
        return;
      }
      const st = data.job?.Status || data.Status || data.status;
      setExportStatus(`Job ${jobId} · ${st}`);
      if (st === 'completed' || st === 'done' || st === 'success') {
        const dl = `/api/jobs/${jobId}/download`;
        DomSafe.clearElement(exportStatus);
        exportStatus.appendChild(
          DomSafe.createTextElement('span', 'font-bold text-teal-800', 'Export xong. ')
        );
        const a = document.createElement('a');
        a.href = dl;
        a.className = 'underline font-bold text-teal-700';
        a.textContent = 'Tải file';
        exportStatus.appendChild(a);
        loadMyJobs();
        return;
      }
      if (st === 'failed' || st === 'dead') {
        setExportStatus('Job thất bại: ' + (data.job?.LastError || data.error || st));
        return;
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    setExportStatus('Timeout chờ job — kiểm tra lại trong danh sách jobs.');
  }

  async function loadMyJobs() {
    if (!jobsBox) return;
    DomSafe.clearElement(jobsBox);
    try {
      const res = await WorkHubAPI.api('/api/jobs/me?limit=5', { redirectOn401: false });
      if (!res.ok) return;
      const data = await res.json();
      const jobs = data.jobs || data.items || [];
      if (!jobs.length) return;
      jobsBox.appendChild(DomSafe.createTextElement('p', 'font-bold text-slate-500 mb-1', 'Jobs gần đây'));
      jobs.forEach((j) => {
        const row = document.createElement('div');
        row.className = 'flex justify-between gap-2 border rounded-lg px-2 py-1';
        row.appendChild(
          DomSafe.createTextElement(
            'span',
            '',
            `${j.Type || j.type || 'job'} · ${j.Status || j.status}`
          )
        );
        if ((j.Status || j.status) === 'completed' || (j.Status || j.status) === 'done') {
          const a = document.createElement('a');
          a.href = `/api/jobs/${j._id || j.id}/download`;
          a.className = 'text-teal-700 font-bold';
          a.textContent = 'Download';
          row.appendChild(a);
        }
        jobsBox.appendChild(row);
      });
    } catch {
      /* ignore */
    }
  }

  const exportBtn = document.getElementById('ledger-export-btn');
  if (exportBtn) {
    exportBtn.addEventListener('click', async () => {
      // Small sync download (cookie session)
      window.location.href = '/api/host/ledger/export.csv';
    });
  }
  const asyncExportBtn = document.getElementById('ledger-export-async-btn');
  if (asyncExportBtn) {
    asyncExportBtn.addEventListener('click', async () => {
      asyncExportBtn.disabled = true;
      try {
        const res = await WorkHubAPI.api('/api/host/exports/ledger', { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || data.message || 'Export job failed');
        const jobId = data.jobId || data.job?._id;
        setExportStatus('Đã xếp hàng job ' + jobId + '…');
        await pollJob(jobId);
      } catch (e) {
        setExportStatus(e.message || 'Lỗi');
      } finally {
        asyncExportBtn.disabled = false;
      }
    });
  }
  const bookingsExportBtn = document.getElementById('bookings-export-async-btn');
  if (bookingsExportBtn) {
    bookingsExportBtn.addEventListener('click', async () => {
      bookingsExportBtn.disabled = true;
      try {
        const res = await WorkHubAPI.api('/api/host/exports/bookings', { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || data.message || 'Export failed');
        const jobId = data.jobId || data.job?._id;
        setExportStatus('Bookings export job ' + jobId + '…');
        await pollJob(jobId);
      } catch (e) {
        setExportStatus(e.message || 'Lỗi');
      } finally {
        bookingsExportBtn.disabled = false;
      }
    });
  }
  loadMyJobs();

  try {
    await loadBalance();
    await loadLedger();
    await loadPayouts();
  } catch (e) {
    console.error(e);
  }
});
