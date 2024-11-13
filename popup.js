const maxResults = 200;

document.addEventListener('DOMContentLoaded', async function() {
  const cache = await updateCacheIfNeeded();

  chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
    try {
      const url = new URL(tabs[0].url);
      if (!url || (url.protocol === "chrome:") || url.hostname.endsWith("google.com")) {
	      document.getElementById('domain-header').style.display = 'none';
	      document.getElementById('domain-deals').style.display = 'none';
		  showAllCoupons(cache);
      } else {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'findCoupon' }, function(response) {
          if (chrome.runtime.lastError) {
            console.error('Error with message:', chrome.runtime.lastError.message);
            document.getElementById('message').textContent = 'Error: ' + chrome.runtime.lastError.message;
            return;
          }

          // Additional checks on response
          if (response && response.store) {
            const storeDomain = getDomain(response.store);
            if (storeDomain) {
              showCouponsForStore(storeDomain, cache);
	          showAllCoupons(cache);
            } else {
              console.error('No valid domain found for store:', response.store);
              document.getElementById('message').textContent = 'Invalid store URL.';
            }
          } else {
            document.getElementById('message').textContent = 'No store name found.';
	        showAllCoupons(cache);
          }
        });
      }
    } catch (error) {
      console.error('Error processing tabs or URL:', error);
      document.getElementById('message').textContent = 'Error: ' + error.message;
    }
  });
});

async function showAllCoupons(cache) {
  document.getElementById('all-header').style.display = 'block';
  displayMessages(cache.messages, 'all-deals');
  const lastUpdatedTime = cache?.lastUpdated ? new Date(cache.lastUpdated).toLocaleString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit', hour: 'numeric', minute: '2-digit', hour12: true }) : 'N/A';  
  document.getElementById('last-updated-time').textContent = 'Updated: ' + lastUpdatedTime;
  document.getElementById('all-deals-footer').style.display = 'block';
}

async function showCouponsForStore(storeDomain, cache) {
  const messages = cache.messages || [];
  // Remove the TLD (like .com) from storeDomain
  const baseDomain = storeDomain.split('.')[0];

  const storeCoupons = messages
    .filter(msg => msg.senderDomain.includes(baseDomain) && (msg.coupon || msg.discount))
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  if (storeCoupons.length === 0) {
    document.getElementById('domain-header').textContent = 'No deals found for ' + storeDomain;
    document.getElementById('domain-deals').style.display = 'none';
    return;
  }

  document.getElementById('domain-header').textContent = 'Best deals for ' + storeDomain;
  const couponList = document.getElementById('domain-deals');
  couponList.innerHTML = '';

  const uniqueCoupons = {};
  storeCoupons.forEach(msg => {
    if (!uniqueCoupons[msg.coupon || msg.discount]) {
      uniqueCoupons[msg.coupon || msg.discount] = true;
      displayMessage(msg, 'domain-deals');
    }
  });
}

async function getToken() {
  console.log('Requesting token...');
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, function(token) {
      if (chrome.runtime.lastError || !token) {
        console.error('Token retrieval error:', chrome.runtime.lastError?.message || 'No token obtained');
        reject(new Error('Authorization error: Unable to access Gmail.'));
      } else {
        console.log('Token successfully retrieved:', token);
        resolve(token);
      }
    });
  });
}

async function fetchPromoMessages(lastUpdated) {
    const today = new Date();
	const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const oneMonthAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

	let formattedDate;

	if (!lastUpdated) {
	    formattedDate = Math.floor(twoWeeksAgo / 1000); // converts from millisecond timestamp to seconds
	}
	else {
	    formattedDate = Math.floor(lastUpdated / 1000); // converts from millisecond timestamp to seconds
	}

  document.getElementById('progress-indicator').classList.remove('hidden');
  const progressText = document.getElementById('progress-text');
  progressText.textContent = '';

  try {
    let token = await getToken();
    const query = `label:promotions (subject:off OR "use code" OR "enter code" OR "discount code" OR "promo code" OR "coupon code") after:${formattedDate}`;
    const url = `https://www.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}`;
	console.log(query);
	console.log(url);
	
    let response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

    if (response.status === 401) {
      console.warn('Token unauthorized. Removing from cache and retrying.');
      await new Promise((resolve, reject) => {
        chrome.identity.removeCachedAuthToken({ token: token }, async function () {
          if (chrome.runtime.lastError) {
            console.error('Error removing token from cache:', chrome.runtime.lastError.message);
            reject(new Error('Failed to clear cached token'));
          } else {
            resolve();
          }
        });
      });
      token = await getToken();
      response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    }

    if (!response.ok) {
      throw new Error(`Gmail API request failed with status ${response.status}`);
    }

    const data = await response.json();
    const messages = data.messages || [];
    const totalMessages = messages.length;

    const messageDetails = [];
    for (let i = 0; i < totalMessages; i++) {
      const msg = messages[i];
      const details = await fetchMessage(token, msg.id);
      if (details) {
        messageDetails.push(details);
      }
      
      // Update progress indicator with the current count
	  const percent = Math.round((i + 1) / totalMessages * 100);
      progressText.textContent = `${percent}%`;

      await new Promise(resolve => setTimeout(resolve, 5)); // Rate limiting
    }

    const filteredMessages = messageDetails.filter(msg => msg && msg.date && new Date(msg.date) >= twoWeeksAgo);
    document.getElementById('message').textContent = '';
    document.getElementById('progress-indicator').classList.add('hidden');
    return filteredMessages;

  } catch (error) {
    document.getElementById('progress-indicator').classList.add('hidden');
    console.error('Error fetching and processing promo messages:', error);
    throw error;
  }
}


async function fetchMessage(token, messageId) {
    try {
        // Fetch message details
        const response = await fetch(`https://www.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        
        if (!response.ok) {
            console.error(`Failed to fetch message ${messageId} with status ${response.status}: ${response.statusText}`);
            return null;
        }

        // Parse message JSON
        const message = await response.json();
        const headers = message.payload?.headers || [];

        // Log headers for troubleshooting
        // Extract and log date
        const dateHeader = headers.find(header => header.name === 'Date');
        const date = dateHeader ? new Date(dateHeader.value) : null;
		const formattedDate = date ? date.toISOString() : null; // Store as ISO string

        // Extract and log subject
        const subject = headers.find(header => header.name === 'Subject')?.value || '(No Subject)';
        console.log(`Message ID ${messageId} ${formattedDate}:`, subject);

        // Extract and log sender name and domain
        const fromHeader = headers.find(header => header.name === 'From')?.value || '';
		const senderNameMatch = fromHeader.match(/^(.*?)(?=\s*<)/);
		const senderName = senderNameMatch ? senderNameMatch[0].replace(/^"(.*)"$/, '$1').trim() : '(No Sender Name)';
        const senderDomain = getDomain(fromHeader.match(/@([\w.-]+)/)?.[1]);

        // Retrieve and log plain text body
		const html_body = getBodyFromEmail(message.payload);
        const text_body = convertHtmlToText(html_body);
		
        const { coupon, discount, deallink } = extractDealInfo(html_body, text_body);
        console.log(`coupon: ${coupon} discount: ${discount} deallink: ${deallink} `);
        console.log(`html_body: ${html_body} text_body: ${text_body}`);

        return {
            id: message.id,
            date: formattedDate,
            subject: subject,
            from: senderName,
            senderDomain: senderDomain,
			coupon: coupon,
            discount: discount,
            snippet: message.snippet,
			deallink: deallink,
        };
    } catch (error) {
        console.error(`Error in fetchMessage for message ID ${messageId}:`, error);
        return null;
    }
}

function extractDealInfo(html_body, text_body) {
  // Extract coupon code
  const couponMatch = text_body.match(/\b(?:Code|code|CODE)[:\s]*([A-Z0-9]{3,})\b/);
  let coupon = couponMatch ? couponMatch[1] : "";
  
  // Add spaces every 15 characters if coupon is longer than 13 characters
  if (coupon.length > 13) {
    coupon = coupon.match(/.{1,13}/g).join(' ');
  }

  // Extract discount percentage or "Save X%" and format as "X% off"
  const discountMatch = text_body.match(/\b(\d{1,3})% off\b/i) || text_body.match(/\bSave\s(\d{1,3})%/i);
  let discount = discountMatch ? `${discountMatch[1]}% off` : "";

  // If no percentage discount is found, check for dollar amount discounts
  if (!discount) {
    const dollarMatch = text_body.match(/\bSave\s\$(\d{1,3})\b/i) || text_body.match(/\$(\d{1,3}) off\b/i);
    discount = dollarMatch ? `$${dollarMatch[1]} off` : "";
  }

 // Extract the link on the first large image at the top of the email
  const parser = new DOMParser();
  const doc = parser.parseFromString(html_body, "text/html");

  let deallink = "";
  const images = doc.querySelectorAll("img");

  for (let img of images) {
    const width = img.width || 0;
    const height = img.height || 0;

    if (width > 150 || height > 150) {
      const link = img.closest("a");
      if (link) {
        //console.log("Found link:", link.href);  // Debugging output
        deallink = link.href;
        break;
      }
    }
  }
  return { coupon, discount, deallink };
}

async function updateCacheIfNeeded() {
  try {
    const cache = await getCache();
    let lastUpdated = cache?.lastUpdated;
    const sixHoursAgo = Date.now() - 6 * 60 * 60 * 1000; // 6 hours in milliseconds
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const threeDayAgo = Date.now() - 72 * 60 * 60 * 1000;
    const oneMonthAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

    // lastUpdated = sixHoursAgo; // force cache update for debugging
	
    // Proceed to fetch new messages if cache is outdated
    if (!lastUpdated || lastUpdated <= sixHoursAgo) {
      const newMessages = await fetchPromoMessages(lastUpdated);

      // Ensure `cache.messages` is an array before modifying
      if (!Array.isArray(cache.messages)) {
        cache.messages = [];
      }

      // Remove messages older than a month
      cache.messages = cache.messages.filter(msg => new Date(msg.date).getTime() > oneMonthAgo);

      // Add new messages
      cache.messages.push(...newMessages);

      // Update `lastUpdated` after all modifications
      cache.lastUpdated = Date.now();
      await setCache(cache);
    }

    return cache;

  } catch (error) {
    console.error('Error updating cache:', error);
    return [];
  }
}

function getBodyFromEmail(payload) {
  // Check if `parts` is available; if not, look directly in `payload`
  if (!payload.parts) {
    console.log("No `parts` field found. Checking the payload directly.");
    if (payload.mimeType === 'text/html' && payload.body?.data) {
      console.log("HTML body found directly in payload.");
      return decodeBase64(payload.body.data);
    }
  } else {
    // If `parts` exists, use the recursive function to search for the HTML body
    return getBodyFromParts(payload.parts);
  }

  console.warn("No HTML body found in the email payload.");
  return null;
}

function getBodyFromParts(parts) {
  for (const part of parts) {
    console.log("Checking part with MIME type:", part.mimeType);
    
    if (part.mimeType === 'text/html' && part.body?.data) {
      console.log("HTML body found in part:", part);
      return decodeBase64(part.body.data);
    } else if (part.parts) {
      console.log("Nested parts found, recursing...");
      const result = getBodyFromParts(part.parts);
      if (result) return result;
    }
  }

  console.warn("No HTML body found in the parts.");
  return null;
}

// Helper function for decoding Base64 data
function decodeBase64(encoded) {
  return decodeURIComponent(
    atob(encoded.replace(/-/g, "+").replace(/_/g, "/"))
      .split("")
      .map(c => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
      .join("")
  );
}

function convertHtmlToText(html) {
    // Create a DOM parser to parse the HTML
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Remove all <style> and <script> elements
    const tagsToRemove = ['style', 'script'];
    tagsToRemove.forEach(tag => {
        const elements = doc.getElementsByTagName(tag);
        while (elements[0]) elements[0].parentNode.removeChild(elements[0]);
    });

    // Retrieve the text content of the parsed HTML
    let text = doc.body.textContent || '';

    // Decode HTML entities (e.g., &amp; to &, &lt; to <)
    const tempElement = document.createElement('textarea');
    tempElement.innerHTML = text;
    text = tempElement.value;

    // Remove extra whitespace
    return text.replace(/\s+/g, ' ').trim();
}

function displayMessages(messages) {
  const uniqueMessages = [];
  const senderLastSeen = {};

  // Separate messages with and without coupon codes
  const messagesWithCoupon = messages.filter(msg => msg.coupon);
  const messagesWithoutCoupon = messages.filter(msg => !msg.coupon && msg.discount);

  // Sort both groups by deal size (discount percentage) in descending order
  messagesWithCoupon.sort((a, b) => parseDiscountAsPercentage(b.discount) - parseDiscountAsPercentage(a.discount));
  messagesWithoutCoupon.sort((a, b) => parseDiscountAsPercentage(b.discount) - parseDiscountAsPercentage(a.discount));

  // Combine the two groups, with coupon messages first
  const sortedMessages = [...messagesWithCoupon, ...messagesWithoutCoupon];

  // Filter and push unique messages by sender domain, keeping the highest discount per domain
  sortedMessages.forEach(msg => {
    if (!senderLastSeen[msg.senderDomain]) {
      uniqueMessages.push(msg);
      senderLastSeen[msg.senderDomain] = msg.date;
    }
  });

  uniqueMessages.forEach(msg => displayMessage(msg, 'all-deals'));
}

// Helper function to parse discount as percentage value
function parseDiscountAsPercentage(discount) {
  if (!discount) return 0;

  const percentMatch = discount.match(/(\d+)%/);  // Match percentages
  const dollarMatch = discount.match(/\$(\d+)/);  // Match dollar amounts

  if (percentMatch) {
    return parseFloat(percentMatch[1]);  // Return the percentage value directly
  } else if (dollarMatch) {
    const dollarValue = parseFloat(dollarMatch[1]);
    return dollarValue / 200 * 100;  // Rough translation to percentage by assuming average product price is $150
  }
  return 0;
}

function displayMessage(message, deallist) {
  const listItem = document.createElement('li');
  listItem.className = `message-tile ${message.coupon ? '' : 'no-coupon'}`;
  listItem.style.cursor = 'pointer';
  listItem.title = `Copy code + shop sale`;

  const formattedDate = new Date(message.date).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric'
  });

  const url = message.deallink || `https://mail.google.com/mail/u/0/#inbox/${message.id}`;
  const emailUrl = `https://mail.google.com/mail/u/0/#inbox/${message.id}`;

  listItem.innerHTML = `
    ${deallist === 'domain-deals' ? `${formattedDate}<br>` : ''}
    <b>${message.from}</b><br>
    <span style="color: green;">${message.discount || ''}</span><br>
    ${message.coupon ? `${message.coupon}<br>` : ''}
    <span class="email-link" title="View Email"><div class="email-icon"></div></span>
  `;

  listItem.addEventListener('click', async () => {
    if (message.coupon) {
      try {
        await navigator.clipboard.writeText(message.coupon);
        console.log(`Coupon code ${message.coupon} copied to clipboard.`);
      } catch (error) {
        console.error('Failed to copy coupon code:', error);
      }
    }

    // Now open the link after copying is complete
    window.open(url, '_blank');
  });
  
  listItem.querySelector('.email-link').addEventListener('click', (event) => {
    event.stopPropagation();
    window.open(emailUrl, '_blank');
  });

  document.getElementById(deallist).appendChild(listItem);
}

function getDomain(url) {
  try {
    // Add 'https://' if the URL does not already start with a protocol
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    const domainParts = new URL(url).hostname.split('.');
    return domainParts.slice(-2).join('.'); // Return only the second-level and top-level domain
  } catch (error) {
    console.error('Invalid URL passed to getDomain:', url, error);
    return null;  // Return null if URL is invalid
  }
}

function getCache() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['couponCache'], (result) => {
      resolve(result.couponCache || { lastUpdated: 0, messages: [] });
    });
  });
}
function setCache(cache) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ couponCache: cache }, () => {
      if (chrome.runtime.lastError) {
        console.error('Error storing data:', chrome.runtime.lastError.message);
        reject(new Error('Failed to store data in chrome.storage'));
      } else {
        resolve();
      }
    });
  });
}

async function deleteCacheExtractions() {
  const cache = await getCache();
  
  // Remove coupon and discount fields from each cached message
  cache.messages = cache.messages.map(message => {
    const { coupon, discount, deallink, ...rest } = message;
    return rest;
  });

  setCache(cache);
  console.log('Coupons and discounts removed from cache.');
}

async function resetCache() {
    chrome.storage.local.remove('couponCache', () => {
      if (chrome.runtime.lastError) {
        console.error('Error clearing cache:', chrome.runtime.lastError.message);
      } else {
        console.log('Cache cleared successfully.');
      }
    });

  // Clear the displayed deals and hide the footer
  document.getElementById('domain-header').style.display = 'none';
  document.getElementById('all-header').style.display = 'none';
  document.getElementById('domain-deals').style.display = 'none';
  document.getElementById('all-deals').innerHTML = '';
  document.getElementById('all-deals-footer').style.display = 'none';

  // Reload cache and display updated deals
  const newCache = await updateCacheIfNeeded();
  showAllCoupons(newCache);
}

// Attach click event to the reset link
document.getElementById('reset-cache').addEventListener('click', (event) => {
  event.preventDefault();
  resetCache();
});