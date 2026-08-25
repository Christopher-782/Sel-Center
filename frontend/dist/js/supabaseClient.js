// frontend/js/supabaseClient.js

// Replace these with your actual project values
const SUPABASE_URL = "https://hupdmwnbrhysnjyoomrm.supabase.co"; // NO /rest/v1/
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1cGRtd25icmh5c25qeW9vbXJtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyNzI3ODUsImV4cCI6MjA5Njg0ODc4NX0.Ozg8Vkhg3t2oH07aFr5s2BCvkuXyKp79VqJp6T7Ohq4";

// Attach client to window so auth.js can access it
window.supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
