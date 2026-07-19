// Auth Check
const token = localStorage.getItem("admin_token");
if (token) {
  window.location.href = "/admin";
}

let savedUsername = "";
let savedPassword = "";

// Form 1 Submit
document.getElementById("step1Form").addEventListener("submit", async (e) => {
  e.preventDefault();
  
  const usernameInput = document.getElementById("username");
  const passwordInput = document.getElementById("password");
  const btnStep1 = document.getElementById("btnStep1");
  const errorMsg = document.getElementById("errorMsg");
  
  errorMsg.classList.remove("visible");
  errorMsg.style.display = "none";
  btnStep1.classList.add("loading");
  btnStep1.disabled = true;
  
  try {
    const response = await fetch("/api/login/step1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: usernameInput.value,
        password: passwordInput.value
      })
    });
    
    const data = await response.json();
    
    if (response.ok) {
      savedUsername = usernameInput.value;
      savedPassword = passwordInput.value;
      
      // Switch to Step 2
      document.getElementById("step1").classList.remove("active");
      document.getElementById("step2").classList.add("active");
      document.getElementById("formSubtitle").textContent = "Two-Factor Authentication";
    } else {
      // Handle linking error
      if (data.error === "no_chat_linked") {
        errorMsg.innerHTML = `<b>Telegram Not Linked</b><br><br>${data.message}`;
      } else {
        errorMsg.textContent = data.message || "Invalid username or password";
      }
      errorMsg.classList.add("visible");
    }
  } catch (err) {
    errorMsg.textContent = "Unable to connect to server.";
    errorMsg.classList.add("visible");
  } finally {
    btnStep1.classList.remove("loading");
    btnStep1.disabled = false;
  }
});

// Form 2 Submit
document.getElementById("step2Form").addEventListener("submit", async (e) => {
  e.preventDefault();
  
  const codeInput = document.getElementById("verificationCode");
  const btnStep2 = document.getElementById("btnStep2");
  const errorMsg = document.getElementById("errorMsg");
  
  errorMsg.classList.remove("visible");
  errorMsg.style.display = "none";
  btnStep2.classList.add("loading");
  btnStep2.disabled = true;
  
  try {
    const response = await fetch("/api/login/step2", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: savedUsername,
        password: savedPassword,
        code: codeInput.value
      })
    });
    
    const data = await response.json();
    
    if (response.ok) {
      localStorage.setItem("admin_token", data.token);
      window.location.href = "/admin";
    } else {
      errorMsg.textContent = data.message || "Verification failed.";
      errorMsg.classList.add("visible");
    }
  } catch (err) {
    errorMsg.textContent = "Connection error.";
    errorMsg.classList.add("visible");
  } finally {
    btnStep2.classList.remove("loading");
    btnStep2.disabled = false;
  }
});

function backToStep1() {
  document.getElementById("step2").classList.remove("active");
  document.getElementById("step1").classList.add("active");
  document.getElementById("formSubtitle").textContent = "Enter credentials to verify session";
  document.getElementById("errorMsg").classList.remove("visible");
  document.getElementById("errorMsg").style.display = "none";
}
