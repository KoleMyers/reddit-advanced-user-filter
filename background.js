let REDIRECT_URI = 'https://example.com/reddit_oauth';

const SCOPES = "identity read";
const STATE = Math.random().toString(36).substring(7);

function urlsMatch(url1, url2) {
  // Ignore protocol and trailing slashes
  return url1.replace(/^https?:\/\//, '').replace(/\/$/, '') ===
         url2.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

function handleLogin(request, sendResponse) {
  const { clientId } = request;
  if (!clientId) {
    sendResponse({ success: false, error: "No client ID provided." });
    return;
  }
  const authUrl =
    `https://www.reddit.com/api/v1/authorize?client_id=${clientId}` +
    `&response_type=token&state=${STATE}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&duration=temporary&scope=${SCOPES}`;

  chrome.tabs.create({ url: authUrl }, (tab) => {
    function handleUpdated(tabId, changeInfo, tabInfo) {
      if (tabId === tab.id && changeInfo.url) {
        const baseUrl = changeInfo.url.split('#')[0];
        if (urlsMatch(baseUrl, REDIRECT_URI)) {
          const url = new URL(changeInfo.url);
          const hash = url.hash.substring(1); // Remove the '#'
          const params = new URLSearchParams(hash);
          const accessToken = params.get("access_token");

          if (accessToken) {
            chrome.storage.local.set({ reddit_token: accessToken });
            chrome.tabs.remove(tabId);
            sendResponse({ success: true });
          } else {
            sendResponse({ success: false });
          }
          chrome.tabs.onUpdated.removeListener(handleUpdated);
        }
      }
    }
    chrome.tabs.onUpdated.addListener(handleUpdated);
  });
  return true;
}

function handleFetchUserData(request, sendResponse) {
  const { username, token } = request;
  fetch(`https://oauth.reddit.com/user/${username}/about`, {
    headers: {
      Authorization: `bearer ${token}`,
      "User-Agent": "RedditFilterExtension/1.0"
    }
  })
    .then(async res => {
      if (!res.ok) {
        const text = await res.text();
        console.warn(`API request failed for user ${username}:`, res.status, text);
        
        // Handle specific error cases
        if (res.status === 401) {
          // Token expired or invalid
          chrome.storage.local.remove('reddit_token', () => {
            console.log('Removed expired token from storage');
          });
          sendResponse({ success: false, error: `Status ${res.status}: Token expired or invalid` });
        } else if (res.status === 429) {
          // Rate limited
          sendResponse({ 
            success: false, 
            error: `Status ${res.status}: Rate limited`
          });
        } else {
          sendResponse({ success: false, error: `Status ${res.status}: ${text}` });
        }
        return;
      }
      
      const data = await res.json();
      sendResponse({ success: true, data });
    })
    .catch(err => {
      sendResponse({ success: false, error: err.toString() });
    });
  return true;
}

function handleWarningMessage(request) {
  // Forward warning messages to popup
  chrome.runtime.sendMessage(request);
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.type) {
    case "login":
      return handleLogin(request, sendResponse);
    case "fetchUserData":
      return handleFetchUserData(request, sendResponse);
    case "showAuthWarning":
    case "showRateLimitWarning":
    case "clearWarnings":
      handleWarningMessage(request);
      break;
  }
});