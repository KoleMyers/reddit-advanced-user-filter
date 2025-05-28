let CLIENT_ID, REDIRECT_URI;

fetch(chrome.runtime.getURL('config.json'))
  .then(res => res.json())
  .then(config => {
    CLIENT_ID = config.CLIENT_ID;
    REDIRECT_URI = config.REDIRECT_URI;
    console.log('Loaded Reddit app config:', config);
  })
  .catch(err => {
    console.error('Failed to load config.json:', err);
  });

const SCOPES = "identity read";
const STATE = Math.random().toString(36).substring(7);

function urlsMatch(url1, url2) {
  // Ignore protocol and trailing slashes
  return url1.replace(/^https?:\/\//, '').replace(/\/$/, '') ===
         url2.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "login") {
    if (!CLIENT_ID || !REDIRECT_URI) {
      sendResponse({ success: false, error: "Reddit app config not loaded." });
      return;
    }
    const authUrl =
      `https://www.reddit.com/api/v1/authorize?client_id=${CLIENT_ID}` +
      `&response_type=token&state=${STATE}` +
      `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
      `&duration=temporary&scope=${SCOPES}`;

    chrome.tabs.create({ url: authUrl }, (tab) => {
      function handleUpdated(tabId, changeInfo, tabInfo) {
        if (tabId === tab.id && changeInfo.url) {
          console.log("Tab updated to:", changeInfo.url);
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
  if (request.type === "fetchUserData") {
    const { username, token } = request;
    fetch(`https://oauth.reddit.com/user/${username}/about`, {
      headers: {
        Authorization: `bearer ${token}`,
        "User-Agent": "RedditFilterExtension/1.0"
      }
    })
      .then(async res => {
        console.log("Fetch response status:", res.status);
        if (!res.ok) {
          const text = await res.text();
          console.warn("Fetch failed, response text:", text);
          sendResponse({ success: false, error: `Status ${res.status}: ${text}` });
          return;
        }
        const data = await res.json();
        sendResponse({ success: true, data });
      })
      .catch(err => {
        console.error("Fetch error:", err);
        sendResponse({ success: false, error: err.toString() });
      });
    return true;
  }
});