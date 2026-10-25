# 🛍️ Simple E-Commerce Web App for Google Sheets & Google Apps Script

[![Google Apps Script](https://img.shields.io/badge/Google%20Apps%20Script-4285F4?style=flat-square&logo=google&logoColor=white)](https://developers.google.com/apps-script)
[![Google Sheets](https://img.shields.io/badge/Database-Google%20Sheets-34A853?style=flat-square&logo=google-sheets&logoColor=white)](https://www.google.com/sheets/about/)
[![Vanilla JS](https://img.shields.io/badge/Frontend-Vanilla%20JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)

A complete, serverless, zero-maintenance e-commerce web application specifically built for **Cash on Delivery (COD)** stores in Bangladesh. It requires **no server hosting**, **no database fees**, and **no external SaaS subscriptions**—your Google Sheet acts as both your product catalog and order management dashboard.

---

## 📑 Table of Contents

- [Architecture Overview](#-architecture-overview)
- [Key Features](#-key-features)
- [Spreadsheet Database Schema](#-spreadsheet-database-schema)
- [Step-by-Step Setup Guide](#-step-by-step-setup-guide)
  - [Option A: Container-Bound Script (Recommended & Fastest)](#option-a-container-bound-script-recommended--fastest)
  - [Option B: Command Line Deployment via Clasp](#option-b-command-line-deployment-via-clasp)
- [Authorizing Google Permissions](#-authorizing-google-permissions)
- [Store Owner's Daily Workflow](#-store-owners-daily-workflow)
- [Configuration Reference](#-configuration-reference)
- [Security & Concurrency Protections](#-security--concurrency-protections)
- [Troubleshooting & FAQ](#-troubleshooting--faq)
- [Roadmap & Enhancements](#-roadmap--enhancements)
- [License](#-license)

---

## 🏛️ Architecture Overview

```text
  ┌──────────────────────────────────────────────────────────────┐
  │                 Customer Browser (Client)                   │
  │  • index.html (Responsive Single Page App)                   │
  │  • Persistent Cart in localStorage                           │
  │  • Instant Client Validation & Live Product Search           │
  └──────────────────────────────┬───────────────────────────────┘
                                 │
                     google.script.run (RPC)
                                 │
  ┌──────────────────────────────▼──────────────────────────────┐
  │              Google Apps Script Backend (Code.js)           │
  │  • CacheService (60s Cache for fast product reads)           │
  │  • LockService (Concurrency protection on orders)           │
  │  • Server-Side Price Verification (Tamper-proof)            │
  │  • Formula Injection Sanitizer (CWE-1236 protection)        │
  └──────────────┬───────────────────────────────┬──────────────┘
                 │                               │
        Appends Order Row               Sends Instant Email
                 │                               │
  ┌──────────────▼──────────────┐ ┌──────────────▼──────────────┐
  │        Google Sheets        │ │    Merchant Notification    │
  │  • 'Products' Sheet (Catalog)│ │  • HTML Order Receipt       │
  │  • 'Orders' Sheet (CRM)     │ │  • Direct Click-to-Call Link│
  └─────────────────────────────┘ └─────────────────────────────┘
```

---

## ✨ Key Features

### 🛍️ Shopper Experience
- **Instant Product Search:** Live search filtering by title and description without extra network requests.
- **Detailed Product Modal:** Native accessible `<dialog>` modal with high-res image preview, formatted descriptions, and quantity stepper.
- **Persistent Shopping Cart:** Shopping cart state is saved to `localStorage`. Carts survive page reloads and browser restarts.
- **Visual Itemized Cart:** Cart displays thumbnail images, unit prices, quantity multipliers, and single-click item removal.
- **Smart Phone Validation:** Automatically cleans and normalizes Bangladeshi phone numbers whether entered with `+880`, `880`, hyphens, or spaces (`017XXXXXXXX`).
- **Instant Client Feedback:** Real-time form validation with field-level highlighting and smooth auto-scrolling to errors.
- **Printable Order Confirmation:** Clean receipt view displaying Order ID, shipping details, itemized breakdown, a 1-click **"Copy ID"** button, and print styling (`@media print`).

### 📦 Merchant & Operations Experience
- **Zero Cost & Maintenance:** Runs 100% on free Google Cloud infrastructure.
- **Google Sheets as CMS:** Add, edit, or remove products simply by typing into Google Sheets.
- **1-Click Call Verification:** Sends an HTML order alert to the store owner's inbox with a prominent `📞 Call Customer` button to verify Cash on Delivery orders directly from a smartphone.
- **Honeypot Anti-Spam:** Hidden spam trap catches automated web scrapers without bothering real users with CAPTCHAs.

---

## 📋 Spreadsheet Database Schema

The web app requires two sheets inside your Google Spreadsheet:

### 1. `Products` Sheet
Controls which items are displayed in the shop.

| Column Header | Data Type | Required? | Description |
|:---|:---|:---:|:---|
| **ID** | Text | **Yes** | Unique identifier (e.g., `P1`, `P2`, `SKU-100`). |
| **Name** | Text | **Yes** | Product name shown on cards and cart. |
| **Price** | Number / Text | **Yes** | Price in BDT. Formats like `1200`, `1,200`, `৳1200`, or `1200 BDT` are automatically sanitized. |
| **Image** | URL | **Yes** | Direct public image URL (JPEG/PNG/WebP/Imgur/Drive). |
| **Description** | Text | No | Detailed product description shown inside the modal. |
| **Active** | Boolean | No | `TRUE` to show the item in store; `FALSE` to hide it. |

> [!TIP]
> **Product Image Best Practices:**
> - **Aspect Ratio:** Use **1:1 square** images (e.g. `600x600px` or `800x800px`).
> - **Background:** Plain white (`#FFFFFF`) or transparent PNGs produce the cleanest catalog appearance.
> - **Handling Variations:** The web app automatically frames all images within a standardized 1:1 container using `object-fit: contain` with padding so that wide landscape or tall portrait photos are never cropped or distorted. If an image link breaks, an automatic SVG placeholder is shown.

### 2. `Orders` Sheet
Logs all incoming customer orders.

| Column Header | Description |
|:---|:---|
| **Date** | Timestamp formatted in your configured timezone (`yyyy-MM-dd HH:mm:ss`). |
| **OrderID** | Unique 5-digit identifier (e.g., `ORD-261025-48210`). |
| **Name** | Customer's full name (sanitized against formula injection). |
| **Phone** | Customer's 11-digit mobile number (prefixed with `'` to preserve leading zero). |
| **Address** | Full delivery address (house, road, thana, district). |
| **Area** | Selected delivery zone (e.g., `Inside Dhaka`, `Outside Dhaka`). |
| **Items** | Semicolon-delimited summary list of purchased products (e.g., `Backpack x 1; Sunglasses x 2`). |
| **Subtotal** | Products subtotal in BDT. |
| **Delivery** | Delivery fee in BDT. |
| **Total** | Grand total to collect upon delivery in BDT. |
| **Status** | Initial status set to `New`. You can change to `Confirmed`, `Shipped`, or `Delivered`. |
| **Note** | Optional special instructions or delivery landmarks from customer. |

---

## 🚀 Step-by-Step Setup Guide

### Option A: Container-Bound Script (Recommended & Fastest)

This approach binds the script directly to your Google Sheet. It requires **no manual configuration of `SHEET_ID`** because Apps Script automatically detects the active spreadsheet.

1. **Create a Google Sheet:**
   - Go to [Google Sheets](https://sheets.new) and create a new blank spreadsheet.
   - Name it (e.g., `My Online Shop DB`).

2. **Open the Script Editor:**
   - In the Google Sheets menu, click **Extensions** > **Apps Script**.

3. **Add the Project Files:**
   - Replace the default code in `Code.gs` with the contents of [`Code.js`](file:///c:/Users/Abu%20Yusuf/Documents/GitHub/shop-order-web/Code.js).
   - Click the **+** (Add a file) button next to Files, choose **HTML**, name it `index`, and paste the contents of [`index.html`](file:///c:/Users/Abu%20Yusuf/Documents/GitHub/shop-order-web/index.html).

4. **Initialize the Database:**
   - In the Apps Script toolbar, select the **`setup`** function from the dropdown menu and click **Run**.
   - Grant authorization when prompted (see [Authorizing Google Permissions](#-authorizing-google-permissions) below).
   - This creates both the `Products` and `Orders` sheets and seeds them with sample products.

5. **Deploy as a Web App:**
   - In the top right corner, click **Deploy** > **New deployment**.
   - Click the gear icon (**Select type**) and select **Web app**.
   - Configure the deployment settings:
     - **Description:** `Production v1`
     - **Execute as:** `Me (your-email@gmail.com)` *(Crucial: allows visitors to write orders to your sheet)*
     - **Who has access:** `Anyone` *(Crucial: allows customers to visit your store without logging into Google)*
   - Click **Deploy**.
   - Copy the provided **Web App URL**—this is your live e-commerce store link!

---

### Option B: Command Line Deployment via Clasp

If you develop locally using Git and Visual Studio Code:

1. **Install and Log in to Google Clasp:**
   ```bash
   npm install -g @google/clasp
   clasp login
   ```

2. **Clone this repository:**
   ```bash
   git clone https://github.com/Muhammad-Abu-Yusuf-Nayeem/shop-order-web.git
   cd shop-order-web
   ```

3. **Configure your Script ID:**
   - Create a standalone Google Apps Script project at [script.new](https://script.new).
   - Copy the Script ID from **Project Settings** (gear icon) > **Script ID**.
   - Update `.clasp.json`:
     ```json
     {
       "scriptId": "YOUR_ACTUAL_SCRIPT_ID",
       "rootDir": ""
     }
     ```

4. **Push code to Apps Script:**
   ```bash
   clasp push
   ```

5. **Set your Google Sheet ID:**
   - Either open [`Code.js`](file:///c:/Users/Abu%20Yusuf/Documents/GitHub/shop-order-web/Code.js) and paste your Google Sheet ID in `SHEET_ID`:
     ```javascript
     const SHEET_ID = '1Bxxoc_dR0ymDV23CLqOzdvBAYgGE0sT2YWYwgx8A-w';
     ```
   - **OR** store it securely in **Project Settings** > **Script Properties**:
     - Property: `SHEET_ID`
     - Value: `1Bxxoc_dR0ymDV23CLqOzdvBAYgGE0sT2YWYwgx8A-w`

6. **Run `setup` and Deploy:**
   - Run `clasp open` to open the Apps Script editor in your browser.
   - Run `setup()` once.
   - Deploy as a Web App (`Execute as: Me`, `Who has access: Anyone`).

---

## 🔐 Authorizing Google Permissions

When running `setup()` or testing for the first time, Google displays an authorization prompt:

1. Click **Review Permissions**.
2. Select your Google account.
3. You will see a warning: *"Google hasn’t verified this app"*.
   - *Why does this appear?* Because you are running your own custom script on your own personal Google account.
4. Click **Advanced** (in small text at the bottom).
5. Click **Go to My Shop (unsafe)**.
6. Click **Allow**.

---

## 💼 Store Owner's Daily Workflow

### Adding New Products
1. Open your Google Sheet and switch to the **`Products`** tab.
2. Insert a new row with:
   - **ID:** Any unique code (e.g. `P5`, `TSHIRT-BLK`).
   - **Name:** Product title (e.g. `Premium Cotton T-Shirt`).
   - **Price:** Price in BDT (e.g. `850`).
   - **Image:** Direct image URL.
   - **Description:** Features, sizing, or warranty notes.
   - **Active:** `TRUE`
3. The new product will appear in your store within **60 seconds** (due to the performance cache).

### Hiding Out-of-Stock Items
- Change the **`Active`** column value from `TRUE` to `FALSE`. The product is immediately hidden from customer view while preserving your historical order records.

### Processing Orders
1. When a customer places an order, you will receive an instant email with the order details.
2. Open the email on your phone and tap **`📞 Call [Phone Number]`** to verify the customer's identity and confirm their address.
3. Open your Google Sheet's **`Orders`** tab.
4. Update the **`Status`** cell from `New` to `Confirmed`, and then to `Shipped` once handed over to the courier.

---

## ⚙️ Configuration Reference

All settings can be customized at the top of [`Code.js`](file:///c:/Users/Abu%20Yusuf/Documents/GitHub/shop-order-web/Code.js):

```javascript
// ===================== CONFIG =====================
const SHEET_ID = 'PASTE_YOUR_SHEET_ID_HERE'; // Set this or use a container-bound script
const SHOP_NAME = 'My Shop';                 // Displayed on header and page title
const NOTIFY_EMAIL = Session.getEffectiveUser().getEmail(); // Receives new order notifications
const TIMEZONE = 'Asia/Dhaka';              // Used for order date formatting

// Delivery charges by zone (Server acts as the single source of truth)
const DELIVERY = {
  'Inside Dhaka': 60,
  'Outside Dhaka': 120
};

const PRODUCTS_CACHE_SECONDS = 60;          // Cache duration for catalog reads
```

---

## 🛡️ Security & Concurrency Protections

1. **Server-Side Price Verification:**
   - The browser only transmits product IDs and quantities (`[{id: 'P1', qty: 2}]`).
   - Prices, subtotal, delivery charges, and total calculations are executed entirely on the server. Clients cannot manipulate amounts.
2. **Formula Injection (CWE-1236) Sanitization:**
   - Any user-supplied text starting with `=`, `+`, `-`, `@`, `\t`, or `\r` is automatically escaped with a leading single quote (`'`), preventing malicious spreadsheet formulas from executing.
3. **LockService Concurrency Control:**
   - Simultaneous checkouts are managed through `LockService.getScriptLock()`. Orders are queued safely without colliding or overwriting sheet rows.
4. **Honeypot Bot Trap:**
   - Includes a hidden input field (`website`) invisible to human visitors. Automated spam bots that fill all form fields are silently rejected with a fake success status.
5. **Item Quantity Consolidation:**
   - Deduplicates incoming items to ensure malicious payloads cannot bypass the `MAX_QTY = 20` per-product limit.

---

## ❓ Troubleshooting & FAQ

### Q: Why do I see "Spreadsheet ID is not configured"?
**A:** You are running the script as a standalone project, but have not specified `SHEET_ID`. Either paste your Sheet ID into `const SHEET_ID = '...'` in [`Code.js`](file:///c:/Users/Abu%20Yusuf/Documents/GitHub/shop-order-web/Code.js) or bind the script directly to your spreadsheet via **Extensions > Apps Script**.

### Q: Why do product changes in Google Sheets not appear immediately?
**A:** The shop caches product data in Google's `CacheService` for **60 seconds** to ensure near-instant page loading for visitors. Edits will appear automatically after the cache expires.

### Q: Why are customers receiving an error when submitting orders?
**A:** Check your web app deployment settings under **Deploy > Manage deployments**:
- **Execute as** must be set to **`Me`**.
- **Who has access** must be set to **`Anyone`**.

### Q: What is the email sending quota?
**A:** Standard free `@gmail.com` accounts have a Google quota of **100 emails per day**. Google Workspace accounts have a quota of **1,500 emails per day**. Order placement logic is wrapped in `try/catch` so that even if the daily email limit is reached, orders are still safely written to your Google Sheet.

---

## 🗺️ Roadmap & Enhancements

Interested in extending this project? Recommended additions:
- [ ] **Courier API Integration:** Automatically generate consignments via Steadfast, Pathao, or RedX APIs upon order confirmation.
- [ ] **SMS Gateway Integration:** Automatic order confirmation SMS to customers using Bangladeshi SMS gateways (e.g. Greenweb, Elitbuzz, SSLWireless).
- [ ] **Customer Order Tracking:** A tracking lookup page allowing customers to check status (`New`, `Shipped`, `Delivered`) by typing their Order ID.
- [ ] **Discount Codes / Coupons:** Promotional voucher codes validated on the server.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE). You are free to use, modify, and distribute it for personal or commercial e-commerce stores.
