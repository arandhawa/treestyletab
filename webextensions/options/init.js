/*
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
*/
'use strict';

import Options from '/extlib/Options.js';
import ShortcutCustomizeUI from '/extlib/ShortcutCustomizeUI.js';
import '/extlib/l10n.js';

import {
  log,
  configs
} from '/common/common.js';

import * as Constants from '/common/constants.js';
import * as Permissions from '/common/permissions.js';
import * as Bookmark from '/common/bookmark.js';
import * as Migration from '/common/migration.js';

log.context = 'Options';
const options = new Options(configs);

function onConfigChanged(key) {
  const value = configs[key];
  switch (key) {
    case 'debug':
      if (value)
        document.documentElement.classList.add('debugging');
      else
        document.documentElement.classList.remove('debugging');
      break;

    case 'successorTabControlLevel': {
      const checkbox = document.getElementById('simulateSelectOwnerOnClose');
      const label = checkbox.parentNode;
      if (value == Constants.kSUCCESSOR_TAB_CONTROL_NEVER) {
        checkbox.setAttribute('disabled', true);
        label.setAttribute('disabled', true);
      }
      else {
        checkbox.removeAttribute('disabled');
        label.removeAttribute('disabled');
      }
    }; break;
  }
}

function removeAccesskeyMark(node) {
  if (!node.nodeValue)
    return;
  node.nodeValue = node.nodeValue.replace(/\(&[a-z]\)|&([a-z])/gi, '$1');
}

function onChangeMasterChacekbox(event) {
  const container = event.currentTarget.closest('fieldset');
  for (const checkbox of container.querySelectorAll('p input[type="checkbox"]')) {
    checkbox.checked = event.currentTarget.checked;
  }
  saveLogForConfig();
}

function onChangeSlaveChacekbox(event) {
  getMasterCheckboxFromSlave(event.currentTarget).checked = isAllSlavesChecked(event.currentTarget);
  saveLogForConfig();
}

function getMasterCheckboxFromSlave(aSlave) {
  const container = aSlave.closest('fieldset');
  return container.querySelector('legend input[type="checkbox"]');
}

function saveLogForConfig() {
  const config = {};
  for (const checkbox of document.querySelectorAll('p input[type="checkbox"][id^="logFor-"]')) {
    config[checkbox.id.replace(/^logFor-/, '')] = checkbox.checked;
  }
  configs.logFor = config;
}

function isAllSlavesChecked(aMasger) {
  const container = aMasger.closest('fieldset');
  const checkboxes = container.querySelectorAll('p input[type="checkbox"]');
  return Array.from(checkboxes).every(checkbox => checkbox.checked);
}

function updateBookmarksUI(enabled) {
  const elements = document.querySelectorAll('.with-bookmarks-permission label, .with-bookmarks-permission input, .with-bookmarks-permission button');
  if (enabled) {
    for (const element of elements) {
      element.removeAttribute('disabled');
    }
    const defaultBookmarkParentChooser = document.getElementById('defaultBookmarkParentChooser');
    Bookmark.initFolderChoolser(defaultBookmarkParentChooser, {
      defaultValue: configs.defaultBookmarkParentId,
      onCommand:    (item, _event) => {
        if (item.dataset.id)
          configs.defaultBookmarkParentId = item.dataset.id;
      },
    });
  }
  else {
    for (const element of elements) {
      element.setAttribute('disabled', true);
    }
  }
}

async function showQueryLogs() {
  browser.tabs.create({
    url: '/resources/query-logs.html'
  });
}

configs.$addObserver(onConfigChanged);
window.addEventListener('DOMContentLoaded', () => {
  if (/^Mac/i.test(navigator.platform))
    document.documentElement.classList.add('platform-mac');
  else
    document.documentElement.classList.remove('platform-mac');

  if (typeof browser.tabs.moveInSuccession == 'function')
    document.documentElement.classList.add('successor-tab-support');
  else
    document.documentElement.classList.remove('successor-tab-support');

  for (const label of document.querySelectorAll('#contextConfigs label')) {
    removeAccesskeyMark(label.lastChild);
  }

  ShortcutCustomizeUI.build().then(aUI => {
    document.getElementById('shortcuts').appendChild(aUI);

    for (const item of aUI.querySelectorAll('li > label:first-child')) {
      removeAccesskeyMark(item.firstChild);
    }
  });
  const resetAll = document.getElementById('shortcutsResetAll');
  resetAll.addEventListener('click', event => {
    if (event.button != 0)
      return;
    for (const button of document.querySelectorAll('#shortcuts button')) {
      button.click();
    }
  });
  resetAll.addEventListener('keydown', event => {
    if (event.key != 'Enter')
      return;
    for (const button of document.querySelectorAll('#shortcuts button')) {
      button.click();
    }
  });

  const showQueryLogsButton = document.getElementById('showQueryLogsButton');
  showQueryLogsButton.addEventListener('click', event => {
    if (event.button != 0)
      return;
    showQueryLogs();
  });
  showQueryLogsButton.addEventListener('keydown', event => {
    if (event.key != 'Enter')
      return;
    showQueryLogs();
  });

  document.getElementById('link-startupPage').setAttribute('href', Constants.kSHORTHAND_URIS.startup);
  document.getElementById('link-groupPage').setAttribute('href', Constants.kSHORTHAND_URIS.group);
  document.getElementById('link-runTests').setAttribute('href', Constants.kSHORTHAND_URIS.testRunner);

  configs.$loaded.then(() => {
    for (const fieldset of document.querySelectorAll('fieldset.collapsible')) {
      if (configs.optionsExpandedGroups.includes(fieldset.id))
        fieldset.classList.remove('collapsed');
      else
        fieldset.classList.add('collapsed');

      const onChangeCollapsed = () => {
        if (!fieldset.id)
          return;
        const otherExpandedSections = configs.optionsExpandedGroups.filter(id => id != fieldset.id);
        if (fieldset.classList.contains('collapsed'))
          configs.optionsExpandedGroups = otherExpandedSections;
        else
          configs.optionsExpandedGroups = otherExpandedSections.concat([fieldset.id]);
      };

      const legend = fieldset.querySelector(':scope > legend');
      legend.addEventListener('click', () => {
        fieldset.classList.toggle('collapsed');
        onChangeCollapsed();
      });
      legend.addEventListener('keydown', event => {
        if (event.key != 'Enter')
          return;
        fieldset.classList.toggle('collapsed');
        onChangeCollapsed();
      });
    }

    for (const heading of document.querySelectorAll('body > section > h1')) {
      const section = heading.parentNode;
      section.style.maxHeight = `${heading.offsetHeight}px`;
      if (!configs.optionsExpandedSections.includes(section.id))
        section.classList.add('collapsed');
      heading.addEventListener('click', () => {
        section.classList.toggle('collapsed');
        const otherExpandedSections = configs.optionsExpandedSections.filter(id => id != section.id);
        if (section.classList.contains('collapsed'))
          configs.optionsExpandedSections = otherExpandedSections;
        else
          configs.optionsExpandedSections = otherExpandedSections.concat([section.id]);
      });
    }

    Permissions.isGranted(Permissions.BOOKMARKS).then(granted => updateBookmarksUI(granted));

    document.querySelector('#legacyConfigsNextMigrationVersion-currentLevel').textContent = Migration.kLEGACY_CONFIGS_MIGRATION_VERSION;

    Permissions.bindToCheckbox(
      Permissions.ALL_URLS,
      document.querySelector('#allUrlsPermissionGranted'),
      { onChanged: (granted) => configs.skipCollapsedTabsForTabSwitchingShortcuts = granted }
    );
    Permissions.bindToCheckbox(
      Permissions.BOOKMARKS,
      document.querySelector('#bookmarksPermissionGranted'),
      { onChanged: (granted) => updateBookmarksUI(granted) }
    );
    Permissions.bindToCheckbox(
      Permissions.TAB_HIDE,
      document.querySelector('#tabHidePermissionGranted')
    );


    for (const checkbox of document.querySelectorAll('p input[type="checkbox"][id^="logFor-"]')) {
      checkbox.addEventListener('change', onChangeSlaveChacekbox);
      checkbox.checked = configs.logFor[checkbox.id.replace(/^logFor-/, '')];
    }
    for (const checkbox of document.querySelectorAll('legend input[type="checkbox"][id^="logFor-"]')) {
      checkbox.checked = isAllSlavesChecked(checkbox);
      checkbox.addEventListener('change', onChangeMasterChacekbox);
    }

    options.buildUIForAllConfigs(document.querySelector('#group-allConfigs'));
    onConfigChanged('debug');
    onConfigChanged('successorTabControlLevel');
  });
}, { once: true });
