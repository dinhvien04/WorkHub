'use strict';

document.addEventListener('DOMContentLoaded', async () => {
  const list = document.getElementById('dlq-list');
  if (!list) return;

  const btnPending = document.getElementById('tab-pending');
  const btnReplayed = document.getElementById('tab-replayed');
  const btnDiscarded = document.getElementById('tab-discarded');

  let currentStatus = 'pending';

  const updateTabs = () => {
    btnPending.className = `px-4 py-2 font-bold rounded ${currentStatus === 'pending' ? 'bg-black text-white' : 'bg-gray-200 text-black'}`;
    btnReplayed.className = `px-4 py-2 font-bold rounded ${currentStatus === 'replayed' ? 'bg-black text-white' : 'bg-gray-200 text-black'}`;
    btnDiscarded.className = `px-4 py-2 font-bold rounded ${currentStatus === 'discarded' ? 'bg-black text-white' : 'bg-gray-200 text-black'}`;
  };

  const loadDlq = async () => {
    DomSafe.clearElement(list);
    updateTabs();

    try {
      const res = await WorkHubAPI.api(`/api/admin/dlq?status=${currentStatus}`);
      const data = await res.json();
      const items = data.messages || [];

      if (!items.length) {
        list.appendChild(DomSafe.createTextElement('p', 'text-slate-400 text-sm', `Không có thông điệp nào ở trạng thái ${currentStatus}.`));
        return;
      }

      items.forEach((item) => {
        const card = document.createElement('div');
        card.className = 'bg-white border rounded-2xl p-4 space-y-2';

        // Title line
        const header = document.createElement('div');
        header.className = 'flex justify-between items-start';
        header.appendChild(DomSafe.createTextElement('p', 'font-bold text-sm text-slate-800', `Queue: ${item.QueueName || 'unknown'}`));
        header.appendChild(DomSafe.createTextElement('span', 'text-xs px-2 py-0.5 rounded font-semibold bg-red-100 text-red-700', item.Status.toUpperCase()));
        card.appendChild(header);

        // Routing Key
        card.appendChild(DomSafe.createTextElement('p', 'text-xs text-slate-500 font-mono', `Routing Key: ${item.RoutingKey || 'n/a'}`));

        // Error message
        if (item.Error) {
          const errDiv = document.createElement('div');
          errDiv.className = 'bg-red-50 text-red-700 text-xs p-2 rounded border border-red-100 font-mono break-all';
          errDiv.textContent = `Lỗi: ${item.Error}`;
          card.appendChild(errDiv);
        }

        // Payload Details (collapsible or text representation)
        const payloadStr = JSON.stringify(item.Payload, null, 2);
        const details = document.createElement('details');
        details.className = 'text-xs text-slate-600 mt-2';
        const summary = document.createElement('summary');
        summary.className = 'cursor-pointer text-slate-500 hover:text-black font-semibold';
        summary.textContent = 'Chi tiết Payload';
        details.appendChild(summary);
        const pre = document.createElement('pre');
        pre.className = 'bg-slate-50 p-2 rounded mt-1 overflow-x-auto max-h-40 font-mono border border-slate-100';
        pre.textContent = payloadStr;
        details.appendChild(pre);
        card.appendChild(details);

        // Admin Action Row
        if (currentStatus === 'pending') {
          const row = document.createElement('div');
          row.className = 'mt-3 flex gap-2';

          const btnRetry = document.createElement('button');
          btnRetry.type = 'button';
          btnRetry.className = 'text-xs bg-teal-600 text-white px-3 py-2 rounded-lg font-bold hover:bg-teal-700';
          btnRetry.textContent = 'Phát lại (Retry)';
          btnRetry.addEventListener('click', async () => {
            if (!confirm('Bạn có chắc muốn phát lại thông điệp này?')) return;
            btnRetry.disabled = true;
            btnRetry.textContent = 'Đang gửi...';

            const r = await WorkHubAPI.api(`/api/admin/dlq/${item._id}/retry`, { method: 'POST' });
            const body = await r.json().catch(() => ({}));
            btnRetry.disabled = false;
            btnRetry.textContent = 'Phát lại (Retry)';

            if (!r.ok) {
              alert(body.error || 'Phát lại thất bại');
              return;
            }
            alert('Đã phát lại thông điệp thành công!');
            loadDlq();
          });

          const btnDiscard = document.createElement('button');
          btnDiscard.type = 'button';
          btnDiscard.className = 'text-xs border border-red-300 text-red-700 px-3 py-2 rounded-lg font-bold hover:bg-red-50';
          btnDiscard.textContent = 'Hủy bỏ (Discard)';
          btnDiscard.addEventListener('click', async () => {
            const reason = prompt('Nhập lý do hủy bỏ vĩnh viễn thông điệp này:');
            if (reason === null) return; // cancelled
            if (reason.trim().length === 0) {
              alert('Lý do hủy bỏ là bắt buộc!');
              return;
            }
            btnDiscard.disabled = true;

            const r = await WorkHubAPI.api(`/api/admin/dlq/${item._id}/discard`, {
              method: 'POST',
              body: { reason: reason.trim() }
            });
            const body = await r.json().catch(() => ({}));
            btnDiscard.disabled = false;

            if (!r.ok) {
              alert(body.error || 'Hủy bỏ thất bại');
              return;
            }
            loadDlq();
          });

          row.appendChild(btnRetry);
          row.appendChild(btnDiscard);
          card.appendChild(row);
        }

        list.appendChild(card);
      });
    } catch (err) {
      console.error(err);
      list.appendChild(DomSafe.createTextElement('p', 'text-red-500 text-sm font-bold', 'Lỗi tải danh sách DLQ từ máy chủ.'));
    }
  };

  btnPending.addEventListener('click', () => {
    currentStatus = 'pending';
    loadDlq();
  });

  btnReplayed.addEventListener('click', () => {
    currentStatus = 'replayed';
    loadDlq();
  });

  btnDiscarded.addEventListener('click', () => {
    currentStatus = 'discarded';
    loadDlq();
  });

  // Initial load
  loadDlq();
});
