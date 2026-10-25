/**
 * Simple e-commerce backend (Google Apps Script)
 * Sheets used:
 *   "Products": ID | Name | Price | Image
 *   "Orders"  : Date | OrderID | Name | Phone | Address | Area | Items | Subtotal | Delivery | Total | Status | Note
 *
 * SETUP:
 *  1. Create a Google Sheet, copy its ID from the URL into SHEET_ID below.
 *  2. Run setup() once (it creates the sheets + sample products).
 *  3. Deploy > New deployment > Web app
 *       Execute as: Me | Who has access: Anyone
 */

// ===================== CONFIG =====================
const SHEET_ID = '16Bxxoc_dR0ymDV23CLqOzdvBAYgGE0sT2YWYwgx8A-w';
const SHOP_NAME = 'My Shop';
const NOTIFY_EMAIL = Session.getEffectiveUser().getEmail(); // new-order emails go here
const TIMEZONE = 'Asia/Dhaka';

// Delivery charge by area (the server is the source of truth for this)
const DELIVERY = {
  'Inside Dhaka': 60,
  'Outside Dhaka': 120
};

// ===================== PAGE =====================
function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle(SHOP_NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ===================== DATA FOR THE PAGE =====================
/** Called by the page on load. Returns products + delivery charges. */
function getShopData() {
  return {
    shopName: SHOP_NAME,
    delivery: DELIVERY,
    products: readProducts_()
  };
}

/** Reads the Products sheet and returns an array of product objects. */
function readProducts_() {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('Products');
  const rows = sheet.getDataRange().getValues();
  rows.shift(); // remove header row

  return rows
    .filter(r => r[0] !== '' && r[2] !== '')           // skip empty rows
    .map(r => ({
      id: String(r[0]),
      name: String(r[1]),
      price: Number(r[2]),
      image: String(r[3])
    }));
}

// ===================== PLACE ORDER =====================
/**
 * @param {Array}  items    [{id: 'P1', qty: 2}, ...]  (NO prices - the server looks them up)
 * @param {Object} customer {name, phone, address, area, note, website(honeypot)}
 * @return {Object} {success, orderId, total} or {success:false, error}
 */
function submitOrder(items, customer) {
  try {
    // 1) Spam trap: real users never fill the hidden "website" field
    if (customer.website) {
      return { success: true, orderId: 'ORD-OK', total: 0 }; // fake success for bots
    }

    // 2) Validate customer details
    const name = String(customer.name || '').trim();
    const phone = String(customer.phone || '').trim();
    const address = String(customer.address || '').trim();
    const area = String(customer.area || '');
    const note = String(customer.note || '').trim().slice(0, 300);

    if (name.length < 2) throw new Error('Please enter your name.');
    if (!/^01[3-9]\d{8}$/.test(phone)) throw new Error('Enter a valid 11-digit mobile number (01XXXXXXXXX).');
    if (address.length < 10) throw new Error('Please enter your full address.');
    if (!(area in DELIVERY)) throw new Error('Please select a delivery area.');
    if (!Array.isArray(items) || items.length === 0) throw new Error('Your cart is empty.');

    // 3) Recalculate prices on the server (never trust the browser)
    const productMap = {};
    readProducts_().forEach(p => productMap[p.id] = p);

    let subtotal = 0;
    const lines = [];
    items.forEach(item => {
      const product = productMap[String(item.id)];
      const qty = parseInt(item.qty, 10);
      if (!product) throw new Error('A product in your cart is no longer available.');
      if (!(qty >= 1 && qty <= 20)) throw new Error('Invalid quantity.');
      subtotal += product.price * qty;
      lines.push(product.name + ' x ' + qty);
    });

    const delivery = DELIVERY[area];
    const total = subtotal + delivery;

    // 4) Lock so two simultaneous orders cannot collide, then save
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    let orderId;
    try {
      orderId = makeOrderId_();
      const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('Orders');
      sheet.appendRow([
        new Date(), orderId, name,
        "'" + phone,            // leading ' keeps the leading 0 in the phone number
        address, area, lines.join('; '),
        subtotal, delivery, total, 'New', note
      ]);
    } finally {
      lock.releaseLock();
    }

    // 5) Notify the shop owner (failure here must not break the order)
    notifyOwner_(orderId, name, phone, address, lines, total);

    return { success: true, orderId: orderId, total: total };

  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ===================== HELPERS =====================
/** Example: ORD-251025-4821 */
function makeOrderId_() {
  const day = Utilities.formatDate(new Date(), TIMEZONE, 'yyMMdd');
  const rand = Math.floor(1000 + Math.random() * 9000);
  return 'ORD-' + day + '-' + rand;
}

function notifyOwner_(orderId, name, phone, address, lines, total) {
  try {
    MailApp.sendEmail(
      NOTIFY_EMAIL,
      'New order ' + orderId,
      'Name: ' + name + '\nPhone: ' + phone + '\nAddress: ' + address +
      '\nItems: ' + lines.join(', ') + '\nTotal: ' + total + ' BDT'
    );
  } catch (e) {
    console.error('Email failed: ' + e.message);
  }
}

// ===================== ONE-TIME SETUP =====================
/** Run this once from the editor to create the sheets with sample data. */
function setup() {
  const ss = SpreadsheetApp.openById(SHEET_ID);

  let products = ss.getSheetByName('Products') || ss.insertSheet('Products');
  products.clear();
  products.appendRow(['ID', 'Name', 'Price', 'Image']);
  products.appendRow(['P1', 'Wireless Earbuds', 1200, 'https://picsum.photos/id/1/120/120']);
  products.appendRow(['P2', 'Smart Watch', 2500, 'https://picsum.photos/id/20/120/120']);
  products.appendRow(['P3', 'Backpack', 1800, 'https://picsum.photos/id/30/120/120']);
  products.appendRow(['P4', 'Sunglasses', 650, 'https://picsum.photos/id/40/120/120']);

  let orders = ss.getSheetByName('Orders') || ss.insertSheet('Orders');
  if (orders.getLastRow() === 0) {
    orders.appendRow(['Date', 'OrderID', 'Name', 'Phone', 'Address', 'Area',
                      'Items', 'Subtotal', 'Delivery', 'Total', 'Status', 'Note']);
  }
}
