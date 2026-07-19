
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
      } else if (tab === 'settings') {
        document.getElementById("tabBtnSettings").classList.add("active");
        document.getElementById("sectionSettings").classList.add("active");
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
        
        return `
          <tr>
            <td>${date}</td>
            <td><b>${escapeHtml(reg.name || '-')}</b></td>
            <td>${escapeHtml(reg.phone || '-')}</td>
            <td><code>${escapeHtml(reg.receipt_number || '-')}</code></td>
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
      publishBtn.textContent = "Publishing to Channel...";
      
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
          alert("Published successfully to your private Telegram Channel!");
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
        publishBtn.textContent = "Publish to Channel";
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
      document.getElementById('addQuestionModal').style.display = 'flex';
    }

    function closeAddQuestionModal() {
      document.getElementById('addQuestionModal').style.display = 'none';
    }

    document.getElementById('confirmAddQuestionBtn').addEventListener('click', async () => {
      const day_number = parseInt(document.getElementById('qDayNumber').value);
      const question_text = document.getElementById('qText').value;
      const optionsRaw = document.getElementById('qOptions').value;
      const correct_option_index = parseInt(document.getElementById('qCorrectIndex').value);
      
      const options = optionsRaw.split('\\n').map(opt => opt.trim()).filter(opt => opt.length > 0);
      
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

    function logout() {
      localStorage.removeItem("admin_token");
      window.location.href = "/";
    }

    // Auto load current tab
    switchMainTab('submissions');
  