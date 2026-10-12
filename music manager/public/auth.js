const signupMode = window.location.pathname === "/signup";
const form = document.querySelector("#auth-form");
const errorBox = document.querySelector("#auth-error");
const submitButton = document.querySelector("#auth-submit");
const nameField = document.querySelector("#name-field");
const passwordInput = document.querySelector("#password-input");
const nextPath = new URLSearchParams(window.location.search).get("next");
const redirectPath = nextPath && nextPath.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/learn";

document.querySelector("#login-tab").classList.toggle("active", !signupMode);
document.querySelector("#signup-tab").classList.toggle("active", signupMode);
document.querySelector("#auth-eyebrow").textContent = signupMode ? "MAKE YOURSELF AT HOME" : "WELCOME BACK";
document.querySelector("#auth-title").textContent = signupMode ? "Find your frequency." : "Good to have you back.";
document.querySelector("#auth-description").textContent = signupMode
  ? "Create an account to save your progress and keep your favorite mixes close."
  : "Log in to pick up right where you left off.";
nameField.hidden = !signupMode;
document.querySelector("#name-input").required = signupMode;
passwordInput.autocomplete = signupMode ? "new-password" : "current-password";
passwordInput.placeholder = signupMode ? "At least 8 characters" : "Your password";
document.querySelector("#password-hint").hidden = !signupMode;
submitButton.innerHTML = signupMode ? 'Create my account <span>↗</span>' : 'Log in <span>↗</span>';
document.querySelector("#auth-switch").innerHTML = signupMode
  ? 'Already have an account? <a href="/login">Log in</a>'
  : 'New to Riff? <a href="/signup">Create an account</a>';

async function alreadySignedIn() {
  const response = await fetch("/api/auth/me");
  const result = await response.json();
  if (result.user) window.location.replace(redirectPath);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorBox.hidden = true;
  const payload = {
    email: document.querySelector("#email-input").value.trim(),
    password: passwordInput.value
  };
  if (signupMode) payload.name = document.querySelector("#name-input").value.trim();
  submitButton.disabled = true;
  submitButton.textContent = signupMode ? "Creating your account…" : "Logging you in…";
  try {
    const response = await fetch(`/api/auth/${signupMode ? "signup" : "login"}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Unable to sign in right now.");
    window.location.assign(redirectPath);
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.hidden = false;
    submitButton.disabled = false;
    submitButton.innerHTML = signupMode ? 'Create my account <span>↗</span>' : 'Log in <span>↗</span>';
  }
});

alreadySignedIn().catch(() => {
  errorBox.textContent = "We couldn't check your sign-in status. You can still try logging in.";
  errorBox.hidden = false;
});
