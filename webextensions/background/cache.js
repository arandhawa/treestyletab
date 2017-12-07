/*
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
*/
'use strict';

async function restoreWindowFromEffectiveWindowCache(aWindowId, aOptions = {}) {
  gMetricsData.add('restoreWindowFromEffectiveWindowCache start');
  log('restoreWindowFromEffectiveWindowCache start');
  var tabs  = aOptions.tabs || await browser.tabs.query({ windowId: aWindowId });
  log('restoreWindowFromEffectiveWindowCache tabs: ', tabs);
  var [actualSignature, cachedSignature, cache] = await Promise.all([
    getWindowSignature(tabs),
    getWindowCache(aWindowId, kWINDOW_STATE_SIGNATURE),
    getWindowCache(aWindowId, kWINDOW_STATE_CACHED_TABS)
  ]);
  if (aOptions.ignorePinnedTabs &&
      cache &&
      cache.tabs &&
      cachedSignature) {
    cache.tabs      = trimTabsCache(cache.tabs, cache.pinnedTabsCount);
    cachedSignature = trimSignature(cachedSignature, cache.pinnedTabsCount);
  }
  var signatureMatched = matcheSignatures({
    actual: actualSignature,
    cached: cachedSignature
  });
  log(`restoreWindowFromEffectiveWindowCache: verify cache for ${aWindowId}`, {
    cache, actualSignature, cachedSignature, signatureMatched
  });
  if (!cache ||
      cache.version != kSIDEBAR_CONTENTS_VERSION ||
      !signatureMatched) {
    log(`restoreWindowFromEffectiveWindowCache: no effective cache for ${aWindowId}`);
    clearWindowCache(aWindowId);
    gMetricsData.add('restoreWindowFromEffectiveWindowCache fail');
    return false;
  }
  cache.offset = actualSignature.replace(cachedSignature, '').trim().split('\n').filter(aPart => !!aPart).length;

  log(`restoreWindowFromEffectiveWindowCache: restore ${aWindowId} from cache`);

  var insertionPoint  = aOptions.insertionPoint;
  if (!insertionPoint) {
    insertionPoint = document.createRange();
    let container = getTabsContainer(aWindowId);
    if (container)
      insertionPoint.selectNode(container);
    else
      insertionPoint.selectNodeContents(gAllTabs);
    insertionPoint.collapse(false);
  }
  var restored = restoreTabsFromCache(aWindowId, {
    insertionPoint, cache, tabs
  });
  if (!aOptions.insertionPoint)
    insertionPoint.detach();

  if (restored)
    gMetricsData.add('restoreWindowFromEffectiveWindowCache success');
  else
    gMetricsData.add('restoreWindowFromEffectiveWindowCache fail');

  return restored;
}

function restoreTabsFromCache(aWindowId, aParams = {}) {
  if (!aParams.cache ||
      aParams.cache.version != kBACKGROUND_CONTENTS_VERSION)
    return false;

  log(`restoreTabsFromCache: restore tabs for ${aWindowId} from cache `, aParams.cache);

  var offset         = aParams.cache.offset || 0;
  var insertionPoint = aParams.insertionPoint;
  var oldContainer   = getTabsContainer(aWindowId);
  if (offset > 0) {
    if (!oldContainer ||
        oldContainer.childNodes.length <= offset) {
      log('restoreTabsFromCache: missing container');
      return false;
    }
    log(`restoreTabsFromCache: there is ${oldContainer.childNodes.length} tabs`);
    insertionPoint = document.createRange();
    insertionPoint.selectNodeContents(oldContainer);
    log('restoreTabsFromCache: delete obsolete tabs, offset = ', offset);
    insertionPoint.setStartAfter(oldContainer.childNodes[offset - 1]);
    insertionPoint.deleteContents();
    log(`restoreTabsFromCache: => ${oldContainer.childNodes.length} tabs`);
    let matched = aParams.cache.tabs.match(/<li/g);
    log(`restoreTabsFromCache: restore ${matched.length} tabs from cache `,
        aParams.cache.tabs.replace(/(<(li|ul))/g, '\n$1'));
    let fragment = insertionPoint.createContextualFragment(aParams.cache.tabs.replace(/^<ul[^>]+>|<\/ul>$/g, ''));
    insertionPoint.insertNode(fragment);
    insertionPoint.detach();
  }
  else {
    if (oldContainer)
      oldContainer.parentNode.removeChild(oldContainer);
    let fragment = aParams.insertionPoint.createContextualFragment(aParams.cache.tabs);
    let container = fragment.firstChild;
    log('restoreTabsFromCache: restore');
    insertionPoint.insertNode(fragment);
    container.id = `window-${aWindowId}`;
    container.dataset.windowId = aWindowId;
  }

  log('restoreTabsFromCache: post process');
  var tabElements = getAllTabs(aWindowId).slice(offset);
  var apiTabs     = aParams.tabs.slice(offset);
  log('restoreTabsFromCache: tabs ', { tabElements, apiTabs });
  if (tabElements.length != apiTabs.length) {
    log('restoreTabsFromCache: Mismatched number of restored tabs? ');
    return true;
  }
  try{
    fixupTabsRestoredFromCache(tabElements, apiTabs, {
      dirty: true
    });
  }
  catch(e) {
    log(String(e), e.stack);
    throw e;
  }
  log('restoreTabsFromCache: done', configs.debug && getTreeStructureFromTabs(getAllTabs(aWindowId)));
  dumpAllTabs();
  return true;
}


function updateWindowCache(aWindowId, aKey, aValue) {
  if (!aWindowId)
    return;
  if (aValue === undefined) {
    browser.sessions.removeWindowValue(aWindowId, aKey);
  }
  else {
    browser.sessions.setWindowValue(aWindowId, aKey, aValue);
  }
}

function clearWindowCache(aWindowId) {
  log('clearWindowCache for ', aWindowId);
  updateWindowCache(aWindowId, kWINDOW_STATE_CACHED_SIDEBAR);
  updateWindowCache(aWindowId, kWINDOW_STATE_CACHED_SIDEBAR_TABS_DIRTY);
  updateWindowCache(aWindowId, kWINDOW_STATE_CACHED_SIDEBAR_COLLAPSED_DIRTY);
  updateWindowCache(aWindowId, kWINDOW_STATE_SIGNATURE);
}

function markWindowCacheDirty(aWindowId, akey) {
  updateWindowCache(aWindowId, akey, true);
}

async function getWindowCache(aWindowId, aKey) {
  return browser.sessions.getWindowValue(aWindowId, aKey);
}

function reserveToCacheTree(aWindowId) {
  if (gInitializing ||
      !configs.useCachedTree)
    return;

  var container = getTabsContainer(aWindowId);
  if (!container ||
      container.allTabsRestored)
    return;

  //log('clear cache for ', aWindowId);
  clearWindowCache(aWindowId);

  if (container.waitingToCacheTree)
    clearTimeout(container.waitingToCacheTree);
  container.waitingToCacheTree = setTimeout(() => {
    cacheTree(aWindowId);
  }, 500);
}
async function cacheTree(aWindowId) {
  var container = getTabsContainer(aWindowId);
  if (!container ||
      !configs.useCachedTree ||
      container.allTabsRestored)
    return;
  //log('save cache for ', aWindowId);
  log('cacheTree for window ', aWindowId);
  updateWindowCache(aWindowId, kWINDOW_STATE_CACHED_TABS, {
    version: kBACKGROUND_CONTENTS_VERSION,
    tabs:    container.outerHTML,
    pinnedTabsCount: getPinnedTabs(container).length
  });
  getWindowSignature(aWindowId).then(aSignature => {
    updateWindowCache(aWindowId, kWINDOW_STATE_SIGNATURE, aSignature);
  });
}
