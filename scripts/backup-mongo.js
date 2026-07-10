'use strict';

/**
 * Logical backup helper (mongodump if available, else JSON export of key collections).
 * Usage: node scripts/backup-mongo.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const mongoose = require('mongoose');

async function jsonBackup() {
  await mongoose.connect(process.env.MONGODB_URI);
  const dir = path.join(process.cwd(), 'backups', new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  const cols = await mongoose.connection.db.listCollections().toArray();
  for (const c of cols) {
    const docs = await mongoose.connection.db.collection(c.name).find({}).limit(10000).toArray();
    fs.writeFileSync(path.join(dir, `${c.name}.json`), JSON.stringify(docs, null, 2));
  }
  await mongoose.disconnect();
  console.log('JSON backup written to', dir);
}

try {
  if (process.env.MONGODB_URI) {
    try {
      execSync(`mongodump --uri="${process.env.MONGODB_URI}" --out=./backups/dump-${Date.now()}`, {
        stdio: 'inherit',
      });
      console.log('mongodump completed');
    } catch {
      console.log('mongodump unavailable, falling back to JSON export');
      jsonBackup();
    }
  } else {
    console.error('MONGODB_URI required');
    process.exit(1);
  }
} catch (e) {
  console.error(e);
  process.exit(1);
}
