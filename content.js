const userCache = {};
let userQueue = [];
let processing = false;
let cachedToken = null;

const SKIP_FILTER_PATTERNS = [
  /\/user\//,
  /\/message\//,
  /\/modmail\//,
  /\/chat\//,
];

function getCurrentSubreddit() {
  const match = window.location.pathname.match(/\/r\/([^\/]+)/);
  return match ? match[1].toLowerCase() : null;
}

function shouldSkipFiltering() {
  if (!filterOptions) return false;
  const subreddit = getCurrentSubreddit();
  if (
    filterOptions.whitelistedSubreddits &&
    subreddit &&
    filterOptions.whitelistedSubreddits.map(s => s.toLowerCase()).includes(subreddit)
  ) {
    return true;
  }
  return SKIP_FILTER_PATTERNS.some(pattern => pattern.test(window.location.pathname));
}

const DEFAULT_OPTIONS = {
  minAccountAgeDays: 90,
  minKarma: 10,
  maxKarma: 1500000,
  requireVerifiedEmail: false,
  requireBothKarmaTypes: true,
  excludePremium: false,
  excludeMods: false,
  linkKarmaRatio: 100,
  filterComments: true,
  whitelistedSubreddits: ["iama"],
  whitelistedUsers: []
};

let filterOptions = null;

async function loadFilterOptions() {
  try {
    const {
      minAccountAgeDays,
      minKarma,
      maxKarma,
      requireVerifiedEmail,
      requireBothKarmaTypes,
      excludePremium,
      excludeMods,
      linkKarmaRatio,
      filterComments,
      whitelistedSubreddits,
      whitelistedUsers
    } = await chrome.storage.local.get(DEFAULT_OPTIONS);

    filterOptions = {
      minAccountAgeDays,
      minKarma,
      maxKarma,
      requireVerifiedEmail,
      requireBothKarmaTypes,
      excludePremium,
      excludeMods,
      linkKarmaRatio,
      filterComments,
      whitelistedSubreddits,
      whitelistedUsers
    };

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

function shouldFilterUser(user, username) {
  if (!filterOptions) {
    console.warn('Filter options not loaded yet');
    return null;
  }

  // If user is in whitelisted users list, never filter their posts
  if (filterOptions.whitelistedUsers && filterOptions.whitelistedUsers.map(u => u.toLowerCase()).includes(username.toLowerCase())) {
    return null;
  }

  const age = daysSince(user.created);
  if (age < filterOptions.minAccountAgeDays) return `Account too new: ${age.toFixed(1)} days`;
  if (user.karma < filterOptions.minKarma) return `Karma too low: ${user.karma.toLocaleString()}`;
  if (user.karma > filterOptions.maxKarma) return `Karma too high: ${user.karma.toLocaleString()}`;
  if (filterOptions.requireVerifiedEmail && !user.has_verified_email) return "Email not verified";
  if (filterOptions.requireBothKarmaTypes) {
    if (user.link_karma === 0 && user.comment_karma === 0) {
      return "Missing both link and comment karma";
    } else if (user.link_karma === 0) {
      return "Missing link karma";
    } else if (user.comment_karma === 0) {
      return "Missing comment karma";
    }
  }
  if (filterOptions.excludePremium && user.is_gold) return "Premium user";
  if (filterOptions.excludeMods && user.is_mod) return "Moderator";
  if (filterOptions.linkKarmaRatio > 0 && user.comment_karma > 0 && user.link_karma > user.comment_karma * filterOptions.linkKarmaRatio) {
    return `Link/Comment karma ratio too high: ${(user.link_karma / user.comment_karma).toFixed(1)}x`;
  }
  return null;
}

// Wait for options to load before running any filtering
loadFilterOptions();

function daysSince(unixTimestamp) {
  return (Date.now() - unixTimestamp * 1000) / (1000 * 60 * 60 * 24);
}

async function getToken() {
  if (cachedToken !== null) return cachedToken;
  const { reddit_token } = await chrome.storage.local.get("reddit_token");
  cachedToken = reddit_token;
  return reddit_token;
}

function clearTokenCache() {
  cachedToken = null;
}

// Listen for token changes to clear the cache
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.reddit_token) {
    clearTokenCache();
  }
});

async function fetchUserData(username) {
  // Check cache first
  if (userCache[username]) {
    return userCache[username];
  }

  const token = await getToken();
  if (!token) {
    chrome.storage.local.set({ needsAuthWarning: true });
    chrome.runtime.sendMessage({ type: "showAuthWarning" });
    throw new Error("No access token");
  }

  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: "fetchUserData", username, token },
      (response) => {
        if (!response) {
          reject("No response received from background script");
          return;
        }
        if (response.success && response.data && response.data.data) {
          try {
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
            chrome.runtime.sendMessage({ type: "clearWarnings" });
            resolve(userData);
          } catch (err) {
            reject("Error processing user data: " + err.message);
          }
        } else {
          const error = response.error || "Invalid response format";
          if (response.error) {
            if (response.error.includes('Status 401')) {
              chrome.runtime.sendMessage({ type: "showAuthWarning" });
            } else if (response.error.includes('Status 429')) {
              chrome.runtime.sendMessage({ type: "showRateLimitWarning" });
              // Stop processing when we hit rate limit
              userQueue = [];
              processing = false;
            }
          }
          reject(error);
        }
      }
    );
  });
}

function getUsernameFromPost(post) {
  // Try new Reddit first (shreddit-post)
  if (post.tagName === 'SHREDDIT-POST') {
    const author = post.getAttribute('author');
    if (author) return author;
  }

  // Try old Reddit
  const author = post.getAttribute('data-author');
  if (author) {
    return author;
  }

  // Try new Reddit (alternative format)
  const authorElem = post.querySelector('a.author[href*="/user/"]');
  if (authorElem) {
    const username = authorElem.textContent.trim();
    return username;
  }

  return null;
}

function getPostInfo(post) {
  let title = '';
  let url = '';

  // Try new Reddit (shreddit-post)
  if (post.tagName === 'SHREDDIT-POST') {
    title = post.getAttribute('post-title') || '';
    const permalink = post.getAttribute('permalink');
    if (permalink) {
      url = `https://www.reddit.com${permalink}`;
    }
    return { title, url };
  }

  // Try new Reddit (alternative format)
  const titleElem = post.querySelector('h3');
  if (titleElem) title = titleElem.textContent.trim();
  const postLinkElem = post.querySelector('a[data-click-id="body"]');
  if (postLinkElem) url = postLinkElem.href;

  // Old Reddit fallback
  if (!title) {
    const oldTitleElem = post.querySelector('a.title');
    if (oldTitleElem) title = oldTitleElem.textContent.trim();
    if (oldTitleElem) url = oldTitleElem.href;
  }

  // Check if it's a comment (old Reddit)
  if (post.classList.contains('comment') && post.hasAttribute('data-permalink')) {
    url = `https://www.reddit.com${post.getAttribute('data-permalink')}`;
    let commentText = '';
    const commentBody = post.querySelector('.usertext-body .md');
    if (commentBody) {
      commentText = commentBody.textContent.trim();
      if (commentText.length > 100) {
        commentText = commentText.slice(0, 100) + '…';
      }
    }
    title = commentText || '[Comment]';
    return { title, url };
  }

  // Try to extract subreddit, post ID, and slug from the URL
  let commentsUrl = url;
  const match = url.match(/reddit\.com\/(r\/([^\/]+)\/)?comments\/([a-z0-9]+)(?:\/([^\/?#]+))?/i);
  if (match) {
    const subreddit = match[2];
    const postId = match[3];
    const slug = match[4];
    if (subreddit && postId && slug) {
      commentsUrl = `https://www.reddit.com/r/${subreddit}/comments/${postId}/${slug}`;
    } else if (subreddit && postId) {
      commentsUrl = `https://www.reddit.com/r/${subreddit}/comments/${postId}`;
    } else if (postId) {
      commentsUrl = `https://www.reddit.com/comments/${postId}`;
    }
  }

  return { title, url: commentsUrl };
}

async function processPost(post, username) {
  // Instantly skip if post is no longer in the DOM
  if (!document.body.contains(post)) return;

  // Skip if post is above the viewport
  const rect = post.getBoundingClientRect();
  if (rect.bottom < 0) return;

  // Skip comments if filterComments is false
  if (filterOptions && filterOptions.filterComments === false) {
    // Old Reddit comment
    if (post.classList.contains('comment') && post.hasAttribute('data-permalink')) return;
    // New Reddit comment
    if (post.tagName === 'SHREDDIT-COMMENT') return;
  }

  // Small delay to help prevent rate limiting (only for posts that are actually processed)
  await new Promise(resolve => setTimeout(resolve, 100));

  try {
    const user = await fetchUserData(username);
    const filterReason = shouldFilterUser(user, username);
    if (filterReason) {
      post.style.display = "none";
      const { title, url } = getPostInfo(post);
      chrome.storage.local.get({ filteredUsers: [] }, ({ filteredUsers }) => {
        if (!filteredUsers.some(u => u.username === username && u.postUrl === url)) {
          if (filteredUsers.length >= 1000) { // Limit to 1000 entries
            filteredUsers.pop();
          }
          filteredUsers.unshift({ username, reason: filterReason, url: `https://www.reddit.com/user/${username}`, postTitle: title, postUrl: url });
          chrome.storage.local.set({ filteredUsers });
        }
      });
    }
  } catch (err) {
    // Send warning message if error is rate limit or auth related
    if (err.message?.includes('429')) {
      chrome.runtime.sendMessage({ type: "showRateLimitWarning" });
    } else if (err.message?.includes('401')) {
      chrome.runtime.sendMessage({ type: "showAuthWarning" });
    }
  }
}

function isPostPage() {
  // Matches /r/subreddit/comments/postid/...
  return /\/r\/[^\/]+\/comments\/[a-z0-9]+/i.test(window.location.pathname);
}

function observePosts() {
  const posts = [
    ...document.querySelectorAll(".thing[data-author]"), // old Reddit
    ...document.querySelectorAll(".Post"), // new Reddit
    ...document.querySelectorAll("shreddit-post") // new Reddit shreddit format
  ];

  let skipFirst = isPostPage();
  posts.forEach((post, idx) => {
    // If on a post page, skip filtering the main post (first post element)
    if (skipFirst && idx === 0) return;
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
  threshold: 0.2
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
    try {
      await processPost(post, username);
    } catch (err) {
      if (err.toString().includes('Status 429')) {
        // Stop processing immediately on rate limit
        userQueue = [];
        processing = false;
        return;
      }
    }
  }
  processing = false;
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "clearCacheAndReload") {
    Object.keys(userCache).forEach(key => delete userCache[key]);
    loadFilterOptions();
  } else if (request.type === "clearUserFromCache") {
    delete userCache[request.username];
    loadFilterOptions();
  }
});