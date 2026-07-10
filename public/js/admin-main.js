'use strict';

/**
 * Admin UI — cookie auth + DomSafe rendering (no user-data innerHTML).
 */

function adminApi(url, options = {}) {
  return WorkHubAPI.api(url, options);
}

function clearTbody(tbody) {
  DomSafe.clearElement(tbody);
}

function rowMessage(tbody, colspan, text, className) {
  clearTbody(tbody);
  const tr = document.createElement('tr');
  const td = document.createElement('td');
  td.colSpan = colspan;
  td.className = className || 'p-8 text-center text-slate-400';
  td.textContent = text;
  tr.appendChild(td);
  tbody.appendChild(tr);
}

async function loadUsers() {
  const tbody = document.querySelector('#users-table tbody') || document.getElementById('users-tbody');
  if (!tbody) return;
  rowMessage(tbody, 5, 'Đang tải...', 'p-8 text-center text-slate-400 font-medium');
  try {
    const res = await adminApi('/api/admin/users');
    const data = await res.json();
    if (!res.ok) {
      rowMessage(tbody, 5, 'Lỗi tải dữ liệu', 'p-8 text-center text-red-500 font-bold');
      return;
    }
    const users = data.users || [];
    if (!users.length) {
      rowMessage(tbody, 5, 'Chưa có dữ liệu.');
      return;
    }
    clearTbody(tbody);
    users.forEach((user) => {
      const tr = document.createElement('tr');
      tr.className = 'hover:bg-slate-50';
      const cells = [
        user.FullName || '—',
        user.Email || '—',
        user.Role || '—',
        user.Status || '—',
      ];
      cells.forEach((t) => {
        const td = document.createElement('td');
        td.className = 'p-4 text-sm';
        td.textContent = t;
        tr.appendChild(td);
      });
      const actionTd = document.createElement('td');
      actionTd.className = 'p-4 text-right';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'bg-slate-800 text-white text-xs font-bold px-3 py-2 rounded-lg';
      btn.textContent = user.Status === 'banned' ? 'Mở khóa' : 'Khóa';
      btn.addEventListener('click', () => toggleUser(user._id));
      actionTd.appendChild(btn);
      tr.appendChild(actionTd);
      tbody.appendChild(tr);
    });
  } catch {
    rowMessage(tbody, 5, 'Lỗi kết nối máy chủ', 'p-8 text-center text-red-500 font-bold');
  }
}

async function toggleUser(id) {
  if (!id) return;
  const res = await adminApi(`/api/admin/users/${id}/toggle-status`, { method: 'PATCH' });
  const data = await res.json();
  if (!res.ok) {
    alert(data.error || 'Thao tác thất bại');
    return;
  }
  loadUsers();
}

async function loadPendingHosts() {
  const tbody =
    document.querySelector('#pending-hosts-table tbody') ||
    document.getElementById('pending-hosts-tbody');
  if (!tbody) return;
  rowMessage(tbody, 4, 'Đang tải...', 'p-8 text-center text-slate-400');
  try {
    const res = await adminApi('/api/admin/pending-hosts');
    const data = await res.json();
    if (!res.ok) {
      rowMessage(tbody, 4, 'Lỗi tải dữ liệu', 'p-8 text-center text-red-500 font-bold');
      return;
    }
    const hosts = data.hosts || [];
    if (!hosts.length) {
      rowMessage(tbody, 4, 'Không có hồ sơ chờ duyệt.');
      return;
    }
    clearTbody(tbody);
    hosts.forEach((host) => {
      const tr = document.createElement('tr');
      tr.className = 'hover:bg-amber-50';

      const nameTd = document.createElement('td');
      nameTd.className = 'p-4';
      nameTd.appendChild(
        DomSafe.createTextElement('p', 'font-bold', host.UserID?.FullName || 'Không rõ')
      );
      nameTd.appendChild(
        DomSafe.createTextElement('p', 'text-xs text-slate-500', host.UserID?.Email || '')
      );
      tr.appendChild(nameTd);

      const companyTd = document.createElement('td');
      companyTd.className = 'p-4';
      companyTd.appendChild(
        DomSafe.createTextElement('p', 'font-bold text-indigo-700', host.CompanyName || 'Chưa cập nhật')
      );
      companyTd.appendChild(
        DomSafe.createTextElement(
          'p',
          'text-xs',
          `Bank: ${host.BankName || ''} — ****${String(host.BankNumber || '').slice(-4)}`
        )
      );
      tr.appendChild(companyTd);

      const phoneTd = document.createElement('td');
      phoneTd.className = 'p-4';
      phoneTd.textContent = host.Hotline || 'Trống';
      tr.appendChild(phoneTd);

      const actTd = document.createElement('td');
      actTd.className = 'p-4 text-right';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'bg-amber-500 text-white text-sm font-bold px-4 py-2 rounded-lg';
      btn.textContent = 'Phê duyệt';
      btn.addEventListener('click', () => verifyHost(host._id));
      actTd.appendChild(btn);
      tr.appendChild(actTd);

      tbody.appendChild(tr);
    });
  } catch {
    rowMessage(tbody, 4, 'Lỗi kết nối máy chủ', 'p-8 text-center text-red-500 font-bold');
  }
}

async function verifyHost(hostId) {
  if (!hostId) return;
  const res = await adminApi(`/api/admin/hosts/${hostId}/verify`, { method: 'PATCH' });
  const data = await res.json();
  if (!res.ok) {
    alert(data.error || 'Phê duyệt thất bại');
    return;
  }
  alert(data.message || 'Đã phê duyệt');
  loadPendingHosts();
}

async function loadActivityLogs(page = 1) {
  const tbody =
    document.querySelector('#activity-logs-table tbody') ||
    document.getElementById('activity-logs-tbody');
  if (!tbody) return;
  rowMessage(tbody, 4, 'Đang tải dữ liệu...', 'p-8 text-center text-slate-400 font-medium');
  try {
    const res = await adminApi(`/api/admin/activity-logs?page=${page}&limit=20`);
    const data = await res.json();
    if (!res.ok) {
      rowMessage(tbody, 4, 'Lỗi lấy dữ liệu', 'p-8 text-center text-red-500');
      return;
    }
    const logs = data.logs || data.activityLogs || [];
    if (!logs.length) {
      rowMessage(tbody, 4, 'Chưa có dữ liệu.');
      return;
    }
    clearTbody(tbody);
    logs.forEach((log) => {
      const tr = document.createElement('tr');
      [
        log.ActionType || log.action || '—',
        log.Description || log.description || '—',
        log.TargetEntity || '—',
        log.createdAt ? new Date(log.createdAt).toLocaleString('vi-VN') : '—',
      ].forEach((text) => {
        const td = document.createElement('td');
        td.className = 'p-4 text-sm';
        td.textContent = text;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
  } catch {
    rowMessage(tbody, 4, 'Lỗi kết nối', 'p-8 text-center text-red-500');
  }
}

async function loadAdminStats() {
  try {
    const res = await adminApi('/api/admin/stats');
    if (!res.ok) return;
    const data = await res.json();
    // Best-effort map common ids
    if (data.stats) {
      Object.entries(data.stats).forEach(([k, v]) => {
        const el = document.getElementById(`stat-${k}`) || document.querySelector(`[data-stat="${k}"]`);
        if (el) el.textContent = String(v);
      });
    }
  } catch {
    /* ignore */
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const path = window.location.pathname;
  if (path.includes('/admin/users')) loadUsers();
  if (path.includes('/admin/hosts')) loadPendingHosts();
  if (path.includes('/admin/activitylog')) loadActivityLogs(1);
  if (path.includes('/admin/dashboard')) {
    loadAdminStats();
    loadPendingHosts();
    loadActivityLogs(1);
  }
});

window.loadUsers = loadUsers;
window.loadPendingHosts = loadPendingHosts;
window.verifyHost = verifyHost;
window.toggleUser = toggleUser;
window.loadActivityLogs = loadActivityLogs;
