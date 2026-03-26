// ═══════════════════════════════════════════════════════════════
//  ZING Designer Performance Tracker — Google Apps Script Backend
//  Deploy as: Web App → Execute as: Me → Access: Anyone
// ═══════════════════════════════════════════════════════════════

const SMTP2GO_KEY  = 'api-AE40C393800A4987AC3448286D2031C2';
const FROM_EMAIL   = 'amy@zing-work.com';
const FROM_NAME    = 'Amy at ZING';

const SHEETS = { designers: 'Designers', entries: 'Entries' };

// ── ROUTING ────────────────────────────────────────────────────
function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, service: 'ZING Designer Tracker' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const body   = JSON.parse(e.postData.contents);
    const action = body.action;
    let result;
    if      (action === 'init')          result = handleInit();
    else if (action === 'getAll')        result = handleGetAll();
    else if (action === 'saveDesigner')  result = handleSaveDesigner(body);
    else if (action === 'saveEntry')     result = handleSaveEntry(body);
    else if (action === 'sendEmail')     result = handleSendEmail(body);
    else                                 result = { ok: false, err: 'Unknown action: ' + action };
    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, err: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ── SHEET HELPERS ──────────────────────────────────────────────
function getSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  return sh;
}

function sheetToObjects(sh, headers) {
  const data = sh.getDataRange().getValues();
  if (data.length <= 1) return [];
  return data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  });
}

function nextId(sh) {
  const data = sh.getDataRange().getValues();
  if (data.length <= 1) return 1;
  let max = 0;
  data.slice(1).forEach(row => { if (row[0] > max) max = row[0]; });
  return max + 1;
}

// ── INIT ────────────────────────────────────────────────────────
function handleInit() {
  const dSh = getSheet(SHEETS.designers);
  const eSh = getSheet(SHEETS.entries);

  // Set headers if empty
  if (dSh.getLastRow() === 0) {
    dSh.appendRow(['id', 'name', 'email', 'createdAt']);
  }
  if (eSh.getLastRow() === 0) {
    eSh.appendRow(['id', 'designerId', 'designerName', 'month', 'monthLabel',
      'assigned', 'published', 'cancelled', 'referrals', 'notes',
      'incentiveQualified', 'incentiveAmount', 'savedAt']);
  }

  // Seed Jorden and Tina if no designers exist
  const dData = dSh.getDataRange().getValues();
  if (dData.length <= 1) {
    const now = new Date().toISOString();
    dSh.appendRow([1, 'Jorden', '', now]);
    dSh.appendRow([2, 'Tina',   '', now]);
  }

  return { ok: true };
}

// ── GET ALL ─────────────────────────────────────────────────────
function handleGetAll() {
  // Ensure sheets + seed exist
  handleInit();

  const dSh = getSheet(SHEETS.designers);
  const eSh = getSheet(SHEETS.entries);

  const dHeaders = ['id', 'name', 'email', 'createdAt'];
  const eHeaders = ['id', 'designerId', 'designerName', 'month', 'monthLabel',
    'assigned', 'published', 'cancelled', 'referrals', 'notes',
    'incentiveQualified', 'incentiveAmount', 'savedAt'];

  const designers = sheetToObjects(dSh, dHeaders).map(d => ({
    id:        Number(d.id),
    name:      String(d.name || ''),
    email:     String(d.email || ''),
    createdAt: String(d.createdAt || '')
  }));

  const entries = sheetToObjects(eSh, eHeaders).map(e => ({
    id:                 Number(e.id),
    designerId:         Number(e.designerId),
    designerName:       String(e.designerName || ''),
    month:              String(e.month || ''),
    monthLabel:         String(e.monthLabel || ''),
    assigned:           Number(e.assigned  || 0),
    published:          Number(e.published || 0),
    cancelled:          Number(e.cancelled || 0),
    referrals:          Number(e.referrals || 0),
    notes:              String(e.notes || ''),
    incentiveQualified: e.incentiveQualified === true || e.incentiveQualified === 'TRUE',
    incentiveAmount:    Number(e.incentiveAmount || 0),
    savedAt:            String(e.savedAt || '')
  }));

  return { ok: true, designers, entries };
}

// ── SAVE DESIGNER ───────────────────────────────────────────────
function handleSaveDesigner(body) {
  const { name, email } = body;
  if (!name) return { ok: false, err: 'Missing name' };

  const sh   = getSheet(SHEETS.designers);
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const nameIdx  = headers.indexOf('name');
  const emailIdx = headers.indexOf('email');
  const idIdx    = headers.indexOf('id');

  // Find existing
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][nameIdx]).toLowerCase() === name.toLowerCase()) {
      if (email !== undefined) sh.getRange(i + 1, emailIdx + 1).setValue(email);
      return { ok: true, id: Number(data[i][idIdx]) };
    }
  }

  // New designer
  const id  = nextId(sh);
  const now = new Date().toISOString();
  sh.appendRow([id, name, email || '', now]);
  return { ok: true, id };
}

// ── SAVE ENTRY ──────────────────────────────────────────────────
function handleSaveEntry(body) {
  const { designerId, designerName, month, monthLabel,
          assigned, published, cancelled, referrals, notes, email } = body;

  if (!designerId || !month) return { ok: false, err: 'Missing designerId or month' };

  // Compute incentive
  const qualif  = assigned > 0 && published >= Math.ceil(assigned * 0.5);
  const incAmt  = qualif ? published * 10 : 0;
  const now     = new Date().toISOString();

  // Update designer email if provided
  if (email) {
    handleSaveDesigner({ name: designerName, email });
  }

  const sh      = getSheet(SHEETS.entries);
  const data    = sh.getDataRange().getValues();
  const headers = data[0];
  const didIdx  = headers.indexOf('designerId');
  const monIdx  = headers.indexOf('month');

  // Find existing entry for same designer+month
  for (let i = 1; i < data.length; i++) {
    if (Number(data[i][didIdx]) === Number(designerId) && String(data[i][monIdx]) === month) {
      // Overwrite row
      const id = Number(data[i][0]);
      sh.getRange(i + 1, 1, 1, 13).setValues([[
        id, designerId, designerName, month, monthLabel,
        assigned, published, cancelled, referrals, notes,
        qualif, incAmt, now
      ]]);
      return { ok: true, id };
    }
  }

  // New entry
  const id = nextId(sh);
  sh.appendRow([
    id, designerId, designerName, month, monthLabel,
    assigned, published, cancelled, referrals, notes,
    qualif, incAmt, now
  ]);
  return { ok: true, id };
}

// ── SEND EMAIL ──────────────────────────────────────────────────
function handleSendEmail(body) {
  const { to, subject, text } = body;
  if (!to || !subject || !text) return { ok: false, err: 'Missing to, subject, or text' };

  const payload = {
    api_key:   SMTP2GO_KEY,
    to:        [to],
    sender:    `${FROM_NAME} <${FROM_EMAIL}>`,
    subject:   subject,
    text_body: text
  };

  const res = UrlFetchApp.fetch('https://api.smtp2go.com/v3/email/send', {
    method:      'post',
    contentType: 'application/json',
    payload:     JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const json = JSON.parse(res.getContentText());
  Logger.log('SMTP2GO response: ' + JSON.stringify(json));

  if (json.data && json.data.succeeded > 0) {
    return { ok: true };
  }
  return { ok: false, err: json.data?.error || JSON.stringify(json).substring(0, 200) };
}
