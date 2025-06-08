document.addEventListener('DOMContentLoaded', function() {
  // Party Management UI
  const notInPartyView = document.getElementById('notInPartyView');
  const inPartyView = document.getElementById('inPartyView');
  const partyCodeInput = document.getElementById('partyCodeInput');
  const joinPartyButton = document.getElementById('joinPartyButton');
  const createPartyButton = document.getElementById('createPartyButton');
  const currentPartyCodeDisplay = document.getElementById('currentPartyCodeDisplay');
  const joinPartyStatus = document.getElementById('joinPartyStatus');
  const createPartyStatus = document.getElementById('createPartyStatus');

  // Link Sharing UI
  const linkToShareInput = document.getElementById('linkToShareInput');
  const shareLinkButton = document.getElementById('shareLinkButton');
  const leavePartyButton = document.getElementById('leavePartyButton');
  const shareLinkStatus = document.getElementById('shareLinkStatus');

  // Shared Link Display UI
  const sharedLinkSection = document.getElementById('sharedLinkSection');
  const receivedLinkText = document.getElementById('receivedLinkText');
  const openSharedLinkButton = document.getElementById('openSharedLinkButton');
  const openLinkStatus = document.getElementById('openLinkStatus');

  let currentSharedLinkFromState = null;

  function setStatus(element, message, type = 'info', duration = 3000) {
    element.textContent = message;
    element.className = 'status-message ' + type;
    if (duration > 0) {
      setTimeout(() => {
        if (element.textContent === message) { // Vymaž len ak je to stále tá istá správa
             element.textContent = '';
             element.className = 'status-message';
        }
      }, duration);
    }
  }

  function updateUI(partyState) {
    console.log("Popup UI update:", partyState);
    currentSharedLinkFromState = partyState.sharedLink;

    if (partyState.partyCode) { // Používame partyCode na určenie, či sme v párty
      notInPartyView.classList.add('hidden');
      inPartyView.classList.remove('hidden');
      sharedLinkSection.classList.remove('hidden');
      currentPartyCodeDisplay.textContent = partyState.partyCode;

      if (!linkToShareInput.value) {
        chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
          if (tabs[0] && tabs[0].url) {
            linkToShareInput.value = tabs[0].url;
          }
        });
      }
    } else {
      notInPartyView.classList.remove('hidden');
      inPartyView.classList.add('hidden');
      sharedLinkSection.classList.add('hidden');
      currentPartyCodeDisplay.textContent = 'N/A';
      linkToShareInput.value = '';
    }

    if (partyState.sharedLink) {
      receivedLinkText.textContent = partyState.sharedLink;
      receivedLinkText.classList.remove("link-text"); // Odstráň default text class
      receivedLinkText.style.fontWeight = "bold"; // Urob link tučným
      openSharedLinkButton.disabled = false;
    } else {
      receivedLinkText.textContent = 'Žiadny link nebol zdieľaný.';
      receivedLinkText.classList.add("link-text"); // Pridaj default text class
      receivedLinkText.style.fontWeight = "normal";
      openSharedLinkButton.disabled = true;
    }
  }
  
  function sendMessageToBackground(message, callback) {
    chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
            console.error("Chyba pri odosielaní správy do BG:", chrome.runtime.lastError.message, "Pre správu:", message);
            // Tu môžeš zobraziť všeobecnú chybu používateľovi, ak je to vhodné
            // napr. setStatus(createPartyStatus, "Chyba komunikácie s rozšírením.", "error");
            if (callback) callback({ success: false, error: "Chyba komunikácie: " + chrome.runtime.lastError.message });
            return;
        }
        if (callback) callback(response);
    });
  }


  sendMessageToBackground({ type: 'GET_PARTY_STATE' }, (response) => {
    if (response) {
      console.log("Počiatočný stav z BG:", response);
      updateUI(response);
    } else {
      console.warn("Neprišla odpoveď pre GET_PARTY_STATE, background skript možno ešte nebeží správne.");
      setStatus(createPartyStatus, "Rozšírenie sa inicializuje...", "info", 5000);
      setTimeout(() => { // Skús znova o chvíľu
        sendMessageToBackground({ type: 'GET_PARTY_STATE' }, (delayedResponse) => {
          if (delayedResponse) updateUI(delayedResponse);
          else setStatus(createPartyStatus, "Nepodarilo sa načítať stav.", "error", 0);
        });
      }, 1000); // Dlhšie čakanie pre prípad pomalej inicializácie BG
    }
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'PARTY_STATE_UPDATE') {
      console.log("Popup prijal PARTY_STATE_UPDATE:", message.payload);
      updateUI(message.payload);
    }
    return true; // Keep the message channel open for other listeners if any
  });

  createPartyButton.addEventListener('click', () => {
    createPartyButton.disabled = true;
    setStatus(createPartyStatus, "Vytváram párty...", "info", 0);
    sendMessageToBackground({ type: 'CREATE_PARTY' }, (response) => {
      createPartyButton.disabled = false;
      if (response && response.success) {
        setStatus(createPartyStatus, `Párty ${response.partyCode} vytvorená!`, "success");
      } else {
        setStatus(createPartyStatus, "Chyba: " + (response?.error || "Nepodarilo sa vytvoriť párty."), "error");
      }
    });
  });

  joinPartyButton.addEventListener('click', () => {
    const partyCode = partyCodeInput.value.trim().toUpperCase();
    if (!partyCode) {
      setStatus(joinPartyStatus, "Zadaj kód párty.", "error");
      return;
    }
    joinPartyButton.disabled = true;
    setStatus(joinPartyStatus, "Pripájam sa k párty...", "info", 0);
    sendMessageToBackground({ type: 'JOIN_PARTY', payload: { partyCode: partyCode } }, (response) => {
      joinPartyButton.disabled = false;
      if (response && response.success) {
        setStatus(joinPartyStatus, `Pripojený k párty ${response.partyCode}.`, "success");
        partyCodeInput.value = '';
      } else {
        setStatus(joinPartyStatus, "Chyba: " + (response?.error || "Nepodarilo sa pripojiť."), "error");
      }
    });
  });

  leavePartyButton.addEventListener('click', () => {
    leavePartyButton.disabled = true;
    setStatus(shareLinkStatus, "Opúšťam párty...", "info", 0); // Zobraz info tu
    sendMessageToBackground({ type: 'LEAVE_PARTY' }, (response) => {
      leavePartyButton.disabled = false;
      if (response && response.success) {
         setStatus(createPartyStatus, "Úspešne si opustil párty.", "info");
         shareLinkStatus.textContent = ''; // Vyčisti status zdieľania
      } else {
         setStatus(shareLinkStatus, "Chyba pri opúšťaní párty: " + (response?.error || ""), "error");
      }
    });
  });

  shareLinkButton.addEventListener('click', () => {
    const link = linkToShareInput.value.trim();
    if (!link) {
      setStatus(shareLinkStatus, "Zadaj link na zdieľanie.", "error");
      return;
    }
    // Jednoduchá validácia URL
    try {
        new URL(link);
    } catch (_) {
        setStatus(shareLinkStatus, "Prosím, zadaj platný link (napr. http://...).", "error");
        return;
    }

    shareLinkButton.disabled = true;
    setStatus(shareLinkStatus, "Zdieľam link...", "info", 0);
    sendMessageToBackground({ type: 'SHARE_LINK', payload: { link: link } }, (response) => {
      shareLinkButton.disabled = false;
      if (response && response.success) {
        setStatus(shareLinkStatus, "Link úspešne zdieľaný!", "success");
      } else {
        setStatus(shareLinkStatus, "Chyba: " + (response?.error || "Nepodarilo sa zdieľať."), "error");
      }
    });
  });

  openSharedLinkButton.addEventListener('click', () => {
    if (currentSharedLinkFromState) {
      setStatus(openLinkStatus, "Otváram link...", "info", 0);
      sendMessageToBackground({ type: 'OPEN_LINK_IN_TAB', payload: { url: currentSharedLinkFromState } }, (response) => {
        if (response && response.success) {
            setStatus(openLinkStatus, "Link otvorený v novom tabe.", "success");
        } else {
            setStatus(openLinkStatus, "Nepodarilo sa otvoriť link: " + (response?.error || ""), "error");
        }
      });
    } else {
      setStatus(openLinkStatus, "Žiadny link na otvorenie.", "error");
    }
  });
});
