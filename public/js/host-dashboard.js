'use strict';

/**
 * Host dashboard — safe DOM rendering (no user data via innerHTML).
 */
let currentSelectedBranch = 'all';

async function loadHostDashboard() {
  if (!window.WorkHubAPI || !window.DomSafe) return;

  const url =
    currentSelectedBranch && currentSelectedBranch !== 'all'
      ? `/api/hosts/dashboard-stats?branchId=${encodeURIComponent(currentSelectedBranch)}`
      : '/api/hosts/dashboard-stats?branchId=all';

  try {
    const res = await WorkHubAPI.api(url, { redirectOn401: true });
    const data = await res.json();
    if (!res.ok) {
      console.error(data.error || 'Dashboard error');
      return;
    }
    renderBranchTabs(data.branches || []);
    renderStats(data.stats || {});
    renderFloorPlan(data.liveFloorPlan || []);
    renderRecentBookings(data.recentBookings || []);
    renderChart(data.chartData || { labels: [], bookings: [], revenue: [] });
  } catch (e) {
    console.error(e);
  }
}

function renderBranchTabs(branches) {
  const tabContainer = document.getElementById('branch-tabs') || document.querySelector('.branch-tabs');
  if (!tabContainer) return;
  DomSafe.clearElement(tabContainer);

  const allBtn = document.createElement('button');
  allBtn.type = 'button';
  allBtn.className = `branch-tab px-5 py-2.5 rounded-xl text-sm font-bold transition ${
    currentSelectedBranch === 'all' ? 'bg-indigo-600 text-white' : 'text-slate-600'
  }`;
  allBtn.textContent = 'Tất cả';
  allBtn.addEventListener('click', () => switchBranch('all'));
  tabContainer.appendChild(allBtn);

  branches.forEach((b) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `branch-tab px-5 py-2.5 rounded-xl text-sm font-bold transition ${
      currentSelectedBranch === String(b._id) ? 'bg-indigo-600 text-white' : 'text-slate-600'
    }`;
    btn.textContent = b.Name || 'Chi nhánh';
    btn.addEventListener('click', () => switchBranch(String(b._id)));
    tabContainer.appendChild(btn);
  });
}

function switchBranch(id) {
  currentSelectedBranch = id;
  loadHostDashboard();
}

function setTextById(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text == null ? '' : String(text);
}

function renderStats(stats) {
  setTextById('stat-revenue', Number(stats.revenue || 0).toLocaleString('vi-VN') + 'đ');
  setTextById('stat-paid', Number(stats.paidAmount || 0).toLocaleString('vi-VN') + 'đ');
  setTextById('stat-pending', Number(stats.pendingAmount || 0).toLocaleString('vi-VN') + 'đ');
  setTextById('stat-refunded', Number(stats.refundedAmount || 0).toLocaleString('vi-VN') + 'đ');
  setTextById('stat-bookings', String(stats.totalBookings || 0));
  setTextById('stat-occupied', String(stats.totalOccupiedGuests || 0));
  setTextById('stat-rooms', String(stats.activeRoomsCount || 0));
}

function renderFloorPlan(items) {
  const floorPlanContainer =
    document.getElementById('floor-plan') || document.getElementById('live-floor-plan');
  if (!floorPlanContainer) return;
  DomSafe.clearElement(floorPlanContainer);
  items.forEach((item) => {
    const d = document.createElement('div');
    const status = item.LiveStatus || 'available';
    d.className = `floor-plan-item status-${status === 'occupied' ? 'occupied' : status === 'upcoming' ? 'booked' : status === 'maintenance' ? 'maintenance' : 'available'}`;
    d.title = `${item.SpaceCode || ''} — ${status}`;
    d.textContent = item.SpaceCode || '?';
    floorPlanContainer.appendChild(d);
  });
}

function renderRecentBookings(bookings) {
  const tableBody =
    document.querySelector('#recent-bookings-body') ||
    document.querySelector('#recent-bookings tbody');
  if (!tableBody) return;
  DomSafe.clearElement(tableBody);
  if (!bookings.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 4;
    td.className = 'p-4 text-center text-slate-400';
    td.textContent = 'Chưa có đơn đặt chỗ nào.';
    tr.appendChild(td);
    tableBody.appendChild(tr);
    return;
  }
  bookings.forEach((b) => {
    const tr = document.createElement('tr');
    const cells = [
      b.CustomerID?.FullName || b.CustomerID?.Email || 'Khách',
      b.SpaceID?.SpaceCode || b.SpaceID?.Name || '—',
      b.Status || '—',
      b.StartTime ? new Date(b.StartTime).toLocaleString('vi-VN') : '—',
    ];
    cells.forEach((text) => {
      const td = document.createElement('td');
      td.className = 'p-3 text-sm';
      td.textContent = text;
      tr.appendChild(td);
    });
    tableBody.appendChild(tr);
  });
}

let chartInstance = null;
function renderChart(chartData) {
  const canvas = document.getElementById('host-revenue-chart') || document.getElementById('revenueChart');
  if (!canvas || typeof Chart === 'undefined') return;
  if (chartInstance) chartInstance.destroy();
  chartInstance = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: chartData.labels || [],
      datasets: [
        {
          label: 'Doanh thu đã xác minh (đ)',
          data: chartData.revenue || [],
          borderColor: '#0d9488',
          tension: 0.3,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: true } },
    },
  });
}

document.addEventListener('DOMContentLoaded', () => {
  loadHostDashboard();
});

// expose for any legacy buttons
window.switchBranch = switchBranch;
window.loadHostDashboard = loadHostDashboard;
