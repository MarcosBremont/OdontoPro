import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
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
const STORE = "odontopro-data-v1";
const settingsRefPath = ["odontopro", "configuracion"];
const recordsCollectionPath = ["odontopro", "configuracion", "procedimientos"];
let db;
let state;

try {
  state = JSON.parse(localStorage.getItem(STORE)) || { settings: { general: 50, specialist: 60, currency: "DOP" }, records: [] };
} catch {
  state = { settings: { general: 50, specialist: 60, currency: "DOP" }, records: [] };
}
state.settings ||= { general: 50, specialist: 60, currency: "DOP" };
state.settings.currency ||= "DOP";
state.records ||= [];

const currency = (value) => {
  const prefix = state.settings.currency === "USD" ? "US$" : "RD$";
  return `${prefix} ${new Intl.NumberFormat("es-DO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;
};
const saveLocal = () => localStorage.setItem(STORE, JSON.stringify(state));
const percentageFor = (type) => state.settings[type];
const status = (message, style = "") => { const el = $("#syncStatus"); el.textContent = message; el.className = `sync-status ${style}`; };
const settingsDoc = () => doc(db, ...settingsRefPath);
const recordsRef = () => collection(db, ...recordsCollectionPath);

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
  $("#professionalPercent").textContent = totals.billed ? `${(totals.professional / totals.billed * 100).toFixed(1)}% de participación promedio` : "Tu participación en los ingresos";
  const body = $("#recordsBody");
  body.innerHTML = state.records.map(item => `<tr><td>${escapeHTML(item.patient)}<small>${escapeHTML(item.procedure)} · ${formatDate(item.date)}</small></td><td><span class="tag ${item.type}">${item.type === "general" ? "General" : "Especialista"}</span></td><td>${currency(item.amount)}</td><td class="you-money">${currency(item.professional)}<small>${item.percent}%</small></td><td><button class="delete" data-id="${item.id}" aria-label="Eliminar registro">×</button></td></tr>`).join("");
  $("#emptyState").hidden = state.records.length > 0;
  $("#clearAll").hidden = state.records.length === 0;
}

function escapeHTML(text) { const el = document.createElement("div"); el.textContent = text; return el.innerHTML; }
function formatDate(date) { return new Intl.DateTimeFormat("es-DO", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${date}T12:00:00`)); }

async function saveSettingsToCloud() { await setDoc(settingsDoc(), { ...state.settings, updatedAt: Date.now() }, { merge: true }); }
async function addRecordToCloud(record) { await setDoc(doc(recordsRef(), record.id), record); }
async function removeRecordFromCloud(id) { await deleteDoc(doc(recordsRef(), id)); }

async function startFirebase() {
  try {
    db = getFirestore(initializeApp(firebaseConfig));
    const [remoteSettings, remoteRecords] = await Promise.all([getDoc(settingsDoc()), getDocs(recordsRef())]);
    if (remoteSettings.exists() || !remoteRecords.empty) {
      if (remoteSettings.exists()) state.settings = { ...state.settings, ...remoteSettings.data() };
      state.records = remoteRecords.docs.map(item => item.data());
      saveLocal();
    } else {
      await saveSettingsToCloud();
      await Promise.all(state.records.map(addRecordToCloud));
    }
    render(); updatePreview(); status("Datos sincronizados", "connected");
    onSnapshot(settingsDoc(), snapshot => { if (snapshot.exists()) { state.settings = { ...state.settings, ...snapshot.data() }; saveLocal(); render(); updatePreview(); } });
    onSnapshot(recordsRef(), snapshot => { state.records = snapshot.docs.map(item => item.data()); saveLocal(); render(); });
  } catch (error) {
    console.error("Firebase no disponible:", error);
    status("Sin conexión a Firebase", "error");
  }
}

$("#date").value = new Date().toISOString().slice(0, 10);
$("#amount").addEventListener("input", updatePreview);
$("#type").addEventListener("change", updatePreview);
$("#procedureForm").addEventListener("submit", async event => {
  event.preventDefault();
  const amount = Number($("#amount").value), type = $("#type").value, percent = percentageFor(type);
  const record = { id: crypto.randomUUID(), patient: $("#patient").value.trim(), procedure: $("#procedure").value.trim(), type, amount, percent, professional: amount * percent / 100, clinic: amount * (100 - percent) / 100, date: $("#date").value };
  state.records.unshift(record); saveLocal(); render();
  event.target.reset(); $("#date").value = new Date().toISOString().slice(0, 10); updatePreview();
  if (db) try { await addRecordToCloud(record); } catch { status("No se pudo guardar en Firebase", "error"); }
});
$("#recordsBody").addEventListener("click", async event => { const id = event.target.dataset.id; if (!id) return; state.records = state.records.filter(record => record.id !== id); saveLocal(); render(); if (db) try { await removeRecordFromCloud(id); } catch { status("No se pudo eliminar en Firebase", "error"); } });
$("#clearAll").addEventListener("click", async () => { if (!confirm("¿Eliminar todos los procedimientos registrados?")) return; const deleted = [...state.records]; state.records = []; saveLocal(); render(); if (db) try { await Promise.all(deleted.map(record => removeRecordFromCloud(record.id))); } catch { status("No se pudo eliminar en Firebase", "error"); } });
$("#openSettings").addEventListener("click", () => { $("#generalPercent").value = state.settings.general; $("#specialistPercent").value = state.settings.specialist; $("#currencySelect").value = state.settings.currency; $("#settingsDialog").showModal(); });
$("#closeSettings").addEventListener("click", () => $("#settingsDialog").close());
$("#saveSettings").addEventListener("click", async () => {
  const general = Number($("#generalPercent").value), specialist = Number($("#specialistPercent").value);
  if (!Number.isFinite(general) || !Number.isFinite(specialist) || general < 0 || general > 100 || specialist < 0 || specialist > 100) return alert("Ingresa porcentajes entre 0 y 100.");
  state.settings = { general, specialist, currency: $("#currencySelect").value }; saveLocal(); $("#settingsDialog").close(); updatePreview(); render();
  if (db) try { await saveSettingsToCloud(); } catch { status("No se pudo guardar en Firebase", "error"); }
});

render(); updatePreview(); startFirebase();
