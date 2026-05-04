// ============================================================
// WO Progress Kiosk — Supabase → Google Sheets Backup
//
// SETUP (one time):
//   1. Create a new blank Google Sheet for your backup.
//   2. Copy the Sheet ID from its URL:
//        https://docs.google.com/spreadsheets/d/SHEET_ID_HERE/edit
//   3. In that Sheet: Extensions > Apps Script
//   4. Paste this entire file, replacing any default code.
//   5. Set SHEET_ID below to your Sheet ID.
//   6. Save, then from the Run menu run createTrigger() once.
//      Authorize when prompted (needs Sheets + external URL access).
//   7. Run backupAll() manually once to verify it works.
//
// After setup: runs automatically Mon–Fri at 12pm.
// Worst-case data age during normal ops: ~5 hours (Mon–Fri).
// Run backupAll() any time for an immediate refresh.
// ============================================================

var SUPABASE_URL = 'https://eqbybduwgzmbkbjyywgk.supabase.co';
var SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVxYnliZHV3Z3ptYmtianl5d2drIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyMDMwNzksImV4cCI6MjA4Nzc3OTA3OX0.j77BJ8LlRzCinGOSHuiCRX1M7KO1A687o9yQGwNXh8M';
var SHEET_ID = 'YOUR_GOOGLE_SHEET_ID_HERE'; // <-- replace this

var TV_DEPTS = 'Trac Vac Assy,TV Assy,TV. Assy,TV Assy.';
var TC_DEPTS = 'Tru Cut Assy,TC Assy,TC. Assy,TC Assy.';
var INVENTORY_PREFIXES = ['chute', 'hitch', 'engine', 'hardware', 'hoses'];

// Rolling window for high-volume archive tabs (Completed WOs, Open Orders - Shipped).
// Only rows newer than this many days are kept in the sheet.
// Increase if you need more history; decrease to keep the sheet lean.
var LOOKBACK_DAYS = 90;

// ── Value transforms ──────────────────────────────────────────

var STATUS_LABELS = {
  'not_started': 'Not Started',
  'started':     'In Progress',
  'resumed':     'In Progress',
  'paused':      'Paused',
  'on_hold':     'On Hold',
  'completed':   'Completed'
};

// Background colors for each status label (hex)
var STATUS_COLORS = {
  'In Progress': '#bbf7d0',
  'Paused':      '#fef08a',
  'On Hold':     '#fecaca',
  'Not Started': '#e2e8f0',
  'Completed':   '#bfdbfe'
};

function fmtStatus(v) { return STATUS_LABELS[v] || v || ''; }
function fmtDate(v)   { return v ? String(v).slice(0, 10) : ''; }
function fmtBool(v)   { return v === true ? 'Yes' : v === false ? 'No' : ''; }
function fmtMode(v)   { return v === 'unit' ? 'Unit' : v === 'stock' ? 'Subassy/Stock' : v || ''; }
function fmtDt(v)     { return v ? String(v).replace('T', ' ').slice(0, 16) : ''; }

// ── Tab definitions ───────────────────────────────────────────
//
// columns: array of { db, label, transform }
//   db        — column name in Supabase
//   label     — header shown in Sheets
//   transform — optional function applied to each cell value
//
// statusColLabel — label of the column to color-code, or null

var TABS = [

  // ── Fab WOs ───────────────────────────────────────────────────
  {
    name: 'Fab WOs',
    table: 'work_orders',
    query: 'department=eq.Fab&status=neq.completed&order=priority.desc,due_date.asc',
    statusColLabel: 'Status',
    columns: [
      { db: 'wo_number',     label: 'WO #' },
      { db: 'part_number',   label: 'Part #' },
      { db: 'description',   label: 'Description' },
      { db: 'qty_required',  label: 'Qty Required' },
      { db: 'qty_completed', label: 'Qty Done' },
      { db: 'status',        label: 'Status',      transform: fmtStatus },
      { db: 'operator',      label: 'Operator' },
      { db: 'priority',      label: 'Priority' },
      { db: 'due_date',      label: 'Due Date',    transform: fmtDate },
      { db: 'start_date',    label: 'Start Date',  transform: fmtDate },
      { db: 'notes',         label: 'Notes' },
      { db: 'fab_bring_to',  label: 'Bring To' },
      { db: 'sales_order',   label: 'Sales Order' }
    ]
  },

  // ── Weld WOs ──────────────────────────────────────────────────
  {
    name: 'Weld WOs',
    table: 'work_orders',
    query: 'department=eq.Weld&status=neq.completed&order=priority.desc,due_date.asc',
    statusColLabel: 'Status',
    columns: [
      { db: 'wo_number',          label: 'WO #' },
      { db: 'part_number',        label: 'Part #' },
      { db: 'description',        label: 'Description' },
      { db: 'qty_required',       label: 'Qty Required' },
      { db: 'qty_completed',      label: 'Qty Done' },
      { db: 'status',             label: 'Status',       transform: fmtStatus },
      { db: 'operator',           label: 'Operator' },
      { db: 'priority',           label: 'Priority' },
      { db: 'due_date',           label: 'Due Date',     transform: fmtDate },
      { db: 'start_date',         label: 'Start Date',   transform: fmtDate },
      { db: 'notes',              label: 'Notes' },
      { db: 'sales_order',        label: 'Sales Order' },
      { db: 'weld_reel_status',   label: 'Weld Status',  transform: fmtStatus },
      { db: 'weld_reel_operator', label: 'Weld Op' },
      { db: 'weld_reel_qty',      label: 'Weld Qty Done' },
      { db: 'grind_reel_status',  label: 'Grind Status', transform: fmtStatus },
      { db: 'grind_reel_operator',label: 'Grind Op' },
      { db: 'grind_reel_qty',     label: 'Grind Qty Done' }
    ]
  },

  // ── TV Assy WOs ───────────────────────────────────────────────
  {
    name: 'TV Assy WOs',
    table: 'work_orders',
    query: 'department=in.(' + TV_DEPTS + ')&status=neq.completed&order=priority.desc,due_date.asc',
    statusColLabel: 'Status',
    columns: [
      { db: 'wo_number',     label: 'WO #' },
      { db: 'part_number',   label: 'Part #' },
      { db: 'description',   label: 'Description' },
      { db: 'qty_required',  label: 'Qty Required' },
      { db: 'qty_completed', label: 'Qty Done' },
      { db: 'status',        label: 'Status',      transform: fmtStatus },
      { db: 'operator',      label: 'Operator' },
      { db: 'priority',      label: 'Priority' },
      { db: 'due_date',      label: 'Due Date',    transform: fmtDate },
      { db: 'start_date',    label: 'Start Date',  transform: fmtDate },
      { db: 'notes',         label: 'Notes' },
      { db: 'tv_assy_notes', label: 'TV Notes' },
      { db: 'sales_order',   label: 'Sales Order' }
    ]
  },

  // ── TC Assy WOs ───────────────────────────────────────────────
  {
    name: 'TC Assy WOs',
    table: 'work_orders',
    query: 'department=in.(' + TC_DEPTS + ')&status=neq.completed&order=priority.desc,due_date.asc',
    statusColLabel: 'Status',
    columns: [
      { db: 'wo_number',                      label: 'WO #' },
      { db: 'part_number',                    label: 'Part #' },
      { db: 'description',                    label: 'Description' },
      { db: 'tc_job_mode',                    label: 'Mode',           transform: fmtMode },
      { db: 'qty_required',                   label: 'Qty Required' },
      { db: 'qty_completed',                  label: 'Qty Done' },
      { db: 'status',                         label: 'Status',         transform: fmtStatus },
      { db: 'operator',                       label: 'Operator' },
      { db: 'priority',                       label: 'Priority' },
      { db: 'due_date',                       label: 'Due Date',       transform: fmtDate },
      { db: 'start_date',                     label: 'Start Date',     transform: fmtDate },
      { db: 'tc_pre_lap_status',              label: 'Pre-Lap Status', transform: fmtStatus },
      { db: 'tc_pre_lap_operator',            label: 'Pre-Lap Op' },
      { db: 'tc_final_status',                label: 'Final Status',   transform: fmtStatus },
      { db: 'tc_final_operator',              label: 'Final Op' },
      { db: 'unit_serial_number',             label: 'Serial #' },
      { db: 'engine',                         label: 'Engine' },
      { db: 'engine_serial_number',           label: 'Engine Serial' },
      { db: 'num_blades',                     label: 'Blades' },
      { db: 'tc_assy_notes_differences_mods', label: 'TC Notes' },
      { db: 'sales_order',                    label: 'Sales Order' }
    ]
  },

  // ── Open Orders — active (open_orders table) ──────────────────
  {
    name: 'Open Orders - Active',
    table: 'open_orders',
    query: 'order=sort_order.asc',
    statusColLabel: 'Status',
    columns: [
      { db: 'order_type',         label: 'Order Type' },
      { db: 'part_number',        label: 'Part #' },
      { db: 'to_ship',            label: 'To Ship' },
      { db: 'qty_pulled',         label: 'Qty Pulled' },
      { db: 'description',        label: 'Description' },
      { db: 'customer',           label: 'Customer' },
      { db: 'sales_order',        label: 'Sales Order' },
      { db: 'wo_po_number',       label: 'WO / PO #' },
      { db: 'status',             label: 'Status' },
      { db: 'last_status_update', label: 'Last Updated',  transform: fmtDate },
      { db: 'date_entered',       label: 'Date Entered',  transform: fmtDate },
      { db: 'deadline',           label: 'Deadline',      transform: fmtDate },
      { db: 'store_bin',          label: 'Store Bin' },
      { db: 'update_store_bin',   label: 'Holding Bin' },
      { db: 'wo_va_notes',        label: 'Notes' }
    ]
  },

  // ── WO Requests — pending / approved (excludes forecasted) ───
  {
    name: 'WO Requests - Active',
    table: 'wo_requests',
    query: 'status=in.(pending,approved)&forecasted=eq.false&order=request_date.asc,created_at.asc',
    statusColLabel: 'Status',
    columns: [
      { db: 'part_number',          label: 'Part #' },
      { db: 'description',          label: 'Description' },
      { db: 'sales_order_number',   label: 'Sales Order' },
      { db: 'qty_on_order',         label: 'Qty on Order' },
      { db: 'qty_in_stock',         label: 'Qty in Stock' },
      { db: 'qty_used_per_unit',    label: 'Qty / Unit' },
      { db: 'qty_to_make',          label: 'Qty to Make' },
      { db: 'request_date',         label: 'Request Date',   transform: fmtDate },
      { db: 'submitted_by',         label: 'Submitted By' },
      { db: 'status',               label: 'Status' },
      { db: 'fab',                  label: 'Fab?' },
      { db: 'weld',                 label: 'Weld Area' },
      { db: 'assy_wo',              label: 'Assy WO' },
      { db: 'date_to_start',        label: 'Date to Start',  transform: fmtDate },
      { db: 'alere_bin',            label: 'Alere Bin' },
      { db: 'where_used',           label: 'Where Used' },
      { db: 'estimated_lead_time',  label: 'Est. Lead Time' },
      { db: 'sent_to_production',   label: 'Sent to Prod',   transform: fmtBool }
    ]
  },

  // ── WO Requests — in production (WO created in Alere) ─────────
  {
    name: 'WO Requests - In Production',
    table: 'wo_requests',
    query: 'status=eq.in production&order=created_date.desc,created_at.desc',
    statusColLabel: null,
    columns: [
      { db: 'part_number',         label: 'Part #' },
      { db: 'description',         label: 'Description' },
      { db: 'alere_wo_number',     label: 'WO #' },
      { db: 'sales_order_number',  label: 'Sales Order' },
      { db: 'qty_to_make',         label: 'Qty to Make' },
      { db: 'fab',                 label: 'Fab?' },
      { db: 'weld',                label: 'Weld Area' },
      { db: 'assy_wo',             label: 'Assy WO' },
      { db: 'created_by_initials', label: 'Created By' },
      { db: 'created_date',        label: 'Created Date',  transform: fmtDate },
      { db: 'request_date',        label: 'Request Date',  transform: fmtDate }
    ]
  },

  // ── WO Forecasting — future-dated requests ────────────────────
  {
    name: 'WO Forecasting',
    table: 'wo_requests',
    query: 'forecasted=eq.true&order=forecast_date.asc,created_at.asc',
    statusColLabel: null,
    columns: [
      { db: 'part_number',        label: 'Part #' },
      { db: 'description',        label: 'Description' },
      { db: 'sales_order_number', label: 'Sales Order' },
      { db: 'qty_to_make',        label: 'Qty to Make' },
      { db: 'submitted_by',       label: 'Submitted By' },
      { db: 'request_date',       label: 'Request Date',   transform: fmtDate },
      { db: 'forecast_date',      label: 'Forecast Date',  transform: fmtDate },
      { db: 'forecast_reason',    label: 'Forecast Reason' }
    ]
  },

  // ── Office — WO Status Tracking ───────────────────────────────
  {
    name: 'WO Status Tracking',
    table: 'wo_status_tracking',
    query: 'order=created_at.desc',
    statusColLabel: 'ERP Status',
    columns: [
      { db: 'wo_number',    label: 'WO #' },
      { db: 'erp_status',   label: 'ERP Status' },
      { db: 'received_at',  label: 'Received At',  transform: fmtDate },
      { db: 'qty_received', label: 'Qty Received' },
      { db: 'closed_at',    label: 'Closed At',    transform: fmtDate }
    ]
  },

];

// ── Main entry point ──────────────────────────────────────────

function backupAll() {
  // Skip weekends — trigger fires daily at noon but we only want Mon–Fri
  var day = new Date().getDay(); // 0 = Sunday, 6 = Saturday
  if (day === 0 || day === 6) return;

  var ss = SpreadsheetApp.openById(SHEET_ID);
  var timestamp = new Date().toISOString();
  Logger.log('Backup started: ' + timestamp);

  // All defined tabs — select only the columns each tab needs to minimize bandwidth.
  // 600ms sleep between fetches keeps us under Apps Script's URL rate limiter.
  for (var i = 0; i < TABS.length; i++) {
    var tab = TABS[i];
    var dbCols = tab.columns.map(function(c) { return c.db; });
    var selectParam = 'select=' + dbCols.join(',');
    var rows = fetchAll(tab.table, selectParam + '&' + tab.query);
    writeTab(ss, tab.name, rows, tab.columns, tab.statusColLabel);
    Logger.log(tab.name + ': ' + rows.length + ' rows');
    Utilities.sleep(600);
  }

  // Rolling cutoff date for high-volume archive tabs
  var cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - LOOKBACK_DAYS);
  var cutoffStr = cutoff.toISOString().slice(0, 10); // YYYY-MM-DD

  // Completed WOs — last LOOKBACK_DAYS days only (comp_date filter)
  var completedCols = [
    { db: 'wo_number',                      label: 'WO #' },
    { db: 'part_number',                    label: 'Part #' },
    { db: 'description',                    label: 'Description' },
    { db: 'department',                     label: 'Dept' },
    { db: 'tc_job_mode',                    label: 'Mode',          transform: fmtMode },
    { db: 'qty_required',                   label: 'Qty Required' },
    { db: 'qty_completed',                  label: 'Qty Done' },
    { db: 'operator',                       label: 'Operator' },
    { db: 'start_date',                     label: 'Start Date',    transform: fmtDate },
    { db: 'comp_date',                      label: 'Completed Date',transform: fmtDate },
    { db: 'sales_order',                    label: 'Sales Order' },
    { db: 'notes',                          label: 'Notes' },
    { db: 'tv_assy_notes',                  label: 'TV Notes' },
    { db: 'tc_assy_notes_differences_mods', label: 'TC Notes' },
    { db: 'unit_serial_number',             label: 'Serial #' },
    { db: 'engine_serial_number',           label: 'Engine Serial' },
    { db: 'num_blades',                     label: 'Blades' }
  ];
  var completedSelect = 'select=' + completedCols.map(function(c) { return c.db; }).join(',');
  writeTab(ss, 'Completed WOs',
    fetchAll('completed_work_orders', completedSelect + '&comp_date=gte.' + cutoffStr + '&order=comp_date.desc'),
    completedCols, null
  );
  Logger.log('Completed WOs: last ' + LOOKBACK_DAYS + ' days (since ' + cutoffStr + ')');
  Utilities.sleep(600);

  // wo_time_sessions — last LOOKBACK_DAYS days (started_at filter)
  var sessionCols = [
    { db: 'wo_number',         label: 'WO #' },
    { db: 'department',        label: 'Dept' },
    { db: 'operator',          label: 'Operator' },
    { db: 'stage',             label: 'Stage' },
    { db: 'started_at',        label: 'Started At',       transform: fmtDt },
    { db: 'ended_at',          label: 'Ended At',         transform: fmtDt },
    { db: 'duration_minutes',  label: 'Duration (min)' },
    { db: 'qty_this_session',  label: 'Qty This Session' },
    { db: 'end_status',        label: 'End Status',       transform: fmtStatus }
  ];
  var sessionSelect = 'select=' + sessionCols.map(function(c) { return c.db; }).join(',');
  writeTab(ss, 'Time Sessions',
    fetchAll('wo_time_sessions', sessionSelect + '&started_at=gte.' + cutoffStr + '&order=started_at.desc'),
    sessionCols, 'End Status'
  );
  Logger.log('Time Sessions: last ' + LOOKBACK_DAYS + ' days (since ' + cutoffStr + ')');
  Utilities.sleep(600);

  // wo_unit_completions — last LOOKBACK_DAYS days (completed_at filter)
  var unitCompCols = [
    { db: 'wo_number',            label: 'WO #' },
    { db: 'department',           label: 'Dept' },
    { db: 'unit_number',          label: 'Unit #' },
    { db: 'unit_serial_number',   label: 'Serial #' },
    { db: 'engine_model',         label: 'Engine Model' },
    { db: 'engine_serial_number', label: 'Engine Serial' },
    { db: 'num_blades',           label: 'Blades' },
    { db: 'operator',             label: 'Operator' },
    { db: 'completed_at',         label: 'Completed At',  transform: fmtDt }
  ];
  var unitCompSelect = 'select=' + unitCompCols.map(function(c) { return c.db; }).join(',');
  writeTab(ss, 'Unit Completions',
    fetchAll('wo_unit_completions', unitCompSelect + '&completed_at=gte.' + cutoffStr + '&order=completed_at.desc'),
    unitCompCols, null
  );
  Logger.log('Unit Completions: last ' + LOOKBACK_DAYS + ' days (since ' + cutoffStr + ')');
  Utilities.sleep(600);

  // Open Orders - Shipped — last LOOKBACK_DAYS days only (shipped_at filter)
  var shippedCols = [
    { db: 'order_type',   label: 'Order Type' },
    { db: 'part_number',  label: 'Part #' },
    { db: 'to_ship',      label: 'To Ship' },
    { db: 'qty_pulled',   label: 'Qty Pulled' },
    { db: 'description',  label: 'Description' },
    { db: 'customer',     label: 'Customer' },
    { db: 'sales_order',  label: 'Sales Order' },
    { db: 'wo_po_number', label: 'WO / PO #' },
    { db: 'status',       label: 'Status' },
    { db: 'date_entered', label: 'Date Entered', transform: fmtDate },
    { db: 'shipped_at',   label: 'Shipped',      transform: fmtDate }
  ];
  var shippedSelect = 'select=' + shippedCols.map(function(c) { return c.db; }).join(',');
  writeTab(ss, 'Open Orders - Shipped',
    fetchAll('completed_orders', shippedSelect + '&shipped_at=gte.' + cutoffStr + '&order=shipped_at.desc'),
    shippedCols, null
  );
  Logger.log('Open Orders - Shipped: last ' + LOOKBACK_DAYS + ' days (since ' + cutoffStr + ')');
  Utilities.sleep(600);

  // Inventory — all 5 category tables merged (select only needed columns)
  var invCols = [
    { db: 'source_table',    label: 'Category' },
    { db: 'part_number',     label: 'Part #' },
    { db: 'description',     label: 'Description' },
    { db: 'qty',             label: 'Qty' },
    { db: 'location',        label: 'Location' },
    { db: 'refill_location', label: 'Refill Location' }
  ];
  var invSelect = 'select=' + invCols.filter(function(c) { return c.db !== 'source_table'; }).map(function(c) { return c.db; }).join(',');
  writeTab(ss, 'Inventory',
    fetchCombined(INVENTORY_PREFIXES, '_inventory', invSelect + '&order=part_number.asc'),
    invCols,
    null
  );

  // Pull History — all 5 pull-log tables merged (select only needed columns)
  var pullCols = [
    { db: 'source_table',  label: 'Category' },
    { db: 'name',          label: 'Pulled By' },
    { db: 'qty_pulled',    label: 'Qty Pulled' },
    { db: 'date_pulled',   label: 'Date Pulled', transform: fmtDate },
    { db: 'new_location',  label: 'New Location' },
    { db: 'where_used',    label: 'Where Used' }
  ];
  var pullSelect = 'select=' + pullCols.filter(function(c) { return c.db !== 'source_table'; }).map(function(c) { return c.db; }).join(',');
  writeTab(ss, 'Pull History',
    fetchCombined(INVENTORY_PREFIXES, '_pulls', pullSelect + '&order=created_at.desc'),
    pullCols,
    null
  );

  writeBackupInfo(ss, timestamp);
  Logger.log('Backup complete: ' + timestamp);
  // Total runtime with sleeps: ~8s overhead across 13 fetches — well within 6-min limit.
}

// ── Data fetching ─────────────────────────────────────────────

// fetchAll — pages through all rows using Supabase Range headers.
// Returns a flat array of plain row objects.
function fetchAll(table, query) {
  var rows = [];
  var pageSize = 1000;
  var start = 0;

  while (true) {
    var url = SUPABASE_URL + '/rest/v1/' + table + '?' + query;
    var resp = UrlFetchApp.fetch(url, {
      headers: {
        'apikey':        SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY,
        'Range':         start + '-' + (start + pageSize - 1),
        'Range-Unit':    'items'
      },
      muteHttpExceptions: true
    });

    var code = resp.getResponseCode();
    if (code !== 200 && code !== 206) {
      Logger.log('fetchAll HTTP ' + code + ' [' + table + ']: ' + resp.getContentText().slice(0, 200));
      break;
    }

    var batch = JSON.parse(resp.getContentText());
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (var i = 0; i < batch.length; i++) rows.push(batch[i]);
    if (batch.length < pageSize) break;
    start += pageSize;
  }

  return rows;
}

// fetchCombined — fetches rows from multiple tables (e.g. chute_inventory,
// hitch_inventory …) and merges them, adding a source_table column.
function fetchCombined(prefixes, suffix, query) {
  var all = [];
  for (var i = 0; i < prefixes.length; i++) {
    var rows = fetchAll(prefixes[i] + suffix, query);
    for (var j = 0; j < rows.length; j++) {
      rows[j].source_table = prefixes[i];
    }
    for (var k = 0; k < rows.length; k++) all.push(rows[k]);
  }
  return all;
}

// ── Sheet writing ─────────────────────────────────────────────

// writeTab — clears and rewrites one sheet tab.
// columns defines which DB fields to show and how to label/transform them.
// statusColLabel is the label of the column to color-code, or null.
function writeTab(ss, tabName, rows, columns, statusColLabel) {
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) {
    sheet = ss.insertSheet(tabName);
  } else {
    sheet.clearContents();
    sheet.clearConditionalFormatRules();
  }

  if (!rows || rows.length === 0) {
    sheet.getRange(1, 1).setValue('No data as of ' + new Date().toISOString());
    return;
  }

  // Build header row
  var headers = [];
  for (var c = 0; c < columns.length; c++) headers.push(columns[c].label);

  // Build data rows
  var data = new Array(rows.length + 1);
  data[0] = headers;
  for (var r = 0; r < rows.length; r++) {
    var rowArr = new Array(columns.length);
    for (var c = 0; c < columns.length; c++) {
      var raw = rows[r][columns[c].db];
      if (raw === null || raw === undefined) {
        rowArr[c] = '';
      } else if (columns[c].transform) {
        rowArr[c] = columns[c].transform(raw);
      } else if (typeof raw === 'object') {
        rowArr[c] = JSON.stringify(raw);
      } else {
        rowArr[c] = raw;
      }
    }
    data[r + 1] = rowArr;
  }

  sheet.getRange(1, 1, data.length, columns.length).setValues(data);

  // Bold + freeze header row
  var headerRange = sheet.getRange(1, 1, 1, columns.length);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#1e293b');
  headerRange.setFontColor('#ffffff');
  sheet.setFrozenRows(1);

  // Auto-resize columns, cap wide ones at 300px
  sheet.autoResizeColumns(1, columns.length);
  for (var col = 1; col <= columns.length; col++) {
    if (sheet.getColumnWidth(col) > 300) sheet.setColumnWidth(col, 300);
  }

  // Color-code the status column if specified
  if (statusColLabel) {
    var statusColIndex = headers.indexOf(statusColLabel) + 1; // 1-based
    if (statusColIndex > 0 && rows.length > 0) {
      applyStatusColors(sheet, statusColIndex, rows.length);
    }
  }
}

// applyStatusColors — adds conditional formatting rules to the status column.
function applyStatusColors(sheet, colIndex, numDataRows) {
  var range = sheet.getRange(2, colIndex, numDataRows, 1);
  var rules = [];
  var labels = Object.keys(STATUS_COLORS);
  for (var i = 0; i < labels.length; i++) {
    var label = labels[i];
    rules.push(
      SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo(label)
        .setBackground(STATUS_COLORS[label])
        .setRanges([range])
        .build()
    );
  }
  sheet.setConditionalFormatRules(rules);
}

// writeBackupInfo — stamps timestamp on a meta tab.
function writeBackupInfo(ss, timestamp) {
  var sheet = ss.getSheetByName('Backup Info');
  if (!sheet) sheet = ss.insertSheet('Backup Info');
  sheet.clearContents();

  var tabs = [];
  for (var i = 0; i < TABS.length; i++) tabs.push(TABS[i].name);
  tabs.push('Completed WOs', 'Time Sessions', 'Unit Completions', 'Open Orders - Shipped', 'Inventory', 'Pull History');

  sheet.getRange('A1').setValue('Last backup');
  sheet.getRange('B1').setValue(timestamp);
  sheet.getRange('A2').setValue('Schedule');
  sheet.getRange('B2').setValue('Mon–Fri at 12pm (set by createTrigger)');
  sheet.getRange('A3').setValue('Tabs');
  sheet.getRange('B3').setValue(tabs.join(', '));
  sheet.getRange('A4').setValue('Archive window');
  sheet.getRange('B4').setValue('Completed WOs and Open Orders - Shipped show last ' + LOOKBACK_DAYS + ' days only');
  sheet.getRange('A1:A3').setFontWeight('bold');
  sheet.autoResizeColumns(1, 2);
}

// ── Trigger setup ─────────────────────────────────────────────

// createTrigger — run ONCE from the Apps Script editor.
// Deletes any existing backupAll triggers first to avoid duplicates.
function createTrigger() {
  var existing = ScriptApp.getProjectTriggers();
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].getHandlerFunction() === 'backupAll') {
      ScriptApp.deleteTrigger(existing[i]);
    }
  }

  // Daily at noon — backupAll() skips Sat/Sun internally
  ScriptApp.newTrigger('backupAll')
    .timeBased()
    .everyDays(1)
    .atHour(12)
    .create();

  Logger.log('Trigger created: backupAll runs daily at noon, skips weekends.');
}
