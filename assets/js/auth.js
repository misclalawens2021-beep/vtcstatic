const $ = id => document.getElementById(id);

// --- CONFIGURATION SUPABASE ---
// ⚠️ Remplacez par les mêmes valeurs que dans app.js
const SUPABASE_URL = 'https://syjvkankzdblvqnzrybm.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN5anZrYW5remRibHZxbnpyeWJtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI0ODI4NzUsImV4cCI6MjEwODA1ODg3NX0.qVstBxl-iEX6yRUH0sDF3VwGpADviprxzM6rCTwgGFo';

const isConfigured = !SUPABASE_URL.includes('votre-') && !SUPABASE_KEY.includes('votre-');

let supabaseClient = null;
let supabaseError = null;

try {
  if (!window.supabase) {
    throw new Error("Le SDK Supabase n'a pas pu être chargé (bloqueur de pub ou connexion).");
  }
  if (!isConfigured) {
    throw new Error('Veuillez configurer SUPABASE_URL et SUPABASE_KEY dans auth.js.');
  }
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
} catch (error) {
  supabaseError = error.message;
  console.error("Erreur d'initialisation Supabase :", error.message);
}

// --- THÈME ---
try {
  if (localStorage.getItem('noctis-theme') === 'light') document.body.classList.add('light-theme');
} catch {}

const themeToggle = $('themeToggle');
function updateThemeButton() {
  if (!themeToggle) return;
  const light = document.body.classList.contains('light-theme');
  themeToggle.innerHTML = light ? '☾ <span>Thème sombre</span>' : '☼ <span>Thème clair</span>';
  themeToggle.setAttribute('aria-label', light ? 'Activer le thème sombre' : 'Activer le thème clair');
}
if (themeToggle) {
  themeToggle.addEventListener('click', () => {
    document.body.classList.toggle('light-theme');
    try {
      localStorage.setItem(
        'noctis-theme',
        document.body.classList.contains('light-theme') ? 'light' : 'dark'
      );
    } catch {}
    updateThemeButton();
  });
  updateThemeButton();
}

// --- BASCULE CONNEXION / INSCRIPTION ---
function switchMode(mode) {
  const login = mode === 'login';
  $('loginPanel').hidden = !login;
  $('registerPanel').hidden = login;
  $('loginTab').classList.toggle('active', login);
  $('registerTab').classList.toggle('active', !login);
  $('loginTab').setAttribute('aria-selected', String(login));
  $('registerTab').setAttribute('aria-selected', String(!login));
  message('loginMessage', '');
  message('registerMessage', '');
  ['loginPassword', 'registerPassword', 'confirmPassword'].forEach(id => {
    const el = $(id); if (el) el.value = '';
  });
  const meter = $('passwordMeter'); if (meter) meter.hidden = true;
}

document.querySelectorAll('[data-switch]').forEach(b =>
  b.addEventListener('click', () => switchMode(b.dataset.switch))
);
$('loginTab')?.addEventListener('click', () => switchMode('login'));
$('registerTab')?.addEventListener('click', () => switchMode('register'));

// --- AFFICHER / MASQUER LE MOT DE PASSE ---
document.querySelectorAll('[data-toggle-password]').forEach(b => b.addEventListener('click', () => {
  const field = $(b.dataset.togglePassword);
  const reveal = field.type === 'password';
  field.type = reveal ? 'text' : 'password';
  b.textContent = reveal ? 'Masquer' : 'Afficher';
  b.setAttribute('aria-label', reveal ? 'Masquer le mot de passe' : 'Afficher le mot de passe');
}));

// --- MESSAGES ---
function message(id, text, kind = '') {
  const el = $(id); if (!el) return;
  el.textContent = text;
  el.classList.remove('error', 'success');
  if (kind) el.classList.add(kind);
}

// --- INDICATEUR DE FORCE DU MOT DE PASSE ---
const pwd = $('registerPassword');
const meter = $('passwordMeter');
if (pwd && meter) {
  const bar = meter.querySelector('.password-meter-bar span');
  const label = meter.querySelector('.password-meter-label');
  pwd.addEventListener('input', () => {
    const v = pwd.value;
    if (!v) { meter.hidden = true; return; }
    meter.hidden = false;
    let score = 0;
    if (v.length >= 10) score++;
    if (v.length >= 14) score++;
    if (/[A-Z]/.test(v) && /[a-z]/.test(v)) score++;
    if (/\d/.test(v)) score++;
    if (/[^A-Za-z0-9]/.test(v)) score++;
    const labels = ['Très faible', 'Faible', 'Moyen', 'Bon', 'Excellent', 'Très fort'];
    const colors = ['#ff7a7a', '#ff9f6a', '#f0c860', '#b8d36a', '#78d3a4', '#78d3a4'];
    const idx = Math.min(score, labels.length - 1);
    if (bar) {
      bar.style.width = `${(idx + 1) / labels.length * 100}%`;
      bar.style.background = colors[idx];
    }
    if (label) {
      label.textContent = labels[idx];
      label.style.color = colors[idx];
    }
  });
}

// --- VALIDATION E-MAIL ---
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// --- CONNEXION ---
$('loginForm')?.addEventListener('submit', async event => {
  event.preventDefault();
  if (!supabaseClient) {
    message('loginMessage', supabaseError || "La connexion à la base de données n'est pas configurée.", 'error');
    return;
  }

  const email = $('loginEmail').value.trim();
  const password = $('loginPassword').value;

  if (!isValidEmail(email)) {
    message('loginMessage', 'Adresse e-mail invalide.', 'error');
    $('loginEmail').focus();
    return;
  }
  if (!password) {
    message('loginMessage', 'Saisissez votre mot de passe.', 'error');
    $('loginPassword').focus();
    return;
  }

  const btn = $('loginForm').querySelector('button[type=submit]');
  btn.disabled = true;
  message('loginMessage', 'Connexion en cours…');

  try {
    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;

    message('loginMessage', 'Connexion réussie. Redirection…', 'success');
    setTimeout(() => window.location.href = 'index.html', 800);
  } catch (error) {
    console.error('Erreur de connexion:', error);
    let msg = error.message;
    if (msg === 'Invalid login credentials') msg = 'E-mail ou mot de passe incorrect.';
    if (msg === 'Email not confirmed') msg = 'Veuillez confirmer votre e-mail avant de vous connecter (vérifiez vos spams).';
    if (msg === 'Database error saving new user') {
      msg = 'Supabase a renvoyé une erreur interne de base de données pendant l’authentification. Vérifiez les journaux Auth du projet ; si l’erreur survient à la création du compte, exécutez sql/database.sql dans le SQL Editor.';
    }
    message('loginMessage', msg, 'error');
  } finally {
    btn.disabled = false;
  }
});

// --- INSCRIPTION ---
$('registerForm')?.addEventListener('submit', async event => {
  event.preventDefault();
  if (!supabaseClient) {
    message('registerMessage', supabaseError || "La connexion à la base de données n'est pas configurée.", 'error');
    return;
  }

  const prenom = $('firstName').value.trim();
  const nom = $('lastName').value.trim();
  const email = $('registerEmail').value.trim();
  const telephone = $('phone').value.trim();
  const password = $('registerPassword').value;
  const confirm = $('confirmPassword').value;
  const consent = $('consent').checked;

  // Validation manuelle (le formulaire a novalidate)
  if (prenom.length < 1) {
    message('registerMessage', 'Indiquez votre prénom.', 'error');
    $('firstName').focus(); return;
  }
  if (nom.length < 1) {
    message('registerMessage', 'Indiquez votre nom.', 'error');
    $('lastName').focus(); return;
  }
  if (!isValidEmail(email)) {
    message('registerMessage', 'Adresse e-mail invalide.', 'error');
    $('registerEmail').focus(); return;
  }
  if (password.length < 10) {
    message('registerMessage', 'Le mot de passe doit contenir au moins 10 caractères.', 'error');
    $('registerPassword').focus(); return;
  }
  if (password !== confirm) {
    message('registerMessage', 'Les deux mots de passe ne correspondent pas.', 'error');
    $('confirmPassword').focus(); return;
  }
  if (!consent) {
    message('registerMessage', 'Merci de confirmer que les informations saisies sont exactes.', 'error');
    return;
  }

  const btn = $('registerForm').querySelector('button[type=submit]');
  btn.disabled = true;
  message('registerMessage', 'Création du compte en cours…');

  try {
    const { data, error } = await supabaseClient.auth.signUp({
      email,
      password,
      options: {
        data: { prenom, nom, telephone }
      }
    });
    if (error) throw error;

    if (data.user && data.session === null) {
      message('registerMessage', 'Compte créé ! Vérifiez vos e-mails pour confirmer votre adresse.', 'success');
    } else {
      message('registerMessage', 'Compte créé avec succès. Redirection…', 'success');
      setTimeout(() => window.location.href = 'index.html', 1000);
    }
  } catch (error) {
    console.error("Erreur d'inscription:", error);
    let msg = error.message;
    if (msg.includes('User already registered')) msg = 'Un compte existe déjà avec cet e-mail.';
    if (msg === 'Database error saving new user') {
      msg = 'Supabase a refusé la création du compte à cause d’une erreur de base de données. Ce message ne précise pas la cause : consultez Supabase → Logs → Auth et Postgres à l’heure de l’essai. Si le schéma du projet n’a pas été mis à jour, exécutez sql/database.sql dans le SQL Editor.';
    }
    message('registerMessage', msg, 'error');
  } finally {
    btn.disabled = false;
  }
});

// --- ANNÉE ---
const yearEl = $('year');
if (yearEl) yearEl.textContent = new Date().getFullYear();