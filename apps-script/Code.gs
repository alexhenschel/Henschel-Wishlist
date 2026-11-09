/**
 * Henschel Wish Book: back end for the public catalog page.
 *
 * Lives inside the "Henschel Wish Book" Google Sheet (Extensions > Apps Script).
 * Deploy > New deployment > Web app, Execute as: Me, Who has access: Anyone.
 *
 * GET  -> public list data: people, sizes, items, and the IDs of bought items.
 *         Buyer names, prices paid and stores never leave the Sheet.
 * POST -> {"action":"purchase", itemId, buyerName, pricePaid, retailer}
 *         Appends a row to the Purchases tab. To put an item back on the
 *         list, tick "Restored" on its Purchases row.
 */

var CACHE_KEY = 'public-v1';
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
  try { req = JSON.parse(e.postData.contents); } catch (err) { return out_(JSON.stringify({ ok: false, error: 'bad_request' })); }
  if (!req || req.action !== 'purchase') return out_(JSON.stringify({ ok: false, error: 'unknown_action' }));

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var items = readItems_();
    var item = items.filter(function (it) { return it.id === String(req.itemId || ''); })[0];
    if (!item) return out_(JSON.stringify({ ok: false, error: 'unknown_item' }));
    var paid = parseFloat(String(req.pricePaid || '').replace(/[^0-9.]/g, ''));
    sheet_('Purchases').appendRow([
      new Date(),
      item.id,
      item.name,
      item.personName,
      clean_(req.buyerName, 60),
      isNaN(paid) ? '' : paid,
      clean_(req.retailer, 80),
      false
    ]);
  } finally {
    lock.releaseLock();
  }
  CacheService.getScriptCache().remove(CACHE_KEY);
  return out_(JSON.stringify({ ok: true }));
}

/* ---------- reading the Sheet ---------- */

function buildPublic_() {
  var people = readPeople_();
  var items = readItems_().map(function (it) { delete it.personName; return it; });
  var bought = {};
  rows_('Purchases').forEach(function (r) {
    if (r['Item ID'] && !truthy_(r['Restored'])) bought[String(r['Item ID'])] = true;
  });
  var settings = {};
  rows_('Settings').forEach(function (r) { if (r['Key']) settings[String(r['Key'])] = r['Value']; });
  return {
    people: people,
    items: items,
    purchased: Object.keys(bought),
    meta: { lastRun: iso_(settings['last_price_check']), summary: String(settings['summary'] || '') }
  };
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
function slug_(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function clean_(s, n) { return String(s || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n); }
function num_(v) { if (v === '' || v === null) return null; var n = Number(String(v).replace(/[^0-9.]/g, '')); return isNaN(n) ? null : n; }
function truthy_(v) { return v === true || /^(true|yes|y|x|1)$/i.test(String(v).trim()); }
function iso_(v) { if (!v) return null; var d = v instanceof Date ? v : new Date(v); return isNaN(d) ? null : d.toISOString(); }
function parseJson_(v, dflt) { if (!v) return dflt; try { return JSON.parse(v); } catch (e) { return dflt; } }
