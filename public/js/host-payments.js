'use strict';

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.btn-verify-payment').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      if (!id || !window.WorkHubAPI) return;
      btn.disabled = true;
      try {
        const res = await WorkHubAPI.api(`/api/hosts/payments/${id}/verify`, { method: 'PUT' });
        const data = await res.json();
        if (!res.ok) {
          alert(data.error || 'Xác minh thất bại');
          btn.disabled = false;
          return;
        }
        window.location.reload();
      } catch (e) {
        alert('Lỗi kết nối');
        btn.disabled = false;
      }
    });
  });

  document.querySelectorAll('.btn-reject-payment').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      if (!id || !window.WorkHubAPI) return;
      const reason = window.prompt('Lý do từ chối (tuỳ chọn):') || '';
      btn.disabled = true;
      try {
        const res = await WorkHubAPI.api(`/api/hosts/payments/${id}/reject`, {
          method: 'PUT',
          body: { reason },
        });
        const data = await res.json();
        if (!res.ok) {
          alert(data.error || 'Từ chối thất bại');
          btn.disabled = false;
          return;
        }
        window.location.reload();
      } catch (e) {
        alert('Lỗi kết nối');
        btn.disabled = false;
      }
    });
  });
});
