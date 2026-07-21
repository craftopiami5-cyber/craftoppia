// Token verify
const token = localStorage.getItem("admin_token");
if (!token) {
  window.location.href = "/";
}

// State Variables
let activeTab = 'submissions';
let currentPage = 1;
let currentLimit = 10;
let currentStatus = 'all';
let currentSearch = '';
let declineTargetId = null;

// Switch Main Tabs
function switchMainTab(tab) {
  activeTab = tab;

  // Update tab buttons class
  document.querySelectorAll(".tab-btn").forEach(btn => btn.classList.remove("active"));
  document.querySelectorAll(".tab-section").forEach(sec => sec.classList.remove("active"));
  
  if (tab === 'submissions') {
    document.getElementById("tabBtnSubmissions").classList.add("active");
    document.getElementById("sectionSubmissions").classList.add("active");
    fetchRegistrations();
  } else if (tab === 'referrals') {
    document.getElementById("tabBtnReferrals").classList.add("active");
    document.getElementById("sectionReferrals").classList.add("active");
    fetchReferrers();
  } else if (tab === 'broadcaster') {
    document.getElementById("tabBtnBroadcaster").classList.add("active");
    document.getElementById("sectionBroadcaster").classList.add("active");
  } else if (tab === 'quizBuilder') {
    document.getElementById("tabBtnQuizBuilder").classList.add("active");
    document.getElementById("sectionQuizBuilder").classList.add("active");
    fetchQuestions();
  } else if (tab === 'translations') {
    document.getElementById("tabBtnTranslations").classList.add("active");
    document.getElementById("sectionTranslations").classList.add("active");
    initTranslationsTab();
  } else if (tab === 'settings') {
    document.getElementById("tabBtnSettings").classList.add("active");
    document.getElementById("sectionSettings").classList.add("active");
    loadPaymentSettings();
  }
}

// Fetch Registrations (Submissions tab)
async function fetchRegistrations() {
  const statusText = document.getElementById("statusText");
  statusText.textContent = "Syncing...";
  
  const params = new URLSearchParams({
    page: currentPage,
    limit: currentLimit,
    status: currentStatus
  });
  if (currentSearch) params.append("search", currentSearch);
  
  try {
    const response = await fetch(`/api/registrations?${params.toString()}`, {
      headers: { "Authorization": `Bearer ${token}` }
    });
    
    if (response.status === 401) { logout(); return; }
    
    if (response.ok) {
      const result = await response.json();
      renderStatsCounts();
      renderTable(result.data, result.total);
      statusText.textContent = "Live synced";
    } else {
      statusText.textContent = "Sync error";
    }
  } catch (err) {
    console.error(err);
    statusText.textContent = "Connection error";
  }
}

// Render Stats Quick Counts
async function renderStatsCounts() {
  try {
    const response = await fetch(`/api/registrations?page=1&limit=9999`, {
      headers: { "Authorization": `Bearer ${token}` }
    });
    if (response.ok) {
      const result = await response.json();
      const list = result.data || [];
      
      const counts = {
        total: result.total || list.length,
        pending: list.filter(r => r.status === 'pending').length,
        approved: list.filter(r => r.status === 'approved').length,
        declined: list.filter(r => r.status === 'declined').length
      };
      
      document.getElementById("countTotal").textContent = counts.total;
      document.getElementById("countPending").textContent = counts.pending;
      document.getElementById("countApproved").textContent = counts.approved;
      document.getElementById("countDeclined").textContent = counts.declined;
    }
  } catch (err) {
    console.error(err);
  }
}

// Render registrations table
function renderTable(regs, totalCount) {
  const tbody = document.getElementById("registrationsBody");
  
  if (!regs || regs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="no-data">No registrations found.</td></tr>`;
    updatePaginationInfo(0, 0, 0);
    return;
  }
  
  tbody.innerHTML = regs.map(reg => {
    const date = new Date(reg.created_at).toLocaleString();
    const referredByHtml = reg.referred_by_name ? `<b>${escapeHtml(reg.referred_by_name)}</b>` : `-`;
    
    let detailsHtml = "-";
    if (reg.status === 'approved' && reg.invite_link) {
      const links = reg.invite_link.trim().split(/\s+/);
      const mainLink = links[0] || null;
      const groupLink = links[1] || null;
      detailsHtml = `<div class="invite-link-wrapper" style="display:flex;flex-direction:column;gap:4px;">
        ${mainLink ? `<a href="${mainLink}" class="invite-link" target="_blank">📢 Main Channel</a>` : ''}
        ${groupLink ? `<a href="${groupLink}" class="invite-link" target="_blank" style="background:rgba(99,102,241,0.15);color:#a5b4fc;">👥 Private Group</a>` : ''}
      </div>`;
    } else if (reg.status === 'declined' && reg.rejection_reason) {
      detailsHtml = `<span style="font-size:12px; color:var(--text-muted); font-style:italic;" title="${escapeHtml(reg.rejection_reason)}">${escapeHtml(reg.rejection_reason)}</span>`;
    }

    
    let actionsHtml = "-";
    if (reg.status === 'pending') {
      actionsHtml = `
        <div class="btn-group">
          <button class="btn-action btn-approve" onclick="approveRegistration('${reg.id}', this)">Approve</button>
          <button class="btn-action btn-decline" onclick="openDeclineModal('${reg.id}')">Decline</button>
        </div>
      `;
    } else if (reg.status === 'declined') {
      actionsHtml = `
        <div class="btn-group">
          <button class="btn-action btn-approve" onclick="approveRegistration('${reg.id}', this)">Approve</button>
        </div>
      `;
    }
    
    let receiptHtml = `<code>${escapeHtml(reg.receipt_number || '-')}</code>`;
    if (reg.receipt_image_url) {
      if (reg.receipt_image_url.startsWith('http')) {
        receiptHtml += `
          <div style="margin-top: 6px;">
            <a href="${reg.receipt_image_url}" target="_blank">
              <img src="${reg.receipt_image_url}" alt="Receipt" style="width: 48px; height: 48px; object-fit: cover; border-radius: 6px; border: 1px solid var(--card-border); cursor: pointer; transition: transform 0.2s;" onmouseover="this.style.transform='scale(1.15)'" onmouseout="this.style.transform='scale(1)'">
            </a>
          </div>
        `;
      } else {
        const adminToken = localStorage.getItem('admin_token') || '';
        const proxyUrl = `/api/admin/photo/${encodeURIComponent(reg.receipt_image_url)}${adminToken ? `?token=${adminToken}` : ''}`;
        receiptHtml += `
          <div style="margin-top: 6px;">
            <a href="${proxyUrl}" target="_blank">
              <img src="${proxyUrl}" alt="Receipt" style="width: 48px; height: 48px; object-fit: cover; border-radius: 6px; border: 1px solid var(--card-border); cursor: pointer; transition: transform 0.2s;" onmouseover="this.style.transform='scale(1.15)'" onmouseout="this.style.transform='scale(1)'">
            </a>
          </div>
        `;
      }
    }

    return `
      <tr>
        <td>${date}</td>
        <td><b>${escapeHtml(reg.name || '-')}</b></td>
        <td><b>${escapeHtml(reg.name2 || '-')}</b></td>
        <td>${escapeHtml(reg.phone || '-')}</td>
        <td>${receiptHtml}</td>
        <td>${referredByHtml}</td>
        <td>
          <span class="status-badge badge-${reg.status}">${reg.status}</span>
        </td>
        <td>${detailsHtml}</td>
        <td>${actionsHtml}</td>
      </tr>
    `;
  }).join('');

  const startIdx = (currentPage - 1) * currentLimit + 1;
  const endIdx = Math.min(currentPage * currentLimit, totalCount);
  updatePaginationInfo(startIdx, endIdx, totalCount);
}

function updatePaginationInfo(start, end, total) {
  const info = document.getElementById("paginationInfo");
  info.textContent = total > 0 ? `Showing ${start} to ${end} of ${total} entries` : `Showing 0 to 0 of 0 entries`;
  
  document.getElementById("btnPrev").disabled = currentPage === 1;
  document.getElementById("btnNext").disabled = end >= total || total === 0;
  document.getElementById("pageIndicator").textContent = `Page ${currentPage}`;
}

function selectStatusFilter(status) {
  document.querySelectorAll(".stat-card").forEach(c => c.classList.remove("active"));
  
  if (status === 'all') document.getElementById("statCardAll").classList.add("active");
  else if (status === 'pending') document.getElementById("statCardPending").classList.add("active");
  else if (status === 'approved') document.getElementById("statCardApproved").classList.add("active");
  else if (status === 'declined') document.getElementById("statCardDeclined").classList.add("active");
  
  currentStatus = status;
  currentPage = 1;
  fetchRegistrations();
}

let searchTimeout = null;
function handleSearch() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    currentSearch = document.getElementById("searchInput").value;
    currentPage = 1;
    fetchRegistrations();
  }, 300);
}

function changePage(direction) {
  currentPage += direction;
  fetchRegistrations();
}

// Approve Callback
async function approveRegistration(id, btnElement) {
  const btnGroup = btnElement.closest(".btn-group");
  const buttons = btnGroup.querySelectorAll("button");
  buttons.forEach(btn => btn.disabled = true);
  
  try {
    const response = await fetch("/api/approve", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ id })
    });
    
    if (response.ok) {
      fetchRegistrations();
    } else {
      const data = await response.json();
      alert(`Error: ${data.message || "Failed to approve."}`);
      buttons.forEach(btn => btn.disabled = false);
    }
  } catch (err) {
    console.error(err);
    alert("Network error.");
    buttons.forEach(btn => btn.disabled = false);
  }
}

// Rejection Modal Callback
function openDeclineModal(id) {
  declineTargetId = id;
  document.getElementById("declineReasonInput").value = "";
  document.getElementById("declineModal").classList.add("active");
}

function closeDeclineModal() {
  declineTargetId = null;
  document.getElementById("declineModal").classList.remove("active");
}

document.getElementById("confirmDeclineBtn").addEventListener("click", async () => {
  if (!declineTargetId) return;
  const reasonInput = document.getElementById("declineReasonInput");
  const reason = reasonInput.value.trim() || "Details do not match our records.";
  
  const confirmBtn = document.getElementById("confirmDeclineBtn");
  confirmBtn.disabled = true;
  
  try {
    const response = await fetch("/api/decline", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ id: declineTargetId, reason })
    });
    
    if (response.ok) {
      closeDeclineModal();
      fetchRegistrations();
    } else {
      const data = await response.json();
      alert(`Error: ${data.message || "Failed to decline."}`);
    }
  } catch (err) {
    console.error(err);
    alert("Network error.");
  } finally {
    confirmBtn.disabled = false;
  }
});

async function loadPaymentSettings() {
  try {
    const response = await fetch("/api/admin/settings", {
      headers: { "Authorization": "Bearer " + token }
    });
    if(response.ok) {
      const data = await response.json();
      document.getElementById('setAmount').value = data.amount || '';
      document.getElementById('setChannelId').value = data.telegram_channel_id || '';
      document.getElementById('setAccessDuration').value = data.access_duration_days || '30';
      document.getElementById('setTelebirrName').value = data.telebirr_name || '';
      document.getElementById('setTelebirrNumber').value = data.telebirr_number || '';
      document.getElementById('setCbeName').value = data.cbe_name || '';
      document.getElementById('setCbeNumber').value = data.cbe_number || '';
      
      document.getElementById('setCertProgramEn').value = data.cert_program_en || 'Hand Craft & Art';
      document.getElementById('setCertProgramAm').value = data.cert_program_am || 'የእጅ ሥራና ጥበብ ስልጠና';
      document.getElementById('setCertDurationEn').value = data.cert_duration_en || '4 Weeks';
      document.getElementById('setCertDurationAm').value = data.cert_duration_am || '4 ሳምንት';
      
      const sigPreview = document.getElementById('signaturePreview');
      const sigNoText = document.getElementById('noSignatureText');
      if (data.signature_base64) {
        sigPreview.src = data.signature_base64;
        sigPreview.style.display = 'block';
        sigNoText.style.display = 'none';
      } else {
        sigPreview.style.display = 'none';
        sigNoText.style.display = 'block';
      }

      const sealPreview = document.getElementById('sealPreview');
      const sealNoText = document.getElementById('noSealText');
      if (data.seal_base64) {
        sealPreview.src = data.seal_base64;
        sealPreview.style.display = 'block';
        sealNoText.style.display = 'none';
      } else {
        sealPreview.style.display = 'none';
        sealNoText.style.display = 'block';
      }
    }
  } catch(e) {
    console.error("Error loading settings:", e);
  }
}

document.getElementById('paymentSettingsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const sigPreviewSrc = document.getElementById('signaturePreview').src;
  const sealPreviewSrc = document.getElementById('sealPreview').src;
  const payload = {
    amount: document.getElementById('setAmount').value,
    telegram_channel_id: document.getElementById('setChannelId').value,
    access_duration_days: document.getElementById('setAccessDuration').value,
    telebirr_name: document.getElementById('setTelebirrName').value,
    telebirr_number: document.getElementById('setTelebirrNumber').value,
    cbe_name: document.getElementById('setCbeName').value,
    cbe_number: document.getElementById('setCbeNumber').value,
    cert_program_en: document.getElementById('setCertProgramEn').value,
    cert_program_am: document.getElementById('setCertProgramAm').value,
    cert_duration_en: document.getElementById('setCertDurationEn').value,
    cert_duration_am: document.getElementById('setCertDurationAm').value,
    signature_base64: sigPreviewSrc && sigPreviewSrc.startsWith('data:') ? sigPreviewSrc : (sigPreviewSrc || null),
    seal_base64: sealPreviewSrc && sealPreviewSrc.startsWith('data:') ? sealPreviewSrc : (sealPreviewSrc || null)
  };
  try {
    const res = await fetch("/api/admin/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
      body: JSON.stringify(payload)
    });
    if(res.ok) {
      alert("Payment & Certificate settings saved successfully!");
    } else {
      alert("Failed to save settings.");
    }
  } catch(e) {
    alert("Error saving settings.");
  }
});

// Fetch Referrers Data (Users & Referrals Tab)
async function fetchReferrers() {
  const tbody = document.getElementById("referralsBody");
  tbody.innerHTML = `<tr><td colspan="5" class="no-data">Loading referrers summary...</td></tr>`;
  
  try {
    const response = await fetch("/api/referrers", {
      headers: { "Authorization": `Bearer ${token}` }
    });
    
    if (response.status === 401) { logout(); return; }
    
    if (response.ok) {
      const list = await response.json();
      renderReferralsTable(list);
    } else {
      tbody.innerHTML = `<tr><td colspan="5" class="no-data">Error loading referrers data.</td></tr>`;
    }
  } catch (err) {
    console.error(err);
    tbody.innerHTML = `<tr><td colspan="5" class="no-data">Connection error loading referrers.</td></tr>`;
  }
}

// Render Referrers Table
function renderReferralsTable(list) {
  const tbody = document.getElementById("referralsBody");
  
  if (!list || list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="no-data">No referrers found in the database.</td></tr>`;
    return;
  }
  
  tbody.innerHTML = list.map(user => {
    const total = user.total_referred || 0;
    const approved = user.approved_referred || 0;
    
    const totalBadge = `<span class="ref-badge">${total} referred</span>`;
    const approvedBadge = `<span class="status-badge badge-approved">${approved} approved</span>`;
    
    return `
      <tr>
        <td><b>${escapeHtml(user.name || '-')}</b></td>
        <td><code>${user.chat_id}</code></td>
        <td>${escapeHtml(user.phone || '-')}</td>
        <td>${totalBadge}</td>
        <td>${approvedBadge}</td>
      </tr>
    `;
  }).join('');
}

// Broadcaster Media Files handler
function handleFileSelect(event) {
  const file = event.target.files[0];
  const dropText = document.getElementById("dropText");
  const imgPrev = document.getElementById("imagePreview");
  const vidPrev = document.getElementById("videoPreview");
  const fileInfo = document.getElementById("fileInfo");
  
  imgPrev.style.display = "none";
  vidPrev.style.display = "none";
  fileInfo.style.display = "none";
  
  if (!file) {
    dropText.textContent = "Drag and drop file here, or click to browse";
    return;
  }
  
  dropText.textContent = `File selected: ${file.name}`;
  fileInfo.textContent = `Type: ${file.type} | Size: ${(file.size / (1024 * 1024)).toFixed(2)} MB`;
  fileInfo.style.display = "block";
  
  const reader = new FileReader();
  reader.onload = function(e) {
    if (file.type.startsWith("image/")) {
      imgPrev.src = e.target.result;
      imgPrev.style.display = "block";
    } else if (file.type.startsWith("video/")) {
      vidPrev.src = e.target.result;
      vidPrev.style.display = "block";
    }
  }
  reader.readAsDataURL(file);
}

// Broadcast form submit handler
document.getElementById("broadcastForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  
  const textVal = document.getElementById("broadcastText").value.trim();
  const fileInput = document.getElementById("broadcastFile");
  const publishBtn = document.getElementById("btnBroadcastPublish");
  
  if (!textVal && !fileInput.files[0]) {
    alert("Please write some text or attach an image/video to broadcast.");
    return;
  }
  
  publishBtn.disabled = true;
  publishBtn.textContent = "Broadcasting to Users...";
  
  const formData = new FormData();
  formData.append("text", textVal);
  if (fileInput.files[0]) {
    formData.append("file", fileInput.files[0]);
  }
  
  try {
    const response = await fetch("/api/broadcast", {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}` },
      body: formData
    });
    
    const data = await response.json();
    
    if (response.ok) {
      alert("Broadcast sent successfully to all registered bot users!");
      // Reset form
      document.getElementById("broadcastText").value = "";
      fileInput.value = "";
      document.getElementById("imagePreview").style.display = "none";
      document.getElementById("videoPreview").style.display = "none";
      document.getElementById("fileInfo").style.display = "none";
      document.getElementById("dropText").textContent = "Drag and drop file here, or click to browse";
    } else {
      alert(`Error: ${data.message || "Failed to publish broadcast."}`);
    }
  } catch (err) {
    console.error(err);
    alert("Network error publishing broadcast.");
  } finally {
    publishBtn.disabled = false;
    publishBtn.textContent = "Broadcast to Users";
  }
});

// Request code for Change Password
async function requestPasswordCode() {
  const btn = document.getElementById("btnRequestPassCode");
  btn.disabled = true;
  btn.textContent = "Sending...";
  
  try {
    const response = await fetch("/api/request-code", {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}` }
    });
    
    const data = await response.json();
    if (response.ok) {
      alert("A 6-digit verification code has been sent to your Telegram chat.");
      btn.textContent = "Code Sent ✅";
      setTimeout(() => {
        btn.disabled = false;
        btn.textContent = "Request Code";
      }, 30000); // Throttling code requests for 30s
    } else {
      alert(`Error: ${data.message || "Unable to request code."}`);
      btn.disabled = false;
      btn.textContent = "Request Code";
    }
  } catch (err) {
    console.error(err);
    alert("Network error requesting code.");
    btn.disabled = false;
    btn.textContent = "Request Code";
  }
}

// Submit Password Change
document.getElementById("changePasswordForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  
  const newPass = document.getElementById("newPassword").value;
  const confirmPass = document.getElementById("confirmPassword").value;
  const code = document.getElementById("passwordCode").value;
  const saveBtn = document.getElementById("btnSavePassword");
  
  if (newPass !== confirmPass) {
    alert("New passwords do not match!");
    return;
  }
  
  saveBtn.disabled = true;
  saveBtn.textContent = "Saving...";
  
  try {
    const response = await fetch("/api/change-password", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({
        new_password: newPass,
        code: code
      })
    });
    
    const data = await response.json();
    if (response.ok) {
      alert("Your password has been changed successfully! Please log in again.");
      logout();
    } else {
      alert(`Error: ${data.message || "Failed to update password."}`);
    }
  } catch (err) {
    console.error(err);
    alert("Network error updating password.");
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "Update Password";
  }
});

// Escape Helper
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// --- Quiz Builder Logic ---

function openAddQuestionModal() {
  document.getElementById('qDayNumber').value = '1';
  document.getElementById('qText').value = '';
  document.getElementById('qOptions').value = '';
  document.getElementById('qCorrectIndex').value = '0';
  document.getElementById('addQuestionModal').classList.add('active');
}

function closeAddQuestionModal() {
  document.getElementById('addQuestionModal').classList.remove('active');
}

document.getElementById('confirmAddQuestionBtn').addEventListener('click', async () => {
  const day_number = parseInt(document.getElementById('qDayNumber').value);
  const question_text = document.getElementById('qText').value;
  const optionsRaw = document.getElementById('qOptions').value;
  const correct_option_index = parseInt(document.getElementById('qCorrectIndex').value);
  
  const options = optionsRaw.split('\n').map(opt => opt.trim()).filter(opt => opt.length > 0);
  
  if (!day_number || !question_text || options.length < 2) {
    alert("Please provide day number, question text, and at least 2 options.");
    return;
  }
  
  if (correct_option_index < 0 || correct_option_index >= options.length) {
    alert("Correct option index must be valid for the provided options.");
    return;
  }

  const btn = document.getElementById('confirmAddQuestionBtn');
  btn.disabled = true;
  btn.textContent = "Saving...";

  try {
    const response = await fetch('/api/questions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ day_number, question_text, options, correct_option_index })
    });
    
    if (response.ok) {
      closeAddQuestionModal();
      fetchQuestions();
    } else {
      const data = await response.json();
      alert(`Error adding question: ${data.message || 'Unknown error'}`);
    }
  } catch (err) {
    console.error(err);
    alert("Network error.");
  } finally {
    btn.disabled = false;
    btn.textContent = "Save Question";
  }
});

async function fetchQuestions() {
  const tbody = document.getElementById('questionsTableBody');
  tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Loading...</td></tr>';
  
  try {
    const response = await fetch('/api/questions', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (response.ok) {
      const questions = await response.json();
      tbody.innerHTML = '';
      if (questions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);">No questions found. Add one to get started.</td></tr>';
        return;
      }
      
      questions.forEach(q => {
        const tr = document.createElement('tr');
        const optsHtml = q.options.map((o, idx) => `<div>${idx}: ${escapeHtml(o)}</div>`).join('');
        
        tr.innerHTML = `
          <td>Day ${q.day_number}</td>
          <td style="max-width:300px;white-space:normal;">${escapeHtml(q.question_text)}</td>
          <td>${optsHtml}</td>
          <td>${q.correct_option_index}</td>
          <td>
            <button class="btn-decline" onclick="deleteQuestion('${q.id}')">Delete</button>
          </td>
        `;
        tbody.appendChild(tr);
      });
    }
  } catch (err) {
    console.error(err);
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--danger);">Error loading questions</td></tr>';
  }
}

async function deleteQuestion(id) {
  if (!confirm("Are you sure you want to delete this question?")) return;
  
  try {
    const response = await fetch(`/api/questions/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (response.ok) {
      fetchQuestions();
    } else {
      alert("Failed to delete question.");
    }
  } catch (err) {
    console.error(err);
    alert("Network error.");
  }
}

// --- Translations & Languages Management ---

let allLanguages = [];
let allTranslations = []; // Array of { lang_code, key, value }

async function initTranslationsTab() {
  try {
    await fetchLanguages();
    await fetchTranslations();
    
    // Set default selected language if not set
    const select = document.getElementById("selectLangEdit");
    if (select && select.children.length > 0 && !select.value) {
      select.value = select.children[0].value;
    }
    renderTranslationsList();
  } catch (err) {
    console.error("Error initializing translations tab:", err);
  }
}

async function fetchLanguages() {
  try {
    const response = await fetch("/api/languages", {
      headers: { "Authorization": `Bearer ${token}` }
    });
    if (response.status === 401) { logout(); return; }
    if (response.ok) {
      allLanguages = await response.json();
      renderLanguagesList();
      populateLangSelect();
    }
  } catch (err) {
    console.error("Error fetching languages:", err);
  }
}

async function fetchTranslations() {
  try {
    const response = await fetch("/api/translations", {
      headers: { "Authorization": `Bearer ${token}` }
    });
    if (response.status === 401) { logout(); return; }
    if (response.ok) {
      allTranslations = await response.json();
    }
  } catch (err) {
    console.error("Error fetching translations:", err);
  }
}

function renderLanguagesList() {
  const container = document.getElementById("languagesList");
  if (!container) return;
  if (!Array.isArray(allLanguages) || allLanguages.length === 0) {
    container.innerHTML = `<div style="text-align:center; color:var(--text-muted); font-size:13px;">No languages.</div>`;
    return;
  }
  
  container.innerHTML = allLanguages.map(lang => {
    const isProtected = ['en', 'am', 'om', 'or', 'ti', 'tg'].includes(lang.code);
    const deleteBtn = isProtected ? '' : `
      <button class="btn-logout" style="padding:4px 8px; font-size:11px; background:rgba(239,68,68,0.1); border-color:rgba(239,68,68,0.2); color:var(--danger);" onclick="deleteLanguage('${lang.code}')">Delete</button>
    `;
    return `
      <div class="lang-row" style="display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.02); padding:10px 14px; border:1px solid rgba(255,255,255,0.04); border-radius:10px;">
        <div>
          <div style="font-weight:600; font-size:14px;">${escapeHtml(lang.name)}</div>
          <div style="font-size:12px; color:var(--text-muted);">Code: <code>${escapeHtml(lang.code)}</code></div>
        </div>
        <div style="display:flex; align-items:center; gap:12px;">
          <input type="checkbox" id="chk-${lang.code}" ${lang.is_active ? 'checked' : ''} onchange="toggleLanguageActive('${lang.code}', this.checked)" style="width:16px; height:16px; cursor:pointer;" title="Toggle Active">
          ${deleteBtn}
        </div>
      </div>
    `;
  }).join('');
}

function populateLangSelect() {
  const select = document.getElementById("selectLangEdit");
  if (!select) return;
  if (!Array.isArray(allLanguages)) return;
  const currentVal = select.value;
  select.innerHTML = allLanguages.map(lang => `
    <option value="${lang.code}">${escapeHtml(lang.name)} (${lang.code})</option>
  `).join('');
  if (currentVal && allLanguages.some(l => l.code === currentVal)) {
    select.value = currentVal;
  } else if (allLanguages.length > 0) {
    select.value = allLanguages[0].code;
  }
}

function handleLangEditChange() {
  renderTranslationsList();
}

function renderTranslationsList() {
  const container = document.getElementById("translationsEditorList");
  if (!container) return;
  const selectedLangEl = document.getElementById("selectLangEdit");
  const selectedLang = selectedLangEl ? selectedLangEl.value : "";
  
  if (!selectedLang) {
    container.innerHTML = `<div style="text-align:center; color:var(--text-muted); padding:20px;">Please select or add a language first.</div>`;
    return;
  }
  
  // Filter translations for selected language
  const trans = allTranslations.filter(t => t.lang_code === selectedLang);
  
  // If there are no translation records yet in the database for this language, fallback to English keys
  let keysToRender = [];
  if (trans.length > 0) {
    keysToRender = trans;
  } else {
    // Fallback/Draft placeholders based on English translations
    const englishTrans = allTranslations.filter(t => t.lang_code === 'en');
    keysToRender = englishTrans.map(t => ({
      lang_code: selectedLang,
      key: t.key,
      value: "" // empty placeholder
    }));
  }
  
  // Filter by search query if any
  const searchEl = document.getElementById("translationSearch");
  const searchQuery = searchEl ? searchEl.value.toLowerCase().trim() : "";
  const filteredKeys = keysToRender.filter(t => {
    const k = (t.key || "").toLowerCase();
    const v = (t.value || "").toLowerCase();
    return k.includes(searchQuery) || v.includes(searchQuery);
  });
  
  if (filteredKeys.length === 0) {
    container.innerHTML = `<div style="text-align:center; color:var(--text-muted); padding:20px;">No matching translations found.</div>`;
    return;
  }
  
  container.innerHTML = filteredKeys.map(t => `
    <div class="translation-editor-row" data-key="${escapeHtml(t.key)}" style="display:flex; flex-direction:column; gap:6px;">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <span style="font-family:monospace; font-size:12px; color:#a5b4fc; font-weight:600; background:rgba(99,102,241,0.1); padding:2px 8px; border-radius:6px;">${escapeHtml(t.key)}</span>
      </div>
      <textarea class="search-box" style="width:100%; min-height:60px; background:var(--input-bg); color:var(--text-main); font-size:13px; line-height:1.4; padding:10px; border-radius:10px; resize:vertical; border: 1px solid var(--card-border);" id="trans-${escapeHtml(t.key)}">${escapeHtml(t.value)}</textarea>
    </div>
  `).join('');
}

function filterTranslations() {
  renderTranslationsList();
}

async function saveTranslations(event) {
  event.preventDefault();
  const selectedLangEl = document.getElementById("selectLangEdit");
  const selectedLang = selectedLangEl ? selectedLangEl.value : "";
  if (!selectedLang) return;
  
  const saveBtn = document.getElementById("btnSaveTranslations");
  saveBtn.disabled = true;
  saveBtn.textContent = "Saving...";
  
  // Collect all textareas
  const rows = document.querySelectorAll("#translationsEditorList .translation-editor-row");
  const payloadTranslations = [];
  
  rows.forEach(row => {
    const key = row.getAttribute("data-key");
    const val = document.getElementById(`trans-${key}`).value;
    payloadTranslations.push({
      lang_code: selectedLang,
      key: key,
      value: val
    });
  });
  
  try {
    const response = await fetch("/api/translations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ translations: payloadTranslations })
    });
    
    if (response.ok) {
      alert("Translations saved successfully!");
      await fetchTranslations();
      renderTranslationsList();
    } else {
      const data = await response.json();
      alert(`Error saving translations: ${data.message || "Unknown error"}`);
    }
  } catch (err) {
    console.error(err);
    alert("Network error saving translations.");
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "Save Translations";
  }
}

// Add Language Modal Controls
function openAddLanguageModal() {
  document.getElementById("langCodeInput").value = "";
  document.getElementById("langNameInput").value = "";
  document.getElementById("langActiveInput").checked = true;
  document.getElementById("addLanguageModal").classList.add("active");
}

function closeAddLanguageModal() {
  document.getElementById("addLanguageModal").classList.remove("active");
}

async function saveNewLanguage() {
  const code = document.getElementById("langCodeInput").value.trim().toLowerCase();
  const name = document.getElementById("langNameInput").value.trim();
  const is_active = document.getElementById("langActiveInput").checked;
  
  if (!code || !name) {
    alert("Please provide both a language code and name.");
    return;
  }
  
  const saveBtn = document.getElementById("confirmAddLanguageBtn");
  saveBtn.disabled = true;
  saveBtn.textContent = "Saving...";
  
  try {
    const response = await fetch("/api/languages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ code, name, is_active })
    });
    
    if (response.ok) {
      closeAddLanguageModal();
      alert("Language added successfully!");
      await fetchLanguages();
      await fetchTranslations(); // Load new default translation keys
      
      const select = document.getElementById("selectLangEdit");
      select.value = code;
      renderTranslationsList();
    } else {
      const data = await response.json();
      alert(`Error: ${data.message || "Failed to add language"}`);
    }
  } catch (err) {
    console.error(err);
    alert("Network error adding language.");
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "Save Language";
  }
}

async function toggleLanguageActive(code, isChecked) {
  const lang = allLanguages.find(l => l.code === code);
  if (!lang) return;
  
  try {
    const response = await fetch("/api/languages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ code, name: lang.name, is_active: isChecked })
    });
    
    if (response.ok) {
      await fetchLanguages();
    } else {
      alert("Failed to toggle language active status.");
      await fetchLanguages(); // reset UI state
    }
  } catch (err) {
    console.error(err);
    alert("Network error updating language.");
    await fetchLanguages(); // reset UI state
  }
}

async function deleteLanguage(code) {
  if (['en', 'am'].includes(code)) {
    alert("System default languages cannot be deleted.");
    return;
  }
  if (!confirm(`Are you sure you want to delete language "${code}"? This will also remove all its translations.`)) {
    return;
  }
  
  try {
    const response = await fetch(`/api/languages/${code}`, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${token}` }
    });
    
    if (response.ok) {
      alert("Language deleted.");
      await fetchLanguages();
      await fetchTranslations();
      renderTranslationsList();
    } else {
      alert("Failed to delete language.");
    }
  } catch (err) {
    console.error(err);
    alert("Network error deleting language.");
  }
}

async function logout() {
  localStorage.removeItem("admin_token");
  try {
      await fetch('/api/logout', { method: 'POST' });
  } catch(e) {}
  window.location.href = "/";
}


function handleSignatureSelect(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = function(e) {
    const img = new Image();
    img.onload = function() {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      // Resize to max 300px width to keep database payload lightweight
      const maxW = 300;
      const scale = Math.min(1, maxW / img.width);
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      
      // Auto-remove white/light background to make it a transparent PNG
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imgData.data;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i+1];
        const b = data[i+2];
        // If pixel is near white/grey (RGB values above 190), make it transparent
        if (r > 190 && g > 190 && b > 190) {
          data[i+3] = 0; // Set alpha to 0
        }
      }
      ctx.putImageData(imgData, 0, 0);
      
      const preview = document.getElementById('signaturePreview');
      const noText = document.getElementById('noSignatureText');
      preview.src = canvas.toDataURL('image/png');
      preview.style.display = 'block';
      noText.style.display = 'none';
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function handleSealSelect(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = function(e) {
    const img = new Image();
    img.onload = function() {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      // Resize to max 300px width/height to keep payload lightweight
      const maxW = 300;
      const scale = Math.min(1, maxW / img.width);
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      
      // Auto-remove white/light background to make it transparent
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imgData.data;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i+1];
        const b = data[i+2];
        if (r > 190 && g > 190 && b > 190) {
          data[i+3] = 0;
        }
      }
      ctx.putImageData(imgData, 0, 0);
      
      const preview = document.getElementById('sealPreview');
      const noText = document.getElementById('noSealText');
      preview.src = canvas.toDataURL('image/png');
      preview.style.display = 'block';
      noText.style.display = 'none';
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

async function generateTelegramLinkCode() {
  const btn = document.getElementById("btnGenerateLinkCode");
  const display = document.getElementById("linkCodeDisplay");
  const val = document.getElementById("linkCodeValue");
  const instruction = document.getElementById("linkInstructionText");
  
  btn.disabled = true;
  btn.textContent = "Generating...";
  
  try {
    const res = await fetch("/api/admin/generate-link-code", {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}` }
    });
    const data = await res.json();
    if (res.ok && data.code) {
      val.textContent = data.code;
      
      // Get username from token
      let username = "admin";
      try {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(window.atob(base64).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
        username = JSON.parse(jsonPayload).user || "admin";
      } catch (e) {
        console.error(e);
      }
      
      instruction.textContent = `/auth ${username} <your_password> ${data.code}`;
      display.style.display = "block";
    } else {
      alert("Failed to generate link code: " + (data.error || "Unknown error"));
    }
  } catch (e) {
    console.error(e);
    alert("Error generating linkage code.");
  } finally {
    btn.disabled = false;
    btn.textContent = "Generate Linkage Code 🔑";
  }
}

// Auto load current tab
switchMainTab('submissions');
