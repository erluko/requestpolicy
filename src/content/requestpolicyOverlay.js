Components.utils.import("resource://requestpolicy/DomainUtils.jsm");
Components.utils.import("resource://requestpolicy/Logger.jsm");

/**
 * Provides functionality for the overlay. An instance of this class exists for
 * each tab/window.
 */
var requestpolicyOverlay = {

  _prefetchInfoUri : "http://www.requestpolicy.com/help/prefetch.html",
  _prefetchDisablingInstructionsUri : "http://www.requestpolicy.com/help/prefetch.html#disable",

  _initialized : false,
  _requestpolicy : null,

  // for development, direct access to the js object
  _requestpolicyJSObject : null,

  _strbundle : null,
  _addedMenuItems : [],
  _menu : null,
  _blockedDestinationsMenu : null,
  _allowedDestinationsMenu : null,

  _blockedDestinationsItems : [],
  _allowedDestinationsItems : [],

  _blockedDestinationsBeforeReferenceItem : null,
  _allowedDestinationsBeforeReferenceItem : null,

  _itemPrefetchWarning : null,
  _itemPrefetchWarningSeparator : null,

  _itemRevokeTemporaryPermissions : null,
  _itemRevokeTemporaryPermissionsSeparator : null,

  _itemAllowOriginTemporarily : null,
  _itemAllowOrigin : null,
  _itemForbidOrigin : null,

  _statusbar : null,
  _rpStatusbar : null,
  _rpContextMenu : null,

  /**
   * Initialize the object. This must be done after the DOM is loaded.
   */
  init : function() {
    if (this._initialized == false) {
      this._requestpolicy = Components.classes["@requestpolicy.com/requestpolicy-service;1"]
          .getService(Components.interfaces.nsIRequestPolicy);
      this._requestpolicyJSObject = this._requestpolicy.wrappedJSObject;
      this._strbundle = document.getElementById("requestpolicyStrings");
      this._initialized = true;
      this._menu = document.getElementById("requestpolicyStatusbarPopup");

      this._blockedDestinationsMenu = document
          .getElementById("requestpolicyBlockedDestinationsPopup");
      this._allowedDestinationsMenu = document
          .getElementById("requestpolicyAllowedDestinationsPopup");

      this._blockedDestinationsBeforeReferenceItem = document
          .getElementById("requestpolicyAllowedDestinationsSeparator");
      this._allowedDestinationsBeforeReferenceItem = document
          .getElementById("requestpolicyOriginSubmenusSeparator");

      this._itemPrefetchWarning = document
          .getElementById("requestpolicyPrefetchWarning");
      this._itemPrefetchWarningSeparator = document
          .getElementById("requestpolicyPrefetchWarningSeparator");

      this._itemRevokeTemporaryPermissions = document
          .getElementById("requestpolicyRevokeTemporaryPermissions");
      this._itemRevokeTemporaryPermissionsSeparator = document
          .getElementById("requestpolicyRevokeTemporaryPermissionsSeparator");

      this._itemAllowOriginTemporarily = document
          .getElementById("requestpolicyAllowOriginTemporarily");
      this._itemAllowOrigin = document
          .getElementById("requestpolicyAllowOrigin");
      this._itemForbidOrigin = document
          .getElementById("requestpolicyForbidOrigin");

      this._statusbar = document.getElementById("status-bar");
      this._rpStatusbar = document.getElementById("requestpolicyStatusbar");
      this._rpContextMenu = document.getElementById("requestpolicyContextMenu");
    }
  },

  /**
   * Perform the actions required once the window has loaded. This just sets a
   * listener for when the content of the window has changed (a page is loaded).
   * 
   * @param {Event}
   *            event
   */
  onLoad : function(event) {
    // Info on detecting page load at:
    // http://developer.mozilla.org/En/Code_snippets/On_page_load
    var appcontent = document.getElementById("appcontent"); // browser
    const requestpolicyOverlay = this;
    if (appcontent) {
      appcontent.addEventListener("DOMContentLoaded", function(event) {
            requestpolicyOverlay.onPageLoad(event);
          }, true);
    }

    // Add an event listener for when the contentAreaContextMenu (generally the
    // right-click menu within the document) is shown.
    var contextMenu = document.getElementById("contentAreaContextMenu");
    if (contextMenu) {
      contextMenu.addEventListener("popupshowing",
          this._contextMenuOnPopupShowing, false);
    }

    // We consider the default place for the popup to be attached to the context
    // menu, so attach it there.
    this._attachPopupToContextMenu();

    // Listen for the user changing tab so we can update any notification or
    // indication of blocked requests.
    var container = gBrowser.tabContainer;
    container.addEventListener("TabSelect", function(event) {
          requestpolicyOverlay.tabChanged();
        }, false);
  },

  _showRedirectNotification : function(targetDocument, redirectTargetUri, delay) {
    // TODO: Do something with the delay. Not sure what the best thing to do is
    // without complicating the UI.

    // TODO: The following error seems to be resulting when the notification
    // goes away with a redirect, either after clicking "allow" or if the
    // redirect is allowed and happens automatically.
    //
    // Source file: chrome://browser/content/browser.js
    // Line: 3704
    // ----------
    // Error: self._closedNotification.parentNode is null
    // Source file: chrome://global/content/bindings/notification.xml
    // Line: 260

    var notificationBox = gBrowser.getNotificationBox();
    var notificationValue = "request-policy-meta-redirect";
    var notificationLabel = this._strbundle.getFormattedString(
        "redirectNotification", [redirectTargetUri]);
    var notificationButtonOptions = this._strbundle.getString("options");
    var notificationButtonAllow = this._strbundle.getString("allow");
    var notificationButtonDeny = this._strbundle.getString("deny");

    optionsPopupName = "requestpolicyRedirectNotificationOptions";
    var optionsPopup = document.getElementById(optionsPopupName);
    this._clearMenu(optionsPopup);
    var currentIdent = this._getCurrentUriIdentifier();
    var destIdent = this._requestpolicy.getUriIdentifier(redirectTargetUri);
    Logger.dump(currentIdent);
    Logger.dump(destIdent);
    this._addMenuItemTemporarilyAllowOriginToDest(optionsPopup, currentIdent,
        destIdent);
    this._addMenuItemAllowOriginToDest(optionsPopup, currentIdent, destIdent);

    var notification = notificationBox
        .getNotificationWithValue(notificationValue);
    if (notification) {
      notification.label = notificationLabel;
    } else {
      var buttons = [{
            label : notificationButtonOptions,
            accessKey : '', // TODO
            popup : optionsPopupName,
            callback : null
          }, {
            label : notificationButtonAllow,
            accessKey : '', // TODO
            popup : null,
            callback : function() {
              targetDocument.location.href = redirectTargetUri;
            }
          }, {
            label : notificationButtonDeny,
            accessKey : '', // TODO
            popup : null,
            callback : function() {
              // Do nothing. The notification closes when this is called.
            }
          }];
      const priority = notificationBox.PRIORITY_WARNING_MEDIUM;
      notificationBox.appendNotification(notificationLabel, notificationValue,
          "chrome://browser/skin/Info.png", priority, buttons);
    }
  },

  tabChanged : function() {
    this._checkForBlockedContent();
  },

  /**
   * Things to do when a page has loaded (after images, etc., have been loaded).
   * 
   * @param {Event}
   *            event
   */
  onPageLoad : function(event) {
    // TODO: This is getting called multiple times for a page, should only be
    // called once.

    if (event.originalTarget.nodeName != "#document") {
      // It's a favicon. See the note at
      // http://developer.mozilla.org/En/Code_snippets/On_page_load
      return;
    }

    this._onDOMContentLoaded(event);
    this._checkForBlockedContent();
  },

  /**
   * Checks if the current document has blocked content and shows appropriate
   * notifications.
   */
  _checkForBlockedContent : function() {
    Logger.debug(Logger.TYPE_INTERNAL, "checking for blocked content");
    var uri = this._getCurrentUri();
    var rejectedRequests = this._requestpolicyJSObject._rejectedRequests[uri];
    var anyRejected = false;
    if (rejectedRequests) {
      for (var i in rejectedRequests) {
        for (var j in rejectedRequests[i]) {
          if (rejectedRequests[i][j]) {
            anyRejected = true;
          }
        }
      }
    }
    this._setBlockedContentNotification(anyRejected);
  },

  /**
   * Sets the blocked content notifications visible to the user.
   */
  _setBlockedContentNotification : function(isContentBlocked) {
    this._rpStatusbar.setAttribute("blocked", isContentBlocked);
    this._rpContextMenu.setAttribute("blocked", isContentBlocked);
  },

  /**
   * Sets the permissive status visible to the user.
   */
  _setPermissiveNotification : function(isPermissive) {
    this._rpStatusbar.setAttribute("permissive", isPermissive);
    this._rpContextMenu.setAttribute("permissive", isPermissive);
  },

  /**
   * Perform the actions required once the DOM is loaded. This may be being
   * called for more than just the page content DOM. It seems to work for now.
   * 
   * @param {Event}
   *            event
   */
  _onDOMContentLoaded : function(event) {

    // TODO: Listen for DOMSubtreeModified and/or DOMLinkAdded to register
    // new links/forms with requestpolicy even if they are added after initial
    // load (e.g. they are added through javascript).

    var document = event.target;
    const requestpolicy = this._requestpolicy;

    // Clear any notifications that may have been present.
    this._setBlockedContentNotification(false);

    // Find all meta redirects.
    var metaTags = document.getElementsByTagName("meta");
    for (var i = 0; i < metaTags.length; i++) {
      if (metaTags[i].httpEquiv
          && metaTags[i].httpEquiv.toLowerCase() == "refresh") {
        // TODO: Register meta redirects so we can tell which blocked requests
        // were meta redirects in the statusbar menu.
        Logger.info(Logger.TYPE_META_REFRESH, "meta refresh to <"
                + metaTags[i].content + "> found in document at <"
                + document.location + ">");

        // TODO: move this logic to the requestpolicy service.
        var parts = /^\s*(\S*)\s*;\s*url\s*=\s*(.*?)\s*$/i(metaTags[i].content);
        var delay = parts[1];
        var dest = parts[2];
        if (dest != undefined) {
          if (this._requestpolicyJSObject._blockingDisabled
              || this._requestpolicy.isAllowedRedirect(document.location, dest)) {
            // The meta refresh is allowed.
            this._performRedirectAfterDelay(document, dest, delay);
          } else {
            this._showRedirectNotification(document, dest, delay);
          }
        }
      }
    }

    // Find all anchor tags and add click events (which also fire when enter
    // is pressed while the element has focus).
    // This semes to be a safe approach in that the MDC states that javascript
    // can't be used to initiate a click event on a link:
    // http://developer.mozilla.org/en/DOM/element.click
    var anchorTags = document.getElementsByTagName("a");
    for (var i = 0; i < anchorTags.length; i++) {
      anchorTags[i].addEventListener("click", function(event) {
            // Note: need to use currentTarget so that it is the link, not
            // something else within the link that got clicked, it seems.
            requestpolicy
                .registerLinkClicked(event.currentTarget.ownerDocument.URL,
                    event.currentTarget.href);
          }, false);
    }

    // Find all form tags and add submit events.
    // As far as I can tell, calling a form's submit() method from javascript
    // will not cause this event listener to fire, which makes things easier in
    // that we don't have to find another way to tell if the user submitted the
    // form or if it was done by javascript. However, I'm not sure on the
    // specifics of why submit() from javascript doesn't end up calling this. I
    // can only conclude it's the same difference as with link clicks by humans
    // vs. click(), but that the docmentation just doesn't state this.
    var formTags = document.getElementsByTagName("form");
    for (var i = 0; i < formTags.length; i++) {
      formTags[i].addEventListener("submit", function(event) {
            requestpolicy.registerFormSubmitted(event.target.ownerDocument.URL,
                event.target.action);
          }, false);
    }

    // Find all <link rel="prefetch" ...> tags. Unfortunately, they can't
    // just be removed (the url is still prefetched). Just use this as a way
    // to warn the user. Fundamentally, the user needs to manually change
    // their preferences until it's possible to change the prefetch preference
    // programmatically.
    var linkTags = document.getElementsByTagName("link");
    for (var i = 0; i < linkTags.length; i++) {
      if (linkTags[i].rel.toLowerCase() == "prefetch") {
        Logger.info(Logger.TYPE_CONTENT, "prefetch of <" + linkTags[i].href
                + "> found in document at <" + document.location + ">");
      }
    }

    if (this._requestpolicyJSObject._blockedRedirects[document.location]) {
      var dest = this._requestpolicyJSObject._blockedRedirects[document.location];
      Logger.warning(Logger.TYPE_HEADER_REDIRECT,
          "Showing notification for blocked redirect. To <" + dest + "> "
              + "from <" + document.location + ">");
      this._showRedirectNotification(document, dest);
      delete this._requestpolicyJSObject._blockedRedirects[document.location];
    }

  },

  /**
   * Called as an event listener when popupshowing fires on the
   * contentAreaContextMenu.
   */
  _contextMenuOnPopupShowing : function() {
    requestpolicyOverlay._wrapOpenLinkFunctions();
    requestpolicyOverlay._attachPopupToContextMenu();
  },

  /**
   * Called as an event listener when popuphidden fires on the
   * contentAreaContextMenu.
   */
  _contextMenuOnPopupHidden : function(event) {
    if (event.currentTarget != event.originalTarget) {
      return;
    }
    requestpolicyOverlay._attachPopupToStatusbar();
  },

  /**
   * Changes the gContextMenu's functions that open links in new tabs or windows
   * such that they first call our own functions before the original open in new
   * link/window functions are executed.
   */
  _wrapOpenLinkFunctions : function() {
    const requestpolicy = this._requestpolicy;

    if (!gContextMenu.origOpenLinkInTab) {
      gContextMenu.origOpenLinkInTab = gContextMenu.openLinkInTab;
      gContextMenu.openLinkInTab = function() {
        requestpolicy.registerLinkClicked(gContextMenu.link.ownerDocument.URL,
            gContextMenu.link.href);
        return gContextMenu.origOpenLinkInTab();
      };
    }

    if (!gContextMenu.origOpenLink) {
      gContextMenu.origOpenLink = gContextMenu.openLink;
      gContextMenu.openLink = function() {
        return gContextMenu.origOpenLink();
      };
    }
  },

  /**
   * Called before the popup menu is shown.
   * 
   * @param {Event}
   *            event
   */
  onMenuShowing : function(event) {
    if (event.currentTarget != event.originalTarget) {
      return;
    }
    this.prepareMenu();
  },

  /**
   * Called after the popup menu is hidden.
   * 
   * @param {Event}
   *            event
   */
  onMenuHidden : function(event) {
    if (event.currentTarget != event.originalTarget) {
      return;
    }
    // Leave the popup attached to the context menu, as we consdier that the
    // default location for it.
    this._attachPopupToContextMenu();
  },

  /**
   * Determines the current document's uri identifier based on the current
   * identifier level setting.
   * 
   * @return {String} The current document's identifier.
   */
  _getCurrentUriIdentifier : function _getCurrentUriIdentifier() {
    return this._requestpolicyJSObject.getUriIdentifier(this._getCurrentUri());
  },

  _getCurrentUri : function _getCurrentUriIdentifier() {
    return DomainUtils.stripFragment(content.document.documentURI);
  },

  /**
   * Prepares the statusbar menu based on the user's settings and the current
   * document.
   */
  prepareMenu : function() {
    try {
      var currentIdentifier = this._getCurrentUriIdentifier();

      Logger.dump(currentIdentifier);

      // Set all labels here for convenience, even though we won't display some
      // of these menu items.
      this._itemForbidOrigin.setAttribute("label", this._strbundle
              .getFormattedString("forbidOrigin", [currentIdentifier]));
      this._itemAllowOriginTemporarily.setAttribute("label",
          this._strbundle.getFormattedString("allowOriginTemporarily",
              [currentIdentifier]));
      this._itemAllowOrigin.setAttribute("label", this._strbundle
              .getFormattedString("allowOrigin", [currentIdentifier]));

      // Initially make all menu items hidden.
      this._itemRevokeTemporaryPermissions.hidden = true;
      this._itemRevokeTemporaryPermissionsSeparator.hidden = true;
      this._itemAllowOriginTemporarily.hidden = true;
      this._itemAllowOrigin.hidden = true;
      this._itemForbidOrigin.hidden = true;

      this._itemPrefetchWarning.hidden = this._itemPrefetchWarningSeparator.hidden = !this._requestpolicy
          .isPrefetchEnabled();

      if (this._requestpolicy.isTemporarilyAllowedOrigin(currentIdentifier)) {
        this._itemForbidOrigin.hidden = false;
      } else if (this._requestpolicy.isAllowedOrigin(currentIdentifier)) {
        this._itemForbidOrigin.hidden = false;
      } else {
        this._itemAllowOriginTemporarily.hidden = false;
        this._itemAllowOrigin.hidden = false;
      }

      if (this._requestpolicy.areTemporaryPermissionsGranted()) {
        this._itemRevokeTemporaryPermissions.hidden = false;
        this._itemRevokeTemporaryPermissionsSeparator.hidden = false;
      }

      // Remove old menu items.
      for (var i in this._addedMenuItems) {
        this._menu.removeChild(this._addedMenuItems[i]);
      }
      this._addedMenuItems = [];

      var uri = this._getCurrentUri();

      // Add new menu items giving options to allow content.
      var rejectedRequests = this._requestpolicyJSObject._rejectedRequests[uri];
      this._clearBlockedDestinations();
      for (var destIdentifier in rejectedRequests) {
        var submenu = this._addBlockedDestination(destIdentifier);
        this._addMenuItemTemporarilyAllowDest(submenu, destIdentifier);
        this._addMenuItemAllowDest(submenu, destIdentifier);
        this._addMenuSeparator(submenu);
        this._addMenuItemTemporarilyAllowOriginToDest(submenu,
            currentIdentifier, destIdentifier);
        this._addMenuItemAllowOriginToDest(submenu, currentIdentifier,
            destIdentifier);
      }

      // Add new menu items giving options to forbid currently accepted
      // content.
      this._clearAllowedDestinations();
      var allowedRequests = this._requestpolicyJSObject._allowedRequests[uri];
      for (var destIdentifier in allowedRequests) {
        if (destIdentifier == this._getCurrentUriIdentifier()) {
          continue;
        }
        var submenu = this._addAllowedDestination(destIdentifier);

        // Show a "forbid ___" option that is specific to why the content is
        // allowed.

        // The "order" in which to show these may be worth further
        // consideration. Currently, the options for forbidding content start
        // from the "allow" rules that are most liberal if they exist and shows
        // the more specific ones if there aren't more liberal ones that would
        // apply. The big catch is putting it in any other order may result in
        // the user having to perform multiple "forbids" after successive
        // reloads, which would be unacceptable.

        if (this._requestpolicy.isAllowedOrigin(currentIdentifier)
            || this._requestpolicy
                .isTemporarilyAllowedOrigin(currentIdentifier)) {
          this._addMenuItemForbidOrigin(submenu, currentIdentifier);

        } else if (this._requestpolicy.isAllowedDestination(destIdentifier)
            || this._requestpolicy
                .isTemporarilyAllowedDestination(destIdentifier)) {
          this._addMenuItemForbidDest(submenu, destIdentifier);

        } else if (this._requestpolicy.isAllowedOriginToDestination(
            currentIdentifier, destIdentifier)
            || this._requestpolicy.isTemporarilyAllowedOriginToDestination(
                currentIdentifier, destIdentifier)) {
          this._addMenuItemForbidOriginToDest(submenu, currentIdentifier,
              destIdentifier);

        } else {
          // TODO: make very sure this can never happen or, better, get an idea
          // of when it can and make a sane default.
        }
      }
    } catch (e) {
      Logger.severe(Logger.TYPE_ERROR, "Fatal Error, " + e + ", stack was: "
              + e.stack);
      Logger.severe(Logger.TYPE_ERROR, "Unable to prepare menu due to error.");
      throw e;
    }
  },

  _removeExtraSubmenuSeparators : function(menu) {
    if (menu.firstChild && menu.lastChild.nodeName == "menuseparator") {
      menu.removeChild(menu.lastChild);
    }
  },

  _disableMenuIfEmpty : function(menu) {
    // parentNode is the menu label
    menu.parentNode.disabled = menu.firstChild ? false : true;
  },

  _addMenuItemTemporarilyAllowDest : function(menu, destHost) {
    var label = this._strbundle.getFormattedString(
        "allowDestinationTemporarily", [destHost]);
    var command = "requestpolicyOverlay.temporarilyAllowDestination('"
        + this._sanitizeJsFunctionArg(destHost) + "');";
    var statustext = destHost; // TODO
    var item = this._addMenuItem(menu, label, command, statustext);
    item.setAttribute("class", "requestpolicyTemporary");
    return item;
  },

  _addMenuItemTemporarilyAllowOriginToDest : function(menu, originHost,
      destHost) {
    var label = this._strbundle.getFormattedString(
        "allowOriginToDestinationTemporarily", [originHost, destHost]);
    var command = "requestpolicyOverlay.temporarilyAllowOriginToDestination('"
        + this._sanitizeJsFunctionArg(originHost) + "', '"
        + this._sanitizeJsFunctionArg(destHost) + "');";
    var statustext = destHost; // TODO
    var item = this._addMenuItem(menu, label, command, statustext);
    item.setAttribute("class", "requestpolicyTemporary");
    return item;
  },

  _addMenuItemAllowDest : function(menu, destHost) {
    var label = this._strbundle.getFormattedString("allowDestination",
        [destHost]);
    var command = "requestpolicyOverlay.allowDestination('"
        + this._sanitizeJsFunctionArg(destHost) + "');";
    var statustext = destHost; // TODO
    return this._addMenuItem(menu, label, command, statustext);
  },

  _addMenuItemAllowOriginToDest : function(menu, originHost, destHost) {
    var label = this._strbundle.getFormattedString("allowOriginToDestination",
        [originHost, destHost]);
    var command = "requestpolicyOverlay.allowOriginToDestination('"
        + this._sanitizeJsFunctionArg(originHost) + "', '"
        + this._sanitizeJsFunctionArg(destHost) + "');";
    var statustext = destHost; // TODO
    var item = this._addMenuItem(menu, label, command, statustext);
    item.setAttribute("class", "requestpolicyAllowOriginToDest");
    return item;
  },

  _addMenuItemForbidOrigin : function(menu, originHost) {
    var label = this._strbundle
        .getFormattedString("forbidOrigin", [originHost]);
    var command = "requestpolicyOverlay.forbidOrigin('"
        + this._sanitizeJsFunctionArg(originHost) + "');";
    var statustext = originHost;
    return this._addMenuItem(menu, label, command, statustext);
  },

  _addMenuItemForbidDest : function(menu, destHost) {
    var label = this._strbundle.getFormattedString("forbidDestination",
        [destHost]);
    var command = "requestpolicyOverlay.forbidDestination('"
        + this._sanitizeJsFunctionArg(destHost) + "');";
    var statustext = destHost; // TODO
    return this._addMenuItem(menu, label, command, statustext);
  },

  _addMenuItemForbidOriginToDest : function(menu, originHost, destHost) {
    var label = this._strbundle.getFormattedString("forbidOriginToDestination",
        [originHost, destHost]);
    var command = "requestpolicyOverlay.forbidOriginToDestination('"
        + this._sanitizeJsFunctionArg(originHost) + "', '"
        + this._sanitizeJsFunctionArg(destHost) + "');";
    var statustext = destHost; // TODO
    return this._addMenuItem(menu, label, command, statustext);
  },

  _sanitizeJsFunctionArg : function(str) {
    // strip single quotes and backslashes
    return str.replace(/['\\]/g, "");
  },

  _addMenuSeparator : function(menu) {
    var separator = document.createElement("menuseparator");
    menu.insertBefore(separator, menu.firstChild);
    return separator;
  },

  _addMenuItem : function(menu, label, oncommand, statustext) {
    var menuItem = document.createElement("menuitem");
    menuItem.setAttribute("label", label);
    menuItem.setAttribute("statustext", statustext);
    menuItem.setAttribute("oncommand", oncommand);
    // menuItem.setAttribute("tooltiptext", node.getAttribute("tooltiptext"));
    menu.insertBefore(menuItem, menu.firstChild);
    return menuItem;
  },

  _addMenu : function(parentMenu, label) {
    var menu = document.createElement("menu");
    menu.setAttribute("label", label);
    parentMenu.insertBefore(menu, parentMenu.firstChild);
    // add the menu popup in the menu item
    var menuPopup = document.createElement("menupopup");
    menu.insertBefore(menuPopup, menu.firstChild);
    // return the popup as that's what will have items added to it
    return menuPopup;
  },

  _addBlockedDestination : function(label) {
    var menu = document.createElement("menu");
    menu.setAttribute("label", this._strbundle.getFormattedString(
            "indentedText", [label]));
    menu.setAttribute("class", "requestpolicyBlocked");
    this._menu.insertBefore(menu, this._blockedDestinationsBeforeReferenceItem);
    // add the menu popup in the menu item
    var menuPopup = document.createElement("menupopup");
    menu.insertBefore(menuPopup, menu.firstChild);
    // return the popup as that's what will have items added to it

    // remember what we added
    this._blockedDestinationsItems.push(menu);

    return menuPopup;
  },

  _addAllowedDestination : function(label) {
    var menu = document.createElement("menu");
    menu.setAttribute("label", this._strbundle.getFormattedString(
            "indentedText", [label]));
    menu.setAttribute("class", "requestpolicyAllowed");
    this._menu.insertBefore(menu, this._allowedDestinationsBeforeReferenceItem);
    // add the menu popup in the menu item
    var menuPopup = document.createElement("menupopup");
    menu.insertBefore(menuPopup, menu.firstChild);
    // return the popup as that's what will have items added to it

    // remember what we added
    this._allowedDestinationsItems.push(menu);

    return menuPopup;
  },

  _clearBlockedDestinations : function() {
    for (var i = 0; i < this._blockedDestinationsItems.length; i++) {
      this._menu.removeChild(this._blockedDestinationsItems[i]);
    }
    this._blockedDestinationsItems = [];
  },

  _clearAllowedDestinations : function() {
    for (var i = 0; i < this._allowedDestinationsItems.length; i++) {
      this._menu.removeChild(this._allowedDestinationsItems[i]);
    }
    this._allowedDestinationsItems = [];
  },

  _clearMenu : function(menu) {
    while (menu.firstChild) {
      menu.removeChild(menu.firstChild);
    }
  },

  /**
   * Reloads the current document if the user's preferences indicate it should
   * be reloaded.
   */
  _conditionallyReloadDocument : function() {
    if (this._requestpolicy.prefs.getBoolPref("autoReload")) {
      content.document.location.reload(true);
    }
  },

  /**
   * Toggles disabling of all blocking for the current session.
   * 
   * @param {Event}
   *            event
   */
  toggleTemporarilyAllowAll : function(event) {
    // TODO: Refactor to use a function call to disable blocking.
    this._requestpolicyJSObject._blockingDisabled = !this._requestpolicyJSObject._blockingDisabled;
    // Only reloading the current document. Should we reload all? Seems like it
    // would be unexpected to the user if all were reloaded.
    this
        ._setPermissiveNotification(this._requestpolicyJSObject._blockingDisabled);
    this._conditionallyReloadDocument();
  },

  /**
   * Allows the current document's origin to request from any destination for
   * the duration of the browser session.
   * 
   * @param {Event}
   *            event
   */
  temporarilyAllowOrigin : function(event) {
    // Note: the available variable "content" is different than the avaialable
    // "window.target".
    var host = this._getCurrentUriIdentifier();
    this._requestpolicy.temporarilyAllowOrigin(host);
    this._conditionallyReloadDocument();
  },

  /**
   * Allows a destination to be requested from any origin for the duration of
   * the browser session.
   * 
   * @param {String}
   *            destHost
   */
  temporarilyAllowDestination : function(destHost) {
    this._requestpolicy.temporarilyAllowDestination(destHost);
    this._conditionallyReloadDocument();
  },

  /**
   * Allows a destination to be requested from a single origin for the duration
   * of the browser session.
   * 
   * @param {String}
   *            originHost
   * @param {String}
   *            destHost
   */
  temporarilyAllowOriginToDestination : function(originHost, destHost) {
    this._requestpolicy.temporarilyAllowOriginToDestination(originHost,
        destHost);
    this._conditionallyReloadDocument();
  },

  /**
   * Allows the current document's origin to request from any destination,
   * including in future browser sessions.
   * 
   * @param {Event}
   *            event
   */
  allowOrigin : function(event) {
    var host = this._getCurrentUriIdentifier();
    this._requestpolicy.allowOrigin(host);
    this._conditionallyReloadDocument();
  },

  /**
   * Allows requests to a destination, including in future browser sessions.
   * 
   * @param {String}
   *            destHost
   */
  allowDestination : function(destHost) {
    this._requestpolicy.allowDestination(destHost);
    this._conditionallyReloadDocument();
  },

  /**
   * Allows requests to a destination from a single origin, including in future
   * browser sessions.
   * 
   * @param {String}
   *            originHost
   * @param {String}
   *            destHost
   */
  allowOriginToDestination : function(originHost, destHost) {
    this._requestpolicy.allowOriginToDestination(originHost, destHost);
    this._conditionallyReloadDocument();
  },

  /**
   * Forbids the current document's origin from requesting from any destination.
   * This revoke's temporary or permanent request permissions the origin had
   * been given.
   * 
   * @param {Event}
   *            event
   */
  forbidOrigin : function(event) {
    var host = this._getCurrentUriIdentifier();
    this._requestpolicy.forbidOrigin(host);
    this._conditionallyReloadDocument();
  },

  /**
   * Forbids a destination from being requested by any origin. This revoke's
   * temporary or permanent request permissions the destination had been given.
   * 
   * @param {String}
   *            destHost
   */
  forbidDestination : function(destHost) {
    this._requestpolicy.forbidDestination(destHost);
    this._conditionallyReloadDocument();
  },

  /**
   * Forbids a destination from being requested by a single origin. This
   * revoke's temporary or permanent request permissions the destination had
   * been given.
   * 
   * @param {String}
   *            originHost
   * @param {String}
   *            destHost
   */
  forbidOriginToDestination : function(originHost, destHost) {
    this._requestpolicy.forbidOriginToDestination(originHost, destHost);
    this._conditionallyReloadDocument();
  },

  /**
   * Revokes all temporary permissions granted during the current session.
   * 
   * @param {Event}
   *            event
   */
  revokeTemporaryPermissions : function(event) {
    this._requestpolicy.revokeTemporaryPermissions();
    this._conditionallyReloadDocument();
  },

  _performRedirectAfterDelay : function(document, redirectTargetUri, delay) {
    Logger.info(Logger.TYPE_INTERNAL, "Registering delayed (" + delay
            + "s) redirect to <" + redirectTargetUri + "> from <"
            + document.documentURI + ">");
    const constDocument = document;
    const constRedirectTargetUri = redirectTargetUri;
    document.defaultView.setTimeout(function() {
          requestpolicyOverlay._performRedirect(constDocument,
              constRedirectTargetUri);
        }, delay * 1000);
  },

  _performRedirect : function(document, redirectTargetUri) {
    try {
      if (redirectTargetUri[0] == '/') {
        Logger.info(Logger.TYPE_INTERNAL, "Redirecting to relative path <"
                + redirectTargetUri + "> from <" + document.documentURI + ">");
        document.location.pathname = redirectTargetUri;
      } else {
        // If there is no scheme, treat it as relative to the current directory.
        if (redirectTargetUri.indexOf(":") == -1) {
          // TODO: Move this logic to DomainUtils.
          var curDir = document.documentURI.split("/").slice(0, -1).join("/");
          redirectTargetUri = curDir + "/" + redirectTargetUri;
        }
        Logger.info(Logger.TYPE_INTERNAL, "Redirecting to <"
                + redirectTargetUri + "> from <" + document.documentURI + ">");
        document.location.href = redirectTargetUri;
      }
    } catch (e) {
      if (e.name != "NS_ERROR_FILE_NOT_FOUND") {
        throw e;
      }
    }
  },

  _openInNewTab : function(uri) {
    gBrowser.selectedTab = gBrowser.addTab(uri);
  },

  showPrefetchInfo : function() {
    this._openInNewTab(this._prefetchInfoUri);
  },

  showPrefetchDisablingInstructions : function() {
    this._openInNewTab(this._prefetchDisablingInstructionsUri);
  },

  _attachPopupToContextMenu : function() {
    // Add the menupopup back to the contextmenu.
    if (!requestpolicyOverlay._rpContextMenu.firstChild) {
      requestpolicyOverlay._rpContextMenu.insertBefore(
          requestpolicyOverlay._menu, null);
    }
  },

  _attachPopupToStatusbar : function() {
    // Add the menupopup to the statusbar as it may be attached to the
    // contextmenu.
    requestpolicyOverlay._statusbar.insertBefore(requestpolicyOverlay._menu,
        null);
  },

  openStatusbarPopup : function(anchor) {
    // Open the popup.
    this._attachPopupToStatusbar();
    this._menu.openPopup(anchor, 'before_start', 0, 0, true, true);
  }

};

// Initialize the requestpolicyOverlay object when the window DOM is loaded.
addEventListener("DOMContentLoaded", function(event) {
      requestpolicyOverlay.init();
    }, false);

// Registers event handlers for documents loaded in the window.
addEventListener("load", function(event) {
      requestpolicyOverlay.onLoad(event);
    }, false);
