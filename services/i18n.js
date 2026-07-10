'use strict';

const dictionaries = {
  vi: {
    'nav.home': 'Trang chủ',
    'nav.book': 'Đặt chỗ',
    'nav.history': 'Lịch sử',
    'nav.favorites': 'Yêu thích',
    'nav.account': 'Tài khoản',
    'nav.dashboard': 'Tổng quan',
    'nav.security': 'Bảo mật',
    'nav.notifications': 'Thông báo',
    'common.loading': 'Đang tải...',
    'common.error': 'Đã xảy ra lỗi',
    'common.save': 'Lưu',
    'common.cancel': 'Hủy',
    'booking.success': 'Tạo đơn thành công',
    'booking.checkin_qr': 'Mã check-in',
    'booking.upcoming': 'Sắp tới',
    'booking.action_required': 'Cần xử lý',
    'payment.pending_verify': 'Đang chờ host xác minh thanh toán',
    'dash.title': 'Tổng quan',
    'dash.subtitle': 'Booking sắp tới, việc cần làm và thanh toán chờ xác minh.',
    'dash.checkin': 'Check-in hôm nay',
    'lang.vi': 'Tiếng Việt',
    'lang.en': 'English',
  },
  en: {
    'nav.home': 'Home',
    'nav.book': 'Book',
    'nav.history': 'History',
    'nav.favorites': 'Favorites',
    'nav.account': 'Account',
    'nav.dashboard': 'Dashboard',
    'nav.security': 'Security',
    'nav.notifications': 'Notifications',
    'common.loading': 'Loading...',
    'common.error': 'Something went wrong',
    'common.save': 'Save',
    'common.cancel': 'Cancel',
    'booking.success': 'Booking created',
    'booking.checkin_qr': 'Check-in code',
    'booking.upcoming': 'Upcoming',
    'booking.action_required': 'Action required',
    'payment.pending_verify': 'Awaiting host payment verification',
    'dash.title': 'Overview',
    'dash.subtitle': 'Upcoming bookings, action items, and payments pending host review.',
    'dash.checkin': 'Check-in today',
    'lang.vi': 'Tiếng Việt',
    'lang.en': 'English',
  },
};

function t(lang, key, fallback) {
  const l = dictionaries[lang] ? lang : 'vi';
  return dictionaries[l][key] || fallback || key;
}

function detectLang(req) {
  const q = req.query?.lang;
  if (q === 'en' || q === 'vi') return q;
  const cookie = req.cookies?.lang;
  if (cookie === 'en' || cookie === 'vi') return cookie;
  const al = req.get('accept-language') || '';
  if (al.toLowerCase().startsWith('en')) return 'en';
  return 'vi';
}

function setLangCookie(res, lang) {
  const l = lang === 'en' ? 'en' : 'vi';
  res.cookie('lang', l, {
    httpOnly: false,
    sameSite: 'lax',
    maxAge: 365 * 24 * 3600 * 1000,
    path: '/',
  });
  return l;
}

module.exports = { t, detectLang, dictionaries, setLangCookie };
