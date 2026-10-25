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
const SHEET_ID = 'PASTE_YOUR_SHEET_ID_HERE'; // Set this or use a container-bound script
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
    products: readProducts_(true)   // cached: fast for visitors
  };
}

const PRODUCTS_CACHE_KEY = 'products_v2';
const PRODUCTS_CACHE_SECONDS = 60;   // price/description edits show up within a minute

/**
 * Resolves the Google Spreadsheet object:
 * 1. Uses SHEET_ID if provided.
 * 2. Checks Script Properties for 'SHEET_ID'.
 * 3. Falls back to container-bound Active Spreadsheet.
 */
function getSpreadsheet_() {
  if (SHEET_ID && SHEET_ID !== 'PASTE_YOUR_SHEET_ID_HERE') {
    return SpreadsheetApp.openById(SHEET_ID);
  }
  const propId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (propId) {
    return SpreadsheetApp.openById(propId);
  }
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) {
    return active;
  }
  throw new Error('Spreadsheet ID is not configured. Please set SHEET_ID in Code.js or bind this script to a Google Sheet.');
}

/**
 * Prevents formula injection (CWE-1236) in Google Sheets.
 */
function sanitizeCell_(val) {
  const str = String(val == null ? '' : val).trim();
  if (/^[=+\-@\t\r]/.test(str)) {
    return "'" + str;
  }
  return str;
}

/**
 * Normalizes Bangladeshi mobile numbers by stripping spaces, hyphens, and +88 / 88 prefixes.
 */
function normalizeBdPhone_(phone) {
  let cleaned = String(phone || '').replace(/[\s\-\(\)]/g, '');
  if (cleaned.startsWith('+880')) cleaned = cleaned.slice(3);
  else if (cleaned.startsWith('880')) cleaned = cleaned.slice(2);
  else if (cleaned.startsWith('+88')) cleaned = cleaned.slice(3);
  return cleaned;
}

/**
 * Rounds currency amounts to 2 decimal places to prevent floating point inaccuracies.
 */
function roundMoney_(amount) {
  return Math.round((Number(amount || 0) + Number.EPSILON) * 100) / 100;
}

/**
 * Reads the Products sheet and returns an array of product objects.
 * - Columns are found by header name, so column order does not matter.
 * - Required headers: ID, Name, Price, Image.  Optional: Description, Active.
 * - Rows with a missing ID, an invalid price, or Active = FALSE are skipped.
 *
 * @param {boolean} useCache true for page loads (fast), false when placing an
 *                           order (always uses the live sheet prices).
 */
function readProducts_(useCache) {
  const cache = CacheService.getScriptCache();
  if (useCache) {
    const cached = cache.get(PRODUCTS_CACHE_KEY);
    if (cached) return JSON.parse(cached);
  }

  const sheet = getSpreadsheet_().getSheetByName('Products');
  if (!sheet) throw new Error('Products sheet not found. Run setup() first.');

  const rows = sheet.getDataRange().getValues();
  if (!rows || rows.length === 0) return [];

  const header = rows.shift().map(h => String(h).trim().toLowerCase());
  const col = {
    id: header.indexOf('id'),
    name: header.indexOf('name'),
    price: header.indexOf('price'),
    image: header.indexOf('image'),
    description: header.indexOf('description'), // optional
    active: header.indexOf('active')            // optional
  };
  ['id', 'name', 'price', 'image'].forEach(key => {
    if (col[key] === -1) throw new Error('Products sheet is missing the "' + key + '" column.');
  });

  const products = [];
  const seenIds = {};
  rows.forEach(r => {
    const id = String(r[col.id]).trim();
    // Resilient price parsing: strips commas, BDT, ৳, and extra formatting
    const rawPrice = String(r[col.price]).replace(/[^0-9.]/g, '').trim();
    const price = roundMoney_(rawPrice);

    if (!id || seenIds[id]) return;                                      // empty or duplicate ID
    if (rawPrice === '' || !isFinite(price) || price < 0) return;        // bad price
    if (col.active !== -1 && String(r[col.active]).trim().toUpperCase() === 'FALSE') return; // hidden

    seenIds[id] = true;
    products.push({
      id: id,
      name: String(r[col.name]).trim(),
      price: price,
      image: String(r[col.image]).trim(),
      description: col.description === -1 ? '' : String(r[col.description]).trim()
    });
  });

  if (useCache) {
    try {
      cache.put(PRODUCTS_CACHE_KEY, JSON.stringify(products), PRODUCTS_CACHE_SECONDS);
    } catch (e) {
      console.error('Cache write failed: ' + e.message); // cache is optional, never fatal
    }
  }
  return products;
}

// ===================== PLACE ORDER =====================
/**
 * @param {Array}  items    [{id: 'P1', qty: 2}, ...]  (NO prices - the server looks them up)
 * @param {Object} customer {name, phone, address, area, note, website(honeypot)}
 * @return {Object} {success, orderId, subtotal, delivery, total, items, customer} or {success:false, error}
 */
function submitOrder(items, customer) {
  try {
    // 1) Spam trap: real users never fill the hidden "website" field
    if (customer && customer.website) {
      return { success: true, orderId: 'ORD-OK', total: 0 }; // fake success for bots
    }

    if (!customer) throw new Error('Customer information is missing.');

    // 2) Validate customer details with normalization
    const name = String(customer.name || '').trim();
    const phone = normalizeBdPhone_(customer.phone);
    const address = String(customer.address || '').trim();
    const area = String(customer.area || '');
    const note = String(customer.note || '').trim().slice(0, 300);

    if (name.length < 2) throw new Error('Please enter your full name (at least 2 letters).');
    if (!/^01[3-9]\d{8}$/.test(phone)) throw new Error('Enter a valid 11-digit mobile number (e.g. 017XXXXXXXX).');
    if (address.length < 10) throw new Error('Please enter a detailed delivery address (at least 10 characters).');
    if (!(area in DELIVERY)) throw new Error('Please select a valid delivery area.');
    if (!Array.isArray(items) || items.length === 0) throw new Error('Your cart is empty.');

    // 3) Consolidate cart items and recalculate prices on the server
    const consolidated = {};
    items.forEach(item => {
      if (!item || !item.id) return;
      const itemId = String(item.id).trim();
      const itemQty = parseInt(item.qty, 10);
      if (isFinite(itemQty) && itemQty > 0) {
        consolidated[itemId] = (consolidated[itemId] || 0) + itemQty;
      }
    });

    const itemKeys = Object.keys(consolidated);
    if (itemKeys.length === 0) throw new Error('Your cart is empty.');

    const productMap = {};
    readProducts_(false).forEach(p => productMap[p.id] = p); // live prices, never cached

    let subtotal = 0;
    const lines = [];
    const itemSummaries = [];
    itemKeys.forEach(id => {
      const product = productMap[id];
      const qty = consolidated[id];
      if (!product) throw new Error('A product in your cart is no longer available.');
      if (qty < 1 || qty > 20) throw new Error('Invalid quantity for ' + product.name + ' (maximum 20 per item).');
      const lineTotal = roundMoney_(product.price * qty);
      subtotal = roundMoney_(subtotal + lineTotal);
      lines.push(product.name + ' x ' + qty);
      itemSummaries.push({
        id: product.id,
        name: product.name,
        price: product.price,
        qty: qty,
        lineTotal: lineTotal
      });
    });

    const delivery = roundMoney_(DELIVERY[area]);
    const total = roundMoney_(subtotal + delivery);

    // 4) Safe concurrency lock with friendly timeout message
    const lock = LockService.getScriptLock();
    const acquired = lock.tryLock(20000);
    if (!acquired) {
      throw new Error('Our store is currently experiencing high volume. Please wait a moment and try placing your order again.');
    }

    let orderId;
    try {
      orderId = makeOrderId_();
      const sheet = getSpreadsheet_().getSheetByName('Orders');
      if (!sheet) throw new Error('Orders sheet not found. Run setup() first.');

      const orderTimestamp = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
      sheet.appendRow([
        orderTimestamp,
        orderId,
        sanitizeCell_(name),
        "'" + phone,            // leading ' keeps the leading 0 in the phone number
        sanitizeCell_(address),
        sanitizeCell_(area),
        lines.join('; '),
        subtotal,
        delivery,
        total,
        'New',
        sanitizeCell_(note)
      ]);
    } finally {
      if (lock && lock.hasLock()) {
        lock.releaseLock();
      }
    }

    // 5) Notify the shop owner with actionable click-to-call link
    notifyOwner_(orderId, name, phone, address, area, lines, total, note);

    return {
      success: true,
      orderId: orderId,
      subtotal: subtotal,
      delivery: delivery,
      total: total,
      items: itemSummaries,
      customer: {
        name: name,
        phone: phone,
        address: address,
        area: area,
        note: note
      }
    };

  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ===================== HELPERS =====================
/** Example: ORD-251025-48210 (5-digit random prevents collision) */
function makeOrderId_() {
  const day = Utilities.formatDate(new Date(), TIMEZONE, 'yyMMdd');
  const rand = Math.floor(10000 + Math.random() * 90000);
  return 'ORD-' + day + '-' + rand;
}

function notifyOwner_(orderId, name, phone, address, area, lines, total, note) {
  try {
    const subject = `[New Order] ${orderId} - ${total} BDT (${area})`;
    const plainText = 
      `New Order: ${orderId}\n` +
      `Customer: ${name}\n` +
      `Phone: ${phone}\n` +
      `Address: ${address} (${area})\n` +
      `Note: ${note || 'None'}\n\n` +
      `Items:\n${lines.join('\n')}\n\n` +
      `Total: ${total} BDT (Cash on Delivery)`;

    const htmlBody = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#FAF7F0;border:1px solid #E7E1D3;border-radius:14px;color:#2B2A26;">
        <h2 style="margin:0 0 12px;color:#2F5D50;font-size:22px;">New Order Placed: ${orderId}</h2>
        <p style="margin:4px 0;"><strong>Customer:</strong> ${name}</p>
        <p style="margin:4px 0;">
          <strong>Phone:</strong> 
          <a href="tel:${phone}" style="display:inline-block;padding:4px 10px;background:#2F5D50;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:bold;margin-left:6px;">
            📞 Call ${phone}
          </a>
        </p>
        <p style="margin:4px 0;"><strong>Address:</strong> ${address}</p>
        <p style="margin:4px 0;"><strong>Area:</strong> ${area}</p>
        ${note ? `<p style="margin:4px 0;color:#7A766B;"><strong>Note:</strong> ${note}</p>` : ''}
        <div style="margin:18px 0;padding:14px;background:#FFFEFB;border:1px solid #E7E1D3;border-radius:10px;">
          <h4 style="margin:0 0 10px;color:#2F5D50;font-size:15px;">Order Summary</h4>
          <ul style="margin:0;padding-left:20px;">
            ${lines.map(line => `<li style="margin-bottom:4px;">${line}</li>`).join('')}
          </ul>
          <div style="margin-top:12px;padding-top:10px;border-top:1px solid #E7E1D3;font-size:17px;font-weight:bold;color:#2F5D50;">
            Total: ${total} BDT (Cash on Delivery)
          </div>
        </div>
      </div>
    `;

    MailApp.sendEmail({
      to: NOTIFY_EMAIL,
      subject: subject,
      body: plainText,
      htmlBody: htmlBody
    });
  } catch (e) {
    console.error('Email failed: ' + e.message);
  }
}

// ===================== ONE-TIME SETUP =====================
/** Run this once from the editor to initialize the sheets without overwriting existing data. */
function setup() {
  const ss = getSpreadsheet_();

  let products = ss.getSheetByName('Products');
  if (!products) {
    products = ss.insertSheet('Products');
  }

  // Non-destructive: Only seed sample products if the sheet is completely empty
  if (products.getLastRow() === 0) {
    products.appendRow(['ID', 'Name', 'Price', 'Image', 'Description', 'Active']);
    products.appendRow(['P1', 'Wireless Earbuds', 1200, 'https://picsum.photos/id/1/400/400',
                        'Bluetooth 5.3, 24-hour battery with charging case, sweat resistant.', true]);
    products.appendRow(['P2', 'Smart Watch', 2500, 'https://picsum.photos/id/20/400/400',
                        'Heart-rate and sleep tracking, 7-day battery, water resistant.', true]);
    products.appendRow(['P3', 'Backpack', 1800, 'https://picsum.photos/id/30/400/400',
                        '25L water-resistant backpack with a padded 15-inch laptop sleeve.', true]);
    products.appendRow(['P4', 'Sunglasses', 650, 'https://picsum.photos/id/40/400/400',
                        'Polarized lenses with UV400 protection and a lightweight frame.', true]);
  }
  CacheService.getScriptCache().remove(PRODUCTS_CACHE_KEY); // drop stale cached products

  let orders = ss.getSheetByName('Orders') || ss.insertSheet('Orders');
  if (orders.getLastRow() === 0) {
    orders.appendRow(['Date', 'OrderID', 'Name', 'Phone', 'Address', 'Area',
                      'Items', 'Subtotal', 'Delivery', 'Total', 'Status', 'Note']);
  }
}