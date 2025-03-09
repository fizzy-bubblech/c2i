document.addEventListener("DOMContentLoaded", function () {
  // DOM Elements - Step navigation
  const step1 = document.getElementById("step1");
  const step2 = document.getElementById("step2");
  const step3 = document.getElementById("step3");
  const step4 = document.getElementById("step4");

  // Buttons
  const step1Next = document.getElementById("step1Next");
  const step2Prev = document.getElementById("step2Prev");
  const step2Next = document.getElementById("step2Next");
  const step3Prev = document.getElementById("step3Prev");
  const step3Next = document.getElementById("step3Next");
  const step4Prev = document.getElementById("step4Prev");
  const generateBtn = document.getElementById("generateBtn");
  const downloadInvoiceBtn = document.getElementById("downloadInvoiceBtn");
  const downloadUpdatedCsvBtn = document.getElementById(
    "downloadUpdatedCsvBtn"
  );

  // Form inputs
  const businessDetails = document.getElementById("businessDetails");
  const csvFileInput = document.getElementById("csvFileInput");
  const fileInfo = document.getElementById("fileInfo");
  const mappingContainer = document.getElementById("mappingContainer");
  const invoicePreviewContainer = document.getElementById(
    "invoicePreviewContainer"
  );
  const invoicePreview = document.getElementById("invoicePreview");
  const statusDiv = document.getElementById("status");

  // State variables
  let csvData = [];
  let csvHeaders = [];
  let dataFile = null;
  let mappings = {};
  let updatedDataFile = null;
  let businessName = "";

  // Required invoice fields for mapping
  const requiredFields = [
    { id: "date", label: "Date", description: "Transaction date" },
    {
      id: "description",
      label: "Description",
      description: "Transaction description",
    },
    { id: "amount", label: "Amount", description: "Transaction amount" },
    {
      id: "reference",
      label: "Reference",
      description: "Transaction reference or ID",
    },
  ];

  // Navigation between steps
  step1Next.addEventListener("click", function () {
    const nameInput = document.getElementById("businessName");
    businessName = nameInput.value.trim();

    if (businessName === "") {
      showStatus("Please enter your business name", "error");
      return;
    }

    step1.style.display = "none";
    step2.style.display = "block";
  });

  step2Prev.addEventListener("click", function () {
    step2.style.display = "none";
    step1.style.display = "block";
  });

  step2Next.addEventListener("click", function () {
    step2.style.display = "none";
    step3.style.display = "block";
  });

  step3Prev.addEventListener("click", function () {
    step3.style.display = "none";
    step2.style.display = "block";
  });

  step3Next.addEventListener("click", function () {
    step3.style.display = "none";
    step4.style.display = "block";
    setupFieldMapping();
  });

  step4Prev.addEventListener("click", function () {
    step4.style.display = "none";
    step3.style.display = "block";
  });

  // CSV file handling
  csvFileInput.addEventListener("change", function (e) {
    const file = e.target.files[0];
    if (!file) {
      fileInfo.textContent = "";
      step2Next.disabled = true;
      return;
    }

    // Display file info
    fileInfo.innerHTML = `Processing: ${file.name} (${Math.round(
      file.size / 1024
    )} KB)`;

    // Parse CSV with PapaParse
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: function (results) {
        csvData = results.data;
        csvHeaders = results.meta.fields;

        // Upload CSV to server
        const formData = new FormData();
        formData.append("csvFile", file);

        fetch("/api/upload-csv", {
          method: "POST",
          body: formData,
        })
          .then((response) => response.json())
          .then((data) => {
            if (data.success) {
              dataFile = data.dataFile;
              fileInfo.innerHTML = `<strong>File loaded:</strong> ${data.rowCount} transactions found`;
              step2Next.disabled = false;
            } else {
              showStatus(`Error: ${data.error}`, "error");
            }
          })
          .catch((error) => {
            showStatus(`Error uploading file: ${error}`, "error");
          });
      },
      error: function (error) {
        showStatus(`Error parsing CSV: ${error.message}`, "error");
      },
    });
  });

  // Setup field mapping
  function setupFieldMapping() {
    mappingContainer.innerHTML = "";

    requiredFields.forEach((field) => {
      const fieldDiv = document.createElement("div");
      fieldDiv.className = "col-md-6";

      const mappingDiv = document.createElement("div");
      mappingDiv.className = "field-mapping";

      const label = document.createElement("label");
      label.setAttribute("for", `map-${field.id}`);
      label.textContent = field.label;

      const description = document.createElement("p");
      description.className = "option-desc";
      description.textContent = field.description;

      const select = document.createElement("select");
      select.className = "form-select";
      select.id = `map-${field.id}`;

      // Add default empty option
      const emptyOption = document.createElement("option");
      emptyOption.value = "";
      emptyOption.textContent = "-- Select CSV column --";
      select.appendChild(emptyOption);

      // Add options for each CSV header
      csvHeaders.forEach((header) => {
        const option = document.createElement("option");
        option.value = header;
        option.textContent = header;

        // Auto-select matching fields
        if (header.toLowerCase().includes(field.id.toLowerCase())) {
          option.selected = true;
          mappings[field.id] = header;
        }

        select.appendChild(option);
      });

      // Add event listener for selection change
      select.addEventListener("change", function () {
        mappings[field.id] = this.value;
      });

      mappingDiv.appendChild(label);
      mappingDiv.appendChild(description);
      mappingDiv.appendChild(select);
      fieldDiv.appendChild(mappingDiv);
      mappingContainer.appendChild(fieldDiv);
    });
  }

  // Generate invoice
  generateBtn.addEventListener("click", function () {
    // Check if all required fields are mapped
    const unmappedFields = requiredFields.filter(
      (field) => !mappings[field.id]
    );
    if (unmappedFields.length > 0) {
      showStatus(
        `Please map all required fields: ${unmappedFields
          .map((f) => f.label)
          .join(", ")}`,
        "error"
      );
      return;
    }

    // Get selected invoice type
    const invoiceType = document.querySelector(
      'input[name="invoiceType"]:checked'
    ).value;

    // Get selected template
    const template = document.querySelector(
      'input[name="templateChoice"]:checked'
    ).value;

    // Generate invoice
    generateInvoice(invoiceType, template, mappings);
  });

  function generateInvoice(invoiceType, template, mappings) {
    // Show loading state
    generateBtn.disabled = true;
    generateBtn.innerHTML =
      '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Generating...';

    // Call API to generate invoice
    fetch("/api/generate-invoice", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        dataFile: dataFile,
        invoiceType: invoiceType,
        template: template,
        mappings: mappings,
        businessDetails: businessDetails.value,
        businessName: businessName,
      }),
    })
      .then((response) => response.json())
      .then((data) => {
        if (data.success) {
          // Display invoice preview
          invoicePreview.innerHTML = data.invoiceHTML;
          invoicePreviewContainer.style.display = "block";

          // Store updated data file for download
          updatedDataFile = data.updatedDataFile;

          // Scroll to preview
          invoicePreviewContainer.scrollIntoView({ behavior: "smooth" });

          showStatus("Invoices generated successfully", "success");
        } else {
          showStatus(`Error: ${data.error}`, "error");
        }

        // Reset button state
        generateBtn.disabled = false;
        generateBtn.textContent = "Generate Invoices";
      })
      .catch((error) => {
        showStatus(`Error generating invoice: ${error}`, "error");
        generateBtn.disabled = false;
        generateBtn.textContent = "Generate Invoices";
      });
  }

  // Download updated CSV
  downloadUpdatedCsvBtn.addEventListener("click", function () {
    if (updatedDataFile) {
      window.location.href = `/api/download-updated-csv?dataFile=${updatedDataFile}`;
    }
  });

  // Download invoice as PDF
  downloadInvoiceBtn.addEventListener("click", function () {
    // Use html2canvas and jsPDF to generate PDF
    html2canvas(invoicePreview).then((canvas) => {
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jspdf.jsPDF();
      const imgProps = pdf.getImageProperties(imgData);
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;

      pdf.addImage(imgData, "PNG", 0, 0, pdfWidth, pdfHeight);
      pdf.save("invoice.pdf");
    });
  });

  // Utility function to show status messages
  function showStatus(message, type) {
    statusDiv.textContent = message;
    statusDiv.className = `status ${type}`;
    setTimeout(() => {
      statusDiv.style.display = "none";
      statusDiv.className = "status";
    }, 5000);
  }
});
