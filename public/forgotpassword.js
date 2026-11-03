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

    const view = document.getElementById("forgot-password-view");
    view.replaceChildren();

    const message = document.createElement("div");
    message.className = "forgot-password-email";
    const heading = document.createElement("h1");
    heading.textContent = "Check your email";
    const paragraph = document.createElement("p");
    const address = document.createElement("strong");
    address.textContent = email;
    paragraph.append(
        "If an account exists for ",
        address,
        ", a password reset link has been sent to your email."
    );
    message.append(heading, paragraph);

    const back = document.createElement("div");
    back.className = "forgot-password-div3";
    const loginLink = document.createElement("a");
    loginLink.href = "auth.html";
    loginLink.textContent = "Back to Login";
    back.append(loginLink);

    view.append(message, back);
});