const resetPasswordForm = document.getElementById("resetPasswordForm");

// Replaces the form with an invalid- or expired-link message. //
function showExpiredMessage() {
    document.getElementById("forgot-password-view").innerHTML = `
        <div class="forgot-password-email">
            <h1>Link expired</h1>
            <p>This password reset link is invalid or has expired. Please request a new one.</p>
        </div>
        <div class="forgot-password-div3">
            <a href="auth.html">Back to Login</a>
        </div>
    `;
}

/**
 * On load, extracts the reset token from the query string and asks the
 * server to confirm that it remains valid. An absent or invalid token
 * results in the expired-link view.
 */
(async () => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");

    if (!token) {
        showExpiredMessage();
        return;
    }

    const res = await fetch(`/auth/verify-reset-token?token=${encodeURIComponent(token)}`);
    const data = await res.json();

    if (!data.valid) {
        showExpiredMessage();
    }
})();

/**
 * Validates that the two password fields agree, then posts the new
 * credential together with the token. Success replaces the form with
 * a confirmation; failure is reported via an alert.
 */
resetPasswordForm.addEventListener("input", (e) => {
    if (e.target.name === "password" || e.target.name === "confirmPassword") {
        resetPasswordForm.password.setCustomValidity("");
        resetPasswordForm.confirmPassword.setCustomValidity("");
    }
});

resetPasswordForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const password = resetPasswordForm.password.value;
    const confirmPassword = resetPasswordForm.confirmPassword.value;
    const policyError = passwordPolicyError(password);

    if (policyError) {
        resetPasswordForm.password.setCustomValidity(policyError);
        resetPasswordForm.password.reportValidity();
        return;
    }
    resetPasswordForm.password.setCustomValidity("");

    if (password !== confirmPassword) {
        resetPasswordForm.confirmPassword.setCustomValidity("Passwords do not match");
        resetPasswordForm.confirmPassword.reportValidity();
        return;
    }
    resetPasswordForm.confirmPassword.setCustomValidity("");

    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");

    const response = await fetch("/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password })
    });

    const data = await response.json();

    if (!response.ok) {
        alert(data.error || "Something went wrong. Please try again.");
        return;
    }

    document.getElementById("forgot-password-view").innerHTML = `
        <div class="forgot-password-email">
            <h1>Password Reset Success</h1>
            <p>The password has been reset successfully.</p>
        </div>
        <div class="forgot-password-div3">
            <a href="auth.html">Back to Login</a>
        </div>
    `;
});