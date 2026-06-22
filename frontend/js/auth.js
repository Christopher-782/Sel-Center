const loginForm = document.getElementById("loginForm");
const loginError = document.getElementById("loginError");

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;

  try {
    // Supabase v2 login
    const { data, error } = await window.supabase.auth.signInWithPassword({
      email: email,
      password: password,
    });

    if (error) {
      loginError.textContent = error.message;
      return;
    }

    if (!data.user) {
      loginError.textContent = "Login failed. No user returned.";
      return;
    }

    // Fetch profile
    const { data: profile, error: profileError } = await window.supabase
      .from("profiles")
      .select("*")
      .eq("id", data.user.id)
      .single();

    if (profileError) {
      loginError.textContent = profileError.message;
      return;
    }

    // Redirect based on role
    switch (profile.role) {
      case "sale_associate":
        window.location.href = "pos.html";
        break;
      case "manager":
        window.location.href = "manager.html";
        break;
      case "admin":
        window.location.href = "admin.html";
        break;
      default:
        loginError.textContent = "Unknown role. Contact admin.";
    }
  } catch (err) {
    console.error(err);
    loginError.textContent = "Unexpected error during login.";
  }
});
