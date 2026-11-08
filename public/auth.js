// References for the two mutually exclusive authentication views.
const loginView = document.getElementById("loginView");
const registerView = document.getElementById("registerView");
const messageView = document.getElementById("messageView");

// Presents the login view and hides registration. //
function showLogin() {
    loginView.classList.remove("hidden");
    registerView.classList.add("hidden");
    messageView.classList.add("hidden");
}

// Presents the registration view and hides login. //
function showRegister() {
    loginView.classList.add("hidden");
    registerView.classList.remove("hidden");
    messageView.classList.add("hidden");
}

// Replaces both forms with a message and a link back to login. //
function showMessage(title, text, linkText) {
    clearAuthError();
    clearAuthNotice();
    document.getElementById("message-title").textContent = title;
    document.getElementById("message-text").textContent = text;
    document.getElementById("message-link").textContent = linkText;
    loginView.classList.add("hidden");
    registerView.classList.add("hidden");
    messageView.classList.remove("hidden");
}

function showAuthFromPath() {
    if (window.location.pathname.endsWith("/register")) {
        showRegister();
    } else {
        showLogin();
    }
}

// Switching to login records the active view in the path without reloading.
document.getElementById("show-login").addEventListener("click", (e) => {
    e.preventDefault();
    showLogin();
    window.history.pushState(null, "", "/auth/login");
});

// Switching to registration likewise records the active view in the path.
document.getElementById("show-register").addEventListener("click", (e) => {
    e.preventDefault();
    showRegister();
    window.history.pushState(null, "", "/auth/register");
});

document.getElementById("message-link").addEventListener("click", (e) => {
    e.preventDefault();
    showLogin();
    window.history.pushState(null, "", "/auth/login");
});

showAuthFromPath();
window.addEventListener("popstate", showAuthFromPath);

// If a session already exists, skip login/register and go to Account.
fetch("/auth/me", { credentials: "include" })
    .then((res) => {
        if (res.ok) {
            window.location.replace("/landingpage/account");
        }
    })
    .catch(() => {});

const authError = document.getElementById("auth-error");
const authNotice = document.getElementById("auth-notice");

// Displays a server- or client-side error within the shared alert region. //
function showAuthError(message) {
    if (!authError) return;
    authError.textContent = message;
    authError.classList.remove("hidden");
}

// Hides the alert region and discards any prior message. //
function clearAuthError() {
    if (!authError) return;
    authError.textContent = "";
    authError.classList.add("hidden");
}

function showAuthNotice(message) {
    if (!authNotice) return;
    authNotice.textContent = message;
    authNotice.classList.remove("hidden");
}

function clearAuthNotice() {
    if (!authNotice) return;
    authNotice.textContent = "";
    authNotice.classList.add("hidden");
}

// Outcomes of the emailed confirmation link, passed back by /verify-email.
const verifiedMessages = {
    "1": ["Email confirmed", "Your email has been confirmed. You can sign in.", "Sign in"],
    email: ["Email updated", "Your email has been changed. Sign in with your new email address.", "Sign in"],
    invalid: ["Link expired", "This confirmation link is invalid or has expired.", "Back to Login"],
    taken: ["Email in use", "That email address is already in use.", "Back to Login"],
};

const verified = new URLSearchParams(window.location.search).get("verified");
if (verifiedMessages[verified]) {
    showMessage(...verifiedMessages[verified]);
}

/**
 * Issues a JSON POST to the given authentication endpoint.
 * Session credentials are included so that a cookie may be established.
 */
async function postAuth(url, body) {
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(data.error || "Request failed");
    }
    return data;
}

// Login submission: authenticate, then proceed to the notes workspace.
document.getElementById("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    clearAuthError();
    clearAuthNotice();
    const form = e.target;
    try {
        await postAuth("/auth/login", {
            email: form.email.value,
            password: form.password.value,
        });
        window.location.href = "/notespage.html";
    } catch (err) {
        showAuthError(err.message);
    }
});

// Registration submission: confirm passwords locally, then create the account.
document.getElementById("register-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    clearAuthError();
    clearAuthNotice();
    const form = e.target;
    const password = form.password.value;
    const confirm = form.password_confirm.value;
    const policyError = passwordPolicyError(password, {
        email: form.email.value,
        name: form.name.value,
    });
    if (policyError) {
        form.password.setCustomValidity(policyError);
        form.password.reportValidity();
        return;
    }
    form.password.setCustomValidity("");
    if (password !== confirm) {
        form.password_confirm.setCustomValidity("Passwords do not match");
        form.password_confirm.reportValidity();
        return;
    }
    form.password_confirm.setCustomValidity("");
    try {
        const created = await postAuth("/auth/register", {
            name: form.name.value,
            email: form.email.value,
            password,
        });
        if (created.needsVerification) {
            showMessage(
                "Confirm your email",
                "A confirmation link has been sent to your email. Confirm your email to sign in. The link expires in 24 hours.",
                "Back to Login"
            );
            return;
        }
        window.location.href = "/notespage.html";
    } catch (err) {
        showAuthError(err.message);
    }
});

// Clear a previous mismatch constraint once the user revises either password field.
document.getElementById("register-form").addEventListener("input", (e) => {
    if (e.target.name === "password_confirm" || e.target.name === "password") {
        e.target.form.password.setCustomValidity("");
        e.target.form.password_confirm.setCustomValidity("");
    }
});

