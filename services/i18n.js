'use strict';

const dictionaries = {
  vi: {
    'nav.home': 'Trang chủ',
    'nav.book': 'Đặt chỗ',
    'nav.history': 'Lịch sử',
    'nav.favorites': 'Yêu thích',
    'nav.account': 'Tài khoản',
    'common.loading': 'Đang tải...',
    'common.error': 'Đã xảy ra lỗi',
    'booking.success': 'Tạo đơn thành công',
    'payment.pending_verify': 'Đang chờ host xác minh thanh toán',
  },
  en: {
    'nav.home': 'Home',
    'nav.book': 'Book',
    'nav.history': 'History',
    'nav.favorites': 'Favorites',
    'nav.account': 'Account',
    'common.loading': 'Loading...',
    'common.error': 'Something went wrong',
    'booking.success': 'Booking created',
    'payment.pending_verify': 'Awaiting host payment verification',
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

module.exports = { t, detectLang, dictionaries };
