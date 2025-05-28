// cache for user data
const userCache = {};

let userQueue = [];
let processing = false;

// Pages where filtering should be skipped
const SKIP_FILTER_PATTERNS = [
  /\/user\//,           // User profile pages
  /\/message\//,        // Messages
  /\/modmail\//,        // Modmail
  /\/chat\//,           // Chat
];

function shouldSkipFiltering() {
  return SKIP_FILTER_PATTERNS.some(pattern => pattern.test(window.location.pathname));
}

// Load filter options from options.json
let filterOptions = null;

function shouldFilterUser(user) {
  const age = daysSince(user.created);
  if (age < filterOptions.minAccountAgeDays) return "Account too new";
  if (user.karma < filterOptions.minKarma) return "Karma too low";
  if (user.karma > filterOptions.maxKarma) return "Karma too high";
  if (filterOptions.requireVerifiedEmail && !user.has_verified_email) return "Email not verified";
  if (filterOptions.requireBothKarmaTypes && (user.link_karma === 0 || user.comment_karma === 0)) return "Missing either link or comment karma";
  if (filterOptions.excludePremium && user.is_gold) return "Premium user";
  if (filterOptions.excludeMods && user.is_mod) return "Moderator";
  if (filterOptions.linkKarmaRatio > 0 && user.comment_karma > 0 && user.link_karma > user.comment_karma * filterOptions.linkKarmaRatio) {
    return `Link karma (${user.link_karma}) is more than ${filterOptions.linkKarmaRatio}x comment karma (${user.comment_karma})`;
  }
  return null;
}

async function loadFilterOptions() {
  try {
    const res = await fetch(chrome.runtime.getURL('options.json'));
    filterOptions = await res.json();
    console.log('Loaded filter options:', filterOptions);
    // Skip filtering if on a page that should not be filtered
    if (shouldSkipFiltering()) {
      return;
    }
    // Start observing posts after options are loaded
    observePosts();
    const mutationObserver = new MutationObserver(observePosts);
    mutationObserver.observe(document.body, { childList: true, subtree: true });
  } catch (err) {
    console.error('Failed to load filter options:', err);
  }
}

// Wait for options to load before running any filtering
loadFilterOptions();

function daysSince(unixTimestamp) {
  return (Date.now() - unixTimestamp * 1000) / (1000 * 60 * 60 * 24);
}

async function getToken() {
  const { reddit_token } = await chrome.storage.local.get("reddit_token");
  return reddit_token;
}

async function fetchUserData(username) {
  // Check cache first
  if (userCache[username]) {
    return userCache[username];
  }
  const token = await getToken();
  if (!token) throw new Error("No access token");
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: "fetchUserData", username, token },
      (response) => {
        if (response && response.success) {
          const userData = {
            created: response.data.data.created_utc,
            karma: response.data.data.total_karma,
            link_karma: response.data.data.link_karma,
            comment_karma: response.data.data.comment_karma,
            has_verified_email: response.data.data.has_verified_email,
            is_gold: response.data.data.is_gold,
            is_mod: response.data.data.is_mod
          };
          userCache[username] = userData;
          resolve(userData);
        } else {
          console.log(response);
          reject(response ? response.error : "Unknown error");
        }
      }
    );
  });
}

function getUsernameFromPost(post) {
  // Try old Reddit
  const author = post.getAttribute('data-author');
  if (author) return author;
  // Try new Reddit
  const authorElem = post.querySelector('a.author[href*="/user/"]');
  if (!authorElem) return null;
  return authorElem.textContent.trim();
}

async function processPost(post, username) {
  try {
    const user = await fetchUserData(username);
    const filterReason = shouldFilterUser(user);
    if (filterReason) {
      post.style.display = "none";
      console.log(`Filtered user: ${username} (https://www.reddit.com/user/${username}) - Reason: ${filterReason}`);
    }
  } catch (err) {
    console.warn("Failed to fetch user:", username, err);
  }
}

function observePosts() {
  // Support both old and new Reddit post selectors
  const posts = [
    ...document.querySelectorAll(".thing[data-author]"), // old Reddit
    ...document.querySelectorAll(".Post") // new Reddit
  ];

  posts.forEach(post => {
    if (!post._observerAttached) { // Prevent double-observing
      observer.observe(post);
      post._observerAttached = true;
    }
  });
}

const onIntersect = (entries, obs) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const post = entry.target;
      const username = getUsernameFromPost(post);
      if (username) {
        enqueueUser(post, username);
      }
      obs.unobserve(post);
    }
  });
};

const observer = new IntersectionObserver(onIntersect, {
  root: null,
  rootMargin: "500px 0px",
  threshold: 0.1 // Start loading when 10% visible and within 500px below viewport
});

function enqueueUser(post, username) {
  userQueue.push({ post, username });
  processQueue();
}

async function processQueue() {
  if (processing) return;
  processing = true;
  while (userQueue.length > 0) {
    const { post, username } = userQueue.shift();
    await processPost(post, username);
    await new Promise(res => setTimeout(res, 600));
  }
  processing = false;
}