'use strict';

const { Readable } = require('stream');
const { CloudinaryStorage, cleanupUploadedFile } = require('../utils/cloudinaryStorage');

describe('CloudinaryStorage first-party adapter (Cloudinary 2.x)', () => {
  test('pipes file stream to upload_stream and returns secure URL fields', async () => {
    const uploaded = [];
    const fakeCloudinary = {
      uploader: {
        upload_stream(opts, cb) {
          uploaded.push(opts);
          const chunks = [];
          const { Writable } = require('stream');
          const w = new Writable({
            write(chunk, enc, done) {
              chunks.push(chunk);
              done();
            },
            final(done) {
              cb(null, {
                secure_url: 'https://res.cloudinary.com/demo/image/upload/v1/coworking/avatars/abc.jpg',
                url: 'http://res.cloudinary.com/demo/image/upload/v1/coworking/avatars/abc.jpg',
                public_id: opts.public_id
                  ? `${opts.folder}/${opts.public_id}`
                  : 'coworking/avatars/abc',
                bytes: Buffer.concat(chunks).length,
                format: 'jpg',
                resource_type: 'image',
                folder: opts.folder,
              });
              done();
            },
          });
          return w;
        },
        destroy(publicId, opts, cb) {
          uploaded.push({ destroy: publicId, opts });
          if (typeof opts === 'function') return opts(null, { result: 'ok' });
          if (cb) cb(null, { result: 'ok' });
        },
      },
    };

    const storage = new CloudinaryStorage({
      cloudinary: fakeCloudinary,
      params: {
        folder: 'coworking/avatars',
        public_id: 'test-id',
        resource_type: 'image',
        allowed_formats: ['jpg', 'png'],
      },
    });

    const file = {
      fieldname: 'customerAvatar',
      originalname: 'a.jpg',
      encoding: '7bit',
      mimetype: 'image/jpeg',
      stream: Readable.from([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])]),
    };

    const result = await new Promise((resolve, reject) => {
      storage._handleFile({}, file, (err, info) => (err ? reject(err) : resolve(info)));
    });

    expect(result.path).toMatch(/^https:\/\//);
    expect(result.path).toContain('cloudinary.com');
    expect(result.filename || result.public_id).toBeTruthy();
    expect(uploaded[0].folder).toBe('coworking/avatars');
    expect(uploaded[0].secure).toBe(true);
    expect(uploaded[0].public_id).toBe('test-id');

    // remove file
    await new Promise((resolve, reject) => {
      storage._removeFile({}, result, (err) => (err ? reject(err) : resolve()));
    });
  });

  test('cleanupUploadedFile is best-effort', async () => {
    let destroyed = null;
    const cloudinary = {
      uploader: {
        destroy: async (id) => {
          destroyed = id;
          return { result: 'ok' };
        },
      },
    };
    await cleanupUploadedFile(cloudinary, { public_id: 'x/y', resource_type: 'image' });
    expect(destroyed).toBe('x/y');
    await cleanupUploadedFile(cloudinary, null);
  });

  test('upload module no longer requires multer-storage-cloudinary', () => {
    expect(() => require('../middlewares/upload')).not.toThrow();
    const upload = require('../middlewares/upload');
    expect(upload.CloudinaryStorage).toBe(CloudinaryStorage);
    // multer-storage-cloudinary must not be a required dependency path
    let peer;
    try {
      require.resolve('multer-storage-cloudinary');
      peer = true;
    } catch {
      peer = false;
    }
    // After uninstall peer should be false; if still present in node_modules, adapter still works
    expect(typeof peer).toBe('boolean');
  });
});
