// background.js

// 1. Importuj Firebase SDK a konfiguráciu
try {
  importScripts(
    './firebase_sdk/firebase-app-compat.js',
    './firebase_sdk/firebase-firestore-compat.js',
    './firebase-config.js' // Načítaj konfiguráciu
  );
} catch (e) {
  console.error("Chyba pri importovaní Firebase SDK alebo konfigurácie:", e);
}

let db; // pre Firestore inštanciu

// 2. Inicializuj Firebase
if (typeof firebase !== 'undefined' && typeof firebaseConfig !== 'undefined') {
  try {
    if (firebase.apps.length === 0) { // Inicializuj len ak ešte nebola appka inicializovaná
        firebase.initializeApp(firebaseConfig);
    }
    db = firebase.firestore(); // Získaj inštanciu Firestore
    console.log("[BG] Firebase inicializovaný a Firestore pripravený.");
  } catch (e) {
    console.error("[BG] Chyba pri inicializácii Firebase:", e);
  }
} else {
  console.error("[BG] Firebase alebo firebaseConfig nie je definované. Skontroluj importy a firebase-config.js.");
}

// Globálny stav pre background script
let currentPartyId = null; // Firestore ID dokumentu párty
let currentPartyCode = null; // Ľudsky čitateľný kód párty
let currentSharedLink = null;
let partyUnsubscribe = null; // Funkcia na odhlásenie listenera z Firestore

// Pomocná funkcia na generovanie náhodného kódu párty
function generatePartyCode(length = 6) {
  const characters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
}

async function createPartyOnBackend() {
  if (!db) {
    console.error("[BG] Firestore (db) nie je inicializované.");
    return { success: false, error: "Firestore nie je dostupné." };
  }
  console.log("[BG] Vytváram párty vo Firestore...");
  const newPartyCode = generatePartyCode();
  try {
    const partyRef = await db.collection('parties').add({
      partyCode: newPartyCode,
      sharedLink: null,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      members: [],
      lastActivity: firebase.firestore.FieldValue.serverTimestamp()
    });
    console.log(`[BG] Párty ${newPartyCode} (ID: ${partyRef.id}) vytvorená vo Firestore.`);
    return { success: true, partyId: partyRef.id, partyCode: newPartyCode };
  } catch (error) {
    console.error("[BG] Chyba pri vytváraní párty vo Firestore:", error);
    return { success: false, error: error.message };
  }
}

async function joinPartyOnBackend(partyCodeToJoin) {
  if (!db) return { success: false, error: "Firestore nie je dostupné." };
  console.log(`[BG] Hľadám párty s kódom ${partyCodeToJoin} vo Firestore...`);
  try {
    const partiesRef = db.collection('parties');
    const snapshot = await partiesRef.where('partyCode', '==', partyCodeToJoin.toUpperCase()).limit(1).get();

    if (snapshot.empty) {
      console.log(`[BG] Párty s kódom ${partyCodeToJoin} nenájdená.`);
      return { success: false, error: "Párty s daným kódom neexistuje." };
    }

    let partyDoc;
    snapshot.forEach(doc => partyDoc = doc);

    console.log(`[BG] Párty ${partyCodeToJoin} (ID: ${partyDoc.id}) nájdená.`);
    return { success: true, partyId: partyDoc.id, partyCode: partyDoc.data().partyCode, sharedLink: partyDoc.data().sharedLink };
  } catch (error) {
    console.error("[BG] Chyba pri pripájaní k párty vo Firestore:", error);
    return { success: false, error: error.message };
  }
}

async function shareLinkOnBackend(partyId, link) {
  if (!db) return { success: false, error: "Firestore nie je dostupné." };
  if (!partyId) return { success: false, error: "ID párty nie je známe." };
  console.log(`[BG] Zdieľam link "${link}" pre párty ${partyId} vo Firestore...`);
  try {
    await db.collection('parties').doc(partyId).update({
      sharedLink: link,
      lastActivity: firebase.firestore.FieldValue.serverTimestamp()
    });
    console.log(`[BG] Link "${link}" zdieľaný pre párty ${partyId}.`);
    return { success: true };
  } catch (error) {
    console.error("[BG] Chyba pri zdieľaní linku vo Firestore:", error);
    return { success: false, error: error.message };
  }
}

function listenToPartyChanges(partyDocId, callback) {
  if (!db) {
    console.error("[BG] Firestore (db) nie je inicializované pre listenera.");
    callback({ error: "Firestore nie je dostupné." });
    return;
  }
  if (partyUnsubscribe) {
    partyUnsubscribe();
    console.log("[BG] Predchádzajúci listener odhlásený.");
  }
  
  console.log(`[BG] Začínam počúvať zmeny pre dokument párty ${partyDocId}`);
  partyUnsubscribe = db.collection('parties').doc(partyDocId)
    .onSnapshot(doc => {
      if (doc.exists) {
        const partyData = doc.data();
        console.log("[BG] Prijaté dáta zo snapshotu:", partyData);
        currentSharedLink = partyData.sharedLink || null;
        currentPartyCode = partyData.partyCode || null;
        callback({
          partyId: doc.id,
          partyCode: partyData.partyCode,
          sharedLink: currentSharedLink
        });
      } else {
        console.warn(`[BG] Dokument párty ${partyDocId} už neexistuje.`);
        callback({ partyId: partyDocId, error: "Party not found" });
        if (currentPartyId === partyDocId) {
            leavePartyLogicInternal();
        }
      }
    }, err => {
      console.error("[BG] Chyba pri počúvaní zmien párty:", err);
      callback({ partyId: partyDocId, error: "Listener error" });
    });
}

function stopListeningToPartyChanges() {
  if (partyUnsubscribe) {
    partyUnsubscribe();
    partyUnsubscribe = null;
    console.log("[BG] Počúvanie zmien párty zastavené.");
  }
}

async function leavePartyLogicInternal() {
  console.log(`[BG] Opúšťam párty ${currentPartyId} (Kód: ${currentPartyCode})`);
  stopListeningToPartyChanges();
  const oldPartyId = currentPartyId;
  currentPartyId = null;
  currentPartyCode = null;
  currentSharedLink = null;
  await chrome.storage.local.remove(['currentPartyId', 'currentPartyCode', 'currentSharedLink']);
  broadcastPartyState();
  return { success: true, oldPartyId: oldPartyId };
}

chrome.runtime.onStartup.addListener(async () => {
  await loadStateFromStorage();
});

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install" || details.reason === "update") {
      console.log("[BG] Rozšírenie nainštalované/aktualizované. Čistím stav párty.");
      await chrome.storage.local.remove(['currentPartyId', 'currentPartyCode', 'currentSharedLink']);
      currentPartyId = null;
      currentPartyCode = null;
      currentSharedLink = null;
      stopListeningToPartyChanges();
  }
  await loadStateFromStorage();
});

async function ensureDbInitialized() {
    if (!db) {
        // Počkaj na inicializáciu Firebase, ak ešte neprebehla
        for (let i=0; i < 10; i++) { // Skús niekoľkokrát s malou pauzou
            if (db) break;
            await new Promise(resolve => setTimeout(resolve, 300));
        }
    }
    return !!db; // Vráti true, ak je db inicializované, inak false
}


async function loadStateFromStorage() {
  if (!await ensureDbInitialized()) {
      console.warn("[BG] DB nie je dostupná v loadStateFromStorage.");
      broadcastPartyState(); // Aj tak odvysielaj (prázdny) stav
      return;
  }

  const result = await chrome.storage.local.get(['currentPartyId', 'currentPartyCode', 'currentSharedLink']);
  if (result.currentPartyId && result.currentPartyCode) {
    currentPartyId = result.currentPartyId;
    currentPartyCode = result.currentPartyCode;
    currentSharedLink = result.currentSharedLink || null;
    console.log(`[BG] Obnovený stav: Párty ID ${currentPartyId}, Kód: ${currentPartyCode}, Link: ${currentSharedLink}`);
    
    try {
        const partyDoc = await db.collection('parties').doc(currentPartyId).get();
        if (partyDoc.exists && partyDoc.data().partyCode === currentPartyCode) {
            listenToPartyChanges(currentPartyId, (update) => {
                if (update.error) {
                    console.error(`[BG] Chyba pri obnovení listenera: ${update.error}`);
                    if (update.error === "Party not found" || update.error === "Listener error") {
                        leavePartyLogicInternal();
                    }
                    return;
                }
                chrome.storage.local.set({ currentSharedLink: update.sharedLink, currentPartyCode: update.partyCode });
                broadcastPartyState();
            });
        } else {
            console.warn(`[BG] Párty ${currentPartyId} (Kód: ${currentPartyCode}) už neexistuje alebo kód nesedí. Čistím stav.`);
            await leavePartyLogicInternal();
        }
    } catch (e) {
        console.error("[BG] Chyba pri overovaní existencie párty pri obnove stavu:", e);
        await leavePartyLogicInternal();
    }
  } else {
      console.log("[BG] Žiadny uložený stav párty nenájdený.");
  }
  broadcastPartyState();
}

function broadcastPartyState() {
  const state = {
    type: 'PARTY_STATE_UPDATE',
    payload: {
      partyId: currentPartyId,
      partyCode: currentPartyCode,
      sharedLink: currentSharedLink,
    }
  };
  chrome.runtime.sendMessage(state).catch(err => {});

  if (currentPartyId) {
    chrome.action.setBadgeText({ text: 'ON' });
    chrome.action.setBadgeBackgroundColor({ color: '#28a745' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => { // Wrap message handler in an async IIFE for easier await usage
    if (!await ensureDbInitialized() && message.type !== 'GET_PARTY_STATE' && message.type !== 'OPEN_LINK_IN_TAB') {
      console.error("[BG] Firestore (db) nie je inicializované pri spracovaní správy:", message.type);
      sendResponse({ success: false, error: "Služba nie je momentálne dostupná. Skúste znova o chvíľu."});
      return;
    }

    console.log("[BG] Prijatá správa:", message);
    switch (message.type) {
      case 'GET_PARTY_STATE':
        sendResponse({ partyId: currentPartyId, partyCode: currentPartyCode, sharedLink: currentSharedLink });
        break;

      case 'CREATE_PARTY':
        try {
            const response = await createPartyOnBackend();
            if (response.success) {
                currentPartyId = response.partyId;
                currentPartyCode = response.partyCode;
                currentSharedLink = null;
                await chrome.storage.local.set({ currentPartyId: currentPartyId, currentPartyCode: currentPartyCode, currentSharedLink: null });
                listenToPartyChanges(currentPartyId, (update) => {
                    if (update.error) {
                        console.error(update.error);
                        if (update.error === "Party not found") leavePartyLogicInternal();
                        return;
                    }
                    chrome.storage.local.set({ currentSharedLink: update.sharedLink, currentPartyCode: update.partyCode });
                    broadcastPartyState();
                });
            }
            sendResponse(response);
            broadcastPartyState();
        } catch (error) {
            console.error("Neočekávaná chyba v CREATE_PARTY:", error);
            sendResponse({success: false, error: "Neočekávaná chyba na serveri."});
        }
        break;

      case 'JOIN_PARTY':
        const codeToJoin = message.payload.partyCode;
        try {
            const response = await joinPartyOnBackend(codeToJoin);
            if (response.success) {
                currentPartyId = response.partyId;
                currentPartyCode = response.partyCode;
                currentSharedLink = response.sharedLink || null;
                await chrome.storage.local.set({ currentPartyId: currentPartyId, currentPartyCode: currentPartyCode, currentSharedLink: currentSharedLink });
                listenToPartyChanges(currentPartyId, (update) => {
                    if (update.error) {
                        console.error(update.error);
                        if (update.error === "Party not found") leavePartyLogicInternal();
                        return;
                    }
                    chrome.storage.local.set({ currentSharedLink: update.sharedLink, currentPartyCode: update.partyCode });
                    broadcastPartyState();
                });
            }
            sendResponse(response);
            broadcastPartyState();
        } catch (error) {
            console.error("Neočekávaná chyba v JOIN_PARTY:", error);
            sendResponse({success: false, error: "Neočekávaná chyba na serveri."});
        }
        break;

      case 'LEAVE_PARTY':
        try {
            await leavePartyLogicInternal();
            sendResponse({ success: true });
        } catch (error) {
            console.error("Neočekávaná chyba v LEAVE_PARTY:", error);
            sendResponse({success: false, error: "Neočekávaná chyba pri opúšťaní párty."});
        }
        break;

      case 'SHARE_LINK':
        const linkToShare = message.payload.link;
        if (currentPartyId && linkToShare) {
            try {
                const response = await shareLinkOnBackend(currentPartyId, linkToShare);
                sendResponse(response);
            } catch (error) {
                console.error("Neočekávaná chyba v SHARE_LINK:", error);
                sendResponse({success: false, error: "Neočekávaná chyba pri zdieľaní linku."});
            }
        } else {
          sendResponse({ success: false, error: "Nie si v párty alebo nebol zadaný link." });
        }
        break;
      
      case 'OPEN_LINK_IN_TAB':
          if (message.payload.url) {
              chrome.tabs.create({ url: message.payload.url });
              sendResponse({success: true});
          } else {
              sendResponse({success: false, error: "URL nebola poskytnutá."});
          }
          break;
      default:
        // Ak správa nie je rozpoznaná, sendResponse sa nevolá, čo môže spôsobiť chybu na strane odosielateľa.
        // Je dobré poslať aspoň nejakú odpoveď alebo nechať return true; a sendResponse() zavolať explicitne.
        console.warn("Neznámy typ správy:", message.type);
        return false; // Pre synchrónne správy, ak sa nevolá sendResponse
    }
  })(); // Execute the async IIFE
  return true; // Vždy vráť true, aby chrome vedel, že odpoveď môže prísť asynchrónne
});

console.log("[BG] Background skript načítaný.");
// loadStateFromStorage(); // Už je volané cez onStartup a onInstalled
