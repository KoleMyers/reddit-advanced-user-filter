const ERROR_COLOR = '#ff4d4d'; 
const WARNING_COLOR = '#ffd700';

document.getElementById("login").addEventListener("click", () => {
  const clientId = document.getElementById('clientId').value;
  chrome.runtime.sendMessage({ type: "login", clientId }, (response) => {
    if (response.success) {
      alert("Please complete login in the new tab.");
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

// Default options
const defaultOptions = {
  minAccountAgeDays: 90,
  minKarma: 10,
  maxKarma: 1500000,
  requireVerifiedEmail: false,
  requireBothKarmaTypes: true,
  excludePremium: false,
  excludeMods: false,
  linkKarmaRatio: 100
};

function loadOptionsForm() {
  chrome.storage.local.get(defaultOptions, (options) => {
    document.getElementById('minAccountAgeDays').value = options.minAccountAgeDays;
    document.getElementById('minKarma').value = options.minKarma;
    document.getElementById('maxKarma').value = options.maxKarma;
    document.getElementById('requireVerifiedEmail').checked = options.requireVerifiedEmail;
    document.getElementById('requireBothKarmaTypes').checked = options.requireBothKarmaTypes;
    document.getElementById('excludePremium').checked = options.excludePremium;
    document.getElementById('excludeMods').checked = options.excludeMods;
    document.getElementById('linkKarmaRatio').value = options.linkKarmaRatio;
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
    linkKarmaRatio: parseInt(document.getElementById('linkKarmaRatio').value, 10) || 0
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

function showAuthWarning() {
  const warnings = document.querySelectorAll('#clientid-warning, #config-warning');
  warnings.forEach(warning => {
    if (warning.id === 'clientid-warning') {
      warning.textContent = 'Warning: Your Reddit authentication has expired. Please log in again in the Reddit API Config tab.';
      warning.style.display = '';
      warning.style.color = ERROR_COLOR;
    } else if (warning.id === 'config-warning') {
      warning.textContent = 'Your Reddit authentication has expired. Please log in again.';
      warning.style.display = '';
      warning.style.color = ERROR_COLOR;
    }
  });
}

function showRateLimitWarning() {
  const warnings = document.querySelectorAll('#clientid-warning, #config-warning');
  warnings.forEach(warning => {
    if (warning.id === 'clientid-warning') {
      warning.textContent = 'Warning: Rate limited by Reddit API. Please wait a few minutes before trying again.';
      warning.style.display = '';
      warning.style.color = WARNING_COLOR;
    } else if (warning.id === 'config-warning') {
      warning.textContent = 'Rate limited by Reddit API. Please wait a few minutes before trying again.';
      warning.style.display = '';
      warning.style.color = WARNING_COLOR;
    }
  });
}

function clearWarnings() {
  const warnings = document.querySelectorAll('#clientid-warning, #config-warning');
  warnings.forEach(warning => {
    warning.textContent = '';
    warning.style.display = 'none';
    warning.style.color = ERROR_COLOR; // Reset to default error color
  });
}

function showClientIdWarningIfNeeded() {
  chrome.storage.local.get(["CLIENT_ID", "reddit_token"], (data) => {
    if (!data.CLIENT_ID || !data.CLIENT_ID.trim() || !data.reddit_token) {
      const warnings = document.querySelectorAll('#clientid-warning, #config-warning');
      warnings.forEach(warning => {
        if (warning.id === 'clientid-warning') {
          warning.textContent = 'Warning: Reddit App Client ID is not set or you are not authenticated. This extension will not work without both. Go to the Reddit API Config tab to set it up.';
          warning.style.display = '';
          warning.style.color = ERROR_COLOR;
        } else if (warning.id === 'config-warning') {
          warning.style.display = '';
          warning.style.color = ERROR_COLOR;
        }
      });
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
      showAuthWarning();
    } else if (request.type === "showRateLimitWarning") {
      showRateLimitWarning();
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