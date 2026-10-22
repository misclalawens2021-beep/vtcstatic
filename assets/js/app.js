const $ = (id) => document.getElementById(id);

// --- CONFIGURATION SUPABASE ---
// ⚠️ Remplacez par les mêmes valeurs que dans auth.js
const SUPABASE_URL = 'https://syjvkankzdblvqnzrybm.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN5anZrYW5remRibHZxbnpyeWJtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI0ODI4NzUsImV4cCI6MjEwODA1ODg3NX0.qVstBxl-iEX6yRUH0sDF3VwGpADviprxzM6rCTwgGFo';

const isConfigured = !SUPABASE_URL.includes('votre-') && !SUPABASE_KEY.includes('votre-');

let supabaseClient = null;
if (!isConfigured) {
  console.warn('Supabase non configuré : renseignez SUPABASE_URL et SUPABASE_KEY dans app.js.');
} else if (!window.supabase) {
  console.warn('SDK Supabase non chargé (bloqueur de pub ?).');
} else {
  try {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  } catch (e) {
    console.warn('Supabase init échoué :', e.message);
  }
}

async function getSession() {
  if (!supabaseClient) return null;
  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    return session;
  } catch { return null; }
}

// --- ÉTAT GLOBAL ---
const state = { depart: null, arrivee: null, route: null, estimate: null, lastFocused: null };
const FR_GEO = 'https://data.geopf.fr/geocodage/search';
let map;
const markers = {};
const searchControllers = { depart: null, arrivee: null };

const money = n => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n);
const kmFormat = n => `${Number(n).toFixed(1).replace('.', ',')} km`;

function setStatus(s) { const el = $('status'); if (el) el.textContent = s; }

function localDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function showMessage(el, message, kind = '') {
  if (!el) return;
  el.textContent = message;
  el.classList.remove('status-error', 'status-success');
  if (kind) el.classList.add(kind === 'error' ? 'status-error' : 'status-success');
}

function getPoints() {
  return [state.depart, state.arrivee].filter(p => p && Number.isFinite(p.lat) && Number.isFinite(p.lon));
}

// --- Invalidation de l'estimation dès qu'un point change ---
function invalidateEstimate() {
  state.route = null;
  state.estimate = null;
  const pr = $('priceResult');
  if (pr) pr.hidden = true;
}

function clearPoint(type) {
  state[type] = null;
  const input = $(type);
  if (input) input.value = '';
  if (markers[type] && map) {
    map.removeLayer(markers[type]);
    delete markers[type];
  }
}

function setPoint(type, label, lat, lon) {
  // Toute modification de point invalide l'estimation précédente
  invalidateEstimate();

  state[type] = { label, lat: Number(lat), lon: Number(lon) };
  const input = $(type);
  if (input) input.value = label;
  state.lastFocused = type === 'depart' ? 'arrivee' : 'depart';

  if (map) {
    if (markers[type]) map.removeLayer(markers[type]);
    const m = L.marker([lat, lon], { draggable: true }).addTo(map)
      .bindPopup(type === 'depart' ? 'Départ' : 'Arrivée');
    m.on('dragend', async () => {
      invalidateEstimate();
      const p = m.getLatLng();
      setStatus('Recherche de l’adresse…');
      try {
        const r = await fetch(`https://data.geopf.fr/geocodage/reverse?lon=${p.lng}&lat=${p.lat}`);
        const j = await r.json();
        const f = j.features?.[0];
        const lbl = f?.properties?.label || `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;
        state[type] = { label: lbl, lat: p.lat, lon: p.lng };
        if (input) input.value = lbl;
        setStatus('');
      } catch {
        state[type] = { label: `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`, lat: p.lat, lon: p.lng };
        if (input) input.value = state[type].label;
        setStatus('');
      }
    });
    markers[type] = m;
    const pts = getPoints();
    if (pts.length === 2) map.fitBounds(pts.map(p => [p.lat, p.lon]), { padding: [30, 30] });
    else map.setView([lat, lon], 13);
  }
  const box = $(type + 'Suggestions');
  if (box) box.replaceChildren();
}

async function resolveCoords(type, lat, lng) {
  setStatus('Recherche de l’adresse…');
  try {
    const r = await fetch(`https://data.geopf.fr/geocodage/reverse?lon=${lng}&lat=${lat}`);
    const j = await r.json();
    const f = j.features?.[0];
    if (f && f.properties?.label) setPoint(type, f.properties.label, lat, lng);
    else setPoint(type, `${lat.toFixed(5)}, ${lng.toFixed(5)}`, lat, lng);
    setStatus('');
  } catch {
    setPoint(type, `${lat.toFixed(5)}, ${lng.toFixed(5)}`, lat, lng);
    setStatus('');
  }
}

async function searchAddress(type, query) {
  const box = $(type + 'Suggestions'); if (!box) return;
  box.replaceChildren();
  if (query.trim().length < 3) return;

  if (searchControllers[type]) searchControllers[type].abort();
  searchControllers[type] = new AbortController();
  const signal = searchControllers[type].signal;

  try {
    const res = await fetch(
      `${FR_GEO}?q=${encodeURIComponent(query)}&limit=5&index=address&returntruegeometry=false`,
      { signal }
    );
    if (!res.ok) throw new Error();
    const json = await res.json();
    (Array.isArray(json.features) ? json.features : []).forEach(f => {
      const p = f.properties || {};
      const coords = f.geometry?.coordinates;
      if (!coords) return;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'suggestion';
      b.setAttribute('role', 'option');
      b.textContent = p.label || p.name || query;
      b.addEventListener('mousedown', e => e.preventDefault());
      b.addEventListener('click', () => setPoint(type, b.textContent, coords[1], coords[0]));
      box.append(b);
    });
    if (!box.children.length) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'suggestion'; b.disabled = true;
      b.textContent = 'Aucune adresse trouvée';
      box.append(b);
    }
  } catch (e) {
    if (e.name === 'AbortError') return;
    setStatus('Recherche d’adresse indisponible.');
  }
}

['depart', 'arrivee'].forEach(type => {
  const input = $(type); if (!input) return;
  const wrap = input.closest('.input-wrap');
  let timer;
  input.addEventListener('focus', () => { state.lastFocused = type; });
  input.addEventListener('input', () => {
    // Saisie manuelle : on considère le point comme inconnu
    state[type] = null;
    invalidateEstimate();
    if (markers[type] && map) {
      map.removeLayer(markers[type]);
      delete markers[type];
    }
    clearTimeout(timer);
    timer = setTimeout(() => searchAddress(type, input.value), 300);
  });
  if (wrap) {
    wrap.addEventListener('focusout', e => {
      if (!wrap.contains(e.relatedTarget)) {
        setTimeout(() => {
          const box = $(type + 'Suggestions');
          if (box && !wrap.contains(document.activeElement)) box.replaceChildren();
        }, 150);
      }
    });
  }
});

function initMap() {
  if (!window.L || !$('map')) return;
  map = L.map('map').setView([48.8566, 2.3522], 6);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© OpenStreetMap'
  }).addTo(map);
  map.on('click', e => {
    invalidateEstimate();
    const type = state.lastFocused || (state.depart ? 'arrivee' : 'depart');
    resolveCoords(type, e.latlng.lat, e.latlng.lng);
  });
  setTimeout(() => map.invalidateSize(), 400);
}

// --- BOUTON INVERSER ---
$('swap')?.addEventListener('click', () => {
  invalidateEstimate();
  const a = state.depart, b = state.arrivee;

  if (b) setPoint('depart', b.label, b.lat, b.lon);
  else clearPoint('depart');

  if (a) setPoint('arrivee', a.label, a.lat, a.lon);
  else clearPoint('arrivee');
});

// --- GÉOLOCALISATION ---
$('locate')?.addEventListener('click', () => {
  if (!navigator.geolocation) { setStatus('La géolocalisation n’est pas disponible.'); return; }
  setStatus('Localisation…');
  navigator.geolocation.getCurrentPosition(
    pos => resolveCoords('depart', pos.coords.latitude, pos.coords.longitude),
    () => setStatus('Autorisez la localisation.'),
    { timeout: 10000 }
  );
});

// --- CALCUL DISTANCE ---
function haversine(a, b) {
  const rad = x => x * Math.PI / 180, R = 6371;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const v = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(v));
}

function validateDateTime() {
  const dv = $('date')?.value, hv = $('heure')?.value;
  if (!dv || !hv) return 'Choisissez une date et une heure.';
  const dt = new Date(`${dv}T${hv}`);
  if (isNaN(dt.getTime())) return 'Date ou heure invalide.';
  const now = new Date();
  now.setSeconds(0, 0);
  if (dt < now) return 'Choisissez une date et une heure futures.';
  return null;
}

async function resolveAddressFromInput(type) {
  const input = $(type);
  const query = input?.value.trim();
  if (!query) return false;

  const response = await fetch(
    `${FR_GEO}?q=${encodeURIComponent(query)}&limit=1&index=address&returntruegeometry=false`
  );
  if (!response.ok) throw new Error('La recherche d’adresse est momentanément indisponible.');
  const result = await response.json();
  const feature = result.features?.[0];
  const coordinates = feature?.geometry?.coordinates;
  if (!coordinates || !Number.isFinite(coordinates[0]) || !Number.isFinite(coordinates[1])) {
    return false;
  }

  const properties = feature.properties || {};
  setPoint(type, properties.label || properties.name || query, coordinates[1], coordinates[0]);
  return true;
}

// --- FORMULAIRE DE TRAJET ---
$('rideForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  const departInput = $('depart');
  const arriveeInput = $('arrivee');
  const passengersInput = $('passagers');
  if (!departInput.value.trim()) { setStatus('Saisissez une adresse de départ.'); departInput.focus(); return; }
  if (!arriveeInput.value.trim()) { setStatus('Saisissez une adresse d’arrivée.'); arriveeInput.focus(); return; }
  const dtErr = validateDateTime();
  if (dtErr) { setStatus(dtErr); $('date').focus(); return; }
  const passengers = Number(passengersInput.value);
  if (!Number.isInteger(passengers) || passengers < 1 || passengers > 6) {
    setStatus('Le nombre de passagers doit être compris entre 1 et 6.');
    passengersInput.focus();
    return;
  }

  const btn = $('calculate');
  const originalHTML = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = 'Préparation du trajet…';

  try {
    if (!state.depart) {
      setStatus('Recherche de l’adresse de départ…');
      if (!(await resolveAddressFromInput('depart'))) {
        setStatus('Adresse de départ introuvable. Choisissez une adresse dans les suggestions.');
        departInput.focus();
        return;
      }
    }
    if (!state.arrivee) {
      setStatus('Recherche de l’adresse d’arrivée…');
      if (!(await resolveAddressFromInput('arrivee'))) {
        setStatus('Adresse d’arrivée introuvable. Choisissez une adresse dans les suggestions.');
        arriveeInput.focus();
        return;
      }
    }
    if (state.depart.lat === state.arrivee.lat && state.depart.lon === state.arrivee.lon) {
      setStatus('Le départ et l’arrivée doivent être différents.');
      arriveeInput.focus();
      return;
    }

    btn.textContent = 'Calcul en cours…';
    setStatus('Calcul de la distance routière…');
    let distance, duration;
    const coords = `${state.depart.lon},${state.depart.lat};${state.arrivee.lon},${state.arrivee.lat}`;
    try {
      const r = await fetch(
        `https://router.project-osrm.org/route/v1/driving/${coords}?overview=false`
      );
      const j = await r.json();
      if (j.code !== 'Ok' || !j.routes?.length) throw new Error();
      distance = j.routes[0].distance / 1000;
      duration = Math.max(1, Math.round(j.routes[0].duration / 60));
    } catch {
      distance = haversine(state.depart, state.arrivee) * 1.25;
      duration = Math.round(distance / 45 * 60);
    }
    const veh = $('vehicule').value;
    const base = veh === 'premium' ? 12 : veh === 'van' ? 8 : 5;
    const rate = veh === 'premium' ? 2.2 : veh === 'van' ? 1.8 : 1.5;
    const hour = Number(($('heure').value || '0:0').split(':')[0]);
    const night = hour >= 22 || hour < 6;
    const total = (base + distance * rate) * (night ? 1.2 : 1);

    state.route = { distance, duration };
    state.estimate = { base, rate, night, total };

    $('distance').textContent = kmFormat(distance);
    $('duration').textContent = duration < 60
      ? `${duration} min`
      : `${Math.floor(duration / 60)} h ${duration % 60} min`;
    $('price').textContent = money(total);
    $('priceResult').hidden = false;
    $('priceResult').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    setStatus('Estimation calculée.');
  } catch (error) {
    console.error('Erreur de calcul du trajet:', error);
    setStatus(error instanceof Error ? error.message : 'Le calcul a échoué. Réessayez.');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHTML;
  }
});

['date', 'heure', 'vehicule', 'passagers'].forEach(id => {
  const el = $(id); if (!el) return;
  el.addEventListener('change', () => {
    invalidateEstimate();
    setStatus('Paramètres modifiés : recalculez le prix.');
  });
});

$('showBooking')?.addEventListener('click', () => {
  if (!state.estimate) { setStatus('Calculez d’abord le trajet.'); return; }
  $('reservation').scrollIntoView({ behavior: 'smooth' });
});

// --- PRÉ-REMPLISSAGE DU FORMULAIRE DE RÉSERVATION SI CONNECTÉ ---
async function prefillBookingForm() {
  if (!supabaseClient) return;
  const session = await getSession();
  if (!session) return;

  const form = $('bookingForm');
  if (!form) return;

  if (session.user.email) form.email.value = session.user.email;

  try {
    const { data: profile } = await supabaseClient
      .from('profiles')
      .select('nom, prenom, telephone')
      .eq('id', session.user.id)
      .maybeSingle();
    if (profile) {
      if (profile.prenom) form.prenom.value = profile.prenom;
      if (profile.nom) form.nom.value = profile.nom;
      if (profile.telephone) form.telephone.value = profile.telephone;
    }
  } catch { /* Silencieux : le pré-remplissage n'est pas critique */ }
}

// --- ENREGISTREMENT DE LA RÉSERVATION (SUPABASE) ---
$('bookingForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  const msg = $('bookingMessage');
  if (!state.depart || !state.arrivee || !state.route || !state.estimate) {
    showMessage(msg, 'Calculez d’abord votre trajet.', 'error'); return;
  }
  if (!supabaseClient) {
    showMessage(msg, 'Le service de réservation n’est pas disponible pour le moment.', 'error');
    return;
  }

  const btn = e.currentTarget.querySelector('button[type="submit"]');
  btn.disabled = true;
  const originalHTML = btn.innerHTML;
  btn.textContent = 'Envoi…';

  const ref = 'NOC-' + Math.random().toString(36).substring(2, 8).toUpperCase();
  const session = await getSession();

  const payload = {
    reference: ref,
    user_id: session ? session.user.id : null,
    prenom: e.target.prenom.value.trim(),
    nom: e.target.nom.value.trim(),
    email: e.target.email.value.trim(),
    telephone: e.target.telephone.value.trim(),
    note: e.target.note.value.trim() || null,
    depart: state.depart.label,
    arrivee: state.arrivee.label,
    depart_lat: state.depart.lat,
    depart_lng: state.depart.lon,
    arrivee_lat: state.arrivee.lat,
    arrivee_lng: state.arrivee.lon,
    date_trajet: $('date').value,
    heure_trajet: $('heure').value,
    vehicule: $('vehicule').value,
    passagers: Number($('passagers').value),
    distance_km: Number(state.route.distance.toFixed(1)),
    duree_min: Math.round(state.route.duration),
    prix_total: Number(state.estimate.total.toFixed(2))
  };

  try {
    const { error } = await supabaseClient.from('reservations').insert([payload]);
    if (error) throw error;
    showMessage(msg, `Demande enregistrée. Référence : ${ref}`, 'success');
    e.target.reset();
    invalidateEstimate();
  } catch (err) {
    console.error('Erreur enregistrement réservation:', err);
    const message = err.code === '42501' || err.message?.includes('row-level security')
      ? 'Supabase a refusé la réservation. Exécutez la mise à jour de sql/database.sql dans le SQL Editor du projet pour appliquer la politique RLS.'
      : `Erreur : ${err.message}`;
    showMessage(msg, message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHTML;
  }
});

// --- AVIS (LECTURE / ÉCRITURE) ---
async function loadReviews() {
  const list = $('reviewList'); if (!list) return;
  const countEl = $('reviewCount'), avgEl = $('average');

  if (!supabaseClient) {
    list.innerHTML = '<p class="review-empty">Les avis ne sont pas disponibles (base non configurée).</p>';
    if (countEl) countEl.textContent = 'Indisponible';
    return;
  }

  list.innerHTML = '<p class="muted">Chargement…</p>';

  try {
    const { data: avis, error } = await supabaseClient
      .from('avis')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;

    const total = avis.length;
    const sum = avis.reduce((acc, a) => acc + Number(a.note), 0);
    const avg = total ? sum / total : 0;

    if (avgEl) avgEl.textContent = total ? avg.toFixed(1).replace('.', ',') : '—';
    if (countEl) countEl.textContent = total ? `${total} avis` : 'Aucun avis';

    list.replaceChildren();
    if (!total) {
      const empty = document.createElement('p');
      empty.className = 'review-empty';
      empty.textContent = 'Pas encore d’avis. Soyez le premier !';
      list.append(empty);
      return;
    }

    avis.forEach(a => {
      const card = document.createElement('article'); card.className = 'review';
      const head = document.createElement('header');
      const name = document.createElement('strong');
      const date = document.createElement('small');
      const stars = document.createElement('div');
      const body = document.createElement('p');
      name.textContent = a.nom;
      date.textContent = new Date(a.created_at).toLocaleDateString('fr-FR');
      stars.className = 'stars';
      stars.textContent = '★'.repeat(Number(a.note)) + '☆'.repeat(5 - Number(a.note));
      body.textContent = a.commentaire;
      head.append(name, date); card.append(head, stars, body); list.append(card);
    });
  } catch (err) {
    console.error('Erreur chargement avis:', err);
    list.innerHTML = '<p class="review-empty">Impossible de charger les avis.</p>';
    if (countEl) countEl.textContent = 'Erreur de connexion';
  }
}

$('reviewForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  const msg = $('reviewMessage');
  if (!supabaseClient) {
    showMessage(msg, 'Les avis ne sont pas disponibles pour le moment.', 'error');
    return;
  }

  const btn = e.currentTarget.querySelector('button[type="submit"]');
  btn.disabled = true;
  showMessage(msg, 'Publication…');

  const session = await getSession();
  const newAvis = {
    nom: e.target.nom.value.trim(),
    note: Number(e.target.note.value),
    commentaire: e.target.commentaire.value.trim(),
    user_id: session ? session.user.id : null
  };

  try {
    const { error } = await supabaseClient.from('avis').insert([newAvis]);
    if (error) throw error;
    showMessage(msg, 'Merci pour votre avis !', 'success');
    e.target.reset();
    loadReviews();
  } catch (err) {
    showMessage(msg, `Erreur : ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
  }
});

// --- DEFAULTS & INIT ---
const dateEl = $('date');
if (dateEl) { dateEl.min = localDateString(); if (!dateEl.value) dateEl.value = dateEl.min; }

const heureEl = $('heure');
if (heureEl && !heureEl.value) {
  const now = new Date();
  heureEl.value = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

const yearEl = $('year'); if (yearEl) yearEl.textContent = new Date().getFullYear();

// --- THÈME ---
const themeToggle = $('themeToggle');
const getSavedTheme = () => { try { return localStorage.getItem('noctis-theme'); } catch { return null; } };
if (getSavedTheme() === 'light') document.body.classList.add('light-theme');

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

initMap();
loadReviews();
prefillBookingForm();