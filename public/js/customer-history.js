// ==========================================
// DỮ LIỆU VÀ TRẠNG THÁI (ĐÃ ĐƯỢC ĐỔI TÊN ĐỂ TRÁNH XUNG ĐỘT)
// ==========================================
var historyBookingsCache = [];
var historyFilteredBookings = [];
var historyFilterTimeType = 'all';
var historyTimerInterval = null;

// ==========================================
// 1. GỌI API LẤY LỊCH SỬ ĐẶT CHỖ
// ==========================================
async function fetchCustomerHistory() {
    const userId = localStorage.getItem('userId');
    const token = localStorage.getItem('token');
    
    if (!userId || !token) {
        document.getElementById('history-list').innerHTML = `<div class="text-center py-10 bg-rose-50 rounded-3xl border border-rose-100"><p class="text-rose-600 font-bold text-sm">Vui lòng đăng nhập để xem lịch sử.</p></div>`;
        return;
    }

    try {
        const res = await fetch(`/api/customers/${userId}/bookings`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        
        if (res.ok) {
            historyBookingsCache = data.bookings || [];
            applyCustomerFilters();
        } else {
            // Nâng cấp: Hiển thị lỗi ra màn hình nếu API từ chối
            document.getElementById('history-list').innerHTML = `<div class="text-center py-10 bg-rose-50 rounded-3xl border border-rose-100"><p class="text-rose-600 font-bold text-sm">Lỗi: ${data.error || 'Không thể tải dữ liệu'}</p></div>`;
        }
    } catch (error) {
        console.error("Lỗi lấy dữ liệu:", error);
        document.getElementById('history-list').innerHTML = `<div class="text-center py-10 bg-rose-50 rounded-3xl border border-rose-100"><p class="text-rose-600 font-bold text-sm">Lỗi kết nối máy chủ, vui lòng thử lại sau.</p></div>`;
    }
}

// ==========================================
// 2. LOGIC BỘ LỌC TÌM KIẾM & THỜI GIAN
// ==========================================
function setupFilters() {
    const timeBtn = document.getElementById('custom-time-btn');
    const timeMenu = document.getElementById('custom-time-menu');
    const timeText = document.getElementById('custom-time-text');
    const timeOptions = document.querySelectorAll('.time-option-btn');

    const d1 = document.getElementById('filter-date-1');
    const d2 = document.getElementById('filter-date-2');
    const keywordInput = document.getElementById('filter-keyword');

    const formatDateVN = (dateString) => {
        if (!dateString) return '';
        const [y, m, d] = dateString.split('-');
        return `${d}/${m}/${y}`;
    };

    if (timeBtn && timeMenu) {
        timeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isHidden = timeMenu.classList.contains('hidden');
            if (isHidden) {
                timeMenu.classList.remove('hidden');
                setTimeout(() => { timeMenu.classList.remove('opacity-0', 'scale-95'); }, 10);
            } else {
                timeMenu.classList.add('opacity-0', 'scale-95');
                setTimeout(() => { timeMenu.classList.add('hidden'); }, 200);
            }
        });
    }

    document.addEventListener('click', (e) => {
        if (timeMenu && !timeMenu.classList.contains('hidden') && !timeBtn.contains(e.target) && !timeMenu.contains(e.target)) {
            timeMenu.classList.add('opacity-0', 'scale-95');
            setTimeout(() => { timeMenu.classList.add('hidden'); }, 200);
        }
    });

    timeOptions.forEach(btn => {
        btn.addEventListener('click', () => {
            const type = btn.getAttribute('data-value');
            historyFilterTimeType = type;

            timeOptions.forEach(b => {
                b.classList.remove('text-teal-600');
                b.classList.add('text-slate-700');
            });
            
            timeMenu.classList.add('opacity-0', 'scale-95');
            setTimeout(() => { timeMenu.classList.add('hidden'); }, 200);

            if (type === 'all') {
                timeText.textContent = 'Tất cả thời gian';
                d1.value = ''; d2.value = '';
                applyCustomerFilters();
            } 
            else if (type === 'specific') {
                try { d1.showPicker(); } catch (e) { d1.focus(); }
            } 
            else if (type === 'range') {
                try { d1.showPicker(); } catch (e) { d1.focus(); }
            }
        });
    });

    if (d1) {
        d1.addEventListener('change', () => {
            if (historyFilterTimeType === 'specific') {
                timeText.textContent = `Lọc: ${formatDateVN(d1.value)}`;
                applyCustomerFilters();
            } else if (historyFilterTimeType === 'range') {
                setTimeout(() => {
                    try { d2.showPicker(); } catch (e) { d2.focus(); }
                }, 100);
            }
        });
    }

    if (d2) {
        d2.addEventListener('change', () => {
            if (historyFilterTimeType === 'range') {
                timeText.textContent = `${formatDateVN(d1.value)} - ${formatDateVN(d2.value)}`;
                applyCustomerFilters();
            }
        });
    }

    if (keywordInput) {
        keywordInput.addEventListener('input', applyCustomerFilters);
    }
}

function applyCustomerFilters() {
    const type = historyFilterTimeType; 
    const d1 = document.getElementById('filter-date-1')?.value;
    const d2 = document.getElementById('filter-date-2')?.value;
    const keyword = document.getElementById('filter-keyword')?.value.trim().toLowerCase();

    historyFilteredBookings = historyBookingsCache.filter(b => {
        let matchKw = true;
        if (keyword && keyword !== '') {
            const id = b._id.toLowerCase();
            const spaceName = b.SpaceID?.Name?.toLowerCase() || '';
            const spaceCode = b.SpaceID?.SpaceCode?.toLowerCase() || '';
            matchKw = id.includes(keyword) || spaceName.includes(keyword) || spaceCode.includes(keyword);
        }

        let matchTime = true;
        const bStart = new Date(b.StartTime);
        const bDateStr = `${bStart.getFullYear()}-${String(bStart.getMonth()+1).padStart(2,'0')}-${String(bStart.getDate()).padStart(2,'0')}`;

        if (type === 'specific' && d1) {
            matchTime = (bDateStr === d1);
        } else if (type === 'range' && d1 && d2) {
            matchTime = (bDateStr >= d1 && bDateStr <= d2);
        }

        return matchKw && matchTime;
    });

    renderCustomerBookings(historyFilteredBookings);
}

// ==========================================
// 3. RENDER GIAO DIỆN (UI) THẺ ĐƠN HÀNG
// ==========================================
function renderCustomerBookings(list) {
    const container = document.getElementById('history-list');
    if (!container) return;
    container.innerHTML = '';

    if (list.length === 0) {
        container.innerHTML = `<div class="text-center py-10 bg-slate-50 rounded-3xl border border-slate-100"><p class="text-slate-500 font-bold text-sm">Không tìm thấy đơn đặt chỗ nào phù hợp.</p></div>`;
        return;
    }

    const now = new Date();

    container.innerHTML = list.map(booking => {
        const space = booking.SpaceID || {};
        
        const imgUrl = (space.Images && space.Images.length > 0) ? space.Images[0] : 'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=200';

        const start = new Date(booking.StartTime);
        const end = new Date(booking.EndTime);
        const dateStr = start.toLocaleDateString('vi-VN');
        const timeStr = `${start.getHours()}:${String(start.getMinutes()).padStart(2,'0')} - ${end.getHours()}:${String(end.getMinutes()).padStart(2,'0')}`;

        let displayStatus = booking.Status || booking.status;
        const isExpired = !isNaN(end.getTime()) && (now >= end);
        if (displayStatus === 'in-use' && isExpired) displayStatus = 'completed';

        let timeWarningUI = '';
        if (displayStatus === 'in-use') {
            const timeDiff = end.getTime() - now.getTime();
            const minutesLeft = Math.floor(timeDiff / (1000 * 60));
            const isHidden = minutesLeft > 15 ? 'hidden' : 'flex animate-pulse';
            timeWarningUI = `
                <div class="live-countdown-container mt-2 ${isHidden} items-center gap-1 bg-amber-100 text-amber-600 px-3 py-1 rounded-lg text-[10px] font-black uppercase w-max" data-endtime="${end}">
                    ⏰ <span class="timer-text font-mono">...</span>
                </div>`;
        }

        let stBadge = '', stColor = '';
        let showBadge = true;
        if (displayStatus === 'pending') { stBadge = 'Chờ duyệt'; stColor = 'bg-amber-100 text-amber-700'; }
        else if (displayStatus === 'confirmed') { stBadge = 'Đã được duyệt'; stColor = 'bg-blue-100 text-blue-700'; }
        else if (displayStatus === 'in-use') { stBadge = 'Đang dùng'; stColor = 'bg-purple-100 text-purple-700'; }
        else if (displayStatus === 'completed') { 
            if (!booking.canReview) {
                showBadge = false;
            } else {
                stBadge = 'Hãy đánh giá ngay!'; stColor = 'bg-emerald-100 text-emerald-500';
            }
        }
        else { stBadge = 'Đã hủy'; stColor = 'bg-slate-200 text-slate-600'; }

        // --- 🛠️ LOGIC TÍNH % THANH TOÁN (GỌN NHẸ THEO PAYMENT_TYPE TỪ BACKEND) ---
        const total = booking.TotalAmount || 0;
        const percent = booking.percentPaid || 0; // Lấy trực tiếp % từ Backend truyền sang
        
        // Xác định màu sắc hiển thị dựa trên tỷ lệ % cố định (0, 30, hoặc 100)
        let percentColor = 'text-slate-400'; // Mặc định xám (0%)
        if (percent === 30) percentColor = 'text-amber-600'; // Cam (đã cọc)
        if (percent === 100) percentColor = 'text-emerald-600'; // Xanh ngọc (đã full)
        // --------------------------------------------------------------------------

        let actionUI = `<button onclick="openDetailModal('${booking._id}')" class="w-full py-1 rounded-xl border-2 border-slate-200 text-slate-500 font-black text-[10px] uppercase hover:border-slate-400 transition whitespace-nowrap">Xem chi tiết</button>`;
        
        if (displayStatus === 'completed') {
            if (booking.canReview) {
                actionUI += `<button onclick="openReviewModal('${booking._id}', 5, '')" class="w-full mt-1 py-1 rounded-xl bg-teal-500 text-white font-black text-[10px] uppercase shadow-md hover:bg-teal-500 transition whitespace-nowrap">Đánh giá</button>`;
            } else if (booking.canEditReview) {
                const rv = booking.ReviewData;
                actionUI += `<button onclick="openReviewModal('${booking._id}', ${rv.Rating}, '${escapeHtml(rv.Comment)}')" class="w-full mt-1 py-1 rounded-xl border-2 border-slate-200 text-slate-500 font-black text-[10px] uppercase hover:bg-teal-50 transition whitespace-nowrap">Sửa đánh giá</button>`;
            }
        }

        const displayName = space.Name || 'Không có thông tin phòng';
        
        // --- XỬ LÝ AN TOÀN BRANCH ID (CHỐNG LỖI ORPHAN DATA) ---
        const branch = space.BranchID || null;
        const actualBranchId = branch ? (branch._id || branch) : null;
        
        let titleHTML = '';
        if (actualBranchId) {
            titleHTML = `<a href="/detail?branchId=${actualBranchId}" class="text-lg font-black text-slate-800 hover:text-teal-600 transition tracking-tight">${displayName}</a>`;
        } else {
            titleHTML = `<a href="#" onclick="alert('Cơ sở này đã ngừng hoạt động hoặc bị xóa khỏi hệ thống.'); return false;" class="text-lg font-black text-slate-400 cursor-not-allowed tracking-tight" title="Cơ sở không khả dụng">${displayName}</a>`;
        }

        return `
            <div class="bg-white rounded-3xl p-4 md:p-5 shadow-sm border border-slate-100 hover:shadow-lg transition flex flex-col md:flex-row gap-5 items-center">
                <div class="w-full md:w-32 h-32 shrink-0 relative">
                    <img src="${imgUrl}" class="w-full h-full object-cover rounded-2xl shadow-inner" alt="${displayName}">
                </div>
                
                <div class="flex-1 w-full">
                    <div class="flex justify-between items-start mb-1">
                        ${titleHTML}
                        <span class="${stColor} px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest whitespace-nowrap ml-2">${showBadge ? stBadge : ''}</span>
                    </div>
                    <div class="text-xs font-bold text-slate-500 mb-3">Mã phòng: ${space.SpaceCode || 'Không có thông tin'}</div>
                    
                    <div class="flex flex-wrap gap-2 md:gap-4 text-xs font-medium text-slate-600">
                        <div class="bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-100">📅 ${dateStr}</div>
                        <div class="bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-100">🕒 ${timeStr}</div>
                        <div class="bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-100">🔖 #${booking._id.substring(booking._id.length - 6).toUpperCase()}</div>
                    </div>
                    ${timeWarningUI}
                </div>

                <div class="w-full md:w-48 text-right flex flex-col justify-between h-full border-t md:border-t-0 md:border-l border-dashed border-slate-200 pt-4 md:pt-0 md:pl-5">
                    <div class="mb-4 md:mb-0">
                        <div class="text-[10px] font-black text-slate-400 uppercase mb-1">Tổng chi phí</div>
                        <div class="text-xl font-black text-slate-800">${total.toLocaleString('vi-VN')}đ</div>
                        <div class="text-[10px] font-bold ${percentColor} mt-1">Đã thanh toán: ${percent}%</div>
                    </div>
                    <div class="flex flex-col mt-auto w-full pt-1">
                        ${actionUI}
                    </div>
                </div>
            </div>`;
    }).join('');

    startLiveTimers(); 
}
// ==========================================
// 4. XỬ LÝ MODAL (POPUP) CHI TIẾT & ĐÁNH GIÁ
// ==========================================
function openDetailModal(id) {
    const booking = historyBookingsCache.find(b => b._id === id);
    if (!booking) return;

    const space = booking.SpaceID || {};
    const branch = space.BranchID || {}; 
    
    const getVal = (val) => (val && val.trim() !== '') ? val : 'Không có thông tin';

    document.getElementById('md-img').src = (space.Images && space.Images.length > 0) ? space.Images[0] : 'https://images.unsplash.com/photo-1497366216548-37526070297c';
    document.getElementById('md-space-name').textContent = getVal(space.Name);
    document.getElementById('md-space-code').textContent = 'Mã phòng: ' + getVal(space.SpaceCode);
    
    document.getElementById('md-branch-address').textContent = getVal(branch.Address);
    document.getElementById('md-branch-hotline').textContent = getVal(branch.Hotline);
    
    document.getElementById('md-booking-id').textContent = '#' + booking._id.substring(booking._id.length - 6).toUpperCase();
    
    document.getElementById('md-time-created').textContent = new Date(booking.createdAt).toLocaleString('vi-VN');

    const start = new Date(booking.StartTime);
    const end = new Date(booking.EndTime);
    document.getElementById('md-time').textContent = `${start.toLocaleDateString('vi-VN')} | ${start.getHours()}:${String(start.getMinutes()).padStart(2,'0')} - ${end.getHours()}:${String(end.getMinutes()).padStart(2,'0')}`;
    
    const total = booking.TotalAmount || 0;

    let displayStatus = booking.Status || booking.status;
    const now = new Date();
    const isExpired = !isNaN(new Date(booking.EndTime).getTime()) && (now >= new Date(booking.EndTime));
    if (displayStatus === 'in-use' && isExpired) displayStatus = 'completed';

    if (displayStatus === 'in-use' || displayStatus === 'completed') {
        deposit = total;
    }

    const remaining = total - deposit;
    
    document.getElementById('md-total').textContent = total.toLocaleString('vi-VN') + 'đ';
    document.getElementById('md-deposit').textContent = deposit.toLocaleString('vi-VN') + 'đ';
    document.getElementById('md-remaining').textContent = (remaining > 0 ? remaining : 0).toLocaleString('vi-VN') + 'đ';

    // --- XỬ LÝ AN TOÀN LINK CHI TIẾT TRONG MODAL ---
    const actualBranchIdModal = branch ? (branch._id || branch) : null;
    const linkDetailBtn = document.getElementById('md-link-detail');
    
    if (actualBranchIdModal && actualBranchIdModal !== '[object Object]') {
        linkDetailBtn.href = `/detail?branchId=${actualBranchIdModal}`;
        linkDetailBtn.onclick = null; // Xóa sự kiện chặn nếu có
    } else {
        linkDetailBtn.href = '#';
        linkDetailBtn.onclick = function(e) {
            e.preventDefault();
            alert('Cơ sở này đã ngừng hoạt động hoặc bị xóa khỏi hệ thống.');
        };
    }

    const remainingBox = document.getElementById('md-remaining').parentElement;
    if (remaining > 0 && displayStatus !== 'cancelled') {
        remainingBox.classList.remove('hidden');
        remainingBox.classList.add('flex');
        document.getElementById('md-remaining').textContent = remaining.toLocaleString('vi-VN') + 'đ';
    } else {
        remainingBox.classList.remove('flex');
        remainingBox.classList.add('hidden');
    }

    const modal = document.getElementById('modal-booking-detail');
    modal.classList.remove('hidden');
    modal.classList.add('flex'); 
}

function startLiveTimers() {
    if (historyTimerInterval) clearInterval(historyTimerInterval);
    historyTimerInterval = setInterval(() => {
        const containers = document.querySelectorAll('.live-countdown-container');
        let needToRefreshTable = false; 

        containers.forEach(container => {
            const endStr = container.getAttribute('data-endtime');
            const endTime = new Date(endStr).getTime();
            const now = new Date().getTime();
            const diff = endTime - now;

            if (diff <= 0) {
                needToRefreshTable = true;
            } else {
                const totalSeconds = Math.floor(diff / 1000);
                const mins = Math.floor(totalSeconds / 60);
                const secs = totalSeconds % 60;
                const secsFormatted = secs < 10 ? '0' + secs : secs;
                
                container.querySelector('.timer-text').textContent = `Còn ${mins}p ${secsFormatted}s`;

                if (mins <= 15) {
                    container.classList.remove('hidden');
                    container.classList.add('flex', 'animate-pulse');
                }
            }
        });

        if (needToRefreshTable) {
            applyCustomerFilters(); 
        }
    }, 1000); 
}

function openReviewModal(bookingId, currentRating, currentComment) {
    document.getElementById('rv-booking-id').value = bookingId;
    document.getElementById('rv-comment').value = currentComment || '';
    
    const starLabels = document.querySelectorAll('#star-container label');
    starLabels.forEach((l, i) => {
        if (i < currentRating) l.className = "cursor-pointer text-4xl text-amber-400 transition";
        else l.className = "cursor-pointer text-4xl text-slate-200 hover:text-amber-400 transition";
    });
    starLabels[currentRating - 1].querySelector('input').checked = true;

    document.getElementById('modal-review').classList.remove('hidden');
}

function closeModal(id) {
    const modal = document.getElementById(id);
    if (id === 'modal-booking-detail') {
        const content = document.getElementById('modal-detail-content');
        content.classList.add('scale-95', 'opacity-0');
        setTimeout(() => { modal.classList.add('hidden'); }, 200);
    } else {
        modal.classList.add('hidden');
    }
}

function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ==========================================
// KÍCH HOẠT KHI TẢI TRANG
// ==========================================
window.addEventListener('DOMContentLoaded', () => {
    const historyListContainer = document.getElementById('history-list');
    if (historyListContainer) {
        setupFilters();
        fetchCustomerHistory(); 

        const reviewForm = document.getElementById('review-form');
        if (reviewForm) {
            reviewForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                
                // --- BỔ SUNG: Vô hiệu hóa nút gửi để chống click đúp ---
                const submitBtn = reviewForm.querySelector('button[type="submit"]');
                if (submitBtn) {
                    submitBtn.disabled = true;
                    submitBtn.innerHTML = 'Đang xử lý...';
                    submitBtn.classList.add('opacity-50', 'cursor-not-allowed');
                }
                // --------------------------------------------------------

                const userId = localStorage.getItem('userId');
                const token = localStorage.getItem('token');
                const bookingId = document.getElementById('rv-booking-id').value;
                const rating = document.querySelector('input[name="rating"]:checked').value;
                const comment = document.getElementById('rv-comment').value.trim();

                try {
                    const res = await fetch(`/api/customers/${userId}/bookings/${bookingId}/review`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                        body: JSON.stringify({ rating, comment })
                    });
                    const data = await res.json();
                    
                    if (res.ok) {
                        alert(data.message);
                        closeModal('modal-review');
                        fetchCustomerHistory(); 
                    } else {
                        alert(data.error);
                    }
                } catch (error) {
                    alert('Có lỗi xảy ra, vui lòng thử lại.');
                } finally {
                    // --- BỔ SUNG: Mở khóa nút bấm trở lại khi API chạy xong dù lỗi hay thành công ---
                    if (submitBtn) {
                        submitBtn.disabled = false;
                        submitBtn.innerHTML = 'Gửi đánh giá';
                        submitBtn.classList.remove('opacity-50', 'cursor-not-allowed');
                    }
                    // -------------------------------------------------------------------------------
                }
            });
        }
        const starLabels = document.querySelectorAll('#star-container label');
        starLabels.forEach((label, idx) => {
            label.addEventListener('click', () => {
                starLabels.forEach((l, i) => {
                    if (i <= idx) l.className = "cursor-pointer text-4xl text-amber-400 transition";
                    else l.className = "cursor-pointer text-4xl text-slate-200 hover:text-amber-400 transition";
                });
                label.querySelector('input').checked = true;
            });
        });
    }
});

// ==========================================
// ĐỒNG BỘ THỜI GIAN THỰC (SOCKET.IO)
// ==========================================
if (typeof io !== 'undefined') {
    const socket = io();
    socket.on('booking_status_updated', (data) => {
        if (typeof fetchCustomerHistory === 'function') {
            fetchCustomerHistory();
        }
    });
}