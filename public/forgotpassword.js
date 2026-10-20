const forgotPasswordForm = document.getElementById("forgotPasswordForm");

/**
 * Submits the address to the server and replaces the form with a
 * confirmation message. The response is deliberately generic so as
 * not to disclose whether an account exists for the given address.
 */
forgotPasswordForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const email = forgotPasswordForm.email.value;

    await fetch("/auth/forgot-password", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ email })
    });

    document.getElementById("forgot-password-view").innerHTML = `
        <div class="forgot-password-email">
            <h1>Check your email</h1>
            <p>
                If an account exists for <strong>${email}</strong>,
                a password reset link has been sent to your email.
            </p>
        </div>

        <div class="forgot-password-div3">
            <a href="auth.html">Back to Login</a>
        </div>
    `;
});