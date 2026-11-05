/**
 * POS JIP — Google Apps Script backend
 *
 * The Google Sheet is the database:
 *   Products    – edit price / stock / promotion here
 *   Promotions  – bill-level promotions (e.g. spend 500 get 50 off)
 *   Sales       – one row per bill (written by the POS)
 *   SaleItems   – one row per product line (written by the POS)
 *   Preorders   – pre-order requests (written by the POS)
 *   Settings    – shop name, QR image URL, etc.
 *
 * Deploy: Extensions ▸ Apps Script ▸ Deploy ▸ New deployment ▸ Web app.
 * See README.md for the full guide.
 */

var SHEETS = {
  PRODUCTS: 'Products',
  PROMOS: 'Promotions',
  SALES: 'Sales',
  ITEMS: 'SaleItems',
  PREORDERS: 'Preorders',
  SETTINGS: 'Settings'
};

var PRODUCT_HEADERS = ['SKU', 'Name', 'Group', 'Description', 'Price', 'Stock', 'Status',
  'PromoType', 'PromoValue', 'PromoLabel', 'Note'];
var PROMO_HEADERS = ['Name', 'Type', 'MinTotal', 'Value', 'Active', 'Note'];
var SALES_HEADERS = ['Timestamp', 'BillNo', 'Items', 'Subtotal', 'Discount', 'Total',
  'Method', 'Received', 'Change', 'Staff', 'Ref', 'Status', 'Note'];
var ITEM_HEADERS = ['Timestamp', 'BillNo', 'SKU', 'Name', 'Qty', 'UnitPrice', 'LineDiscount',
  'LineTotal', 'PromoLabel', 'Method', 'Status'];
var PREORDER_HEADERS = ['Timestamp', 'SKU', 'Name', 'Qty', 'Customer', 'Phone', 'Note', 'Staff'];
var SETTINGS_HEADERS = ['Key', 'Value', 'Description'];
var PROMO_TYPES = ['NONE', 'PERCENT', 'AMOUNT', 'BUY_X_GET_Y', 'BUNDLE', 'TIER'];

/**
 * Price list from "แบบฟอร์มรวบรวมผลิตภัณฑ์นวัตกรรมจุฬาฯ SX 6/11-15/11/2569" (ราคาที่ขาย JIP).
 * `match` finds an existing row by name so applyPriceList() can update a sheet staff already edited.
 */
var PRICE_LIST = [
  { sku: 'MUZC-01', match: /muzc/i, name: 'The Muzc แผ่นแปะสมุนไพร', group: 'กลุ่มสมุนไพร',
    description: 'แผ่นแปะสมุนไพร บรรเทาอาการปวดและลดเมื่อยล้า', price: 269, status: 'SELL',
    promoType: 'BUNDLE', promoValue: '3=699', promoLabel: '3 กล่อง 699', note: 'ราคาปกติ 269/กล่อง' },
  { sku: 'KOS-3', match: /sleep.*3\s*คู่/i, name: 'KEEP ON SLEEP (3 คู่/ซอง)', group: 'กลุ่มสมุนไพร',
    description: 'แผ่นแปะผิวหนัง เทคโนโลยี Controlled Skin Diffusion ช่วยให้ร่างกายผ่อนคลายและส่งเสริมประสิทธิภาพการนอน',
    price: 329, status: 'SELL', promoType: 'NONE', promoValue: '', promoLabel: '', note: '' },
  { sku: 'KOS-5', match: /sleep/i, name: 'KEEP ON SLEEP (5 คู่/ซอง)', group: 'กลุ่มสมุนไพร',
    description: 'แผ่นแปะผิวหนัง เทคโนโลยี Controlled Skin Diffusion ช่วยให้ร่างกายผ่อนคลายและส่งเสริมประสิทธิภาพการนอน',
    price: 429, status: 'SELL', promoType: 'TIER', promoValue: '3@399', promoLabel: '3 ซองขึ้นไป ซองละ 399', note: '' },
  { sku: 'KOP-01', match: /party/i, name: 'KEEP ON PARTY', group: 'กลุ่มสมุนไพร',
    description: 'แผ่นแปะ เทคโนโลยี Controlled Skin Diffusion ช่วยให้ร่างกายรู้สึกสดชื่นและฟื้นฟูร่างกายจากความอ่อนล้า',
    price: 199, status: 'SELL', promoType: 'NONE', promoValue: '', promoLabel: '', note: '' },
  { sku: 'INNO-SUN', match: /กันแดด|sun/i, name: 'InnoBotanica SunShield Sunscreen Serum SPF50 PA+++', group: 'Innophytotech',
    description: 'เซรั่มกันแดด SPF50 PA+++ ซิงก์ออกไซด์จากดอกทุเรียน + สารสกัดทุเรียนอ่อน', price: 520, status: 'SELL',
    promoType: 'BUNDLE', promoValue: '2=888', promoLabel: '2 ขวด 888 (ปกติ 750)', note: 'เทสเตอร์ 1 ชิ้น ไม่ขาย' },
  { sku: 'INNO-SYRUP', match: /มะพร้าว|coconut/i, name: 'Syrup มะพร้าว (Sugar Reduced Coconut Sugar Syrup)', group: 'Innophytotech',
    description: 'ไซรัปน้ำตาลมะพร้าว ลดน้ำตาลซูโครส 65% เพิ่มพรีไบโอติก FOS', price: 150, status: 'SELL',
    promoType: 'NONE', promoValue: '', promoLabel: '', note: '' },
  { sku: 'INNO-PALM', match: /โตนด|palmyra/i, name: 'Syrup โตนด (Sugar Reduced Palmyra Sugar Syrup)', group: 'Innophytotech',
    description: 'ไซรัปน้ำตาลโตนด ลดน้ำตาลซูโครส 65% เพิ่มพรีไบโอติก FOS', price: 150, status: 'SELL',
    promoType: 'NONE', promoValue: '', promoLabel: '', note: '' }
];

/**
 * Updates Products from PRICE_LIST: sets SKU, Name, Price and promotion columns.
 * Keeps whatever staff entered in Stock, Status, Description and Note. Adds missing products
 * (stock 0). Run once from the Apps Script editor or the "POS JIP" menu.
 */
function applyPriceList() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEETS.PRODUCTS);
  if (!sh) throw new Error('ยังไม่ได้ตั้งค่าชีต — กรุณารัน setup() ก่อน');
  sh.getRange('I:I').setNumberFormat('@');
  addValidation_(sh, 'H', PROMO_TYPES);
  var rows = readTable_(SHEETS.PRODUCTS);
  var used = {};
  var col = function (h) { return PRODUCT_HEADERS.indexOf(h) + 1; };
  var log = [];

  PRICE_LIST.forEach(function (e) {
    var free = rows.filter(function (r) { return !used[r._row]; });
    var skuOf = function (r) { return String(r.SKU).trim(); };
    var row = free.filter(function (r) { return skuOf(r) === e.sku && e.match.test(String(r.Name)); })[0] ||
      free.filter(function (r) { return skuOf(r) === e.sku; })[0] ||
      free.filter(function (r) { return e.match.test(String(r.Name)); })[0];
    if (row) {
      used[row._row] = true;
      sh.getRange(row._row, col('SKU'), 1, 2).setValues([[e.sku, e.name]]);
      sh.getRange(row._row, col('Price')).setValue(e.price);
      sh.getRange(row._row, col('PromoType'), 1, 3).setValues([[e.promoType, e.promoValue, e.promoLabel]]);
      if (!row.Note && e.note) sh.getRange(row._row, col('Note')).setValue(e.note);
      log.push('อัปเดต ' + e.sku + ' (แถว ' + row._row + ')');
    } else {
      sh.appendRow([e.sku, e.name, e.group, e.description, e.price, 0, e.status,
        e.promoType, e.promoValue, e.promoLabel, e.note]);
      log.push('เพิ่มใหม่ ' + e.sku + ' (สต็อก 0 — กรุณากรอก)');
    }
  });
  SpreadsheetApp.flush();
  Logger.log(log.join('\n'));
  return log.join('\n');
}

/* ------------------------------------------------------------------ */
/*  Web app entry                                                      */
/* ------------------------------------------------------------------ */

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('POS JIP')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('POS JIP')
    .addItem('ตั้งค่าชีตเริ่มต้น (Setup sheets)', 'setup')
    .addItem('อัปเดตราคา/โปรตามใบราคา (Apply price list)', 'applyPriceList')
    .addItem('สรุปยอดขายวันนี้ (Today summary)', 'showTodaySummary')
    .addToUi();
}

/* ------------------------------------------------------------------ */
/*  Setup                                                              */
/* ------------------------------------------------------------------ */

/** Creates all sheets with headers and seeds the product list. Safe to run again. */
function setup() {
  var ss = SpreadsheetApp.getActive();

  var products = ensureSheet_(ss, SHEETS.PRODUCTS, PRODUCT_HEADERS);
  if (products.getLastRow() < 2) {
    var seed = PRICE_LIST.map(function (e) {
      return [e.sku, e.name, e.group, e.description, e.price, 0, e.status, e.promoType, e.promoValue, e.promoLabel, e.note];
    });
    products.getRange(2, 1, seed.length, seed[0].length).setValues(seed);
  }
  products.getRange('E:E').setNumberFormat('#,##0.00');
  products.getRange('I:I').setNumberFormat('@'); // keep '2+1' / '3=250' as text
  addValidation_(products, 'G', ['SELL', 'PREORDER', 'HIDDEN']);
  addValidation_(products, 'H', PROMO_TYPES);
  products.getRange('H1').setNote(
    'NONE = ไม่มีโปร\n' +
    'PERCENT = ลด % ต่อชิ้น  (PromoValue เช่น 10)\n' +
    'AMOUNT = ลดบาทต่อชิ้น  (PromoValue เช่น 20)\n' +
    'BUY_X_GET_Y = ซื้อ X แถม Y  (PromoValue เช่น 2+1)\n' +
    'BUNDLE = เหมาราคา  (PromoValue เช่น 3=250  คือ 3 ชิ้น 250 บาท)\n' +
    'TIER = ซื้อครบ N ชิ้น ราคาชิ้นละ  (PromoValue เช่น 3@399  คือ ซื้อ 3 ชิ้นขึ้นไป ชิ้นละ 399)');
  products.getRange('G1').setNote(
    'SELL = ขายหน้างาน\nPREORDER = ตัวโชว์/รับพรีออเดอร์ (ไม่ตัดสต็อก)\nHIDDEN = ซ่อนจากหน้า POS');

  var promos = ensureSheet_(ss, SHEETS.PROMOS, PROMO_HEADERS);
  if (promos.getLastRow() < 2) {
    promos.getRange(2, 1, 1, PROMO_HEADERS.length).setValues([
      ['ตัวอย่าง: ซื้อครบ 500 ลด 50', 'AMOUNT', 500, 50, false, 'เปลี่ยน Active เป็น TRUE เพื่อเปิดใช้']
    ]);
  }
  addValidation_(promos, 'B', ['AMOUNT', 'PERCENT']);
  promos.getRange('E2:E').insertCheckboxes();

  ensureSheet_(ss, SHEETS.SALES, SALES_HEADERS);
  ensureSheet_(ss, SHEETS.ITEMS, ITEM_HEADERS);
  ensureSheet_(ss, SHEETS.PREORDERS, PREORDER_HEADERS);

  var settings = ensureSheet_(ss, SHEETS.SETTINGS, SETTINGS_HEADERS);
  if (settings.getLastRow() < 2) {
    settings.getRange(2, 1, 4, 3).setValues([
      ['SHOP_NAME', 'JIP', 'ชื่อร้านที่แสดงบนหน้า POS'],
      ['EVENT_NAME', 'งานวันที่ 6-8', 'ชื่องาน (แสดงใต้ชื่อร้าน)'],
      ['QR_IMAGE_URL', '', 'เว้นว่าง = ใช้ QR ที่ฝังในระบบ / หรือใส่ลิงก์รูป QR ใหม่'],
      ['PREORDER_CONTACT', 'ทีม Innophytotech', 'ข้อความผู้ติดต่อสำหรับสินค้าพรีออเดอร์']
    ]);
  }
  return 'Setup complete';
}

function ensureSheet_(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight('bold').setBackground('#1f3a5f').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  return sh;
}

function addValidation_(sh, col, values) {
  var rule = SpreadsheetApp.newDataValidation().requireValueInList(values, true)
    .setAllowInvalid(false).build();
  sh.getRange(col + '2:' + col).setDataValidation(rule);
}

/* ------------------------------------------------------------------ */
/*  Read API (called from the POS with google.script.run)              */
/* ------------------------------------------------------------------ */

/** Returns everything the POS needs on load / refresh. */
function getData() {
  return {
    products: readProducts_(),
    promotions: readPromotions_(),
    settings: readSettings_(),
    serverTime: new Date().toISOString()
  };
}

function readProducts_() {
  var rows = readTable_(SHEETS.PRODUCTS);
  return rows.filter(function (r) { return String(r.SKU).trim() !== ''; })
    .map(function (r) {
      return {
        sku: String(r.SKU).trim(),
        name: String(r.Name || ''),
        group: String(r.Group || ''),
        description: String(r.Description || ''),
        price: toNum_(r.Price),
        stock: toNum_(r.Stock),
        status: String(r.Status || 'SELL').toUpperCase().trim(),
        promoType: String(r.PromoType || 'NONE').toUpperCase().trim(),
        promoValue: String(r.PromoValue === undefined ? '' : r.PromoValue).trim(),
        promoLabel: String(r.PromoLabel || ''),
        note: String(r.Note || '')
      };
    })
    .filter(function (p) { return p.status !== 'HIDDEN'; });
}

function readPromotions_() {
  return readTable_(SHEETS.PROMOS)
    .filter(function (r) { return r.Active === true || String(r.Active).toUpperCase() === 'TRUE'; })
    .map(function (r) {
      return {
        name: String(r.Name || ''),
        type: String(r.Type || 'AMOUNT').toUpperCase().trim(),
        minTotal: toNum_(r.MinTotal),
        value: toNum_(r.Value)
      };
    });
}

function readSettings_() {
  var out = {};
  readTable_(SHEETS.SETTINGS).forEach(function (r) {
    if (r.Key) out[String(r.Key).trim()] = r.Value;
  });
  return out;
}

function readTable_(name) {
  var sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  var values = sh.getDataRange().getValues();
  var headers = values.shift().map(function (h) { return String(h).trim(); });
  return values.map(function (row, i) {
    var o = { _row: i + 2 };
    headers.forEach(function (h, j) { o[h] = row[j]; });
    return o;
  });
}

/* ------------------------------------------------------------------ */
/*  Pricing — must match calcLine/calcCart in Index.html               */
/* ------------------------------------------------------------------ */

function calcLine_(p, qty) {
  var gross = p.price * qty;
  var discount = 0;
  var v = p.promoValue;
  switch (p.promoType) {
    case 'PERCENT':
      discount = gross * toNum_(v) / 100;
      break;
    case 'AMOUNT':
      discount = Math.min(p.price, toNum_(v)) * qty;
      break;
    case 'BUY_X_GET_Y': {
      var m = String(v).match(/^\s*(\d+)\s*\+\s*(\d+)\s*$/);
      if (m) {
        var x = +m[1], y = +m[2];
        var groups = Math.floor(qty / (x + y));
        discount = groups * y * p.price;
      }
      break;
    }
    case 'BUNDLE': {
      var b = String(v).match(/^\s*(\d+)\s*=\s*([\d.]+)\s*$/);
      if (b) {
        var n = +b[1], bp = +b[2];
        var sets = Math.floor(qty / n);
        discount = Math.max(0, sets * (n * p.price - bp));
      }
      break;
    }
    case 'TIER': {
      var t = String(v).match(/^\s*(\d+)\s*@\s*([\d.]+)\s*$/);
      if (t && qty >= +t[1]) discount = Math.max(0, qty * (p.price - +t[2]));
      break;
    }
  }
  discount = round2_(Math.min(discount, gross));
  return { gross: round2_(gross), discount: discount, total: round2_(gross - discount) };
}

function calcBillDiscount_(subtotal, promos) {
  var best = { amount: 0, name: '' };
  promos.forEach(function (pr) {
    if (subtotal < pr.minTotal) return;
    var amt = pr.type === 'PERCENT' ? subtotal * pr.value / 100 : pr.value;
    amt = Math.min(amt, subtotal);
    if (amt > best.amount) best = { amount: round2_(amt), name: pr.name };
  });
  return best;
}

/* ------------------------------------------------------------------ */
/*  Write API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Records a sale and decrements stock.
 * payload = { billNo, items:[{sku, qty}], method:'CASH'|'QR', received, staff, ref, note,
 *             manualDiscount, allowOversell }
 * Totals are recomputed on the server from the sheet (the sheet is the source of truth).
 */
function recordSale(payload) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ss = SpreadsheetApp.getActive();
    var salesSh = ss.getSheetByName(SHEETS.SALES);
    var itemsSh = ss.getSheetByName(SHEETS.ITEMS);
    var prodSh = ss.getSheetByName(SHEETS.PRODUCTS);
    if (!salesSh || !itemsSh || !prodSh) throw new Error('ยังไม่ได้ตั้งค่าชีต — กรุณารัน setup() ก่อน');

    var billNo = String(payload.billNo || '').trim();
    if (!billNo) throw new Error('Missing bill number');

    // Idempotency: the POS retries offline bills — never record the same bill twice.
    if (salesSh.getLastRow() > 1) {
      var found = salesSh.getRange(2, 2, salesSh.getLastRow() - 1, 1)
        .createTextFinder(billNo).matchEntireCell(true).findNext();
      if (found) return { ok: true, duplicate: true, billNo: billNo };
    }

    var products = readTable_(SHEETS.PRODUCTS);
    var bySku = {};
    products.forEach(function (r) { bySku[String(r.SKU).trim()] = r; });

    var stockCol = PRODUCT_HEADERS.indexOf('Stock') + 1;
    var lines = [];
    var warnings = [];
    var subtotal = 0, lineDiscounts = 0;

    (payload.items || []).forEach(function (it) {
      var r = bySku[String(it.sku).trim()];
      var qty = Math.floor(toNum_(it.qty));
      if (!r) throw new Error('ไม่พบสินค้า ' + it.sku);
      if (qty <= 0) return;
      var status = String(r.Status || 'SELL').toUpperCase().trim();
      if (status !== 'SELL') throw new Error(r.Name + ' ไม่ได้เปิดขายหน้างาน');
      var p = {
        price: toNum_(r.Price),
        promoType: String(r.PromoType || 'NONE').toUpperCase().trim(),
        promoValue: String(r.PromoValue === undefined ? '' : r.PromoValue).trim()
      };
      var stock = toNum_(r.Stock);
      if (qty > stock) {
        if (!payload.allowOversell) {
          throw new Error('สต็อก ' + r.Name + ' ไม่พอ (เหลือ ' + stock + ')');
        }
        warnings.push(r.Name + ': ขายเกินสต็อก (' + stock + ')');
      }
      var c = calcLine_(p, qty);
      subtotal += c.gross;
      lineDiscounts += c.discount;
      lines.push({ row: r._row, sku: String(r.SKU).trim(), name: r.Name, qty: qty, price: p.price,
        calc: c, promoLabel: String(r.PromoLabel || ''), newStock: stock - qty });
      r.Stock = stock - qty; // in case the same SKU appears twice
    });

    if (!lines.length) throw new Error('ไม่มีสินค้าในบิล');

    var afterLine = round2_(subtotal - lineDiscounts);
    var billPromo = calcBillDiscount_(afterLine, readPromotions_());
    var manual = Math.max(0, Math.min(toNum_(payload.manualDiscount), afterLine - billPromo.amount));
    var discount = round2_(lineDiscounts + billPromo.amount + manual);
    var total = round2_(subtotal - discount);

    var method = String(payload.method || '').toUpperCase() === 'QR' ? 'QR' : 'CASH';
    var received = method === 'CASH' ? toNum_(payload.received) : total;
    if (method === 'CASH' && received < total) throw new Error('รับเงินไม่ครบ');
    var change = round2_(received - total);

    var now = new Date();
    var summary = lines.map(function (l) { return l.name + ' x' + l.qty; }).join(', ');
    var notes = [payload.note || ''];
    if (billPromo.amount) notes.push('โปรบิล: ' + billPromo.name + ' -' + billPromo.amount);
    if (manual) notes.push('ส่วนลดพิเศษ -' + manual);
    if (warnings.length) notes.push(warnings.join('; '));

    salesSh.appendRow([now, billNo, summary, round2_(subtotal), discount, total, method,
      received, change, payload.staff || '', payload.ref || '', 'PAID',
      notes.filter(String).join(' | ')]);

    var itemRows = lines.map(function (l) {
      return [now, billNo, l.sku, l.name, l.qty, l.price, l.calc.discount, l.calc.total,
        l.promoLabel, method, 'PAID'];
    });
    itemsSh.getRange(itemsSh.getLastRow() + 1, 1, itemRows.length, ITEM_HEADERS.length)
      .setValues(itemRows);

    lines.forEach(function (l) { prodSh.getRange(l.row, stockCol).setValue(l.newStock); });
    SpreadsheetApp.flush();

    return { ok: true, billNo: billNo, subtotal: round2_(subtotal), discount: discount,
      total: total, received: received, change: change, warnings: warnings,
      products: readProducts_() };
  } finally {
    lock.releaseLock();
  }
}

/** Voids a bill and returns its items to stock. */
function voidSale(billNo, reason) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ss = SpreadsheetApp.getActive();
    var salesSh = ss.getSheetByName(SHEETS.SALES);
    var itemsSh = ss.getSheetByName(SHEETS.ITEMS);
    var prodSh = ss.getSheetByName(SHEETS.PRODUCTS);
    var sales = readTable_(SHEETS.SALES);
    var sale = sales.filter(function (s) { return String(s.BillNo) === String(billNo); })[0];
    if (!sale) throw new Error('ไม่พบบิล ' + billNo);
    if (sale.Status === 'VOID') throw new Error('บิลนี้ถูกยกเลิกไปแล้ว');

    var statusCol = SALES_HEADERS.indexOf('Status') + 1;
    var noteCol = SALES_HEADERS.indexOf('Note') + 1;
    salesSh.getRange(sale._row, statusCol).setValue('VOID');
    salesSh.getRange(sale._row, noteCol)
      .setValue([sale.Note, 'VOID: ' + (reason || '')].filter(String).join(' | '));

    var products = readTable_(SHEETS.PRODUCTS);
    var bySku = {};
    products.forEach(function (r) { bySku[String(r.SKU).trim()] = r; });
    var stockCol = PRODUCT_HEADERS.indexOf('Stock') + 1;
    var itemStatusCol = ITEM_HEADERS.indexOf('Status') + 1;

    readTable_(SHEETS.ITEMS).forEach(function (it) {
      if (String(it.BillNo) !== String(billNo) || it.Status === 'VOID') return;
      itemsSh.getRange(it._row, itemStatusCol).setValue('VOID');
      var p = bySku[String(it.SKU).trim()];
      if (p) {
        p.Stock = toNum_(p.Stock) + toNum_(it.Qty);
        prodSh.getRange(p._row, stockCol).setValue(p.Stock);
      }
    });
    SpreadsheetApp.flush();
    return { ok: true, products: readProducts_() };
  } finally {
    lock.releaseLock();
  }
}

/** Logs a pre-order request (does not touch stock). */
function recordPreorder(payload) {
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEETS.PREORDERS);
  if (!sh) throw new Error('ยังไม่ได้ตั้งค่าชีต — กรุณารัน setup() ก่อน');
  sh.appendRow([new Date(), payload.sku, payload.name, toNum_(payload.qty) || 1,
    payload.customer || '', "'" + String(payload.phone || ''), payload.note || '', payload.staff || '']);
  return { ok: true };
}

/** Today's totals + the latest bills (for the summary panel). */
function getTodaySummary() {
  var tz = Session.getScriptTimeZone();
  var today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var out = { date: today, bills: 0, total: 0, cash: 0, qr: 0, discount: 0, items: {}, recent: [] };
  readTable_(SHEETS.SALES).forEach(function (s) {
    if (!(s.Timestamp instanceof Date)) return;
    if (Utilities.formatDate(s.Timestamp, tz, 'yyyy-MM-dd') !== today) return;
    out.recent.push({ billNo: String(s.BillNo), time: Utilities.formatDate(s.Timestamp, tz, 'HH:mm'),
      items: String(s.Items), total: toNum_(s.Total), method: s.Method, status: s.Status });
    if (s.Status === 'VOID') return;
    out.bills++;
    out.total += toNum_(s.Total);
    out.discount += toNum_(s.Discount);
    if (s.Method === 'QR') out.qr += toNum_(s.Total); else out.cash += toNum_(s.Total);
  });
  readTable_(SHEETS.ITEMS).forEach(function (it) {
    if (!(it.Timestamp instanceof Date) || it.Status === 'VOID') return;
    if (Utilities.formatDate(it.Timestamp, tz, 'yyyy-MM-dd') !== today) return;
    out.items[it.Name] = (out.items[it.Name] || 0) + toNum_(it.Qty);
  });
  out.recent = out.recent.reverse().slice(0, 30);
  ['total', 'cash', 'qr', 'discount'].forEach(function (k) { out[k] = round2_(out[k]); });
  return out;
}

function showTodaySummary() {
  var s = getTodaySummary();
  var lines = ['วันที่ ' + s.date, 'จำนวนบิล: ' + s.bills, 'ยอดรวม: ' + s.total + ' บาท',
    'เงินสด: ' + s.cash + ' บาท', 'QR: ' + s.qr + ' บาท', 'ส่วนลด: ' + s.discount + ' บาท', ''];
  Object.keys(s.items).forEach(function (k) { lines.push(k + ': ' + s.items[k]); });
  SpreadsheetApp.getUi().alert('สรุปยอดขายวันนี้', lines.join('\n'), SpreadsheetApp.getUi().ButtonSet.OK);
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function toNum_(v) {
  if (typeof v === 'number') return v;
  var n = parseFloat(String(v === undefined || v === null ? '' : v).replace(/,/g, ''));
  return isNaN(n) ? 0 : n;
}

function round2_(n) {
  return Math.round(n * 100) / 100;
}
