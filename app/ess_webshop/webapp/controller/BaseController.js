sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/m/MessageToast",
  "sap/ui/core/UIComponent",
  "sap/ui/core/routing/History",
  "../model/cart"
], function (Controller, MessageToast, UIComponent, History, cart) {
  "use strict";

  return Controller.extend("diehlwebshop.controller.BaseController", {
    cart: cart,

    /**
     * Liefert den Router der Eigentümer-Komponente.
     * @public
     * @returns {sap.ui.core.routing.Router} Router-Instanz
     */
    getRouter: function () {
      return UIComponent.getRouterFor(this);
    },

    /**
     * @public
     * @param {string} [sName] Optionaler Modelname 
     * @returns {sap.ui.model.Model} Gefundenes Model
     */
    getModel: function (sName) {
      return this.getView().getModel(sName);
    },

    /**
     * Kurzform zum Setzen eines (benannten) Models auf der aktuellen View.
     * @public
     * @param {sap.ui.model.Model} oModel Zu setzendes Model
     * @param {string} sName Modelname
     * @returns {sap.ui.mvc.View} Die View zur Verkettung
     */
    setModel: function (oModel, sName) {
      return this.getView().setModel(oModel, sName);
    },

    /**
     * Zugriff auf das I18n-ResourceBundle der Komponente.
     * @public
     * @returns {sap.base.i18n.ResourceBundle} ResourceBundle für Texte
     */
    getResourceBundle: function () {
      return this.getOwnerComponent().getModel("i18n").getResourceBundle();
    },

    /**
     * Zeigt beim Avatar-Klick einen i18n-basierten Hinweis als MessageToast an.
     * @public
     * @returns {void}
     */
    onAvatarPress: function () {
      var sMessage = this.getResourceBundle().getText("avatarButtonMessageToastText");
      MessageToast.show(sMessage);
    },

    /**
     * Reagiert auf stateChange des FlexibleColumnLayout, schreibt smallScreenMode ins appView-Model 
     * und erzwingt bei Bedarf ein Zwei-Spalten-Layout.
     * @public
     * @param {sap.ui.base.Event} oEvent FCL stateChange-Event
     * @returns {void}
     */
    onStateChange: function (oEvent) {
      var sLayout = oEvent.getParameter("layout");
      var iColumns = oEvent.getParameter("maxColumnsCount");

      this.getModel("appView").setProperty("/smallScreenMode", iColumns === 1);

      // Bei größerer Fläche und einfachem Layout auf zwei Spalten wechseln
      if (iColumns > 1 && sLayout === "OneColumn") {
        this._setLayout("Two");
      }
    },

    /**
     * Hilfsfunktion zum Setzen des Layout-Zustands im App-View-Model.
     * Baut den FCL-Layout-String korrekt zusammen (OneColumn bzw. TwoColumnsMidExpanded).
     * @private
     * @param {"One"|"Two"} sColumns Zielspalten-Anzahl als Wort
     * @returns {void}
     */
    _setLayout: function (sColumns) {
      if (sColumns) {
        this.getModel("appView").setProperty(
          "/layout",
          sColumns + "Column" + (sColumns === "One" ? "" : "sMidExpanded")
        );
      }
    },

    /**
     * Navigiert zurück: Erst Browser-Historie, sonst zur Home-Route.
     * @public
     * @returns {void}
     */
    onBack: function () {
      var oHistory = History.getInstance();
      var sPrevHash = oHistory.getPreviousHash();

      if (sPrevHash !== undefined) {
        window.history.go(-1);
      } else {
        this.getRouter().navTo("home");
      }
    },

    /**
     * Fügt ein Produkt zum Warenkorb hinzu oder erhöht dessen Menge,
     * harmonisiert unterschiedliche Feldnamen und aktualisiert Bindings.
     * Zentral gehalten, damit Freitext- und Katalog-Bestellung dieselbe Logik nutzen.
     * @protected
     * @param {object} oProduct Produktobjekt (kann unterschiedliche Feldbezeichner enthalten)
     * @param {int|string} [iQuantity=1] Menge (wird robust geparst)
     * @returns {void}
     */
    /* =========================================================
 * BaseController.js
 * ========================================================= */
    /**
     * Fügt ein Produkt robust in den Warenkorb ein oder erhöht die Menge; normalisiert Feldnamen, 
     * ergänzt fehlende Felder und aktualisiert das cartProducts-Model.
     */
    _addToCart: function (oProduct, iQuantity) {
      if (!oProduct) { return; }

      const rb = this.getResourceBundle();
      const oCartModel = this.getModel("cartProducts");
      if (!oCartModel) {
        jQuery.sap.log.error("cartProducts Model nicht gefunden.");
        return;
      }

      const iQty = Math.max(1, parseInt(iQuantity, 10) || 1);

      let aCart = oCartModel.getProperty("/cartEntries");
      if (!Array.isArray(aCart)) { aCart = Object.values(aCart || {}); }

      const sId = String(
        oProduct.ZmmWebsArtikelId ||
        oProduct.ProductId ||
        oProduct.Produktid ||
        ""
      ).trim();

      if (!sId) {
        jQuery.sap.log.error("Kein Produkt-Schlüssel gefunden (z. B. ZmmWebsArtikelId).");
        return;
      }

      const sCatId = String(oProduct.ZmmWebsKatId || oProduct.Category || "").trim();
      const sDesc = String(
        oProduct.ZmmWebsArtBez ||
        oProduct.BESCHREIBUNG ||
        oProduct.ZmmWebsKatBez ||
        oProduct.ZmmWebsKatId ||
        sId
      ).trim();

      // DocId / Bild-Schlüssel (für Thumbnail-URL im Warenkorb)
      const sDocId = String(
        oProduct.ZmmWebsDocId ||
        oProduct.DocId ||
        oProduct.ZmmWebsDocID ||
        ""
      ).trim();

      const sWlief = (oProduct.Wlief || "").trim();
      const sMatkl = (oProduct.Matkl || "").trim();

      const sMeins = String(oProduct.Meins || "ST").trim();
      const sWaers = String(oProduct.Waers || oProduct.Currency || "EUR").trim();
      const nBapre = Number(oProduct.Bapre ?? 0);

      const sReceiver = String(oProduct.receiver || "").trim();
      const iWeIdx = (typeof oProduct.weExpectedIndex === "number" ? oProduct.weExpectedIndex : -1);

      const sIdnlf = String(oProduct.Idnlf || "").trim().slice(0, 35);

      // Freitext-Notiz robust aus allen Kandidaten
      const sAddText = String(
        oProduct.addText ||
        oProduct.ddText ||
        oProduct.AddText ||
        oProduct.Zusatztext ||
        oProduct.zusatztext ||
        oProduct.freitextAddText ||
        ""
      ).trim();

      // vorhandenen Eintrag finden
      const idx = aCart.findIndex(e => String(e.ZmmWebsArtikelId || e.ProductId || e.Produktid) === sId);

      if (idx > -1) {
        // Menge erhöhen
        const oldQty = parseInt(aCart[idx].MENGE, 10) || 0;
        const newQty = oldQty + iQty;

        aCart[idx].MENGE = newQty;
        aCart[idx].Quantity = newQty;

        // fehlende Felder ergänzen (nicht blind überschreiben)
        if (!aCart[idx].ZmmWebsKatId && sCatId) { aCart[idx].ZmmWebsKatId = sCatId; }
        if (!aCart[idx].ZmmWebsArtBez && sDesc) { aCart[idx].ZmmWebsArtBez = sDesc; }

        // DocId ergänzen, falls im Cart noch leer
        if (!aCart[idx].ZmmWebsDocId && sDocId) { aCart[idx].ZmmWebsDocId = sDocId; }

        if (!aCart[idx].Meins && sMeins) { aCart[idx].Meins = sMeins; }
        if (!aCart[idx].Waers && sWaers) { aCart[idx].Waers = sWaers; }
        if (aCart[idx].Bapre == null || aCart[idx].Bapre === "") { aCart[idx].Bapre = nBapre; }

        if (!aCart[idx].Wlief && sWlief) { aCart[idx].Wlief = sWlief; }
        if (!aCart[idx].Matkl && sMatkl) { aCart[idx].Matkl = sMatkl; }

        if (!aCart[idx].receiver && sReceiver) { aCart[idx].receiver = sReceiver; }
        if (!Number.isInteger(aCart[idx].weExpectedIndex)) { aCart[idx].weExpectedIndex = iWeIdx; }

        if (!aCart[idx].Idnlf && sIdnlf) { aCart[idx].Idnlf = sIdnlf; }

        // Freitext-Notiz übernehmen, falls noch leer
        if (!String(aCart[idx].addText || "").trim() && sAddText) { aCart[idx].addText = sAddText; }
        if (!String(aCart[idx].AddText || "").trim() && sAddText) { aCart[idx].AddText = sAddText; }
      } else {
        // neu anlegen
        aCart.push({
          ZmmWebsArtikelId: sId,
          ZmmWebsKatId: sCatId,
          ZmmWebsKatBez: String(oProduct.ZmmWebsKatBez || sDesc || "").trim(),
          ZmmWebsArtBez: sDesc,

          ZmmWebsDocId: sDocId,

          MENGE: iQty,
          Quantity: iQty,

          Meins: sMeins,
          Waers: sWaers,
          Bapre: nBapre,

          Wlief: sWlief,
          Matkl: sMatkl,

          receiver: sReceiver,
          weExpectedIndex: iWeIdx,

          Idnlf: sIdnlf,

          // Freitext-Notiz 
          addText: sAddText,
          AddText: sAddText,

          // Defaults für Checkout
          accountType: oProduct.accountType || "",
          costCenter: oProduct.costCenter || "",
          internalOrder: oProduct.internalOrder || "",
          accountValue: oProduct.accountValue || "",
          glAccount: oProduct.glAccount || "",

          STATUS: oProduct.STATUS || "A"
        });
      }

      oCartModel.setProperty("/cartEntries", aCart);
      oCartModel.refresh(true);

      sap.m.MessageToast.show(rb.getText("productAddedToCart"));
    },

   // Schaltet den Warenkorb je nach aktuellem Hash ein oder aus und delegiert an _openCart oder _closeCart.
    toggleCart: function () {
      var oHC = sap.ui.core.routing.HashChanger.getInstance();
      var sHash = oHC.getHash() || "";

      console.log("[toggleCart] hash vorher:", sHash);

      var bIsCartHash = (sHash === "cart" || sHash.endsWith("/cart"));
      console.log("[toggleCart] bIsCartHash:", bIsCartHash);

      if (bIsCartHash) {
        console.log("[toggleCart] -> close");
        this._closeCart();
      } else {
        console.log("[toggleCart] -> open");
        this._openCart();
      }
    },


    _openCart: function () {
      var oAppView = this.getOwnerComponent().getModel("appView");
      if (!oAppView) { return; }

      var oHC = sap.ui.core.routing.HashChanger.getInstance();
      var sHash = oHC.getHash() || "";

      // Wenn bereits Cart aktiv: nur State setzen, keine Navigation
      if (sHash === "cart" || sHash.endsWith("/cart")) {
        oAppView.setProperty("/cartOpen", true);
        return;
      }

      // aktuellen Hash merken, um sauber zurück zu können
      oAppView.setProperty("/lastNonCartHash", sHash);

      oAppView.setProperty("/cartOpen", true);

      // /cart anhängen (damit productCart/categoryCart matched, nicht die generische cart-Route)
      if (sHash) {
        oHC.replaceHash(sHash + "/cart");
      } else {
        // Nur wenn wirklich gar kein Hash vorhanden ist
        oHC.replaceHash("cart");
      }
    },

    _closeCart: function () {
      var oAppView = this.getOwnerComponent().getModel("appView");
      if (!oAppView) { return; }

      var oHC = sap.ui.core.routing.HashChanger.getInstance();
      var sHash = oHC.getHash() || "";

      // Primär: aktuellen Hash zurückbauen, wenn er auf /cart endet
      var sBackHash = "";
      if (sHash.endsWith("/cart")) {
        sBackHash = sHash.slice(0, -5); // entfernt "/cart"
      }

      // Wenn wir auf der generischen cart-Route sind: auf gemerkten Hash zurück
      if (!sBackHash && sHash === "cart") {
        sBackHash = oAppView.getProperty("/lastNonCartHash") || "";
      }

      // Letzter Fallback
      if (!sBackHash) {
        sBackHash = oAppView.getProperty("/lastNonCartHash") || "";
      }

      // Skip-Flag nur setzen, wenn wir wirklich zur BANF-Route zurückgehen
      if (sBackHash === "purchaseRequests" || sBackHash === "purchaseRequestsCart") {
        oAppView.setProperty("/skipNextPurchaseRequestsRebind", true);
      }

      oAppView.setProperty("/cartOpen", false);

      if (sBackHash) {
        oHC.replaceHash(sBackHash);
      } else {
        this.getOwnerComponent().getRouter().navTo("categories", {}, true);
      }
    },



    /**
     * Setzt die aktuelle Vergleichsauswahl zurück.
     * @protected
     * @returns {void}
     */
    _clearComparison: function () {
      var oModel = this.getOwnerComponent().getModel("comparison");
      oModel.setData({ category: "", item1: "", item2: "" });
    }
  });
});
