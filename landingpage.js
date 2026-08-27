// Link-variables to reference the right section links of the navbar 
const aboutLink = document.getElementById("aboutLink");
const accountLink = document.getElementById("accountLink");
const logoLink = document.getElementById("logoLink");
const loginRegisterLink = document.getElementById("loginRegisterLink");
const contactLink = document.getElementById("contactLink");

// BackToHome-variables to reference back to the landing page from the other pages when clicked
const aboutBackToHome = document.getElementById("aboutBackToHome");
const accountBackToHome = document.getElementById("accountBackToHome");

// Page-variables to refer page when clicked depending on the link
const landingPage = document.getElementById("landingPage");
const aboutPage = document.getElementById("aboutPage");
const accountPage = document.getElementById("accountPage");

// Stores all variables for Account Login and Logout Page
const accountLoggedOut = document.getElementById("accountLoggedOut");
const accountLoggedIn = document.getElementById("accountLoggedIn");
const accountName = document.getElementById("accountName");
const accountEmail = document.getElementById("accountEmail");
const accLogoutBtn = document.getElementById("accLogoutBtn");
const accLogoutModal = document.getElementById("accLogoutModal");
const accLogoutConfirmBtn = document.getElementById("accLogoutConfirmBtn");
const accLogoutCancelBtn = document.getElementById("accLogoutCancelBtn");

// Save Changes modal variables are stored
const saveBtn = document.getElementById("saveBtn");
const saveModal = document.getElementById("saveModal");
const okBtn = document.getElementById("okBtn");
const saveError = document.getElementById("saveError");

// Delete Account modal variables are stored
const accDeleteBtn = document.getElementById("accDeleteBtn");
const accDeleteModal = document.getElementById("accDeleteModal");
const accDeleteConfirmBtn = document.getElementById("accDeleteConfirmBtn");
const accDeleteCancelBtn = document.getElementById("accDeleteCancelBtn");

// Stores all the pages in an array that will make easier to loop
const allSections = [landingPage, aboutPage, accountPage];

// Function to show the requested Page on an event(click)
function showPage(event, pageToShow, hash) {
  event.preventDefault();

  allSections.forEach((page) => {
    page.classList.add("section-hidden");
  });

  pageToShow.classList.remove("section-hidden");

  if (pageToShow === accountPage) {
    loadAccountDetails();
  }

  // Update the URL hash
  history.pushState(null, "", hash);

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
}

// To redirect on the page on event(click) 
aboutLink.addEventListener("click", (event) => showPage(event, aboutPage, "#about"));
accountLink.addEventListener("click", (event) => showPage(event, accountPage, "#account"));
logoLink.addEventListener("click", (event) => showPage(event, landingPage, "#home"));
loginRegisterLink.addEventListener("click", handleLoginRegister);
aboutBackToHome.addEventListener("click", (event) => showPage(event, landingPage, "#home"));
accountBackToHome.addEventListener("click", (event) => showPage(event, landingPage, "#home"));

const hashToPage = {
  "#home": landingPage,
  "#about": aboutPage,
  "#account": accountPage,
};

function showPageFromHash() {
  const page = hashToPage[window.location.hash];
  if (!page) return;
  allSections.forEach((section) => section.classList.add("section-hidden"));
  page.classList.remove("section-hidden");
  if (page === accountPage) loadAccountDetails();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

showPageFromHash();

async function handleLoginRegister(event) {
  event.preventDefault();

  try {
    const res = await fetch("/auth/me", {
      credentials: "include"
    });

    if (res.ok) {
      // User is logged in
      showPage(event, accountPage, "#account");
    } else {
      // User is not logged in
      window.location.href = "auth.html";
    }

  } catch (error) {
    console.error(error);
    window.location.href = "auth.html";
  }
}

// Link for contactLink, redirected to About section

contactLink.addEventListener("click", (event) => showPage(event, aboutPage, "#aboutPage"));

async function loadAccountDetails() {
  if (!accountLoggedOut || !accountLoggedIn) return;

  try {
    const res = await fetch("/auth/me", { credentials: "include" });
    if (!res.ok) {
      accountLoggedOut.classList.remove("account-panel-hidden");
      accountLoggedIn.classList.add("account-panel-hidden");
      return;
    }

    const user = await res.json();
    if (accountName) accountName.value = user.name;
    if (accountEmail) accountEmail.value = user.email;
    accountLoggedOut.classList.add("account-panel-hidden");
    accountLoggedIn.classList.remove("account-panel-hidden");
  } catch {
    accountLoggedOut.classList.remove("account-panel-hidden");
    accountLoggedIn.classList.add("account-panel-hidden");
  }
}

function showAccLogoutModal() {
  accLogoutModal.classList.remove("hidden");
}

function hideAccLogoutModal() {
  accLogoutModal.classList.add("hidden");
}

if (accLogoutBtn) accLogoutBtn.addEventListener("click", showAccLogoutModal);
if (accLogoutCancelBtn) accLogoutCancelBtn.addEventListener("click", hideAccLogoutModal);

async function logoutAccount() {
  await fetch("/auth/logout", { method: "POST", credentials: "include" });
  await loadAccountDetails();
}

if (accLogoutConfirmBtn) {
  accLogoutConfirmBtn.addEventListener("click", logoutAccount)
}

if (accLogoutModal) {
  accLogoutModal.addEventListener("click", (e) => {
    if (e.target === accLogoutModal) hideAccLogoutModal();
  });
}
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && accLogoutModal && !accLogoutModal.classList.contains("hidden")) {
    hideAccLogoutModal();
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && accLogoutModal && !accLogoutModal.classList.contains("hidden")) {
    logoutAccount();
  }
});

async function saveAccountChanges() {
  if (saveError) {
    saveError.classList.add("hidden");
    saveError.textContent = "";
  }

  const name = accountName ? accountName.value.trim() : "";
  const email = accountEmail ? accountEmail.value.trim() : "";
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  if (!name || !email) {
    if (saveError) {
      saveError.textContent = "Username and email are required.";
      saveError.classList.remove("hidden");
    }
    return;
  }

  if (!emailPattern.test(email)) {
    if (saveError) {
      saveError.textContent = "Please enter a valid email address.";
      saveError.classList.remove("hidden");
    }
    return;
  }

  saveBtn.disabled = true;
  const originalText = saveBtn.textContent;
  saveBtn.textContent = "Saving...";

  try {
    const res = await fetch("/auth/me", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ name, email }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      if (saveError) {
        saveError.textContent = data.error || "Failed to save changes.";
        saveError.classList.remove("hidden");
      }
      return;
    }

    const user = await res.json();
    if (accountName) accountName.value = user.name;
    if (accountEmail) accountEmail.value = user.email;

    saveModal.style.display = "flex";
  } catch (err) {
    console.error("Save account error:", err);
    if (saveError) {
      saveError.textContent = "Network error. Please try again.";
      saveError.classList.remove("hidden");
    }
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = originalText;
  }
}

saveBtn.addEventListener("click", saveAccountChanges);

okBtn.addEventListener("click", () => {saveModal.style.display = "none"});

// Close modal when clicking outside the box
saveModal.addEventListener("click", (event) => {
  if (event.target === saveModal) {
    saveModal.style.display = "none";
  }
});

function showAccDeleteModal() {
  accDeleteModal.classList.remove("hidden");
}

function hideAccDeleteModal() {
  accDeleteModal.classList.add("hidden");
}

if (accDeleteBtn) accDeleteBtn.addEventListener("click", showAccDeleteModal);
if (accDeleteCancelBtn) accDeleteCancelBtn.addEventListener("click", hideAccDeleteModal);
if (accDeleteModal) {
  accDeleteModal.addEventListener("click", (e) => {
    if (e.target === accDeleteModal) hideAccDeleteModal();
  });
}
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && accDeleteModal && !accDeleteModal.classList.contains("hidden")) {
    hideAccDeleteModal();
  }
});

async function deleteAccount() {
  try {
    const res = await fetch("/auth/me", { method: "DELETE", credentials: "include" });
    if (!res.ok) {
      console.error("Failed to delete account:", res.status);
      return; // keep modal open, don't redirect
    }
    hideAccDeleteModal();
    await loadAccountDetails();
    showPage({ preventDefault(){} }, landingPage, "#home");
  } catch (err) {
    console.error("Delete account error:", err);
  }
}

if (accDeleteConfirmBtn) {
  accDeleteConfirmBtn.addEventListener("click", deleteAccount);
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && accDeleteModal && !accDeleteModal.classList.contains("hidden")) {
    deleteAccount();
  }
});


