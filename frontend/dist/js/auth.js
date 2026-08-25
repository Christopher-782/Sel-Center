// ============================================
// Login Authentication
// ============================================

const loginForm = document.getElementById("loginForm");
const loginError = document.getElementById("loginError");
const loginBtn = document.getElementById("loginBtn");

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  loginError.textContent = "";
  loginError.className = "";

  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  if (!email || !password) {
    loginError.textContent = "Please enter both email and password.";
    loginError.className = "alert alert-error";
    return;
  }

  loginBtn.classList.add("loading");
  loginBtn.disabled = true;
  loginBtn.innerHTML = '<i class="fas fa-spinner"></i> Signing in...';

  try {
    if (!window.supabase) {
      throw new Error(
        "Supabase client not initialized. Check supabaseClient.js",
      );
    }

    // Login user
    const { data, error } = await window.supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      loginError.textContent = error.message;
      loginError.className = "alert alert-error";
      return;
    }

    if (!data || !data.user) {
      loginError.textContent = "Login failed. No user returned.";
      loginError.className = "alert alert-error";
      return;
    }

    console.log("Login successful:", data.user.email);

    // Fetch user profile and role from profiles table
    const { data: profile, error: profileError } = await window.supabase
      .from("profiles")
      .select("id, full_name, email, role")
      .eq("id", data.user.id)
      .maybeSingle();

    if (profileError) {
      console.error("Profile fetch error:", profileError);

      await window.supabase.auth.signOut();

      loginError.textContent =
        "Failed to load user profile. Error: " + profileError.message;
      loginError.className = "alert alert-error";
      return;
    }

    if (!profile) {
      await window.supabase.auth.signOut();

      loginError.textContent = "Profile not found. Contact admin.";
      loginError.className = "alert alert-error";
      return;
    }

    if (!profile.role) {
      await window.supabase.auth.signOut();

      loginError.textContent = "No role assigned to this user. Contact admin.";
      loginError.className = "alert alert-error";
      return;
    }

    console.log("Profile loaded:", profile);

    // Store user session data
    localStorage.setItem("userId", data.user.id);
    localStorage.setItem("userEmail", data.user.email || profile.email || "");
    localStorage.setItem("userName", profile.full_name || "");
    localStorage.setItem("userRole", profile.role);

    // Redirect based on role
    const roleRedirects = {
      sale_associate: "pos.html",
      manager: "manager.html",
      admin: "admin.html",
    };

    const redirectTo = roleRedirects[profile.role];

    if (!redirectTo) {
      await window.supabase.auth.signOut();

      loginError.textContent =
        "Unknown role: " + profile.role + ". Contact admin.";
      loginError.className = "alert alert-error";
      return;
    }

    window.location.href = redirectTo;
  } catch (err) {
    console.error("Login error:", err);

    loginError.textContent = "Unexpected error: " + err.message;
    loginError.className = "alert alert-error";
  } finally {
    loginBtn.classList.remove("loading");
    loginBtn.disabled = false;
    loginBtn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Sign In';
  }
});
