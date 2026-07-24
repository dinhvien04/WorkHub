'use strict';
document.addEventListener('DOMContentLoaded', async () => {
  const sessionId = document.getElementById('gw-session')?.textContent?.trim();
  const info = document.getElementById('gw-info');
  const msg = document.getElementById('gw-msg');
  if (!sessionId) return;
  try {
    const res = await fetch(`/api/gateway/sessions/${sessionId}`);
    const data = await res.json();
    if (data.session) {
      DomSafe.clearElement(info);
      [
        `Amount: ${Number(data.session.Amount).toLocaleString('vi-VN')}đ`,
        `Status: ${data.session.Status}`,
        `Provider: ${data.session.Provider}`,
      ].forEach((t) => info.appendChild(DomSafe.createTextElement('p', '', t)));
    }
  } catch {
    msg.textContent = 'Không tải được session';
  }
  document.getElementById('gw-pay')?.addEventListener('click', async () => {
    msg.textContent = 'Processing...';
    const res = await WorkHubAPI.api(`/api/gateway/sessions/${sessionId}/mock-complete`, {
      method: 'POST',
    });
    const data = await res.json();
    msg.textContent = res.ok
      ? 'Thanh toán mock thành công. Host sẽ thấy payment successful.'
      : data.error || 'Failed';
    if (res.ok) setTimeout(() => (window.location.href = '/history'), 1200);
  });
});
