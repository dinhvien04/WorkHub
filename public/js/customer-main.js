// ==========================================
// LOGIC LUỒNG KHÁCH HÀNG (CUSTOMER)
// ==========================================

let selectedSeat = null;
let currentPrices = { total: 0, deposit: 0 };
let currentRoomType = 'meeting';
let roomImages = [];
let currentImageIndex = 0;
let selectedTimeSlot = null;
let selectedPaymentType = 'deposit';

// Kiểm tra xem đang ở trang nào
const isDetailPage = (() => {
    const p = window.location.pathname || '';
    const s = window.location.search || '';
    return p.includes('/detail') || s.includes('detail');
})();

const isPaymentPage = window.location.pathname === '/payment';
const isProfilePage = window.location.pathname.includes('/profile');

// ==========================================
// HÀM CHUYỂN ĐỔI LOẠI PHÒNG
// ==========================================
function switchRoomType(type) {
    if (!isDetailPage) return; 
    
    currentRoomType = type; // 'meeting' hoặc 'desk'
    selectedTimeSlot = null; 
    selectedSeat = null; 

    ['available-slots-container', 'booking-summary'].forEach(id => document.getElementById(id)?.classList.add('hidden'));

    document.querySelectorAll('.timeslot-btn').forEach(btn => {
        btn.classList.remove('border-teal-600', 'bg-teal-600', 'text-white');
        btn.removeAttribute('data-selected');
    });

    document.querySelectorAll('.room-card').forEach(card => {
        card.classList.remove('border-teal-500', 'bg-teal-50/30');
    });

    const btnMeeting = document.getElementById('btn-type-meeting');
    const btnStudy = document.getElementById('btn-type-study');

    if (btnMeeting) {
        btnMeeting.className = (type === 'meeting') 
            ? "py-2 text-xs font-bold rounded-lg transition bg-white text-teal-700 shadow-sm" 
            : "py-2 text-xs font-bold rounded-lg transition text-slate-500 hover:text-slate-800";
    }

    if (btnStudy) {
        btnStudy.className = (type === 'desk') 
            ? "py-2 text-xs font-bold rounded-lg transition bg-white text-teal-700 shadow-sm" 
            : "py-2 text-xs font-bold rounded-lg transition text-slate-500 hover:text-slate-800";
    }

    const meetingButtons = document.querySelectorAll('.meeting-slot');
    const studyButtons = document.querySelectorAll('.study-slot');

    if (type === 'meeting') {
        meetingButtons.forEach(b => b.classList.remove('hidden'));
        studyButtons.forEach(b => b.classList.add('hidden'));
    } else {
        studyButtons.forEach(b => b.classList.remove('hidden'));
        meetingButtons.forEach(b => b.classList.add('hidden'));
    }
}

// ==========================================
// EVENT LISTENER CHO KHUNG GIỜ
// ==========================================
function initTimeSlotListener() {
    if (!isDetailPage) return; 
    
    const grid = document.getElementById('timeslot-grid');
    if (!grid) return;

    grid.addEventListener('click', function (e) {
        if (e.target.classList.contains('timeslot-btn')) {
            document.querySelectorAll('.timeslot-btn').forEach(btn => {
                btn.classList.remove('border-teal-600', 'bg-teal-600', 'text-white');
                btn.removeAttribute('data-selected');
            });

            e.target.classList.add('border-teal-600', 'bg-teal-600', 'text-white');
            e.target.setAttribute('data-selected', 'true');
            selectedTimeSlot = e.target.getAttribute('data-slot');

            selectedSeat = null;
            document.querySelectorAll('.room-card').forEach(card => {
                card.classList.remove('border-teal-500', 'bg-teal-50/30');
            });
            document.getElementById('available-slots-container')?.classList.add('hidden');
            document.getElementById('booking-summary')?.classList.add('hidden');
        }
    });
}

// ==========================================
// KIỂM TRA PHÒNG CÓ SẴN
// ==========================================
// ==========================================
// KIỂM TRA PHÒNG CÓ SẴN (ĐÃ FIX LỖI THỜI GIAN QUÁ KHỨ)
// ==========================================
async function checkAvailableSlots() {
    if (!isDetailPage) return; 
    
    const container = document.getElementById('available-slots-container');
    const listGrid = document.getElementById('available-slots-list');

    if (!container || !listGrid) return;

    const branchId = document.querySelector('[data-branch-id]')?.getAttribute('data-branch-id');
    const date = document.getElementById('booking-date')?.value;

    if (!selectedTimeSlot) {
        alert("Vui lòng chọn khung giờ trước khi xem!");
        return;
    }

    if (!branchId || !date) {
        alert("Thiếu dữ liệu chi nhánh hoặc ngày!");
        return;
    }

    // [BẢO MẬT]: Chặn tra cứu thời gian trong quá khứ
    const [startStr] = selectedTimeSlot.split(' - ');
    const startTimeObj = new Date(`${date}T${startStr}:00`);
    if (startTimeObj < new Date()) {
        alert("Khung giờ này đã qua. Vui lòng chọn thời gian khác trong tương lai!");
        return;
    }

    DomSafe.clearElement(listGrid);
    listGrid.appendChild(DomSafe.createTextElement('p', 'text-slate-500 text-sm', 'Đang tải...'));

    try {
        const params = new URLSearchParams({
            branchId,
            date,
            timeSlot: selectedTimeSlot,
            roomType: currentRoomType,
        });
        const res = await WorkHubAPI.api(
            `/api/customers/bookings/availability?${params.toString()}`,
            { redirectOn401: false }
        );
        const data = await res.json();

        if (!res.ok) {
            DomSafe.clearElement(listGrid);
            listGrid.appendChild(
                DomSafe.createTextElement(
                    'p',
                    'text-red-500 text-sm',
                    data.error || data.message || 'Lỗi hệ thống'
                )
            );
            return;
        }

        DomSafe.clearElement(listGrid);
        if (!data.spaces || data.spaces.length === 0) {
            listGrid.appendChild(
                DomSafe.createTextElement(
                    'p',
                    'text-slate-400 text-xs italic',
                    'Không còn phòng trống trong khung giờ này.'
                )
            );
        } else {
            data.spaces.forEach((space) => {
                const card = document.createElement('div');
                card.className =
                    'room-card bg-white border border-slate-200 rounded-[1rem] p-4 flex justify-between items-center gap-3 cursor-pointer transition hover:border-teal-300';
                card.dataset.roomId = String(space._id);
                card.dataset.roomPrice = String(space.PricePerHour || 0);
                card.addEventListener('click', () => selectRoomCardDetail(card));

                const left = document.createElement('div');
                left.className = 'flex-1 min-w-0';
                left.appendChild(
                    DomSafe.createTextElement('div', 'font-bold text-sm text-slate-800', space.Name || '')
                );
                left.appendChild(
                    DomSafe.createTextElement(
                        'div',
                        'text-xs font-black text-teal-700 mt-0.5',
                        `${Number(space.PricePerHour || 0).toLocaleString('vi-VN')}đ/giờ`
                    )
                );
                left.appendChild(
                    DomSafe.createTextElement(
                        'div',
                        'text-[10px] text-emerald-600 font-black uppercase mt-1.5',
                        'Sẵn sàng'
                    )
                );

                const detailBtn = document.createElement('button');
                detailBtn.type = 'button';
                detailBtn.className =
                    'text-[10px] px-3 py-1.5 rounded-lg bg-teal-50 text-teal-700 font-bold shrink-0 hover:bg-teal-100 transition';
                detailBtn.textContent = 'Chi tiết';
                detailBtn.addEventListener('click', (event) => {
                    event.stopPropagation();
                    openModalSafeFromSpace(space);
                });

                card.appendChild(left);
                card.appendChild(detailBtn);
                listGrid.appendChild(card);
            });
        }

        container.classList.remove('hidden');
    } catch (err) {
        console.error('Lỗi:', err);
        DomSafe.clearElement(listGrid);
        listGrid.appendChild(
            DomSafe.createTextElement('p', 'text-red-500 text-sm', 'Lỗi kết nối server')
        );
    }
}

function openModalSafeFromSpace(space) {
    openModalSafe(
        space.Name || '',
        space.PricePerHour || 0,
        (space.Images || []).join(','),
        space.Description || '',
        space.Capacity || 0,
        (space.Amenities || []).join(',')
    );
}

// ==========================================
// CHỌN PHÒNG
// ==========================================
function selectRoomCardDetail(element) {
    if (!isDetailPage) return; 
    
    document.querySelectorAll('.room-card').forEach(card => {
        card.classList.remove('border-teal-500', 'bg-teal-50/30');
    });
    
    element.classList.add('border-teal-500', 'bg-teal-50/30');

    selectedSeat = element.dataset.roomId || element.getAttribute('data-room-id');
    const pricePerHour = parseInt(element.dataset.roomPrice || element.getAttribute('data-room-price'), 10) || 0;
    
    if (selectedTimeSlot) {
        const [startStr, endStr] = selectedTimeSlot.split(' - ');
        const start = new Date(`2000-01-01T${startStr}:00`);
        const end = new Date(`2000-01-01T${endStr}:00`);
        const hours = (end - start) / (1000 * 60 * 60);
        
        currentPrices.total = Math.round(pricePerHour * hours);
        currentPrices.deposit = Math.round(currentPrices.total * 0.3);
    }

    const summary = document.getElementById('booking-summary');
    if (summary) {
        summary.classList.remove('hidden');
        document.getElementById('val-deposit').innerText = `Cọc: ${currentPrices.deposit.toLocaleString('vi-VN')}đ`;
    }
}

// ==========================================
// XỬ LÝ ĐẶT CHỖ (KẾT HỢP HEAD & NA)
// ==========================================
// ==========================================
// XỬ LÝ ĐẶT CHỖ (ĐÃ FIX LỖI THỜI GIAN VÀ THANH TOÁN MẶC ĐỊNH)
// ==========================================
async function checkAuthAndGoToPayment() {
    if (!selectedSeat) { alert("Vui lòng chọn phòng!"); return; }
    if (!selectedTimeSlot) { alert("Vui lòng chọn khung giờ!"); return; }

    const branchId = document.querySelector('[data-branch-id]')?.getAttribute('data-branch-id');
    
    try {
        // Verify session from server (cookie HttpOnly)
        const meRes = await WorkHubAPI.api('/api/auth/me');
        if (!meRes.ok) {
            alert("Vui lòng đăng nhập để tiến hành đặt chỗ.");
            window.location.href = '/login';
            return;
        }

        const [startStr, endStr] = selectedTimeSlot.split(' - ');
        const date = document.getElementById('booking-date').value;
        const startTimeObj = new Date(`${date}T${startStr}:00`);
        const endTimeObj = new Date(`${date}T${endStr}:00`);

        if (startTimeObj < new Date()) {
            alert("Khung giờ này đã qua. Vui lòng chọn thời gian khác trong tương lai!");
            return;
        }

        const createRes = await WorkHubAPI.api('/api/customers/me/bookings', {
            method: 'POST',
            body: {
                spaceId: selectedSeat,
                startTime: startTimeObj.toISOString(),
                endTime: endTimeObj.toISOString(),
            }
        });

        const data = await createRes.json();

        if (!createRes.ok) {
            alert(data.error || 'Lỗi hệ thống khi đặt chỗ.');
            return;
        }

        const bookingId = data?.booking?._id || data?.bookingId || null;

        sessionStorage.setItem('pendingBooking', JSON.stringify({
            deposit: currentPrices.deposit,
            total: currentPrices.total,
            branchId: branchId
        }));

        alert("Tạo đơn thành công! Chuyển hướng đến trang thanh toán...");
        
        if (bookingId) {
            window.location.href = `/payment?bookingId=${bookingId}&branchId=${branchId}`;
        } else {
            window.location.href = '/payment';
        }

    } catch (err) {
        console.error('Lỗi:', err);
        alert("Lỗi kết nối server");
    }
}
// ==========================================
// TRANG PAYMENT (NA)
// ==========================================
function goBackToDetail() {
    const pending = JSON.parse(sessionStorage.getItem('pendingBooking') || '{}');
    const branchId = pending.branchId || new URLSearchParams(window.location.search).get('branchId');
    window.location.href = branchId ? `/detail?branchId=${branchId}` : '/';
}

function setPaymentType(type) {
    const area = document.getElementById('qr-area');
    if (!area) return;

    selectedPaymentType = type;

    const pending = JSON.parse(sessionStorage.getItem('pendingBooking') || '{}');
    currentPrices.deposit = pending.deposit || 0;
    currentPrices.total = pending.total || 0;

    area.classList.remove('hidden');
    document.getElementById('qr-placeholder')?.classList.add('hidden');
    document.getElementById('pay-30')?.classList.toggle('active', type === 'deposit');
    document.getElementById('pay-100')?.classList.toggle('active', type === 'full');

    const amount = type === 'deposit' ? currentPrices.deposit : currentPrices.total;
    const priceEl = document.getElementById('qr-price-val');
    if (priceEl) priceEl.innerText = amount.toLocaleString('vi-VN') + 'đ';

    const qrImg = document.getElementById('qr-img');
    if (qrImg) qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=PAY_${amount}`;
}

async function handleFinalSuccess() {
    const bookingId = new URLSearchParams(window.location.search).get('bookingId');
    if (!bookingId) {
        alert('Thiếu thông mã đặt chỗ, không thể xác nhận thanh toán!');
        return;
    }

    try {
        const idemKey =
            (typeof crypto !== 'undefined' && crypto.randomUUID && crypto.randomUUID()) ||
            `pay-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const confirmRes = await WorkHubAPI.api('/api/customers/me/booking/confirm', {
            method: 'POST',
            headers: { 'Idempotency-Key': idemKey },
            body: { bookingId: bookingId, paymentType: selectedPaymentType },
        });

        const confirmData = await confirmRes.json();
        if (!confirmRes.ok) {
            alert(confirmData.error || 'Xác nhận thanh toán thất bại');
            return;
        }

        sessionStorage.removeItem('pendingBooking');
        alert('Thanh toán thành công! Chuyển về trang lịch sử...');
        setTimeout(() => window.location.href = '/history', 1000);

    } catch (err) {
        console.error('Lỗi:', err);
        alert('Lỗi kết nối server: ' + err.message);
    }
}

// ==========================================
// QUẢN LÝ MODAL PHÒNG
// ==========================================
function openModalSafe(name, price, encodedUrls, description, capacity, encodedAmenities) {
    if (!isDetailPage) return;
    
    const urls = decodeURIComponent(encodedUrls);
    const desc = decodeURIComponent(description || "");
    const cap = capacity || 0;
    const amenities = decodeURIComponent(encodedAmenities || "");
    
    openRoomModal(name, price, urls, desc, cap, amenities);
}

function openRoomModal(name, price, imageUrlsString, description, capacity, amenities) {
    if (!isDetailPage) return;
    
    const modal = document.getElementById('modal-room-detail');
    const nameEl = document.getElementById('modal-room-name');
    const priceEl = document.getElementById('modal-room-price');
    const imgEl = document.getElementById('modal-room-img');
    const descEl = document.getElementById('modal-room-desc');
    const capacityEl = document.getElementById('modal-room-capacity');
    const amenitiesEl = document.getElementById('modal-room-amenities');

    roomImages = (imageUrlsString || '')
        .split(',')
        .map(url => url.trim())
        .filter(url => url.length > 0);
    currentImageIndex = 0;

    if (nameEl) nameEl.textContent = name;
    if (priceEl) priceEl.textContent = Number(price).toLocaleString('vi-VN') + 'đ/giờ';
    if (imgEl) imgEl.alt = name;
    
    if (descEl) descEl.textContent = description || "Không có mô tả chi tiết.";
    if (capacityEl) capacityEl.textContent = `Sức chứa: ${capacity || 0} người`;
    
    if (amenitiesEl) {
        DomSafe.clearElement(amenitiesEl);
        const amenitiesArray = amenities ? amenities.split(',').map((item) => item.trim()) : [];
        amenitiesArray.forEach((item) => {
            amenitiesEl.appendChild(
                DomSafe.createTextElement(
                    'span',
                    'bg-teal-100 text-teal-800 text-xs px-2 py-1 rounded-full mr-1',
                    item
                )
            );
        });
    }

    updateModalImageUI();

    if (modal) modal.classList.remove('hidden');
    document.body.classList.add('modal-active');
}

function closeRoomModal() {
    if (!isDetailPage) return; 
    
    const modal = document.getElementById('modal-room-detail');
    if (modal) modal.classList.add('hidden');
    document.body.classList.remove('modal-active');
    roomImages = [];
    currentImageIndex = 0;
}

function updateModalImageUI() {
    const imgEl = document.getElementById('modal-room-img');
    const counterEl = document.getElementById('modal-img-counter');
    const prevBtn = document.getElementById('modal-btn-prev');
    const nextBtn = document.getElementById('modal-btn-next');
    const total = roomImages.length;

    if (!imgEl || total === 0) return;

    imgEl.src = roomImages[currentImageIndex];
    if (counterEl) {
        counterEl.textContent = (currentImageIndex + 1) + ' / ' + total;
        counterEl.classList.toggle('hidden', total <= 1);
    }

    if (prevBtn) prevBtn.classList.toggle('hidden', currentImageIndex === 0 || total <= 1);
    if (nextBtn) nextBtn.classList.toggle('hidden', currentImageIndex === total - 1 || total <= 1);
}

function changeRoomImage(step) {
    if (!isDetailPage) return; 
    
    const newIndex = currentImageIndex + step;
    if (newIndex < 0 || newIndex >= roomImages.length) return;
    currentImageIndex = newIndex;
    updateModalImageUI();
}

// ==========================================
// KHỞI TẠO KHI TẢI TRANG
// ==========================================
document.addEventListener('DOMContentLoaded', function () {
    if (isDetailPage) {
        loadBranchReviews();
        initTimeSlotListener();
    }

    if (isPaymentPage) {
        const pending = JSON.parse(sessionStorage.getItem('pendingBooking') || '{}');

        // Bỏ việc redirect nếu thiếu spaceId, vì ta dùng URL bookingId
        const bookingId = new URLSearchParams(window.location.search).get('bookingId');
        if (!bookingId && !pending.total) {
            alert('Không có thông tin đặt chỗ, vui lòng thử lại!');
            window.location.href = '/';
            return;
        }

        const depositEl = document.getElementById('pay-txt-30');
        const totalEl = document.getElementById('pay-txt-100');

        if (depositEl) depositEl.textContent = Number(pending.deposit || 0).toLocaleString('vi-VN') + 'đ';
        if (totalEl) totalEl.textContent = Number(pending.total || 0).toLocaleString('vi-VN') + 'đ';
    }

    if (isProfilePage) {
        loadMyProfile();
    }
});

// ==========================================
// LOAD REVIEWS (CUSTOMER DETAIL)
// ==========================================
async function loadBranchReviews() {
    const container = document.getElementById('review-items-list');
    if (!container) return;

    const branchId = document.querySelector('[data-branch-id]')?.getAttribute('data-branch-id');
    if (!branchId) {
        DomSafe.clearElement(container);
        container.appendChild(
            DomSafe.createTextElement('div', 'text-red-500 text-sm', 'Thiếu branchId (không lấy được từ UI).')
        );
        return;
    }

    DomSafe.clearElement(container);
    container.appendChild(DomSafe.createTextElement('div', 'text-slate-500 text-sm', 'Đang tải đánh giá...'));

    try {
        const res = await WorkHubAPI.api(
            `/api/customers/branch/${encodeURIComponent(branchId)}/reviews`,
            { redirectOn401: false }
        );
        const data = await res.json();

        if (!res.ok) {
            DomSafe.clearElement(container);
            container.appendChild(
                DomSafe.createTextElement('div', 'text-red-500 text-sm', 'Lỗi tải đánh giá')
            );
            return;
        }

        DomSafe.renderReviews(container, data.reviews || []);
    } catch (e) {
        console.error(e);
        DomSafe.clearElement(container);
        container.appendChild(
            DomSafe.createTextElement('div', 'text-red-500 text-sm', 'Lỗi kết nối server')
        );
    }
}

function renderStars(rating) {
    const n = Number(rating) || 0;
    const full = '★'.repeat(Math.max(0, Math.min(5, n)));
    const empty = '☆'.repeat(Math.max(0, 5 - Math.max(0, Math.min(5, n))));
    return `${full}${empty}`;
}

function formatDateVN(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('vi-VN');
}

function escapeHtml(str) {
    return DomSafe.escapeHtml(str);
}

// ==========================================
// TRANG PROFILE (CỦA NA - GIỮ NGUYÊN)
// ==========================================
async function loadMyProfile() {
    try {
        const res = await WorkHubAPI.api('/api/customers/me/profile');
        const data = await res.json();

        if (!res.ok) {
            if (res.status === 401) { window.location.href = '/login'; return; }
            alert(data.error || 'Lỗi tải hồ sơ');
            return;
        }

        const { user, profile } = data;

        const fullnameEl = document.getElementById('input-fullname');
        const emailEl = document.getElementById('input-email');
        const phoneEl = document.getElementById('input-phone');
        const bankNameEl = document.getElementById('input-bank-name');
        const bankNumberEl = document.getElementById('input-bank-number');
        const displayNameEl = document.getElementById('profile-display-name');
        const avatarEl = document.getElementById('profile-avatar-preview');

        if (fullnameEl) fullnameEl.value = user.FullName || '';
        if (emailEl) emailEl.value = user.Email || '';
        if (phoneEl) phoneEl.value = profile?.Phone || '';
        if (bankNameEl) bankNameEl.value = profile?.BankName || '';
        if (bankNumberEl) bankNumberEl.value = profile?.BankNumber || '';
        if (displayNameEl) displayNameEl.textContent = user.FullName || '--';

        if (avatarEl) {
            avatarEl.src = profile?.Avatar
                ? profile.Avatar
                : `https://ui-avatars.com/api/?name=${encodeURIComponent(user.FullName || 'User')}&size=200`;
        }

    } catch (err) {
        console.error(err);
        alert('Lỗi kết nối server');
    }
}

async function saveMyProfile() {
    const formData = new FormData();
    formData.append('FullName', document.getElementById('input-fullname').value.trim());
    formData.append('Phone', document.getElementById('input-phone').value.trim());
    formData.append('BankName', document.getElementById('input-bank-name').value.trim());
    formData.append('BankNumber', document.getElementById('input-bank-number').value.trim());

    const avatarFile = document.getElementById('input-avatar')?.files[0];
    if (avatarFile) formData.append('customerAvatar', avatarFile);

    try {
        const res = await WorkHubAPI.api('/api/customers/me/profile', {
            method: 'PUT',
            body: formData
        });

        const data = await res.json();
        if (!res.ok) { alert(data.error || 'Lưu thất bại'); return; }

        document.getElementById('profile-display-name').textContent = data.user.FullName || '--';
        if (data.profile?.Avatar) {
            document.getElementById('profile-avatar-preview').src = data.profile.Avatar;
        }

        const headerNameEl = document.getElementById('user-display-name');
        const headerAvatarEl = document.getElementById('header-avatar-preview');

        if (headerNameEl) headerNameEl.textContent = data.user.FullName || 'Người dùng';
        if (headerAvatarEl) {
            headerAvatarEl.src = data.profile?.Avatar
                ? data.profile.Avatar
                : `https://ui-avatars.com/api/?name=${encodeURIComponent(data.user.FullName || 'User')}&background=0D8B8B&color=fff`;
        }

        sessionStorage.setItem('displayName', data.user.FullName || '');
        if (data.profile?.Avatar) {
            sessionStorage.setItem('displayAvatar', data.profile.Avatar);
        }

        alert('Đã lưu thông tin thành công!');

    } catch (err) {
        console.error(err);
        alert('Lỗi kết nối server');
    }
}

function previewProfileImage(input) {
    if (!input.files || !input.files[0]) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        const avatarEl = document.getElementById('profile-avatar-preview');
        if (avatarEl) avatarEl.src = e.target.result;
    };
    reader.readAsDataURL(input.files[0]);
}