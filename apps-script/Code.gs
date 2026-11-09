/**
 * Henschel Wish Book: back end for the public catalog page.
 *
 * Lives inside the "Henschel Wish Book" Google Sheet (Extensions > Apps Script).
 * Deploy > New deployment > Web app, Execute as: Me, Who has access: Anyone.
 *
 * This Sheet is the single source of truth. The site, the daily price check,
 * Shopping Scout and Claude all read from and write to it.
 *
 * GET  -> public list data: people, sizes, public profile rows (Inspo corner),
 *         items, and the IDs of bought items. Buyer names, prices paid,
 *         private profile rows and the Inbox never leave the Sheet.
 * POST -> {"action":"purchase", itemId, buyerName, pricePaid, retailer}
 *           Appends a row to Purchases. Tick "Restored" there to undo.
 *         {"action":"check_code", code}
 *         {"action":"add_wish", code, person, link, note, addedBy, image?}
 *           Appends a row to Inbox; image {name, mime, data(base64)} is saved
 *           to the Drive folder named in Settings > inbox_folder.
 *         {"action":"add_pref", code, person, type, value, addedBy}
 *           Appends a row to Profiles (shown on the site).
 *
 * The family passcode lives in Project Settings > Script properties as
 * FAMILY_CODE. Without it, adding wishes and preferences is switched off.
 */

var CACHE_KEY = 'public-v2';
var PREF_TYPES = ['Needs', 'Loves', 'Style', 'Colors', 'Avoid colors', 'Brands', 'Stores', 'Avoid', 'Allergies', 'Already owns', 'Notes'];
var MAX_IMAGE_BYTES = 8 * 1024 * 1024;
var CACHE_SECONDS = 30;

function doGet() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get(CACHE_KEY);
  if (hit) return out_(hit);
  var body = JSON.stringify(buildPublic_());
  if (body.length < 95000) cache.put(CACHE_KEY, body, CACHE_SECONDS);
  return out_(body);
}

function doPost(e) {
  var req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad_request' }); }
  var action = req && req.action;
  try {
    if (action === 'purchase') return json_(purchase_(req));
    if (action === 'check_code') return json_({ ok: codeOk_(req.code) });
    if (action === 'add_wish') return json_(addWish_(req));
    if (action === 'add_pref') return json_(addPref_(req));
  } catch (err) {
    return json_({ ok: false, error: 'server_error' });
  }
  return json_({ ok: false, error: 'unknown_action' });
}

function purchase_(req) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var items = readItems_();
    var item = items.filter(function (it) { return it.id === String(req.itemId || ''); })[0];
    if (!item) return { ok: false, error: 'unknown_item' };
    var paid = parseFloat(String(req.pricePaid || '').replace(/[^0-9.]/g, ''));
    sheet_('Purchases').appendRow([
      new Date(), item.id, item.name, item.personName,
      clean_(req.buyerName, 60), isNaN(paid) ? '' : paid, clean_(req.retailer, 80), false
    ]);
  } finally {
    lock.releaseLock();
  }
  CacheService.getScriptCache().remove(CACHE_KEY);
  return { ok: true };
}

// Wrong guesses are counted; after 20 in 15 minutes the passcode stops working
// for everyone until the window passes, so it can't be guessed by brute force.
function codeOk_(code) {
  var want = PropertiesService.getScriptProperties().getProperty('FAMILY_CODE');
  if (!want) return false;
  var cache = CacheService.getScriptCache();
  var fails = Number(cache.get('code-fails') || 0);
  if (fails >= 20) return false;
  var ok = String(code || '').trim().toLowerCase() === String(want).trim().toLowerCase();
  if (!ok) cache.put('code-fails', String(fails + 1), 900);
  return ok;
}

function personName_(slug) {
  var p = readPeople_().filter(function (x) { return x.id === slug_(slug); })[0];
  return p ? p.name : '';
}

function addWish_(req) {
  if (!codeOk_(req.code)) return { ok: false, error: 'bad_code' };
  var who = personName_(req.person);
  if (!who) return { ok: false, error: 'unknown_person' };
  var link = String(req.link || '').trim();
  if (link && !/^https?:\/\//i.test(link)) return { ok: false, error: 'bad_link' };
  var shot = '';
  if (req.image && req.image.data) {
    var bytes = Utilities.base64Decode(String(req.image.data));
    if (bytes.length > MAX_IMAGE_BYTES) return { ok: false, error: 'image_too_big' };
    var mime = /^image\/(png|jpeg|webp|gif|heic)$/.test(req.image.mime) ? req.image.mime : 'image/jpeg';
    var name = who + ' ' + Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd HHmm') + ' ' + clean_(req.image.name, 40);
    shot = inboxFolder_().createFile(Utilities.newBlob(bytes, mime, name)).getUrl();
  }
  if (!link && !shot && !String(req.note || '').trim()) return { ok: false, error: 'empty' };
  sheet_('Inbox').appendRow([
    new Date(), who, clean_(link, 1000), shot, clean_(req.note, 500), clean_(req.addedBy, 60), 'New', '', ''
  ]);
  return { ok: true };
}

function addPref_(req) {
  if (!codeOk_(req.code)) return { ok: false, error: 'bad_code' };
  var who = personName_(req.person);
  if (!who) return { ok: false, error: 'unknown_person' };
  var type = PREF_TYPES.filter(function (t) { return t.toLowerCase() === String(req.type || '').toLowerCase(); })[0];
  var value = clean_(req.value, 200);
  if (!type || !value) return { ok: false, error: 'bad_pref' };
  sheet_('Profiles').appendRow([who, type, value, true, Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd')]);
  CacheService.getScriptCache().remove(CACHE_KEY);
  return { ok: true };
}

function inboxFolder_() {
  var name = String(settings_()['inbox_folder'] || 'Wish Book Inbox');
  var it = DriveApp.getFoldersByName(name);
  return it.hasNext() ? it.next() : DriveApp.createFolder(name);
}

/* ---------- reading the Sheet ---------- */

function buildPublic_() {
  var people = readPeople_();
  var items = readItems_().map(function (it) { delete it.personName; return it; });
  var bought = {};
  rows_('Purchases').forEach(function (r) {
    if (r['Item ID'] && !truthy_(r['Restored'])) bought[String(r['Item ID'])] = true;
  });
  var settings = settings_();
  return {
    people: people,
    profiles: readPublicProfiles_(),
    items: items,
    purchased: Object.keys(bought),
    meta: {
      lastRun: iso_(settings['last_price_check']),
      summary: String(settings['summary'] || ''),
      maxPrice: num_(settings['max_price']),
      adding: !!PropertiesService.getScriptProperties().getProperty('FAMILY_CODE')
    }
  };
}

function settings_() {
  var s = {};
  rows_('Settings').forEach(function (r) { if (r['Key']) s[String(r['Key'])] = r['Value']; });
  return s;
}

// Only rows ticked "Show on site" leave the Sheet.
function readPublicProfiles_() {
  var out = {};
  if (!SpreadsheetApp.getActive().getSheetByName('Profiles')) return out;
  rows_('Profiles').forEach(function (r) {
    var p = slug_(r['Person']);
    var v = String(r['Value'] || '').trim();
    if (!p || !v || !truthy_(r['Show on site'])) return;
    (out[p] = out[p] || []).push({ type: String(r['Type'] || 'Notes'), value: v });
  });
  return out;
}

function readPeople_() {
  var sizes = {};
  rows_('Sizes').forEach(function (r) {
    var p = slug_(r['Person']);
    if (!p || !r['Size']) return;
    (sizes[p] = sizes[p] || []).push({ label: String(r['Size']), value: String(r['Value'] || '') });
  });
  return rows_('People').filter(function (r) { return r['Name']; }).map(function (r, i) {
    var id = slug_(r['Name']);
    return {
      id: id,
      name: String(r['Name']),
      age: r['Age'] === '' ? null : r['Age'],
      order: r['Order'] === '' ? i + 1 : Number(r['Order']),
      headline: String(r['Headline'] || ''),
      sizes: sizes[id] || [],
      sizesUpdated: iso_(r['Sizes updated'])
    };
  });
}

function modeOf_(v) { var s = String(v || '').toLowerCase(); return s.indexOf('like') === 0 ? 'like' : s.indexOf('any') === 0 ? 'any' : 'exact'; }
var PRIORITY = { 'must-have': 'must', 'must': 'must', 'would love': 'love', 'love': 'love', 'fun extra': 'fun', 'fun': 'fun' };

function readItems_() {
  var sh = sheet_('Items');
  var values = sh.getDataRange().getValues();
  var head = values[0];
  var col = {};
  head.forEach(function (h, i) { col[String(h).trim()] = i; });
  var out = [];
  var newIds = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var g = function (name) { var i = col[name]; return i === undefined ? '' : row[i]; };
    if (!g('Item')) continue;
    var id = String(g('ID') || '').trim();
    if (!id) { id = slug_(g('Item')).slice(0, 40) + '-' + (r + 1); newIds.push([r + 1, id]); }
    var price = num_(g('Price'));
    var pick = null;
    if (price !== null) {
      pick = {
        kind: String(g('Pick type') || 'original'),
        name: String(g('Pick name') || g('Item')),
        price: price,
        regular: num_(g('Regular price')),
        retailer: String(g('Store') || ''),
        url: String(g('Buy link') || ''),
        stock: String(g('Stock') || ''),
        checked: iso_(g('Checked')),
        why: String(g('Why') || ''),
        priceFrom: truthy_(g('From price')),
        saleVerified: true,
        alsoChecked: parseJson_(g('Also checked'), [])
      };
      var op = num_(g('Exact price'));
      if (op !== null) pick.original = { name: String(g('Exact name') || g('Item')), price: op, retailer: String(g('Exact store') || ''), url: String(g('Exact link') || '') };
    }
    out.push({
      id: id,
      person: slug_(g('For')),
      personName: String(g('For') || ''),
      name: String(g('Item')),
      mode: modeOf_(g('Match')),
      priority: PRIORITY[String(g('Priority')).toLowerCase().trim()] || 'love',
      notes: String(g('Notes') || ''),
      refLink: String(g('Link') || ''),
      image: String(g('Photo') || ''),
      category: String(g('Category') || 'gift'),
      example: truthy_(g('Example')),
      added: iso_(g('Added')) || '',
      pendingNote: String(g('Pending note') || ''),
      pick: pick,
      history: parseJson_(g('History'), [])
    });
  }
  // Give new rows a permanent ID so purchases stay attached to them.
  if (newIds.length && col['ID'] !== undefined) {
    newIds.forEach(function (p) { sh.getRange(p[0], col['ID'] + 1).setValue(p[1]); });
  }
  return out;
}

/* ---------- helpers ---------- */

function sheet_(name) {
  var sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) throw new Error('Missing tab: ' + name);
  return sh;
}
function rows_(name) {
  var v = sheet_(name).getDataRange().getValues();
  var head = v.shift().map(function (h) { return String(h).trim(); });
  return v.map(function (row) { var o = {}; head.forEach(function (h, i) { o[h] = row[i]; }); return o; });
}
function out_(body) { return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JSON); }
function json_(o) { return out_(JSON.stringify(o)); }
function slug_(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function clean_(s, n) { return String(s || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n); }
function num_(v) { if (v === '' || v === null) return null; var n = Number(String(v).replace(/[^0-9.]/g, '')); return isNaN(n) ? null : n; }
function truthy_(v) { return v === true || /^(true|yes|y|x|1)$/i.test(String(v).trim()); }
function iso_(v) { if (!v) return null; var d = v instanceof Date ? v : new Date(v); return isNaN(d) ? null : d.toISOString(); }
function parseJson_(v, dflt) { if (!v) return dflt; try { return JSON.parse(v); } catch (e) { return dflt; } }
