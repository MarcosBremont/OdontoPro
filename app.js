import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, getDocs, setDoc, deleteDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCMOJ9k7fFX5_tOi_JBCrswLC5HK9ITSY4",
  authDomain: "odontopro-c0a1f.firebaseapp.com",
  projectId: "odontopro-c0a1f",
  storageBucket: "odontopro-c0a1f.firebasestorage.app",
  messagingSenderId: "468708744352",
  appId: "1:468708744352:web:04e9a8a1ee7f00eaf3fdc5",
  measurementId: "G-7WLNXC49ES"
};

const $ = (selector) => document.querySelector(selector);
const STORE = "odontopro-data-v2";
const defaultState = () => ({ settings: { general: 50, specialist: 60, currency: "DOP" }, records: [], ownerId: null });
let state;
try { state = JSON.parse(localStorage.getItem(STORE) || localStorage.getItem("odontopro-data-v1")) || defaultState(); } catch { state = defaultState(); }
state.settings ||= defaultState().settings;
state.settings.currency ||= "DOP";
state.records ||= [];

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();
let activeUser = null;
let unsubscribeSettings = null;
let unsubscribeRecords = null;
const authPersistenceReady = setPersistence(auth, browserLocalPersistence).catch(error => console.error("No se pudo preparar la sesion:", error));

const currency = (value) => {
  const prefix = state.settings.currency === "USD" ? "US$" : "RD$";
  return `${prefix} ${new Intl.NumberFormat("es-DO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;
};
const saveLocal = () => localStorage.setItem(STORE, JSON.stringify(state));
const percentageFor = (type) => state.settings[type];
const createId = () => globalThis.crypto?.randomUUID?.() || `procedure-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const status = (message, style = "") => { const el = $("#syncStatus"); el.textContent = message; el.className = `sync-status ${style}`; };
const settingsDoc = () => doc(db, "usuarios", activeUser.uid, "datos", "finanzas");
const recordsRef = () => collection(db, "usuarios", activeUser.uid, "datos", "finanzas", "procedimientos");

function updatePreview() {
  const amount = Number($("#amount").value) || 0;
  const percent = percentageFor($("#type").value);
  $("#previewProfessional").textContent = currency(amount * percent / 100);
  $("#previewClinic").textContent = currency(amount * (100 - percent) / 100);
}

function render() {
  const totals = state.records.reduce((sum, item) => ({ billed: sum.billed + item.amount, professional: sum.professional + item.professional, clinic: sum.clinic + item.clinic }), { billed: 0, professional: 0, clinic: 0 });
  $("#totalBilled").textContent = currency(totals.billed);
  $("#totalProfessional").textContent = currency(totals.professional);
  $("#totalClinic").textContent = currency(totals.clinic);
  $("#amountLabel").textContent = `Monto cobrado (${state.settings.currency === "DOP" ? "RD$" : "US$"})`;
  $("#professionalPercent").textContent = totals.billed ? `${(totals.professional / totals.billed * 100).toFixed(1)}% de participacion promedio` : "Tu participacion en los ingresos";
  $("#recordsBody").innerHTML = state.records.map(item => `<tr><td>${escapeHTML(item.patient)}<small>${escapeHTML(item.procedure)} - ${formatDate(item.date)}</small></td><td><span class="tag ${item.type}">${item.type === "general" ? "General" : "Especialista"}</span></td><td>${currency(item.amount)}</td><td class="you-money">${currency(item.professional)}<small>${item.percent}%</small></td><td><button class="delete" data-id="${item.id}" aria-label="Eliminar registro">x</button></td></tr>`).join("");
  $("#emptyState").hidden = state.records.length > 0;
  $("#clearAll").hidden = state.records.length === 0;
}

function escapeHTML(text) { const el = document.createElement("div"); el.textContent = text; return el.innerHTML; }
function formatDate(date) { return new Intl.DateTimeFormat("es-DO", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${date}T12:00:00`)); }
async function saveSettingsToCloud() { await setDoc(settingsDoc(), { ...state.settings, updatedAt: Date.now() }, { merge: true }); }
async function addRecordToCloud(record) { await setDoc(doc(recordsRef(), record.id), record); }
async function removeRecordFromCloud(id) { await deleteDoc(doc(recordsRef(), id)); }

function stopListeners() { unsubscribeSettings?.(); unsubscribeRecords?.(); unsubscribeSettings = null; unsubscribeRecords = null; }
async function loadUserData(user) {
  activeUser = user;
  if (state.ownerId && state.ownerId !== user.uid) state = defaultState();
  const [remoteSettings, remoteRecords] = await Promise.all([getDoc(settingsDoc()), getDocs(recordsRef())]);
  if (remoteSettings.exists() || !remoteRecords.empty) {
    if (remoteSettings.exists()) state.settings = { ...state.settings, ...remoteSettings.data() };
    state.records = remoteRecords.docs.map(item => item.data());
  } else {
    await saveSettingsToCloud();
    await Promise.all(state.records.map(addRecordToCloud));
  }
  state.ownerId = user.uid;
  saveLocal(); render(); updatePreview(); status("Datos sincronizados", "connected");
  unsubscribeSettings = onSnapshot(settingsDoc(), snapshot => { if (snapshot.exists() && activeUser?.uid === user.uid) { state.settings = { ...state.settings, ...snapshot.data() }; saveLocal(); render(); updatePreview(); } });
  unsubscribeRecords = onSnapshot(recordsRef(), snapshot => { if (activeUser?.uid === user.uid) { state.records = snapshot.docs.map(item => item.data()); saveLocal(); render(); } });
}

$("#date").value = new Date().toISOString().slice(0, 10);
$("#amount").addEventListener("input", updatePreview);
$("#type").addEventListener("change", updatePreview);
$("#googleLogin").addEventListener("click", async () => {
  $("#authMessage").textContent = "Abriendo Google...";
  try {
    await authPersistenceReady;
    await signInWithPopup(auth, provider);
  } catch (error) {
    console.error(error);
    const message = error.code === "auth/popup-blocked" ? "El navegador bloqueo la ventana de Google. Permite las ventanas emergentes e intentalo otra vez." : "No se pudo iniciar sesion. Intentalo de nuevo.";
    $("#authMessage").textContent = message;
  }
});
$("#logoutButton").addEventListener("click", () => signOut(auth));
$("#procedureForm").addEventListener("submit", async event => {
  event.preventDefault();
  const amount = Number($("#amount").value), type = $("#type").value, percent = percentageFor(type);
  const record = { id: createId(), patient: $("#patient").value.trim(), procedure: $("#procedure").value.trim(), type, amount, percent, professional: amount * percent / 100, clinic: amount * (100 - percent) / 100, date: $("#date").value };
  state.records.unshift(record); saveLocal(); render(); event.target.reset(); $("#date").value = new Date().toISOString().slice(0, 10); updatePreview();
  try { await addRecordToCloud(record); } catch (error) { console.error(error); status("No se pudo guardar", "error"); }
});
$("#recordsBody").addEventListener("click", async event => { const id = event.target.dataset.id; if (!id) return; state.records = state.records.filter(record => record.id !== id); saveLocal(); render(); try { await removeRecordFromCloud(id); } catch (error) { console.error(error); status("No se pudo eliminar", "error"); } });
$("#clearAll").addEventListener("click", async () => { if (!confirm("Eliminar todos los procedimientos registrados?")) return; const deleted = [...state.records]; state.records = []; saveLocal(); render(); try { await Promise.all(deleted.map(record => removeRecordFromCloud(record.id))); } catch (error) { console.error(error); status("No se pudo eliminar", "error"); } });
$("#openSettings").addEventListener("click", () => { $("#generalPercent").value = state.settings.general; $("#specialistPercent").value = state.settings.specialist; $("#currencySelect").value = state.settings.currency; $("#settingsDialog").showModal(); });
$("#closeSettings").addEventListener("click", () => $("#settingsDialog").close());
$("#saveSettings").addEventListener("click", async () => {
  const general = Number($("#generalPercent").value), specialist = Number($("#specialistPercent").value);
  if (!Number.isFinite(general) || !Number.isFinite(specialist) || general < 0 || general > 100 || specialist < 0 || specialist > 100) return alert("Ingresa porcentajes entre 0 y 100.");
  state.settings = { general, specialist, currency: $("#currencySelect").value }; saveLocal(); $("#settingsDialog").close(); updatePreview(); render();
  try { await saveSettingsToCloud(); } catch (error) { console.error(error); status("No se pudo guardar", "error"); }
});

onAuthStateChanged(auth, async user => {
  stopListeners();
  if (!user) { activeUser = null; $("#appShell").hidden = true; $("#authScreen").hidden = false; $("#authMessage").textContent = "Usa tu cuenta profesional para proteger los datos de pacientes."; return; }
  $("#authScreen").hidden = true; $("#appShell").hidden = false; $("#userName").textContent = user.displayName || user.email;
  status("Cargando datos...");
  try { await loadUserData(user); } catch (error) { console.error(error); status("Error de permisos", "error"); }
});

render(); updatePreview();
