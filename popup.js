const ERROR_COLOR = '#ff4d4d'; 
const WARNING_COLOR = '#ffd700';

const DEFAULT_OPTIONS = {
  minAccountAgeDays: 90,
  minKarma: 10,
  maxKarma: 1500000,
  requireVerifiedEmail: false,
  requireBothKarmaTypes: true,
  excludePremium: false,
  excludeMods: false,
  linkKarmaRatio: 100,
  filterComments: true
};

const WARNING_MESSAGES = {
  NOT_AUTHENTICATED: {
    text: 'You are not authenticated. Please log in via the Reddit API Config tab.',
    color: ERROR_COLOR
  },
  CLIENT_ID_MISSING: {
    text: 'Reddit App Client ID is not set. Go to the Reddit API Config tab to set it up.',
    color: ERROR_COLOR
  },
  RATE_LIMIT: {
    text: 'Rate limited by Reddit API. Please wait a few minutes before trying again.',
    color: WARNING_COLOR
  }
};

document.getElementById("login").addEventListener("click", () => {
  const clientId = document.getElementById('clientId').value;
  chrome.runtime.sendMessage({ type: "login", clientId }, (response) => {
    if (response.success) {
      chrome.storage.local.set({ needsAuthWarning: false });
      setTimeout(() => {
        const warnings = document.querySelectorAll('#clientid-warning, #config-warning');
        warnings.forEach(warning => {
          warning.textContent = '';
          warning.style.display = 'none';
        });
      }, 1000); // Give time for token to be stored
    } else {
      alert("Login failed.");
    }
  });
});

function populateFilteredUsersTable() {
  chrome.storage.local.get({ filteredUsers: [] }, ({ filteredUsers }) => {
    const tbody = document.querySelector("#filtered-users-table tbody");
    tbody.innerHTML = "";
    filteredUsers.forEach(user => {
      const tr = document.createElement("tr");
      const tdUser = document.createElement("td");
      const tdReason = document.createElement("td");
      const tdPost = document.createElement("td");
      const a = document.createElement("a");
      a.href = user.url;
      a.textContent = user.username;
      a.target = "_blank";
      tdUser.appendChild(a);
      tdReason.textContent = user.reason;
      if (user.postUrl) {
        const postLink = document.createElement("a");
        postLink.href = user.postUrl;
        postLink.textContent = user.postTitle || user.postUrl;
        postLink.target = "_blank";
        tdPost.appendChild(postLink);
      } else {
        tdPost.textContent = "-";
      }
      tr.appendChild(tdUser);
      tr.appendChild(tdReason);
      tr.appendChild(tdPost);
      tbody.appendChild(tr);
    });
  });
}

function loadOptionsForm() {
  chrome.storage.local.get(DEFAULT_OPTIONS, (options) => {
    document.getElementById('minAccountAgeDays').value = options.minAccountAgeDays;
    document.getElementById('minKarma').value = options.minKarma;
    document.getElementById('maxKarma').value = options.maxKarma;
    document.getElementById('requireVerifiedEmail').checked = options.requireVerifiedEmail;
    document.getElementById('requireBothKarmaTypes').checked = options.requireBothKarmaTypes;
    document.getElementById('excludePremium').checked = options.excludePremium;
    document.getElementById('excludeMods').checked = options.excludeMods;
    document.getElementById('linkKarmaRatio').value = options.linkKarmaRatio;
    document.getElementById('filterComments').checked = options.filterComments;
  });
}

function saveOptionsFromForm() {
  const options = {
    minAccountAgeDays: parseInt(document.getElementById('minAccountAgeDays').value, 10) || 0,
    minKarma: parseInt(document.getElementById('minKarma').value, 10) || 0,
    maxKarma: parseInt(document.getElementById('maxKarma').value, 10) || 0,
    requireVerifiedEmail: document.getElementById('requireVerifiedEmail').checked,
    requireBothKarmaTypes: document.getElementById('requireBothKarmaTypes').checked,
    excludePremium: document.getElementById('excludePremium').checked,
    excludeMods: document.getElementById('excludeMods').checked,
    linkKarmaRatio: parseInt(document.getElementById('linkKarmaRatio').value, 10) || 0,
    filterComments: document.getElementById('filterComments').checked
  };
  
  // Save options
  chrome.storage.local.set(options, () => {
    chrome.storage.local.get(['filteredUsers', 'reddit_token', 'CLIENT_ID'], (data) => {
      chrome.storage.local.set({
        filteredUsers: [],
        reddit_token: data.reddit_token,
        CLIENT_ID: data.CLIENT_ID
      }, () => {
        // Notify content script to clear cache and reload
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0]) {
            chrome.tabs.sendMessage(tabs[0].id, { type: "clearCacheAndReload" });
          }
        });
        // Refresh the table display
        populateFilteredUsersTable();
      });
    });
  });
}

function setupOptionsForm() {
  const saveButton = document.getElementById('save-options');
  saveButton.addEventListener('click', saveOptionsFromForm);
}

function setupTabs() {
  const tabs = document.querySelectorAll('.tab');
  const contents = document.querySelectorAll('.tab-content');
  tabs.forEach((tab, idx) => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      contents.forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      contents[idx].classList.add('active');
    });
  });
}

function loadConfigForm() {
  chrome.storage.local.get({ CLIENT_ID: '' }, (data) => {
    document.getElementById('clientId').value = data.CLIENT_ID || '';
  });
}

function displayWarning(type) {
  const warning = WARNING_MESSAGES[type];
  if (!warning) return;
  const warnings = document.querySelectorAll('#clientid-warning, #config-warning');
  warnings.forEach(w => {
    w.textContent = warning.text;
    w.style.display = 'block';
    w.style.color = warning.color;
  });
}

function clearWarnings() {
  const warnings = document.querySelectorAll('#clientid-warning, #config-warning');
  warnings.forEach(warning => {
    warning.textContent = '';
    warning.style.display = 'none';
    warning.style.color = ERROR_COLOR;
  });
  chrome.storage.local.set({ needsAuthWarning: false });
}

function showClientIdWarningIfNeeded() {
  chrome.storage.local.get(["CLIENT_ID", "reddit_token", "needsAuthWarning"], (data) => {
    if (data.needsAuthWarning || !data.reddit_token) {
      displayWarning('NOT_AUTHENTICATED');
    } else if (!data.CLIENT_ID || !data.CLIENT_ID.trim()) {
      displayWarning('CLIENT_ID_MISSING');
    } else {
      clearWarnings();
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  setupTabs();
  loadOptionsForm();
  setupOptionsForm();
  populateFilteredUsersTable();
  loadConfigForm();
  showClientIdWarningIfNeeded();

  // Listen for warning messages from content script
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "showAuthWarning") {
      displayWarning('NOT_AUTHENTICATED');
    } else if (request.type === "showRateLimitWarning") {
      displayWarning('RATE_LIMIT');
    } else if (request.type === "clearWarnings") {
      clearWarnings();
    }
  });

  // Listen for changes to filteredUsers in storage
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.filteredUsers) {
      populateFilteredUsersTable();
    }
  });
});

document.getElementById('clientId').addEventListener('input', function() {
  chrome.storage.local.set({ CLIENT_ID: this.value }, showClientIdWarningIfNeeded);
}); 