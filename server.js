const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const csv = require("csv-parser");

// Create Express app
const app = express();
const port = process.env.PORT || 3000;

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, "uploads");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir);
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + "-" + file.originalname);
  },
});

const upload = multer({ storage: storage });

// Serve static files from the public directory
app.use(express.static("public"));
app.use(express.json());

// API routes
app.post("/api/upload-csv", upload.single("csvFile"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  const results = [];
  fs.createReadStream(req.file.path)
    .pipe(csv())
    .on("data", (data) => results.push(data))
    .on("end", () => {
      // Store the CSV data in a temporary file
      const dataFile = path.join(
        __dirname,
        "uploads",
        `data-${Date.now()}.json`
      );
      fs.writeFileSync(dataFile, JSON.stringify(results));

      res.json({
        success: true,
        message: "File uploaded successfully",
        dataFile: path.basename(dataFile),
        headers: results.length > 0 ? Object.keys(results[0]) : [],
        rowCount: results.length,
      });
    });
});

app.post("/api/generate-invoice", (req, res) => {
  try {
    const {
      dataFile,
      invoiceType,
      template,
      mappings,
      businessDetails,
      businessName,
    } = req.body;

    if (!dataFile) {
      return res.status(400).json({ error: "No data file specified" });
    }

    const dataPath = path.join(__dirname, "uploads", dataFile);
    if (!fs.existsSync(dataPath)) {
      return res.status(404).json({ error: "Data file not found" });
    }

    const csvData = JSON.parse(fs.readFileSync(dataPath, "utf8"));

    // Generate invoice HTML based on template and type
    let invoiceHTML;
    const invoiceNumber = `INV-${Date.now()}`;
    const invoiceDate = new Date().toISOString().split("T")[0];

    if (template === "minimal") {
      invoiceHTML = generateMinimalTemplate(
        csvData,
        mappings,
        businessDetails,
        invoiceType,
        invoiceNumber,
        invoiceDate,
        businessName
      );
    } else if (template === "professional") {
      invoiceHTML = generateProfessionalTemplate(
        csvData,
        mappings,
        businessDetails,
        invoiceType,
        invoiceNumber,
        invoiceDate,
        businessName
      );
    } else {
      invoiceHTML = generateDarkTemplate(
        csvData,
        mappings,
        businessDetails,
        invoiceType,
        invoiceNumber,
        invoiceDate,
        businessName
      );
    }

    // Add invoice number to CSV data
    const updatedData = csvData.map((row, index) => {
      return {
        ...row,
        invoice_number:
          invoiceType === "multiple"
            ? `${invoiceNumber}-${index + 1}`
            : invoiceNumber,
      };
    });

    // Save updated CSV data
    const updatedDataFile = path.join(
      __dirname,
      "uploads",
      `updated-${dataFile}`
    );
    fs.writeFileSync(updatedDataFile, JSON.stringify(updatedData));

    res.json({
      success: true,
      invoiceHTML: invoiceHTML,
      invoiceNumber: invoiceNumber,
      updatedDataFile: path.basename(updatedDataFile),
    });
  } catch (error) {
    console.error("Error generating invoice:", error);
    res.status(500).json({ error: "Failed to generate invoice" });
  }
});

app.get("/api/download-updated-csv", (req, res) => {
  const { dataFile } = req.query;

  if (!dataFile) {
    return res.status(400).json({ error: "No data file specified" });
  }

  const dataPath = path.join(__dirname, "uploads", dataFile);
  if (!fs.existsSync(dataPath)) {
    return res.status(404).json({ error: "Data file not found" });
  }

  const jsonData = JSON.parse(fs.readFileSync(dataPath, "utf8"));

  // Convert JSON back to CSV
  const headers = Object.keys(jsonData[0]);
  const csvContent = [
    headers.join(","),
    ...jsonData.map((row) =>
      headers
        .map((header) => {
          // Handle values with commas by wrapping in quotes
          const value = row[header] || "";
          return value.includes(",") ? `"${value}"` : value;
        })
        .join(",")
    ),
  ].join("\n");

  res.setHeader("Content-Type", "text/csv");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="updated-${path.basename(dataFile, ".json")}.csv"`
  );
  res.send(csvContent);
});

// Template generation functions
function generateMinimalTemplate(
  data,
  mappings,
  businessDetails,
  invoiceType,
  invoiceNumber,
  invoiceDate,
  businessName
) {
  const businessInfo = parseBusinessDetails(businessDetails);
  businessInfo.name = businessName || businessInfo.name;

  let lineItems = "";
  let total = 0;

  if (invoiceType === "single") {
    // Single invoice with all items
    data.forEach((row) => {
      let amount = parseFloat(row[mappings.amount]) || 0;
      const isNegative = amount < 0;
      const paymentStatus = isNegative ? "Paid" : "Pending";

      // Convert negative amounts to positive for display
      amount = Math.abs(amount);
      total += amount;

      lineItems += `
        <tr>
          <td>${row[mappings.date] || ""}</td>
          <td>${row[mappings.description] || ""}</td>
          <td>${row[mappings.reference] || ""}</td>
          <td>${
            isNegative ? '<span class="badge bg-success">Paid</span>' : ""
          }</td>
          <td class="text-end">${formatCurrency(amount)}</td>
        </tr>
      `;
    });
  } else {
    // Show first item only (for preview)
    const row = data[0];
    let amount = parseFloat(row[mappings.amount]) || 0;
    const isNegative = amount < 0;

    // Convert negative amounts to positive for display
    amount = Math.abs(amount);
    total = amount;

    lineItems = `
      <tr>
        <td>${row[mappings.date] || ""}</td>
        <td>${row[mappings.description] || ""}</td>
        <td>${row[mappings.reference] || ""}</td>
        <td>${
          isNegative ? '<span class="badge bg-success">Paid</span>' : ""
        }</td>
        <td class="text-end">${formatCurrency(amount)}</td>
      </tr>
      <tr>
        <td colspan="5" class="text-center text-muted">
          <em>Note: ${data.length - 1} more invoices will be generated</em>
        </td>
      </tr>
    `;
  }

  return `
    <div class="invoice-container">
      <div class="row mb-4">
        <div class="col-6">
          <h1 class="mb-1">INVOICE</h1>
          <h5 class="text-muted mb-4">#${invoiceNumber}</h5>
          <div class="business-info">
            ${
              businessInfo.name
                ? `<p class="mb-1"><strong>${businessInfo.name}</strong></p>`
                : ""
            }
            ${
              businessInfo.address
                ? `<p class="mb-1">${businessInfo.address}</p>`
                : ""
            }
            ${
              businessInfo.taxId
                ? `<p class="mb-1">Tax ID: ${businessInfo.taxId}</p>`
                : ""
            }
            ${
              businessInfo.phone
                ? `<p class="mb-1">Phone: ${businessInfo.phone}</p>`
                : ""
            }
            ${
              businessInfo.email
                ? `<p class="mb-1">Email: ${businessInfo.email}</p>`
                : ""
            }
          </div>
        </div>
        <div class="col-6 text-end">
          <p class="mb-1"><strong>Date:</strong> ${invoiceDate}</p>
          <p class="mb-1"><strong>Payment Status:</strong> Pending</p>
        </div>
      </div>
      
      <div class="row">
        <div class="col-12">
          <div class="card">
            <div class="card-body p-0">
              <table class="table mb-0">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Description</th>
                    <th>Reference</th>
                    <th>Status</th>
                    <th class="text-end">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  ${lineItems}
                </tbody>
                <tfoot>
                  <tr>
                    <td colspan="4" class="text-end"><strong>Total:</strong></td>
                    <td class="text-end"><strong>${formatCurrency(
                      total
                    )}</strong></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      </div>
      
      <div class="row mt-4">
        <div class="col-12">
          <p class="text-muted">Thank you for your business!</p>
        </div>
      </div>
    </div>
    
    <style>
      .invoice-container {
        font-family: 'Helvetica', Arial, sans-serif;
        color: #333;
        padding: 20px;
      }
      
      table {
        width: 100%;
        border-collapse: collapse;
      }
      
      table th, table td {
        padding: 12px 15px;
        border-bottom: 1px solid #ddd;
      }
      
      table thead th {
        background-color: #f8f9fa;
        border-bottom: 2px solid #ddd;
        text-align: left;
      }
      
      .text-end {
        text-align: right;
      }
      
      .text-center {
        text-align: center;
      }
      
      .text-muted {
        color: #6c757d;
      }
    </style>
  `;
}

function generateProfessionalTemplate(
  data,
  mappings,
  businessDetails,
  invoiceType,
  invoiceNumber,
  invoiceDate,
  businessName
) {
  const businessInfo = parseBusinessDetails(businessDetails);
  businessInfo.name = businessName || businessInfo.name;

  let lineItems = "";
  let total = 0;

  if (invoiceType === "single") {
    // Single invoice with all items
    data.forEach((row) => {
      const amount = parseFloat(row[mappings.amount]) || 0;
      total += amount;

      lineItems += `
        <tr>
          <td>${row[mappings.date] || ""}</td>
          <td>${row[mappings.description] || ""}</td>
          <td>${row[mappings.reference] || ""}</td>
          <td class="text-end">${formatCurrency(amount)}</td>
        </tr>
      `;
    });
  } else {
    // Show first item only (for preview)
    const row = data[0];
    const amount = parseFloat(row[mappings.amount]) || 0;
    total = amount;

    lineItems = `
      <tr>
        <td>${row[mappings.date] || ""}</td>
        <td>${row[mappings.description] || ""}</td>
        <td>${row[mappings.reference] || ""}</td>
        <td class="text-end">${formatCurrency(amount)}</td>
      </tr>
      <tr>
        <td colspan="4" class="text-center text-muted">
          <em>Note: ${data.length - 1} more invoices will be generated</em>
        </td>
      </tr>
    `;
  }

  return `
    <div class="invoice-container">
      <div class="invoice-header">
        <div class="row">
          <div class="col-6">
            <div class="company-name">${businessInfo.name}</div>
          </div>
          <div class="col-6 text-end">
            <h1>INVOICE</h1>
            <p class="invoice-id">#${invoiceNumber}</p>
          </div>
        </div>
      </div>
      
      <div class="row invoice-info">
        <div class="col-4">
          <h5>FROM:</h5>
          <div class="business-info">
            ${
              businessInfo.name
                ? `<p class="mb-1"><strong>${businessInfo.name}</strong></p>`
                : ""
            }
            ${
              businessInfo.address
                ? `<p class="mb-1">${businessInfo.address}</p>`
                : ""
            }
            ${
              businessInfo.taxId
                ? `<p class="mb-1">Tax ID: ${businessInfo.taxId}</p>`
                : ""
            }
            ${
              businessInfo.phone
                ? `<p class="mb-1">Phone: ${businessInfo.phone}</p>`
                : ""
            }
            ${
              businessInfo.email
                ? `<p class="mb-1">Email: ${businessInfo.email}</p>`
                : ""
            }
          </div>
        </div>
        <div class="col-4">
          <h5>TO:</h5>
          <p><strong>Multiple Customers</strong></p>
          <p>Statement of Transactions</p>
        </div>
        <div class="col-4 text-end">
          <h5>DETAILS:</h5>
          <p><strong>Invoice Date:</strong> ${invoiceDate}</p>
          <p><strong>Due Date:</strong> ${getDefaultDueDate(invoiceDate)}</p>
          <p><strong>Status:</strong> Pending</p>
        </div>
      </div>
      
      <div class="invoice-items">
        <table class="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Description</th>
              <th>Reference</th>
              <th class="text-end">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${lineItems}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="3" class="text-end"><strong>Subtotal:</strong></td>
              <td class="text-end">${formatCurrency(total)}</td>
            </tr>
            <tr>
              <td colspan="3" class="text-end"><strong>VAT (21%):</strong></td>
              <td class="text-end">${formatCurrency(total * 0.21)}</td>
            </tr>
            <tr class="total">
              <td colspan="3" class="text-end"><strong>TOTAL:</strong></td>
              <td class="text-end"><strong>${formatCurrency(
                total * 1.21
              )}</strong></td>
            </tr>
          </tfoot>
        </table>
      </div>
      
      <div class="invoice-footer">
        <p>Payment is due within 30 days. Thank you for your business.</p>
        <p class="small">This invoice was generated automatically and is valid without a signature.</p>
      </div>
    </div>
    
    <style>
      .invoice-container {
        font-family: 'Arial', sans-serif;
        color: #333;
        padding: 30px;
        max-width: 1000px;
        margin: 0 auto;
      }
      
      .logo {
        max-height: 50px;
        margin-bottom: 20px;
      }
      
      .invoice-header {
        margin-bottom: 40px;
      }
      
      .invoice-header h1 {
        color: #333;
        margin: 0;
        font-weight: 700;
      }
      
      .invoice-id {
        color: #777;
        font-size: 18px;
      }
      
      .invoice-info {
        margin-bottom: 40px;
      }
      
      .invoice-info h5 {
        color: #333;
        border-bottom: 1px solid #ddd;
        padding-bottom: 10px;
        margin-bottom: 15px;
      }
      
      .invoice-items {
        margin-bottom: 40px;
      }
      
      table {
        width: 100%;
        border-collapse: collapse;
      }
      
      table th, table td {
        padding: 12px 15px;
        border-bottom: 1px solid #ddd;
      }
      
      table thead th {
        background-color: #f8f9fa;
        border-bottom: 2px solid #ddd;
        text-align: left;
      }
      
      table tfoot tr {
        background-color: #f8f9fa;
      }
      
      table tfoot tr.total {
        background-color: #333;
        color: white;
      }
      
      .text-end {
        text-align: right;
      }
      
      .text-center {
        text-align: center;
      }
      
      .text-muted {
        color: #6c757d;
      }
      
      .invoice-footer {
        margin-top: 40px;
        text-align: center;
        color: #777;
        font-size: 14px;
      }
      
      .small {
        font-size: 12px;
        margin-top: 10px;
      }
      
      .row {
        display: flex;
        flex-wrap: wrap;
        margin-right: -15px;
        margin-left: -15px;
      }
      
      .col-4 {
        flex: 0 0 33.333333%;
        max-width: 33.333333%;
        padding-right: 15px;
        padding-left: 15px;
      }
      
      .col-6 {
        flex: 0 0 50%;
        max-width: 50%;
        padding-right: 15px;
        padding-left: 15px;
      }
      
      .col-12 {
        flex: 0 0 100%;
        max-width: 100%;
        padding-right: 15px;
        padding-left: 15px;
      }
    </style>
  `;
}

function generateDarkTemplate(
  data,
  mappings,
  businessDetails,
  invoiceType,
  invoiceNumber,
  invoiceDate,
  businessName
) {
  const businessInfo = parseBusinessDetails(businessDetails);
  businessInfo.name = businessName || businessInfo.name;

  let lineItems = "";
  let total = 0;

  if (invoiceType === "single") {
    // Single invoice with all items
    data.forEach((row) => {
      const amount = parseFloat(row[mappings.amount]) || 0;
      total += amount;

      lineItems += `
        <tr>
          <td>${row[mappings.date] || ""}</td>
          <td>${row[mappings.description] || ""}</td>
          <td>${row[mappings.reference] || ""}</td>
          <td class="text-end">${formatCurrency(amount)}</td>
        </tr>
      `;
    });
  } else {
    // Show first item only (for preview)
    const row = data[0];
    const amount = parseFloat(row[mappings.amount]) || 0;
    total = amount;

    lineItems = `
      <tr>
        <td>${row[mappings.date] || ""}</td>
        <td>${row[mappings.description] || ""}</td>
        <td>${row[mappings.reference] || ""}</td>
        <td class="text-end">${formatCurrency(amount)}</td>
      </tr>
      <tr>
        <td colspan="4" class="text-center text-muted">
          <em>Note: ${data.length - 1} more invoices will be generated</em>
        </td>
      </tr>
    `;
  }

  return `
    <div class="invoice-container">
      <div class="invoice-header">
        <div class="header-bar">
          <div class="row">
            <div class="col-6">
              <h2>${businessInfo.name}</h2>
            </div>
            <div class="col-6 text-end">
              <h1>INVOICE</h1>
              <p class="invoice-id">#${invoiceNumber}</p>
            </div>
          </div>
        </div>
      </div>
      
      <div class="invoice-body">
        <div class="row invoice-info">
          <div class="col-6">
            <h5>FROM:</h5>
            <div class="business-info">
              ${
                businessInfo.name
                  ? `<p class="mb-1"><strong>${businessInfo.name}</strong></p>`
                  : ""
              }
              ${
                businessInfo.address
                  ? `<p class="mb-1">${businessInfo.address}</p>`
                  : ""
              }
              ${
                businessInfo.taxId
                  ? `<p class="mb-1">Tax ID: ${businessInfo.taxId}</p>`
                  : ""
              }
              ${
                businessInfo.phone
                  ? `<p class="mb-1">Phone: ${businessInfo.phone}</p>`
                  : ""
              }
              ${
                businessInfo.email
                  ? `<p class="mb-1">Email: ${businessInfo.email}</p>`
                  : ""
              }
            </div>
          </div>
          <div class="col-6 text-end">
            <h5>DETAILS:</h5>
            <p><strong>Date:</strong> ${invoiceDate}</p>
            <p><strong>Status:</strong> Pending</p>
          </div>
        </div>
        
        <div class="invoice-items">
          <table class="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Reference</th>
                <th class="text-end">Amount</th>
              </tr>
            </thead>
            <tbody>
              ${lineItems}
            </tbody>
            <tfoot>
              <tr>
                <td colspan="3" class="text-end"><strong>Subtotal:</strong></td>
                <td class="text-end">${formatCurrency(total)}</td>
              </tr>
              <tr>
                <td colspan="3" class="text-end"><strong>VAT (21%):</strong></td>
                <td class="text-end">${formatCurrency(total * 0.21)}</td>
              </tr>
              <tr class="total">
                <td colspan="3" class="text-end"><strong>TOTAL:</strong></td>
                <td class="text-end"><strong>${formatCurrency(
                  total * 1.21
                )}</strong></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
      
      <div class="invoice-footer">
        <div class="footer-note">
          <p>Payment due within 30 days. Late payment may result in additional fees.</p>
        </div>
      </div>
    </div>
    
    <style>
      .invoice-container {
        font-family: 'Courier New', monospace;
        color: #333;
        background-color: white;
      }
      
      .invoice-header {
        margin-bottom: 30px;
      }
      
      .header-bar {
        background-color: #1a1a1a;
        color: white;
        padding: 20px;
      }
      
      .header-bar h1, .header-bar h2 {
        margin: 0;
        color: white;
      }
      
      .header-bar h2 {
        font-size: 1.2rem;
        letter-spacing: 2px;
      }
      
      .invoice-id {
        color: #999;
        margin: 5px 0 0;
      }
      
      .invoice-body {
        padding: 20px;
      }
      
      .invoice-info {
        margin-bottom: 30px;
      }
      
      .invoice-info h5 {
        color: #333;
        border-bottom: 1px solid #ddd;
        padding-bottom: 10px;
        margin-bottom: 15px;
      }
      
      table {
        width: 100%;
        border-collapse: collapse;
      }
      
      table th, table td {
        padding: 12px 15px;
        border-bottom: 1px solid #ddd;
      }
      
      table thead th {
        background-color: #1a1a1a;
        color: white;
        border-bottom: 2px solid #ddd;
        text-align: left;
      }
      
      table tfoot tr.total {
        background-color: #1a1a1a;
        color: white;
      }
      
      .invoice-footer {
        margin-top: 30px;
        background-color: #1a1a1a;
        color: white;
        padding: 15px 20px;
      }
      
      .footer-note {
        font-size: 12px;
      }
      
      .text-end {
        text-align: right;
      }
      
      .text-center {
        text-align: center;
      }
      
      .row {
        display: flex;
        flex-wrap: wrap;
      }
      
      .col-6 {
        flex: 0 0 50%;
        max-width: 50%;
      }
      
      .text-muted {
        color: #6c757d;
      }
    </style>
  `;
}

// Helper functions
function parseBusinessDetails(details) {
  const businessInfo = {
    name: "",
    address: "",
    taxId: "",
    phone: "",
    email: "",
  };

  if (!details) return businessInfo;

  const lines = details.split("\n");

  if (lines.length > 0) businessInfo.name = lines[0].trim();

  // Try to extract other information from the details
  lines.forEach((line) => {
    line = line.trim();
    if (
      line.toLowerCase().includes("tax") ||
      line.toLowerCase().includes("vat") ||
      line.toLowerCase().includes("btw")
    ) {
      businessInfo.taxId = line;
    } else if (line.match(/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/)) {
      businessInfo.email = line;
    } else if (line.match(/^\+?[0-9\s\-()]{8,}$/)) {
      businessInfo.phone = line;
    } else if (
      businessInfo.address === "" &&
      line !== businessInfo.name &&
      !businessInfo.taxId.includes(line) &&
      line !== ""
    ) {
      businessInfo.address = line;
    }
  });

  return businessInfo;
}

function formatCurrency(amount) {
  return (
    "€" +
    parseFloat(amount)
      .toFixed(2)
      .replace(/\d(?=(\d{3})+\.)/g, "$&,")
  );
}

function getDefaultDueDate(invoiceDate) {
  const date = new Date(invoiceDate);
  date.setDate(date.getDate() + 30);
  return date.toISOString().split("T")[0];
}

// Start server
app.listen(port, () => {
  console.log(`CSV2Invoice running at http://localhost:${port}`);
});
