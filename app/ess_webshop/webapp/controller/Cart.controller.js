sap.ui.define([
  "./BaseController",
  "sap/ui/model/json/JSONModel",
  "sap/ui/Device",
  "../model/formatter",
  "sap/m/MessageBox",
  "sap/m/MessageToast"
], (BaseController, JSONModel, Device, formatter, MessageBox, MessageToast) => {
  "use strict";
  var sCartModelName = "cartProducts";
  var sSavedForLaterEntries = "savedForLaterEntries";
  var sCartEntries = "cartEntries";

  return BaseController.extend("diehlwebshop.controller.Cart", {
    formatter: formatter,



    onInit: function () {
      this.getView().setModel(this.getOwnerComponent().getModel());
      this._oRouter = this.getRouter();
      this._oRouter.getRoute("cart").attachPatternMatched(this._routePatternMatched, this);
      this._oRouter.getRoute("productCart").attachPatternMatched(this._routePatternMatched, this);

      var oCfgModel = new JSONModel({});
      this.getView().setModel(oCfgModel, "cfg");
      this._toggleCfgModel();

      var oEditButton = this.byId("editButton");
      oEditButton.addEventDelegate({ onAfterRendering: function () { oEditButton.focus(); } });
    },

    onExit: function () {
      if (this._orderDialog) { this._orderDialog.destroy(); }
      if (this._orderBusyDialog) { this._orderBusyDialog.destroy(); }
    },

    // Validiert und korrigiert Mengenänderungen im StepInput live (mindestens 1) und 
    // schreibt die Menge in das cartProducts-Model.
    onQuantityLiveChange: function (oEvent) {
      const oInput = oEvent.getSource();
      const sValue = oInput.getValue();
      const iVal = Math.max(1, parseInt(sValue, 10) || 1);

      if (parseInt(sValue, 10) !== iVal) {
        oInput.setValue(iVal);
      }

      const oCtx = oInput.getBindingContext("cartProducts");
      if (!oCtx) {
        return;
      }

      const oModel = oCtx.getModel();
      const sPath = oCtx.getPath();

      oModel.setProperty(sPath + "/MENGE", iVal);
      // refresh ist bei TwoWay-Binding nicht zwingend notwendig
    },



    // Wird beim Matching der Cart-Routen aufgerufen: stellt bei Bedarf auf Drei-Spalten-Layout um,
    // aktiviert Buttons bei vorhandenen Einträgen und entfernt Listenselektionen.
    _routePatternMatched: function () {
      const oAppViewModel = this.getModel("appView");
      const sCurrentLayout = oAppViewModel.getProperty("/layout");
      const bCartWillBeOpened = !sCurrentLayout.startsWith("TwoColumns");
      if (bCartWillBeOpened) { this._setLayout("Three"); }

      const oCartModel = this.getModel(sCartModelName);
      const oCartEntries = oCartModel.getProperty("/" + sCartEntries);
      if (Array.isArray(oCartEntries) && oCartEntries.length > 0) {
        oCartModel.setProperty("/showProceedButton", true);
        oCartModel.setProperty("/showEditButton", true);
      }
      this.byId("entryList").removeSelections();
    },


    // Schaltet zwischen Bearbeiten- und Fertig-Modus um, indem die Konfiguration im cfg-Model umgestellt wird.
    onEditOrDoneButtonPress: function () {
      this._toggleCfgModel();
    },

    // Aktualisiert das cfg-Model für UI-Zustände (Delete-/Select-Modus, ListMode, ItemType, Seitentitel) 
    // abhängig von Device und aktuellem Edit-Status.
    _toggleCfgModel: function () {
      var oCfgModel = this.getView().getModel("cfg");
      var oData = oCfgModel.getData();
      var oBundle = this.getResourceBundle();
      var bDataNoSetYet = !oData.hasOwnProperty("inDelete");
      var bInDelete = (bDataNoSetYet ? true : oData.inDelete);
      var sPhoneMode = (Device.system.phone ? "None" : "SingleSelectMaster");
      var sPhoneType = (Device.system.phone ? "Active" : "Inactive");

      oCfgModel.setData({
        inDelete: !bInDelete,
        notInDelete: bInDelete,
        listMode: (bInDelete ? sPhoneMode : "Delete"),
        listItemType: (bInDelete ? sPhoneType : "Inactive"),
        pageTitle: (bInDelete ? oBundle.getText("Cart_rootLabel") : oBundle.getText("cartTitleEdit"))
      });
    },

    // Reagiert auf Klick/Press auf einen Listeneintrag und öffnet die zugehörige Produktdetailansicht.
    onEntryListPress: function (oEvent) {
      this._showProduct(oEvent.getSource());
    },

    // Reagiert auf Auswahl eines Listeneintrags (z. B. per Tastatur/Select) und öffnet die zugehörige Produktdetailansicht.
    onEntryListSelect: function (oEvent) {
      this._showProduct(oEvent.getParameter("listItem"));
    },

    // Verschiebt einen Eintrag aus dem Warenkorb in die Merkliste ("Saved for later") 
    // und passt die zugrundeliegenden Listen im Model an.
    onSaveForLater: function (oEvent) {
      var oBindingContext = oEvent.getSource().getBindingContext(sCartModelName);
      this._changeList(sSavedForLaterEntries, sCartEntries, oBindingContext);
    },

    // Fügt einen Eintrag aus der Merkliste wieder in den Warenkorb ein, ohne ihn aus der Merkliste zu entfernen.
    onAddBackToBasket: function (oEvent) {
      var oCtx = oEvent.getSource().getBindingContext(sCartModelName);
      this._addToCartKeepSaved(oCtx);
    },

    // Verschiebt ein Produkt anhand des BindingContexts zwischen zwei Listen im Cart-Model 
    // (inkl. Mengen-Zusammenführung bei bereits vorhandenem Ziel-Eintrag).
    _changeList: function (sListToAddItem, sListToDeleteItem, oBindingContext) {
      var oCartModel = oBindingContext.getModel();
      var oProduct = oBindingContext.getObject();

      var aTo = oCartModel.getProperty("/" + sListToAddItem) || [];
      var aFrom = oCartModel.getProperty("/" + sListToDeleteItem) || [];

      if (!Array.isArray(aTo)) { aTo = Object.values(aTo || {}); }
      if (!Array.isArray(aFrom)) { aFrom = Object.values(aFrom || {}); }

      var sId = String(oProduct.ZmmWebsArtikelId || "");
      var iQtySource = parseInt(oProduct.MENGE, 10) || 1;

      // in Ziel-Liste vorhandenes Produkt suchen
      var iExistingTo = aTo.findIndex(e => String(e.ZmmWebsArtikelId) === sId);

      if (iExistingTo === -1) {
        var oCopy = Object.assign({}, oProduct);
        oCopy.MENGE = iQtySource;
        aTo.push(oCopy);
      } else {
        var qty = parseInt(aTo[iExistingTo].MENGE, 10) || 0;
        aTo[iExistingTo].MENGE = qty + iQtySource;
      }

      // Quelle: Eintrag entfernen
      var iIdxFrom = aFrom.findIndex(e => String(e.ZmmWebsArtikelId) === sId);
      if (iIdxFrom > -1) { aFrom.splice(iIdxFrom, 1); }

      oCartModel.setProperty("/" + sListToAddItem, aTo);
      oCartModel.setProperty("/" + sListToDeleteItem, aFrom);
      oCartModel.refresh(true);
    },


    // Kopiert einen Merkliste-Eintrag in den Warenkorb (oder erhöht dort die Menge), 
    // ohne den Merkliste-Eintrag zu löschen, und aktualisiert Button-Sichtbarkeiten.
    _addToCartKeepSaved: function (oBindingContext) {
      var oCartModel = oBindingContext.getModel();
      var oProduct = oBindingContext.getObject();

      // Ziel-Liste (Warenkorb) holen
      var aCart = oCartModel.getProperty("/" + sCartEntries) || [];
      if (!Array.isArray(aCart)) { aCart = Object.values(aCart || {}); }

      // Eindeutig über Artikel-ID
      var sId = String(oProduct.ZmmWebsArtikelId || "");
      var iExisting = aCart.findIndex(e => String(e.ZmmWebsArtikelId) === sId);

      // Menge aus Merkliste übernehmen (Fallback 1)
      var iQtyToAdd = parseInt(oProduct.MENGE, 10) || 1;

      if (iExisting === -1) {
        // In den Warenkorb kopieren (nicht verschieben)
        var oCopy = Object.assign({}, oProduct);
        aCart.push(oCopy);
      } else {
        // bereits im Warenkorb → Menge erhöhen
        aCart[iExisting].MENGE = (parseInt(aCart[iExisting].MENGE, 10) || 0) + iQtyToAdd;
      }

      oCartModel.setProperty("/" + sCartEntries, aCart);
      oCartModel.setProperty("/showProceedButton", aCart.length > 0);
      oCartModel.setProperty("/showEditButton", aCart.length > 0);
      oCartModel.refresh(true);
    },


    // Navigiert zur Produktdetailseite des ausgewählten Warenkorbeintrags und 
    // passt auf dem Phone das Layout an (Cart schließen), damit die Detailansicht korrekt angezeigt wird.
    _showProduct: function (oItem) {
      var oEntry = oItem.getBindingContext(sCartModelName).getObject();

      var bCartVisible = false;
      if (!Device.system.phone) {
        bCartVisible = this.getModel("appView").getProperty("/layout").startsWith("Three");
      } else {
        bCartVisible = false;
        this._setLayout("Two");
      }

      this._oRouter.navTo(bCartVisible ? "productCart" : "product", {
        id: oEntry.ZmmWebsKatId,
        productId: oEntry.ZmmWebsArtikelId
      }, !Device.system.phone);
    },

    onCartEntriesDelete: function (oEvent) {
      this._deleteProduct(sCartEntries, oEvent);
    },

    onSaveForLaterDelete: function (oEvent) {
      this._deleteProduct(sSavedForLaterEntries, oEvent);
    },

    // Löscht einen Eintrag aus der angegebenen Collection (Warenkorb oder Merkliste) nach Bestätigung 
    // per Dialog, aktualisiert UI-States und zeigt Feedback per Toast.
    _deleteProduct: function (sCollection, oEvent) {
      const oListItem = oEvent.getParameter("listItem");
      const oCtx = oListItem.getBindingContext(sCartModelName);
      const oBundle = this.getResourceBundle();
      const sEntryId = oCtx.getProperty("ZmmWebsArtikelId");
      const sEntryName = oCtx.getProperty("ZmmWebsArtBez"); // anzeige-name im warenkorb
      const oCartModel = oCtx.getModel();

      MessageBox.show(oBundle.getText("cartDeleteDialogMsg"), {
        title: oBundle.getText("cartDeleteDialogTitle"),
        actions: [MessageBox.Action.DELETE, MessageBox.Action.CANCEL],
        onClose: function (oAction) {
          if (oAction !== MessageBox.Action.DELETE) return;

          const vEntries = oCartModel.getProperty("/" + sCollection) || [];
          let aEntries = Array.isArray(vEntries) ? vEntries.slice() : Object.values(vEntries);

          const iIdx = aEntries.findIndex(e => String(e.ZmmWebsArtikelId) === String(sEntryId));
          if (iIdx > -1) {
            aEntries.splice(iIdx, 1);
            oCartModel.setProperty("/" + sCollection, aEntries);
            oCartModel.refresh(true);

            const bHasItems = aEntries.length > 0;
            oCartModel.setProperty("/showProceedButton", bHasItems);
            oCartModel.setProperty("/showEditButton", bHasItems);

            const oList = sCollection === "cartEntries" ? this.byId("entryList") : this.byId("saveForLaterList");
            if (oList) { oList.removeSelections(); }

            MessageToast.show(oBundle.getText("cartDeleteDialogConfirmDeleteMsg", [sEntryName]));
          } else {
            MessageToast.show(oBundle.getText("cartNoData"));
          }
        }.bind(this)
      });
    },

    // Prüft, ob der Warenkorb Einträge enthält; setzt Layout auf Vollbild für den Checkout 
    // und navigiert in den CheckoutWizard (oder zeigt bei leerem Warenkorb einen Hinweis).
    onProceedButtonPress: function () {
      const oCartModel = this.getOwnerComponent().getModel("cartProducts");
      const v = oCartModel.getProperty("/cartEntries");
      const a = Array.isArray(v) ? v : Object.values(v || {});
      if (a.length === 0) {
        sap.m.MessageToast.show(this.getResourceBundle().getText("cartEmptyToast"));
        return;
      }

      const oAppView = this.getOwnerComponent().getModel("appView");
      if (oAppView) {
        oAppView.setProperty("/layout", "MidColumnFullScreen");  // ← wichtig
        oAppView.setProperty("/cartOpen", false);
      }

      this.getRouter().navTo("checkoutWizard");
    }

  });
});
