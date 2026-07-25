'use strict';

const request = require('supertest');
const {
  startMemoryMongo,
  stopMemoryMongo,
  clearDb,
  createUser,
  seedHostSpace,
  getApp,
  futureRange,
  absoluteRange,
} = require('./helpers');
const Branch = require('../models/Branch');
const Review = require('../models/Review');
const bookingService = require('../services/bookingService');
const { transform, srcset, pictureSources, isCloudinary } = require('../utils/imageUrl');
const {
  ensureBranchSeo,
  buildBranchFaq,
  seoPathForBranch,
  buildDetailViewModel,
} = require('../services/listingDetailService');

let app;

beforeAll(async () => {
  await startMemoryMongo();
  app = getApp();
});

afterAll(async () => {
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearDb();
});

describe('imageUrl helpers', () => {
  test('cloudinary transform and srcset', () => {
    const url =
      'https://res.cloudinary.com/demo/image/upload/v1/coworking/branchs/test.jpg';
    expect(isCloudinary(url)).toBe(true);
    const t = transform(url, { w: 800, f: 'webp', q: 'auto', c: 'fill' });
    expect(t).toContain('/upload/f_webp,q_auto,w_800,c_fill/');
    expect(t).toContain('test.jpg');
    const ss = srcset(url, [400, 800]);
    expect(ss).toContain('400w');
    expect(ss).toContain('800w');
    const pic = pictureSources(url);
    expect(pic.avifSrcset).toContain('f_avif');
    expect(pic.webpSrcset).toContain('f_webp');
    expect(isCloudinary('https://example.com/a.jpg')).toBe(false);
    expect(transform('https://example.com/a.jpg', { w: 100 })).toBe(
      'https://example.com/a.jpg'
    );
  });
});

describe('listing detail SEO + FAQ + schema', () => {
  test('ensure slug, redirect, FAQ and AggregateRating JSON-LD from real reviews', async () => {
    const host = await createUser({ email: 'hlist@test.com', role: 'host' });
    const customer = await createUser({ email: 'clist@test.com', role: 'customer' });
    const { branch, space } = await seedHostSpace(host);

    await Branch.updateOne(
      { _id: branch._id },
      {
        $set: {
          City: 'Hồ Chí Minh',
          District: 'Quận 1',
          Description: 'Không gian yên tĩnh',
          Images: [
            'https://res.cloudinary.com/demo/image/upload/v1/coworking/branchs/test.jpg',
          ],
          // no Slug yet
          Slug: undefined,
        },
        $unset: { Slug: 1, CitySlug: 1, DistrictSlug: 1 },
      }
    );

    const day = new Date();
    day.setDate(day.getDate() + 6);
    day.setHours(0, 0, 0, 0);
    const { start, end } = absoluteRange(day, 10, 0, 11, 0);
    const booking = await bookingService.createBooking({
      customerId: customer._id,
      spaceId: space._id,
      startTime: start,
      endTime: end,
    });
    booking.Status = 'completed';
    await booking.save();
    await Review.create({
      SpaceID: space._id,
      CustomerID: customer._id,
      BookingID: booking._id,
      Rating: 5,
      Comment: 'Rất tốt cho họp team',
    });

    const fresh = await Branch.findById(branch._id).lean();
    const ensured = await ensureBranchSeo({ ...fresh });
    expect(ensured.Slug).toBeTruthy();
    expect(ensured.CitySlug).toMatch(/ho-chi-minh|ho-chi-minh/);
    expect(seoPathForBranch(ensured)).toContain('/khong-gian/');

    const vm = await buildDetailViewModel(await Branch.findById(branch._id).lean(), {});
    expect(vm.faq.length).toBeGreaterThanOrEqual(2);
    expect(vm.jsonLd.some((b) => b['@type'] === 'LocalBusiness')).toBe(true);
    expect(vm.jsonLd.some((b) => b['@type'] === 'FAQPage')).toBe(true);
    const lb = vm.jsonLd.find((b) => b['@type'] === 'LocalBusiness');
    expect(lb.aggregateRating.reviewCount).toBe(1);
    expect(lb.aggregateRating.ratingValue).toBe(5);
    expect(vm.jsonLd.some((b) => b['@type'] === 'Review')).toBe(true);
    expect(vm.gallery.length).toBe(1);
    expect(vm.gallery[0].avifSrcset || vm.gallery[0].autoSrcset).toBeTruthy();

    // /detail?branchId= redirects to SEO path
    const redir = await request(app).get(`/detail?branchId=${branch._id}`);
    expect([301, 302]).toContain(redir.status);
    expect(redir.headers.location).toMatch(/\/khong-gian\//);

    const page = await request(app).get(redir.headers.location);
    expect(page.status).toBe(200);
    expect(page.text).toContain('Branch A');
    expect(page.text).toContain('Câu hỏi thường gặp');
    expect(page.text).toContain('application/ld+json');
    expect(page.text).toContain('AggregateRating');
    expect(page.text).toContain('FAQPage');
    expect(page.text).toContain('gallery-lightbox');
    expect(page.text).toContain('data-gallery');
  });

  test('buildBranchFaq only from real data', () => {
    const faq = buildBranchFaq(
      {
        Name: 'Test Hub',
        OpeningTime: '08:00',
        ClosingTime: '22:00',
        Address: '1 St',
        DepositPercentage: 0.3,
      },
      [{ PricePerHour: 100000, InstantBook: true }],
      { total: 2, average: 4.5 }
    );
    expect(faq.some((f) => f.question.includes('mở cửa'))).toBe(true);
    expect(faq.some((f) => f.answer.includes('100.000') || f.answer.includes('100000'))).toBe(
      true
    );
  });
});
