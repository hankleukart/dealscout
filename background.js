chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed');
});

chrome.identity.getAuthToken({interactive: true}, function(token) {
  console.log('Auth Token: ', token);
});

// for popup behavior only
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.active) {
    await updateBadgeForTab(tab);
  }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tab = await chrome.tabs.get(activeInfo.tabId);
  if (tab.status === "complete") {
    await updateBadgeForTab(tab);
  }
});

async function updateBadgeForTab(tab) {
  try {
    const url = new URL(tab.url);

    // Skip internal Chrome pages or certain domains
    if (url.protocol === "chrome:" || url.hostname.endsWith("google.com")) {
      chrome.action.setBadgeText({ text: '', tabId: tab.id });
      return;
    }

    const cache = await getCache();
	const baseDomain = url.hostname.split('.').slice(-2, -1)[0];

    // Count the coupons for the specific domain
    const uniqueCoupons = new Set();

    // Count unique coupons for the specific domain
    cache.messages.forEach(msg => {
      if (msg.senderDomain.includes(baseDomain) && (msg.coupon || msg.discount)) {
        const uniqueIdentifier = msg.coupon || msg.discount; // Use coupon or discount as identifier
        uniqueCoupons.add(uniqueIdentifier); // Add to the set if unique
      }
    });

    const couponCount = uniqueCoupons.size; // Number of unique coupons or discounts

    if (couponCount > 0) {
      chrome.action.setBadgeText({ text: `${couponCount}`, tabId: tab.id });
      chrome.action.setBadgeBackgroundColor({ color: 'orange' });
    } else {
      chrome.action.setBadgeText({ text: '', tabId: tab.id });
    }
  } catch (error) {
    console.error('Error updating badge for tab:', error);
  }
}

function getCache() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['couponCache'], (result) => {
      resolve(result.couponCache || { messages: [] });
    });
  });
}