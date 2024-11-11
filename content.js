chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'findCoupon') {
    const storeName = window.location.hostname; // Get the current store's domain
    sendResponse({store: storeName});
  }
});
