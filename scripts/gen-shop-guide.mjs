import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, LevelFormat, HeadingLevel, BorderStyle, WidthType,
  ShadingType, VerticalAlign, PageNumber, Header, Footer, PageBreak
} from "docx";
import fs from "fs";

const OUTPUT = "C:/Users/josiahk/Documents/WO-Progress-Kiosk/WO-Kiosk-Shop-Guide.docx";

// --- helpers ---
const HR_BORDER = { style: BorderStyle.SINGLE, size: 6, color: "CCCCCC" };
const CELL_BORDER = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };

function hr() {
  return new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC", space: 1 } },
    spacing: { before: 200, after: 200 },
    children: [],
  });
}

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 320, after: 120 },
    children: [new TextRun({ text, bold: true, size: 32, font: "Calibri", color: "1F3864" })],
  });
}

function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 200, after: 80 },
    children: [new TextRun({ text, bold: true, size: 26, font: "Calibri", color: "2E5496" })],
  });
}

function body(text, opts = {}) {
  return new Paragraph({
    spacing: { before: 60, after: 60 },
    children: [new TextRun({ text, size: 22, font: "Calibri", ...opts })],
  });
}

function label(text) {
  return new Paragraph({
    spacing: { before: 100, after: 40 },
    children: [new TextRun({ text, bold: true, size: 22, font: "Calibri", color: "333333" })],
  });
}

function numbered(text, level = 0) {
  return new Paragraph({
    numbering: { reference: "numbers", level },
    spacing: { before: 40, after: 40 },
    children: [new TextRun({ text, size: 22, font: "Calibri" })],
  });
}

function bullet(text, level = 0) {
  return new Paragraph({
    numbering: { reference: "bullets", level },
    spacing: { before: 40, after: 40 },
    children: [new TextRun({ text, size: 22, font: "Calibri" })],
  });
}

function bulletBold(boldPart, rest) {
  return new Paragraph({
    numbering: { reference: "bullets", level: 0 },
    spacing: { before: 40, after: 40 },
    children: [
      new TextRun({ text: boldPart, bold: true, size: 22, font: "Calibri" }),
      new TextRun({ text: rest, size: 22, font: "Calibri" }),
    ],
  });
}

function note(text) {
  return new Paragraph({
    spacing: { before: 80, after: 80 },
    indent: { left: 360 },
    children: [
      new TextRun({ text: "Note: ", bold: true, italics: true, size: 20, font: "Calibri", color: "555555" }),
      new TextRun({ text, italics: true, size: 20, font: "Calibri", color: "555555" }),
    ],
  });
}

function space(n = 1) {
  return Array.from({ length: n }, () => new Paragraph({ children: [] }));
}

// --- status flow table ---
function statusFlowTable() {
  const statuses = [
    { label: "REQUESTED", who: "Any operator or office staff" },
    { label: "APPROVED", who: "Manager" },
    { label: "CREATED", who: "Office staff (Create WO screen)" },
    { label: "STARTED", who: "Department operator (Fab, Weld, TV, TC)" },
    { label: "COMPLETED", who: "Department operator (Fab, Weld, TV, TC)" },
    { label: "RECEIVED", who: "Office staff (Inventory screen)" },
    { label: "CLOSED OUT", who: "Office staff (Inventory screen)" },
  ];

  const bgColors = ["D5E8F0", "D5E8F0", "D5E8F0", "D5F0D9", "D5F0D9", "FFF2CC", "E2EFDA"];

  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [2800, 6560],
    rows: [
      new TableRow({
        tableHeader: true,
        children: [
          new TableCell({
            width: { size: 2800, type: WidthType.DXA },
            shading: { fill: "1F3864", type: ShadingType.CLEAR },
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
            borders: { top: CELL_BORDER, bottom: CELL_BORDER, left: CELL_BORDER, right: CELL_BORDER },
            children: [new Paragraph({ children: [new TextRun({ text: "Status", bold: true, size: 22, font: "Calibri", color: "FFFFFF" })] })],
          }),
          new TableCell({
            width: { size: 6560, type: WidthType.DXA },
            shading: { fill: "1F3864", type: ShadingType.CLEAR },
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
            borders: { top: CELL_BORDER, bottom: CELL_BORDER, left: CELL_BORDER, right: CELL_BORDER },
            children: [new Paragraph({ children: [new TextRun({ text: "Who Handles This Step", bold: true, size: 22, font: "Calibri", color: "FFFFFF" })] })],
          }),
        ],
      }),
      ...statuses.map((s, i) =>
        new TableRow({
          children: [
            new TableCell({
              width: { size: 2800, type: WidthType.DXA },
              shading: { fill: bgColors[i], type: ShadingType.CLEAR },
              margins: { top: 80, bottom: 80, left: 120, right: 120 },
              borders: { top: CELL_BORDER, bottom: CELL_BORDER, left: CELL_BORDER, right: CELL_BORDER },
              children: [new Paragraph({ children: [new TextRun({ text: s.label, bold: true, size: 22, font: "Calibri" })] })],
            }),
            new TableCell({
              width: { size: 6560, type: WidthType.DXA },
              shading: { fill: bgColors[i], type: ShadingType.CLEAR },
              margins: { top: 80, bottom: 80, left: 120, right: 120 },
              borders: { top: CELL_BORDER, bottom: CELL_BORDER, left: CELL_BORDER, right: CELL_BORDER },
              children: [new Paragraph({ children: [new TextRun({ text: s.who, size: 22, font: "Calibri" })] })],
            }),
          ],
        })
      ),
    ],
  });
}

const doc = new Document({
  numbering: {
    config: [
      {
        reference: "bullets",
        levels: [
          { level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
          { level: 1, format: LevelFormat.BULLET, text: "\u25CB", alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 1080, hanging: 360 } } } },
        ],
      },
      {
        reference: "numbers",
        levels: [
          { level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
        ],
      },
    ],
  },
  styles: {
    default: { document: { run: { font: "Calibri", size: 22 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 32, bold: true, font: "Calibri", color: "1F3864" },
        paragraph: { spacing: { before: 320, after: 120 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 26, bold: true, font: "Calibri", color: "2E5496" },
        paragraph: { spacing: { before: 200, after: 80 }, outlineLevel: 1 } },
    ],
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 },
      },
    },
    headers: {
      default: new Header({
        children: [
          new Paragraph({
            border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC", space: 1 } },
            children: [
              new TextRun({ text: "WO Progress Kiosk  —  Shop Floor Guide", size: 18, font: "Calibri", color: "777777" }),
            ],
          }),
        ],
      }),
    },
    footers: {
      default: new Footer({
        children: [
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            border: { top: { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC", space: 1 } },
            children: [
              new TextRun({ text: "Page ", size: 18, font: "Calibri", color: "999999" }),
              new TextRun({ children: [PageNumber.CURRENT], size: 18, font: "Calibri", color: "999999" }),
              new TextRun({ text: " of ", size: 18, font: "Calibri", color: "999999" }),
              new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 18, font: "Calibri", color: "999999" }),
            ],
          }),
        ],
      }),
    },
    children: [
      // TITLE BLOCK
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 240, after: 80 },
        children: [new TextRun({ text: "WO Progress Kiosk", bold: true, size: 52, font: "Calibri", color: "1F3864" })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 60 },
        children: [new TextRun({ text: "Shop Floor Guide", bold: true, size: 40, font: "Calibri", color: "2E5496" })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 320 },
        children: [new TextRun({ text: "Quick Reference for All Departments", size: 24, font: "Calibri", color: "555555" })],
      }),

      hr(),

      // SECTION 1
      h1("1.  How to Log In"),
      numbered("Go to the kiosk. You will see the Login screen."),
      numbered("Enter your Username and Password, then tap Sign In."),
      numbered("After logging in, you will see the Main Menu with large category buttons."),

      hr(),

      // SECTION 2
      h1("2.  Navigating the Main Menu"),
      body("The Main Menu has these options:"),
      bulletBold("Production", " — for active work orders (Fab, Weld, TV Assy, TC Assy)"),
      bulletBold("Inventory", " — for receiving and closing out WOs (Office staff)"),
      bulletBold("Customer Service", " — to look up order status"),
      bulletBold("Management", " — for managers only"),
      ...space(1),
      body("To work on a WO:  tap  Production \u2192 Active WOs \u2192 then select your department.", { bold: false }),

      hr(),

      // SECTION 3
      h1("3.  How to Request a WO"),
      label("Who does this:"),
      body("Any operator or office staff who needs a new work order created."),
      label("Where to go:"),
      body("Main Menu \u2192 Production \u2192 Request WO"),
      ...space(1),
      numbered("Tap Production on the main menu."),
      numbered('Tap "Request WO."'),
      numbered("Fill in the form:"),
      bullet("Part Number (required)", 1),
      bullet("Description", 1),
      bullet("Sales Order Number (if you have it)", 1),
      bullet("Quantity on Order", 1),
      bullet("Quantity in Stock", 1),
      bullet("Qty Used Per Unit", 1),
      bullet("Your Name — Submitted By (required)", 1),
      numbered("Tap Submit."),
      numbered("The request goes to the manager for approval. You are done."),

      hr(),

      // SECTION 4
      h1("4.  How to Approve a WO  (Managers Only)"),
      label("Who does this:"),
      body("Managers only."),
      label("Where to go:"),
      body("Main Menu \u2192 Production \u2192 Request WO  (same screen, manager view)"),
      ...space(1),
      numbered("Log in with your manager credentials."),
      numbered('Tap "Production" \u2192 "Request WO."'),
      numbered("You will see a list of pending WO requests."),
      numbered("Tap a request to open it."),
      numbered("Review and fill in the approval fields:"),
      bullet("Alere WO Quantity", 1),
      bullet("Bin Location", 1),
      bullet("Which departments need to work on it (Fab, Weld, Assy — check all that apply)", 1),
      bullet("Estimated lead time and start date", 1),
      numbered('Tap "Approve."'),
      numbered("The approved WO moves to the Create WO queue for office staff."),

      hr(),

      // SECTION 5
      h1("5.  How to Create a WO into Production  (Office Staff)"),
      label("Who does this:"),
      body("Office staff only."),
      label("Where to go:"),
      body("Main Menu \u2192 Production \u2192 Create WO"),
      ...space(1),
      numbered('Tap "Production" \u2192 "Create WO."'),
      numbered("You will see the Pending tab — all approved WO requests waiting to be created."),
      numbered("Tap a request."),
      numbered("Enter:"),
      bullet("WO # (from Alere)", 1),
      bullet("Your Initials", 1),
      numbered('Tap "Confirm."'),
      numbered("The WO is now live and will appear on the department dashboards (Fab, Weld, Assy)."),
      ...space(1),
      note("The Created tab shows WOs already in production."),

      hr(),

      // SECTION 6
      h1("6.  How to Start and Work a WO  (Operators)"),
      label("Who does this:"),
      body("Fab, Weld, TV Assy, and TC Assy operators."),
      label("Where to go:"),
      body("Main Menu \u2192 Production \u2192 Active WOs \u2192 [Your Department]"),
      ...space(1),
      numbered('Tap "Production" \u2192 "Active WOs" \u2192 select your department.'),
      numbered("Find your WO on the board. WOs are grouped by status (New, Started, etc.)."),
      numbered("Tap the WO card to open the Action Panel."),
      numbered("Select your name from the Operator dropdown."),
      numbered('Tap "Start." The WO is now in progress.'),
      ...space(1),
      label("While working:"),
      bullet("Tap the WO again to log qty completed or to pause."),
      bullet('If you need to stop temporarily: tap "Pause" and select a reason (e.g., Waiting for Material).'),
      bullet('To put a WO on hold: tap "On Hold" and enter a reason.'),
      ...space(1),
      label("When you are done:"),
      bullet("Enter the quantity you completed."),
      bullet('Tap "Complete."'),
      bullet("The WO moves to Completed status and goes to Office for receiving."),
      ...space(1),
      note("TV Assy (Trac Vac) has three stages: Engine, Cart, Final. Complete Engine and Cart first — Final unlocks after both are done."),
      note("TC Assy (Tru Cut) has step-by-step assembly stages. Complete each stage in order."),

      hr(),

      // SECTION 7
      h1("7.  How to Receive a Completed WO  (Office Staff)"),
      label("Who does this:"),
      body("Office staff only."),
      label("Where to go:"),
      body("Main Menu \u2192 Inventory \u2192 WO Receive & Close Out"),
      ...space(1),
      numbered('Tap "Inventory" on the main menu.'),
      numbered('Tap "WO Receive & Close Out."'),
      numbered("You will see the Receiving tab with all WOs marked Completed."),
      numbered("Find the WO — search by WO#, Part#, or Sales Order#."),
      numbered("Tap the WO."),
      numbered("Enter:"),
      bullet("Your Name (Receiver)", 1),
      bullet("Qty Received (defaults to qty completed)", 1),
      bullet("Bin Location (optional)", 1),
      numbered('Tap "Receive."'),
      numbered("Status changes to Received."),

      hr(),

      // SECTION 8
      h1("8.  How to Close Out a WO  (Office Staff)"),
      label("Who does this:"),
      body("Office staff only."),
      label("Where to go:"),
      body("Main Menu \u2192 Inventory \u2192 WO Receive & Close Out  (Close-Out tab)"),
      ...space(1),
      numbered('Tap the "Close-Out" tab.'),
      numbered("Find the WO in the list of Received WOs."),
      numbered("Add any notes in the Notes column (optional but recommended)."),
      numbered('Tap "Close Out."'),
      numbered("Enter your name."),
      numbered("Tap Confirm."),
      numbered("The WO is now fully closed. Find it later in the Closed Out WOs history tab."),

      hr(),

      // SECTION 9
      h1("9.  WO Status Flow \u2014 At a Glance"),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 160, after: 160 },
        children: [
          new TextRun({ text: "REQUESTED  \u2192  APPROVED  \u2192  CREATED  \u2192  STARTED  \u2192  COMPLETED  \u2192  RECEIVED  \u2192  CLOSED OUT", bold: true, size: 20, font: "Calibri", color: "1F3864" }),
        ],
      }),
      ...space(1),
      statusFlowTable(),

      hr(),

      // SECTION 10
      h1("10.  Looking Up an Order  (Customer Service)"),
      label("Who does this:"),
      body("CS staff or anyone checking order status."),
      label("Where to go:"),
      body("Main Menu \u2192 Customer Service"),
      ...space(1),
      numbered('Tap "Customer Service."'),
      numbered("Search by WO#, Sales Order#, or Part#."),
      numbered("View the timeline showing which stages are done and what is still in progress."),
    ],
  }],
});

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(OUTPUT, buf);
  console.log("Written:", OUTPUT);
});
