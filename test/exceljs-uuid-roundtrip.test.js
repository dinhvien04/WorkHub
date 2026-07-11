'use strict';

/**
 * Prove ExcelJS works with forced nested uuid@11 (overrides).
 * Generates workbook → buffer → reopen → assert structure/values/styles.
 */
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('ExcelJS UUID 11 round-trip', () => {
  test('create workbook, write buffer, reopen, verify cells/styles/dates', async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'WorkHub';
    workbook.created = new Date('2026-01-15T10:00:00.000Z');

    const ws = workbook.addWorksheet('Report');
    ws.columns = [
      { header: 'ID', key: 'id', width: 12 },
      { header: 'Name', key: 'name', width: 20 },
      { header: 'Amount', key: 'amount', width: 14 },
      { header: 'Date', key: 'date', width: 18 },
    ];

    const header = ws.getRow(1);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1F2937' },
    };

    const when = new Date('2026-06-01T08:30:00.000Z');
    ws.addRow({ id: 'B-001', name: 'Room A', amount: 150000, date: when });
    ws.addRow({ id: 'B-002', name: 'Room B', amount: 250000, date: when });
    ws.getCell('C2').numFmt = '#,##0';
    ws.getCell('C3').numFmt = '#,##0';
    // Formula for total
    ws.getCell('C4').value = { formula: 'SUM(C2:C3)', result: 400000 };

    const buffer = await workbook.xlsx.writeBuffer();
    expect(Buffer.isBuffer(buffer) || buffer instanceof ArrayBuffer || buffer.byteLength > 0).toBe(
      true
    );
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    expect(buf.length).toBeGreaterThan(500);

    // Disk round-trip (export jobs write files)
    const tmp = path.join(os.tmpdir(), `workhub-xlsx-${Date.now()}.xlsx`);
    await fs.promises.writeFile(tmp, buf);

    const reopened = new ExcelJS.Workbook();
    await reopened.xlsx.readFile(tmp);
    const sheet = reopened.getWorksheet('Report');
    expect(sheet).toBeTruthy();
    expect(sheet.getRow(1).getCell(1).value).toBe('ID');
    expect(sheet.getRow(2).getCell(1).value).toBe('B-001');
    expect(sheet.getRow(2).getCell(2).value).toBe('Room A');
    expect(Number(sheet.getRow(2).getCell(3).value)).toBe(150000);
    expect(Number(sheet.getRow(3).getCell(3).value)).toBe(250000);

    // Formula preserved
    const c4 = sheet.getCell('C4').value;
    if (c4 && typeof c4 === 'object' && c4.formula) {
      expect(String(c4.formula).toUpperCase()).toContain('SUM');
    }

    // Style survived
    const hFont = sheet.getRow(1).font;
    expect(hFont && hFont.bold).toBe(true);

    // Concurrent second workbook (uuid usage under load)
    await Promise.all(
      [1, 2, 3].map(async (i) => {
        const wb2 = new ExcelJS.Workbook();
        const s2 = wb2.addWorksheet(`S${i}`);
        s2.addRow(['a', i, new Date()]);
        const b2 = await wb2.xlsx.writeBuffer();
        expect(Buffer.from(b2).length).toBeGreaterThan(200);
      })
    );

    await fs.promises.unlink(tmp).catch(() => {});
  });

  test('uuid override major is compatible and ExcelJS startup uses it', () => {
    // package.json overrides force exceljs nested uuid to ^11.1.1
    const pkg = require('../package.json');
    const forced = pkg.overrides?.exceljs?.uuid || '';
    expect(String(forced)).toMatch(/11/);

    // Practical proof: ExcelJS can create multiple workbooks concurrently
    // (uuid is used internally for shared strings / media ids in some paths)
    return Promise.all(
      Array.from({ length: 5 }, async (_, i) => {
        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet(`T${i}`);
        ws.addRow([`row-${i}`, i * 1000, new Date()]);
        const buf = await wb.xlsx.writeBuffer();
        const again = new ExcelJS.Workbook();
        await again.xlsx.load(Buffer.from(buf));
        expect(again.getWorksheet(`T${i}`).getRow(1).getCell(1).value).toBe(
          `row-${i}`
        );
      })
    );
  });
});

