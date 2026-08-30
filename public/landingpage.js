// DOM references for the primary navigation links.
const aboutLink = document.getElementById("aboutLink");
const accountLink = document.getElementById("accountLink");
const logoLink = document.getElementById("logoLink");
const loginRegisterLink = document.getElementById("loginRegisterLink");
const contactLink = document.getElementById("contactLink");

// Controls that return the user to the landing view from secondary pages.
const aboutBackToHome = document.getElementById("aboutBackToHome");
const accountBackToHome = document.getElementById("accountBackToHome");

// Root containers for each client-side view (landing, about, and account).
const landingPage = document.getElementById("landingPage");
const aboutPage = document.getElementById("aboutPage");
const accountPage = document.getElementById("accountPage");

// Account view: authenticated and unauthenticated panels, profile fields, and logout dialogue.
const accountLoggedOut = document.getElementById("accountLoggedOut");
const accountLoggedIn = document.getElementById("accountLoggedIn");
const accountName = document.getElementById("accountName");
const accountEmail = document.getElementById("accountEmail");
const accLogoutBtn = document.getElementById("accLogoutBtn");
const accLogoutModal = document.getElementById("accLogoutModal");
const accLogoutConfirmBtn = document.getElementById("accLogoutConfirmBtn");
const accLogoutCancelBtn = document.getElementById("accLogoutCancelBtn");

// Elements associated with persisting profile amendments and reporting validation errors.
const saveBtn = document.getElementById("saveBtn");
const saveModal = document.getElementById("saveModal");
const okBtn = document.getElementById("okBtn");
const saveError = document.getElementById("saveError");

// Elements associated with the account-deletion confirmation dialogue.
const accDeleteBtn = document.getElementById("accDeleteBtn");
const accDeleteModal = document.getElementById("accDeleteModal");
const accDeleteConfirmBtn = document.getElementById("accDeleteConfirmBtn");
const accDeleteCancelBtn = document.getElementById("accDeleteCancelBtn");

// Collection of page sections, used to apply visibility changes in a single iteration.
const allSections = [landingPage, aboutPage, accountPage];

/**
 * Displays the requested view by concealing all other sections,
 * updating the document hash, and resetting scroll position.
 */
function showPage(event, pageToShow, hash) {
  event.preventDefault();

  allSections.forEach((page) => {
    page.classList.add("section-hidden");
  });

  pageToShow.classList.remove("section-hidden");

  // The account view is populated from the current session on each visit.
  if (pageToShow === accountPage) {
    loadAccountDetails();
  }

  history.pushState(null, "", hash);

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
}

// Bind navigation and "return home" controls to the corresponding views.
aboutLink.addEventListener("click", (event) => showPage(event, aboutPage, "#about"));
accountLink.addEventListener("click", (event) => showPage(event, accountPage, "#account"));
logoLink.addEventListener("click", (event) => showPage(event, landingPage, "#home"));
loginRegisterLink.addEventListener("click", handleLoginRegister);
aboutBackToHome.addEventListener("click", (event) => showPage(event, landingPage, "#home"));
accountBackToHome.addEventListener("click", (event) => showPage(event, landingPage, "#home"));

// Correspondence between URL fragments and their associated page sections.
const hashToPage = {
  "#home": landingPage,
  "#about": aboutPage,
  "#account": accountPage,
};

/** Restores the appropriate view from the current URL fragment, if one is present. */
function showPageFromHash() {
  const page = hashToPage[window.location.hash];
  if (!page) return;
  allSections.forEach((section) => section.classList.add("section-hidden"));
  page.classList.remove("section-hidden");
  if (page === accountPage) loadAccountDetails();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

showPageFromHash();

/**
 * Resolves the Login/Register action according to session state:
 * authenticated users are directed to the account view; otherwise
 * the browser is redirected to the dedicated authentication page.
 */
async function handleLoginRegister(event) {
  event.preventDefault();

  try {
    const res = await fetch("/auth/me", {
      credentials: "include"
    });

    if (res.ok) {
      // An active session was confirmed.
      showPage(event, accountPage, "#account");
    } else {
      // No valid session; authentication is required.
      window.location.href = "auth.html";
    }

  } catch (error) {
    console.error(error);
    window.location.href = "auth.html";
  }
}

// The contact control presents the About view, which contains contact information.
contactLink.addEventListener("click", (event) => showPage(event, aboutPage, "#aboutPage"));

/**
 * Retrieves the current user from the server and selects the
 * authenticated or unauthenticated account panel accordingly.
 */
async function loadAccountDetails() {
  if (!accountLoggedOut || !accountLoggedIn) return;

  try {
    const res = await fetch("/auth/me", { credentials: "include" });
    if (!res.ok) {
      // Unauthenticated: present the logged-out panel.
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
    // In the event of a network or authentication failure, revert to the logged-out panel.
    accountLoggedOut.classList.remove("account-panel-hidden");
    accountLoggedIn.classList.add("account-panel-hidden");
  }
}

// Reveals the logout confirmation dialogue. //
function showAccLogoutModal() {
  accLogoutModal.classList.remove("hidden");
}

// Hides the logout confirmation dialogue. //
function hideAccLogoutModal() {
  accLogoutModal.classList.add("hidden");
}

if (accLogoutBtn) accLogoutBtn.addEventListener("click", showAccLogoutModal);
if (accLogoutCancelBtn) accLogoutCancelBtn.addEventListener("click", hideAccLogoutModal);

// Terminates the server session and subsequently refreshes the account view. //
async function logoutAccount() {
  await fetch("/auth/logout", { method: "POST", credentials: "include" });
  await loadAccountDetails();
}

if (accLogoutConfirmBtn) {
  accLogoutConfirmBtn.addEventListener("click", logoutAccount)
}

// Dismissal of the logout dialogue when the overlay (outside the modal) is selected.
if (accLogoutModal) {
  accLogoutModal.addEventListener("click", (e) => {
    if (e.target === accLogoutModal) hideAccLogoutModal();
  });
}

// Keyboard support: Escape dismisses the dialogue; Enter confirms logout.
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

/**
 * Validates the submitted name and email, issues a PUT request to persist
 * the amendments, and, upon success, presents a confirmation dialogue.
 */
async function saveAccountChanges() {
  // Discard any previously displayed validation message.
  if (saveError) {
    saveError.classList.add("hidden");
    saveError.textContent = "";
  }

  const name = accountName ? accountName.value.trim() : "";
  const email = accountEmail ? accountEmail.value.trim() : "";
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  // Both identifiers are mandatory prior to any network request.
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
    // Persist the revised profile attributes on the server.
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

// Dismissal of the save-success dialogue when the overlay is selected.
saveModal.addEventListener("click", (event) => {
  if (event.target === saveModal) {
    saveModal.style.display = "none";
  }
});

// Reveals the account-deletion confirmation dialogue. //
function showAccDeleteModal() {
  accDeleteModal.classList.remove("hidden");
}

// Hides the account-deletion confirmation dialogue. //
function hideAccDeleteModal() {
  accDeleteModal.classList.add("hidden");
}

if (accDeleteBtn) accDeleteBtn.addEventListener("click", showAccDeleteModal);
if (accDeleteCancelBtn) accDeleteCancelBtn.addEventListener("click", hideAccDeleteModal);

// Dismissal of the deletion dialogue when the overlay is selected.
if (accDeleteModal) {
  accDeleteModal.addEventListener("click", (e) => {
    if (e.target === accDeleteModal) hideAccDeleteModal();
  });
}

// Escape dismisses the deletion dialogue whilst it remains visible.
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && accDeleteModal && !accDeleteModal.classList.contains("hidden")) {
    hideAccDeleteModal();
  }
});

/**
 * Permanently removes the user account via the server and, upon success,
 * returns the interface to the landing view.
 */
async function deleteAccount() {
  try {
    const res = await fetch("/auth/me", { method: "DELETE", credentials: "include" });
    if (!res.ok) {
      console.error("Failed to delete account:", res.status);
      return; // Retain the dialogue; do not redirect on failure.
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

// Enter confirms deletion whilst the corresponding dialogue remains visible.
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && accDeleteModal && !accDeleteModal.classList.contains("hidden")) {
    deleteAccount();
  }
});
