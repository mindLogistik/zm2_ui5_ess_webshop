sap.ui.define([
  "./BaseController",
  "sap/ui/model/json/JSONModel",
  "sap/m/MessageBox",
  "sap/m/MessageToast",
  "sap/m/SelectDialog",
  "sap/m/StandardListItem",
  "sap/ui/model/Filter",
  "sap/ui/model/FilterOperator",
  "../model/formatter",
  "../model/IndexedDBModel",
  "sap/ui/core/Item"
], function (
  BaseController,
  JSONModel,
  MessageBox,
  MessageToast,
  SelectDialog,
  StandardListItem,
  Filter,
  FilterOperator,
  formatter,
  IndexedDBModel,
  Item
) {

  "use strict";

  const WZ_UI_MODEL = "checkoutWizard"; // UI-Zustand (aktueller Step, Validierungsflag)
  const CHECKOUT_MODEL = "checkout";      // fachliche Wizard-Daten (Step 2)
  const CART_MODEL = "cartProducts";  // Warenkorb

  return BaseController.extend("diehlwebshop.controller.CheckoutWizard", {
    formatter: formatter,

    /* =========================
     * lifecycle
     * ========================= */
    onInit: function () {
      const oWizUi = new JSONModel({ currentStep: "stepHead", validate: false });
      oWizUi.setDefaultBindingMode("TwoWay");
      this.getView().setModel(oWizUi, WZ_UI_MODEL);

      // Checkout-Model sicherstellen (falls noch nicht gesetzt)
      let oCheckout = this.getView().getModel(CHECKOUT_MODEL);
      if (!oCheckout) {
        oCheckout = new JSONModel(this._createCheckoutDefaults());
        oCheckout.setDefaultBindingMode("TwoWay");
        this.getView().setModel(oCheckout, CHECKOUT_MODEL);
        this.getOwnerComponent().setModel(oCheckout, CHECKOUT_MODEL);
      }
      oCheckout.setDefaultBindingMode("TwoWay");


      // Zusatzfelder in Cart-Items sicherstellen (damit Bindings nicht ins Leere laufen)
      this._ensureCartItemExtensions();

      this._prefillReceiversWithCurrentUser();

      // Wizard-Events
      const oWiz = this.byId("checkoutWizard");
      if (oWiz) {
        oWiz.attachStepActivate(this._onStepActivate, this);
      }


      this._hookInvArtNoneItem();

      var oInfoPop = this.byId("infoPopover");
      if (oInfoPop) {
        this.getView().addDependent(oInfoPop);
      }


      const oInfo = new sap.ui.model.json.JSONModel({ text1: "", text2: "" });
      this.getView().setModel(oInfo, "info");


      // FCL-Layout (optional)
      const oAppView = this.getOwnerComponent().getModel("appView");
      if (oAppView) {
        oAppView.setProperty("/layout", "OneColumn");
        oAppView.setProperty("/cartOpen", false);
      }

      this.getRouter()
        .getRoute("checkoutWizard")
        .attachPatternMatched(this._onRouteMatchedCheckout, this);

    },

    // Stellt sicher, dass in der Investmentart-ComboBox ein Eintrag „NONE“ existiert, indem 
    // nach dem Items-Binding verzögert Event-Handler angebunden und einmalig ausgeführt werden.
    _hookInvArtNoneItem: function () {
      const oCB = this.byId("cbInvArt");
      if (!oCB) { return; }

      // Binding ist beim onInit manchmal noch nicht da -> später nochmal versuchen
      const oBinding = oCB.getBinding("items");
      if (!oBinding) {
        jQuery.sap.delayedCall(0, this, this._hookInvArtNoneItem);
        return;
      }

      // damit wir nicht bei jedem Re-Render zig Handler anhängen:
      if (!this._fnEnsureInvArtNoneItem) {
        this._fnEnsureInvArtNoneItem = this._ensureInvArtNoneItem.bind(this);
      } else {
        // vorsichtshalber doppelte Attachments vermeiden
        oBinding.detachChange(this._fnEnsureInvArtNoneItem);
        if (oBinding.detachDataReceived) {
          oBinding.detachDataReceived(this._fnEnsureInvArtNoneItem);
        }
      }

      oBinding.attachChange(this._fnEnsureInvArtNoneItem);
      if (oBinding.attachDataReceived) {
        oBinding.attachDataReceived(this._fnEnsureInvArtNoneItem);
      }

      // einmal sofort ausführen
      this._ensureInvArtNoneItem();
    },

    // Fügt den ComboBox-Item-Key „NONE“ (Keine Investart) ein, falls er fehlt, und 
    // synchronisiert die Auswahl, wenn das Checkout-Model bereits „NONE“ gesetzt hat.
    _ensureInvArtNoneItem: function () {
      const oCB = this.byId("cbInvArt");
      if (!oCB) { return; }

      const bExists = oCB.getItems().some(function (oItem) {
        return oItem && oItem.getKey && oItem.getKey() === "NONE";
      });

      if (!bExists) {
        oCB.insertItem(new Item({ key: "NONE", text: this.getResourceBundle().getText("cw.invArt.none") }), 0);
      }

      // falls das Model bereits NONE hält, ComboBox-Anzeige synchronisieren
      const oCheckout = this.getView().getModel("checkout");
      const sKey = oCheckout && oCheckout.getProperty("/head/invArt");
      if (sKey === "NONE") {
        oCB.setSelectedKey("NONE");
      }
    },

    // Überträgt bei Verbrauch (materialTypeIndex = 0) die Kopf-Kontierung der ersten Position 
    // auf weitere Warenkorbpositionen, ergänzt nur leere Felder und leert nicht 
    // passende Felder je nach Kontierungstyp.
    _syncHeadAccountToCartItems: function () {
      const oCheckout = this.getView().getModel("checkout");
      const oCart = this.getView().getModel("cartProducts");
      if (!oCheckout || !oCart) { return; }

      const h = oCheckout.getProperty("/head") || {};
      if (Number(h.materialTypeIndex) !== 0) { return; } // nur Verbrauch

      const aItems = this._getCartEntries() || [];
      if (aItems.length < 2) { return; }

      const it0 = aItems[0] || {};
      const sType = (it0.accountType || "").trim();
      if (!sType) { return; }

      aItems.forEach((it, idx) => {
        if (idx === 0) { return; }

        // Kontierungstyp übernehmen, wenn leer
        if (!(it.accountType || "").trim()) {
          oCart.setProperty("/cartEntries/" + idx + "/accountType", sType);
        }

        // je nach Typ die passenden Felder übernehmen (wenn leer) + Rest leeren
        if (sType === "gl") {
          if (!(it.costCenter || "").trim() && (it0.costCenter || "").trim()) {
            oCart.setProperty("/cartEntries/" + idx + "/costCenter", it0.costCenter);
          }
          oCart.setProperty("/cartEntries/" + idx + "/internalOrder", "");
          oCart.setProperty("/cartEntries/" + idx + "/accountValue", "");

          if (!(it.glAccount || "").trim() && (it0.glAccount || "").trim()) {
            oCart.setProperty("/cartEntries/" + idx + "/glAccount", it0.glAccount);
          }
        } else if (sType === "io") {
          if (!(it.internalOrder || "").trim() && (it0.internalOrder || "").trim()) {
            oCart.setProperty("/cartEntries/" + idx + "/internalOrder", it0.internalOrder);
          }
          oCart.setProperty("/cartEntries/" + idx + "/costCenter", "");
          oCart.setProperty("/cartEntries/" + idx + "/accountValue", "");
        } else if (sType === "wbs") {
          if (!(it.accountValue || "").trim() && (it0.accountValue || "").trim()) {
            oCart.setProperty("/cartEntries/" + idx + "/accountValue", it0.accountValue);
          }
          oCart.setProperty("/cartEntries/" + idx + "/costCenter", "");
          oCart.setProperty("/cartEntries/" + idx + "/internalOrder", "");
        }
      });

      oCart.refresh(true);
    },



    // Setzt beim erneuten Aufruf der Route den Wizard-UI-Zustand zurück und springt 
    // im Wizard immer auf den ersten Schritt (inkl. Verwerfen des Fortschritts ab StepCart).
    _onRouteMatchedCheckout: function () {
      // UI-Model zurücksetzen
      const oUi = this.getView().getModel(WZ_UI_MODEL);
      if (oUi) {
        oUi.setProperty("/validate", false);
        oUi.setProperty("/currentStep", "stepHead");
      }

      // Wizard selbst zurücksetzen
      const oWiz = this.byId("checkoutWizard");
      const oStepHead = this.byId("stepHead");
      const oStepCart = this.byId("stepCart");

      if (oWiz && oStepHead && oStepCart) {
        if (oWiz.discardProgress) {
          oWiz.discardProgress(oStepCart);  // Fortschritt ab letztem Step entfernen
        }
        oWiz.goToStep(oStepHead);           // immer bei Step 1 starten
      }

      this._prefillReceiversWithCurrentUser();

    },




    // Navigiert zurück zur BANF-Übersicht: setzt Wizard-UI und Wizard-Fortschritt zurück, stellt 
    // das FCL-Layout auf TwoColumnsMidExpanded und navigiert ohne Historieneintrag zur Route purchaseRequests.
    onReturnToShop: function () {
      // Wizard-UI zurücksetzen 
      const oUi = this.getView().getModel("checkoutWizard");
      if (oUi) {
        oUi.setProperty("/validate", false);
        oUi.setProperty("/currentStep", "stepHead");
      }
      const oWiz = this.byId("checkoutWizard");
      const oStepCart = this.byId("stepCart");
      if (oWiz && oStepCart) {
        if (oWiz.discardProgress) { oWiz.discardProgress(oStepCart); }
        oWiz.goToStep(oStepCart);
      }

      // FCL wieder auf die Startseite ausrichten
      const oAppView = this.getOwnerComponent().getModel("appView");
      if (oAppView) {
        oAppView.setProperty("/cartOpen", false);
        oAppView.setProperty("/layout", "TwoColumnsMidExpanded");
      }

      // Zur Startseite mit Smart Table – ohne Historieneintrag
      this.getRouter().navTo("purchaseRequests", {}, true);
    },



    // Erzeugt eine einfache Mock-BANF-Nummer aus Datum (yyMMdd) plus zufälliger 4-stelliger Nummer.
    _genBanfnId: function () {
      const sDate = new Date().toISOString().slice(2, 10).replace(/-/g, "");
      const rnd = Math.floor(1000 + Math.random() * 9000);
      return sDate + rnd;
    },



    // Persistiert eine Mock-BANF-Payload dauerhaft (IndexedDB, Fallback localStorage) 
    // und schreibt sie zusätzlich ins Checkout-Model unter /lastBanfn für die UI-Anzeige.
    _persistMockBanfn: async function (oPayload) {
      const KEY = "mock_banfen";
      try {
        let list = await IDB.getItem(KEY);
        if (!Array.isArray(list)) { list = []; }
        list.push(oPayload);
        await IDB.setItem(KEY, list);
      } catch (e) {
        // Fallback, falls IndexedDB im Browser blockiert ist (Private Mode etc.)
        try {
          let list = [];
          try { list = JSON.parse(localStorage.getItem(KEY) || "[]"); } catch (_) { }
          list.push(oPayload);
          localStorage.setItem(KEY, JSON.stringify(list));
        } catch (_) { }
      }

      const oCk = this.getView().getModel("checkout");
      oCk.setProperty("/lastBanfn", oPayload);
    },


    // Öffnet das Info-Popover zu einem Feld: liest den cwInfoKey aus CustomData, holt 
    // die passenden i18n-Texte (text1/text2) und zeigt sie am gedrückten Button an.
    onInfoPress: function (oEvent) {

      const oBtn = oEvent.getSource();

      // cwInfoKey aus CustomData lesen
      let sKey = "";
      const aCD = oBtn.getCustomData ? oBtn.getCustomData() : [];
      const oCD = aCD && aCD.find(d => d.getKey && d.getKey() === "cwInfoKey");
      sKey = oCD && oCD.getValue ? oCD.getValue() : "";

      if (!sKey) { return; }

      const rb = this.getResourceBundle();
      const oInfoM = this.getView().getModel("info");

      const sText1 = rb.getText("cw.info." + sKey + ".text1");
      let sText2 = "";
      try {
        sText2 = rb.getText("cw.info." + sKey + ".text2");
        if (sText2 === "cw.info." + sKey + ".text2") { sText2 = ""; }
      } catch (e) { sText2 = ""; }

      oInfoM.setProperty("/text1", sText1);
      oInfoM.setProperty("/text2", sText2);

      const oPop = this.byId("infoPopover");
      if (!oPop) { return; }

      oPop.openBy(oBtn);
    },




    // Validiert den Cart-Schritt (Pflichtfelder pro Position), markiert den Step bei Fehlern 
    // als ungültig und wechselt bei Erfolg zum nächsten Schritt sowie setzt currentStep explizit.
    onContinueFromCart: function () {
      const rb = this.getResourceBundle();
      this.getView().getModel("checkoutWizard").setProperty("/validate", true);

      const oWiz = this.byId("checkoutWizard");
      const oStepCart = this.byId("stepCart");

      const res = this._checkCartRequired();
      if (!res.ok) {
        if (oWiz && oStepCart) { oWiz.invalidateStep(oStepCart); }
        sap.m.MessageBox.information(
          rb.getText("cw.msg.correctFields") + "\n• " + res.missing.join("\n• ")
        );
        return;
      }

      if (oWiz && oStepCart) {
        oWiz.validateStep(oStepCart);

        this.getView().getModel("checkoutWizard").setProperty("/currentStep", "stepForm");

        sap.ui.getCore().applyChanges();
        oWiz.nextStep();
      }
    },

    // Validiert den Head-/Kontierungs-Schritt und wechselt bei Erfolg zum nächsten Wizard-Schritt 
    // sowie setzt currentStep explizit.
    onContinueFromHead: function () {
      if (!this._validateStepAccounting()) { return; }

      const oWiz = this.byId("checkoutWizard");
      const oStepHead = this.byId("stepHead");
      if (oWiz && oStepHead) {
        oWiz.validateStep(oStepHead);
        this.getView().getModel("checkoutWizard").setProperty("/currentStep", "stepForm");
        sap.ui.getCore().applyChanges();
        oWiz.nextStep();
      }
    },


    // Validiert den Formular-Schritt, setzt bei Erfolg Default-Wunschlieferdaten und wechselt 
    // zum nächsten Wizard-Schritt sowie setzt currentStep explizit.
    onContinueFromForm: function () {
      if (!this._validateStepForm()) { return; }

      const oWiz = this.byId("checkoutWizard");
      const oStepForm = this.byId("stepForm");
      if (oWiz && oStepForm) {
        oWiz.validateStep(oStepForm);

        // Default-Wunschlieferdatum setzen
        this._applyDesiredDateDefault();

        this.getView().getModel("checkoutWizard").setProperty("/currentStep", "stepCart");
        sap.ui.getCore().applyChanges();
        oWiz.nextStep();
      }
    },


    // Führt die Endvalidierung durch, baut das Deep-Create-Payload, bestätigt das Absenden, 
    // legt die BANF per OData an, lädt danach Attachments hoch, leert erst anschließend den 
    // Warenkorb und navigiert zurück zur BANF-Übersicht.
    onSubmitOrder: function () {
      const rb = this.getResourceBundle();

      // Schritt 1 prüfen
      if (!this._validateStepAccounting()) {
        const oWiz = this.byId("checkoutWizard");
        if (oWiz && this.byId("stepHead")) {
          oWiz.goToStep(this.byId("stepHead"));
        }
        return;
      }

      // Kopfkontierung ggf. auf Positionen übertragen
      this._syncHeadAccountToCartItems();

      // Schritt 3 prüfen
      const res = this._checkCartRequired();
      if (!res.ok) {
        sap.m.MessageBox.information(rb.getText("cw.msg.correctFields") + "\n• " + res.missing.join("\n• "));
        const oWiz = this.byId("checkoutWizard");
        if (oWiz && this.byId("stepCart")) {
          oWiz.goToStep(this.byId("stepCart"));
        }
        return;
      }

      // Modell holen
      const oModel = this.getOwnerComponent().getModel();

      // Payload bauen + gezieltes Log 
      const oPayload = this._buildDeepCreatePayload();

      const oCheckoutM = this.getView().getModel("checkout");
      const h = (oCheckoutM && oCheckoutM.getProperty("/head")) || {};

      const aHeadText = Array.isArray(oPayload && oPayload.NavTo_TextLine) ? oPayload.NavTo_TextLine : [];
      const aB03 = aHeadText.filter(x => String(x.Tdid) === "B03");
      const sB03 = aB03.map(x => String(x.Tdline || "")).join("\n");


      sap.m.MessageBox.confirm(rb.getText("cw.msg.submitConfirm"), {
        actions: [sap.m.MessageBox.Action.OK, sap.m.MessageBox.Action.CANCEL],
        onClose: function (sAction) {
          if (sAction !== sap.m.MessageBox.Action.OK) { return; }

          sap.ui.core.BusyIndicator.show(0);


          oModel.create("/BestellanforderungSet", oPayload, {
            groupId: "$direct",
            success: async function (oData) {
              sap.ui.core.BusyIndicator.hide();

              const sBanfn = (oData && (oData.Banfn || oData.BANFN || oData.banfn)) ? String(oData.Banfn || oData.BANFN || oData.banfn) : "";

              // banfn im Checkout-Model merken
              const oCheckoutM = this.getView().getModel("checkout");
              if (oCheckoutM) {
                oCheckoutM.setProperty("/banfn", sBanfn);
                oCheckoutM.refresh(true);
              }

              // falls Attachments vorhanden: Upload starten
              try {
                sap.ui.core.BusyIndicator.show(0);
                await this._uploadAllAttachmentsForBanfn(sBanfn);
              } finally {
                sap.ui.core.BusyIndicator.hide();
              }

              // erst jetzt Warenkorb leeren
              const oCart = this.getView().getModel("cartProducts");
              if (oCart) {
                oCart.setProperty("/cartEntries", []);
                oCart.setProperty("/savedForLaterEntries", []);
                oCart.refresh(true);
              }

              sap.m.MessageBox.success(
                rb.getText("cw.msg.submitSuccess", [sBanfn]),
                {
                  onClose: function () {
                    this.getRouter().navTo("purchaseRequests");
                  }.bind(this)
                });
            }.bind(this),


            error: function (oError) {
              sap.ui.core.BusyIndicator.hide();

              let sMsg = rb.getText("cw.msg.submitErrorDefault");
              try {
                const o = JSON.parse(oError.responseText);
                sMsg = o && o.error && o.error.message && o.error.message.value ? o.error.message.value : sMsg;
              } catch (e) { }

              sap.m.MessageBox.error(sMsg);
            }.bind(this)
          });
        }.bind(this)
      });
    },




    // Erzeugt aus einer Auswahl von Klassifizierungs-Keys einen kompakten Klassifizierungsstring 
    // in definierter Reihenfolge; „NONE“ führt zu leerem Ergebnis.
    _getInvKlassConcat: function (aKeys) {
      const a = Array.isArray(aKeys) ? aKeys : [];
      if (a.includes("NONE")) {
        return "";
      }
      const ORDER = ["A", "G", "I", "T"];
      return ORDER.filter(k => a.includes(k)).join("");
    },


    // Zerlegt Text in einzelne Tdline-Zeilen mit maximaler Länge (Default 132) und behält Zeilenumbrüche 
    // sowie Leerzeilen bei.
    _splitTdlines: function (sText, iLen) {
      const L = iLen || 132;
      const s = String(sText || "")
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n");

      const out = [];
      const aLines = s.split("\n");

      aLines.forEach((rawLine, idx) => {
        const line = String(rawLine || "");

        // Leerzeile beibehalten
        if (line.length === 0) {
          out.push("");
          return;
        }

        for (let i = 0; i < line.length; i += L) {
          out.push(line.substring(i, i + L));
        }
      });

      return out;
    },


    // Baut Kopf-Textzeilen für die BANF (B01 interne Notiz, B03 Amtsvertragsnummer nach Regel) als 
    // Array für NavTo_TextLine.
    _buildHeaderTextLines: function (oChk, h) {
      const a = [];

      // 1) Interne Notiz (Kopf) -> TextId B01
      const sInternalNote = String((oChk && oChk.note) || "").trim();
      if (sInternalNote) {
        this._splitTdlines(sInternalNote, 132).forEach((line) => {
          a.push({
            Tdid: "B01",
            Tdline: line
          });
        });
      }

      // 2) Amtsvertragsnummer (Kopf) -> TextId B03
      // nur wenn WE erwartet UND Amtsvertragsbezug = Ja UND Nummer gepflegt
      const weYes = (Number(h.weExpectedIndex) === 0);
      const avbYes = (Number(h.AmtsvertragsbezugIndex) === 0);
      const sAvb = String(h.avbNumber || "").trim();

      if (weYes && avbYes && sAvb) {
        this._splitTdlines(sAvb, 132).forEach((line) => {
          a.push({
            Tdid: "B03",
            Tdline: line
          });
        });
      }

      return a;
    },



    // Baut Positions-Textzeilen für Freitext-Positionen aus Zusatztext (B01) als Array für NavTo_PositionTextLine.
    _buildItemTextLines: function (it) {
      const a = [];

      // nur Freitext-Positionen
      const bIsFreitext =
        String(it.ZmmWebsKatId || "").toUpperCase() === "FREETEXT" ||
        String(it.ZmmWebsArtikelId || "").toUpperCase().startsWith("FREETEXT-");

      if (!bIsFreitext) {
        return a;
      }

      // Zusatztext-Feld robust lesen
      const sAddText = String(
        it.addText ||
        it.AddText ||
        it.Zusatztext ||
        it.zusatztext ||
        it.freitextAddText ||
        ""
      ).trim();

      if (!sAddText) {
        return a;
      }

      // Positionstext -> TextId B01
      this._splitTdlines(sAddText, 132).forEach((line) => {
        a.push({
          Tdid: "B01",
          Tdline: line
        });
      });

      return a;
    },


    // Erstellt das Deep-Create-Payload für /BestellanforderungSet inkl. Header-Feldern, Positionen, 
    // Wunschlieferdatum-Formatierung sowie optionalen Kopf- und Positionstexten.
    _buildDeepCreatePayload: function () {
      const aItems = this._getCartEntries() || [];
      const oChk = this.getView().getModel("checkout").getData() || {};
      const h = oChk.head || {};

      // 0 = Ja, 1 = Nein
      const iUmwelt = Number(h.UmweltIndex);
      const sNachhaltig = (iUmwelt === 0) ? "X" : "";

      // Bestellart: 0 Verbrauch, 1 Investition
      const iMatType = Number(h.materialTypeIndex);
      const sBsart = (iMatType === 0) ? "ZNPR" : (iMatType === 1) ? "ZIN1" : "ZNPR";

      const sInvArtKurz = (h.invArt === "NONE") ? "" : String(h.invArt || "");
      const sInvKlass = this._getInvKlassConcat(h.klass);

      const pad2 = (n) => String(n).padStart(2, "0");
      const formatYYYYMMDD = (d) => {
        if (!(d instanceof Date) || isNaN(d.getTime())) {
          return "";
        }
        return String(d.getFullYear()) + pad2(d.getMonth() + 1) + pad2(d.getDate());
      };

      // Kopftexte (Interne Notiz B01 + Amtsvertragsnummer B03)
      const aHeaderTextLines = this._buildHeaderTextLines(oChk, h);

      // Positionen inkl. Positionstexte (Freitext Zusatztext B01)
      const aNav = aItems.map((it) => {
        const dEeind = it.desiredDate instanceof Date ? it.desiredDate : null;

        const oItem = {
          Txz01: String(it.ZmmWebsArtBez || it.description || it.Txz01 || ""),
          MengeD: String(it.MENGE ?? ""),
          Meins: String(it.Meins || "ST"),
          Matkl: String(it.Matkl || ""),
          WerksD: String(h.werks || ""),
          Eeind: dEeind ? formatYYYYMMDD(dEeind) : "",
          Idnlf: String(it.Idnlf || "").slice(0, 35),
          Knttp: (it.accountType === "gl") ? "K" : (it.accountType === "io") ? "F" : (it.accountType === "wbs") ? "P" : "",
          Kostl: String(it.costCenter || ""),
          Wlief: String(it.Wlief || ""),
          Ekgrp: String(it.Ekgrp || ""),
          Sakto: String(it.glAccount || ""),
          Ekorg: String(h.ekorg || ""),
          Bapre: String(it.Bapre ?? ""),
          Uname: String(it.receiver || "").trim().toUpperCase()
        };


        // Positionstexte nur bei Freitext + Zusatztext vorhanden
        const aPosText = this._buildItemTextLines(it);
        if (aPosText.length) {
          oItem.NavTo_PositionTextLine = aPosText;
        }

        return oItem;
      });

      const oPayload = {
        Bsart: sBsart,
        ZdeBanfInvArtKurz: sInvArtKurz,
        ZdeBanfInvKlass: sInvKlass,
        ZdeBanfFlagNachhaltig: sNachhaltig,
        zzsigma: String(h.sigma || "FG00"),

        NavTo_BanfItem: aNav
      };

      // Kopftext-Navigation nur mitsenden, wenn wirklich Zeilen existieren
      if (aHeaderTextLines.length) {
        oPayload.NavTo_TextLine = aHeaderTextLines;
      }

      return oPayload;
    },



    /* =========================
     * wizard-events
     * ========================= */
    // Wizard-Event-Hook für Step-Aktivierung (aktuell ohne Logik; Platzhalter für stepabhängige Aktionen).
    _onStepActivate: function (oEvent) {
    },

    // Setzt für alle Warenkorbpositionen ohne Wunschlieferdatum ein Default-Datum (heute + 7 Tage) 
    // und aktualisiert das Cart-Model.
    _applyDesiredDateDefault: function () {
      const oCartModel = this.getView().getModel(CART_MODEL);
      if (!oCartModel) { return; }

      const aItems = this._getCartEntries() || [];
      if (!aItems.length) { return; }

      // heutiges Datum + 7 Tage (auf Mitternacht)
      const oToday = new Date();
      oToday.setHours(0, 0, 0, 0);
      const iMsPerDay = 24 * 60 * 60 * 1000;
      const oDefaultDate = new Date(oToday.getTime() + 7 * iMsPerDay);

      aItems.forEach(function (oItem, iIdx) {
        // nur setzen, wenn noch kein Wunschlieferdatum vorhanden ist
        if (!oItem.desiredDate) {
          oCartModel.setProperty(
            "/cartEntries/" + iIdx + "/desiredDate",
            new Date(oDefaultDate)   // pro Eintrag eigene Date-Instanz
          );
        }
      });

      oCartModel.refresh(true);
    },



    /* =========================
     * Validierungen
     * ========================= */
    // Prüft Pflichtfelder auf Warenkorbpositionen und liefert Ergebnisobjekt mit fehlenden Feldern für eine UI-Meldung.
    _checkCartRequired: function () {
      const a = this._getCartEntries() || [];
      const rb = this.getResourceBundle();
      const missing = new Set();

      if (!a.length) {
        missing.add(rb.getText("cw.field.emptyCart"));
        return { ok: false, missing: Array.from(missing) };
      }

      a.forEach(it => {
        if (!it.receiver) { missing.add(rb.getText("cw.field.receiver")); }
        if (!it.accountType) { missing.add(rb.getText("cw.field.accountType")); }

        if (it.accountType === "gl" && !it.costCenter) { missing.add(rb.getText("cw.field.costCenter")); }
        else if (it.accountType === "io" && !it.internalOrder) { missing.add(rb.getText("cw.field.internalOrder")); }
        else if (it.accountType === "wbs" && !it.accountValue) { missing.add(rb.getText("cw.field.wbs")); }

        if (!it.Matkl) { missing.add(rb.getText("cw.field.matkl")); }
        const idx = Number(it.weExpectedIndex);
        if (!Number.isInteger(idx) || idx < 0) { missing.add(rb.getText("cw.field.weExpected")); }

        if (!it.glAccount) { missing.add(rb.getText("cw.field.glAccount")); }
      });

      return { ok: missing.size === 0, missing: Array.from(missing) };
    },



    // Öffnet die Kostenstellen-Werthilfe: lädt Kostenstellen einmalig in ein JSON-Cache-Model, 
    // öffnet einen SelectDialog mit Suche und schreibt die Auswahl ins korrekt gebundene Feld.
    onValueHelpKostl: function (oEvent) {
      var oView = this.getView();
      var oODataModel = this.getOwnerComponent().getModel(); // OData V2
      var oInput = oEvent.getSource();
      this._oKostlActiveInput = oInput;

      if (!this._oKostlJsonModel) {
        this._oKostlJsonModel = new sap.ui.model.json.JSONModel({ results: [] });
        oView.setModel(this._oKostlJsonModel, "vhKostl");
      }

      var openDialog = function () {
        if (!this._oKostlVH) {
          this._oKostlVH = new sap.m.SelectDialog({
            title: this.getResourceBundle().getText("cw.vh.kostl.title"),
            items: {
              path: "vhKostl>/results",
              template: new sap.m.StandardListItem({
                title: "{vhKostl>Kostl}",
                description: "{vhKostl>Mctxt}"
              })
            },
            search: function (oEvt) {
              var sValue = (oEvt.getParameter("value") || "").trim().toLowerCase();
              this._applyKostlSearchFilter(sValue);
            }.bind(this),
            confirm: function (oEvt) {
              var oSelected = oEvt.getParameter("selectedItem");
              if (!oSelected || !this._oKostlActiveInput) { return; }

              var oObj = oSelected.getBindingContext("vhKostl").getObject();
              var sKostl = String(oObj.Kostl || "").trim();

              // in das richtige Feld schreiben (invest Kopf oder Position), ohne bestehende Bindings zu zerstören
              var oInp = this._oKostlActiveInput;
              var oBI = oInp.getBindingInfo("value");

              if (oBI && oBI.parts && oBI.parts.length) {
                var sModelName = oBI.parts[0].model;
                var sPath = oBI.parts[0].path;

                if (sPath && sPath[0] !== "/") {
                  var oCtx = oInp.getBindingContext(sModelName);
                  if (oCtx) {
                    sPath = oCtx.getPath() + "/" + sPath;
                  } else {
                    sPath = "/" + sPath;
                  }
                }

                oInp.getModel(sModelName).setProperty(sPath, sKostl);
              } else {
                oInp.setValue(sKostl);
              }
            }.bind(this),
            cancel: function () { }
          });

          oView.addDependent(this._oKostlVH);
        }

        var sCurrent = (oInput.getValue() || "").trim();
        this._oKostlVH.open(sCurrent);

        this._applyKostlSearchFilter(sCurrent);
      }.bind(this);

      // Schon geladen -> öffnen
      var aCached = this._oKostlJsonModel.getProperty("/results") || [];
      if (aCached.length > 0) {
        openDialog();
        return;
      }

      // Einmalig laden (ohne Filter)
      // Hinweis: $top ggf. anpassen, wenn es sehr viele Kostenstellen sind
      oODataModel.read("/KostsSet", {
        urlParameters: {
          "$select": "Kostl,Mctxt",
          "$top": "5000"
        },
        success: function (oData) {
          var a = (oData && oData.results) ? oData.results : [];
          a = a.map(function (x) {
            var o = Object.assign({}, x);
            o.__kostl = String(o.Kostl || "").toLowerCase();
            o.__mctxt = String(o.Mctxt || "").toLowerCase();
            return o;
          });
          this._oKostlJsonModel.setProperty("/results", a);
          openDialog();
        }.bind(this),
        error: function (oErr) {
          sap.m.MessageToast.show(this.getResourceBundle().getText("cw.vh.kostl.loadError"));
          console.log(oErr);
        }
      });
    },

    // Wendet einen clientseitigen Suchfilter auf den Kostenstellen-Dialog an 
    // (Nummer oder Text, case-insensitive) über vorberechnete Hilfsfelder im JSON-Model.
    _applyKostlSearchFilter: function (sValue) {
      if (!this._oKostlVH) { return; }
      var s = String(sValue || "").trim().toLowerCase();
      var oBinding = this._oKostlVH.getBinding("items");
      if (!oBinding) { return; }

      if (!s) {
        oBinding.filter([]);
        return;
      }

      // Suche über Nummer ODER Text (Teilstrings), ohne Groß-/Kleinschreibung
      oBinding.filter([
        new sap.ui.model.Filter({
          filters: [
            new sap.ui.model.Filter("__kostl", sap.ui.model.FilterOperator.Contains, s),
            new sap.ui.model.Filter("__mctxt", sap.ui.model.FilterOperator.Contains, s)
          ],
          and: false
        })
      ], "Application");
    },



    // Öffnet die PSP-Element-Werthilfe (SelectDialog) direkt auf dem OData-Set, ermöglicht Suche und schreibt 
    // die Auswahl in das gebundene Input-Feld.
    onValueHelpWbs: function (oEvent) {
      var oView = this.getView();
      var oModel = this.getOwnerComponent().getModel(); // ODataModel

      this._oWbsActiveInput = oEvent.getSource();

      if (!this._oWbsVH) {
        this._oWbsVH = new SelectDialog({
          title: this.getResourceBundle().getText("cw.vh.wbs.title"),
          items: {
            path: "/plafPspelSet",
            template: new StandardListItem({
              title: "{Pspel}"
            })
          },
          search: function (oEvt) {
            var sValue = oEvt.getParameter("value") || "";
            var oBinding = oEvt.getSource().getBinding("items");
            if (!oBinding) { return; }

            oBinding.filter(sValue ? [new Filter("Pspel", FilterOperator.Contains, sValue)] : []);
          },
          confirm: function (oEvt) {
            var oSelected = oEvt.getParameter("selectedItem");
            if (!oSelected || !this._oWbsActiveInput) { return; }

            var sPspel = oSelected.getBindingContext().getProperty("Pspel");

            var oBnd = this._oWbsActiveInput.getBinding("value");
            if (oBnd && oBnd.setValue) {
              oBnd.setValue(sPspel);
            } else {
              this._oWbsActiveInput.setValue(sPspel);
            }
          }.bind(this),
          cancel: function () { }
        });

        this._oWbsVH.setModel(oModel);
        oView.addDependent(this._oWbsVH);
      }

      var sCurrent = this._oWbsActiveInput.getValue() || "";
      var oBinding = this._oWbsVH.getBinding("items");
      if (oBinding) {
        oBinding.filter(sCurrent ? [new Filter("Pspel", FilterOperator.Contains, sCurrent)] : []);
      }

      this._oWbsVH.open(sCurrent);
    },





    // Öffnet die SAP-User-Werthilfe: lädt User einmalig in ein JSON-Cache-Model, öffnet einen SelectDialog 
    // mit Suche und schreibt den ausgewählten User ins korrekt gebundene Feld.
    onValueHelpUser: function (oEvent) {
      var oView = this.getView();
      var oODataModel = this.getOwnerComponent().getModel();
      var oInput = oEvent.getSource();
      this._oUserActiveInput = oInput;

      if (!this._oUserJsonModel) {
        this._oUserJsonModel = new sap.ui.model.json.JSONModel({ results: [] });
        oView.setModel(this._oUserJsonModel, "vhUser");
      }

      var openDialog = function () {
        if (!this._oUserVH) {
          this._oUserVH = new sap.m.SelectDialog({
            title: this.getResourceBundle().getText("cw.vh.user.title"),
            items: {
              path: "vhUser>/results",
              template: new sap.m.StandardListItem({
                title: "{vhUser>Bname}"
              })
            },
            search: function (oEvt) {
              var sValue = (oEvt.getParameter("value") || "").trim().toLowerCase();
              this._applyUserSearchFilter(sValue);
            }.bind(this),
            confirm: function (oEvt) {
              var oSel = oEvt.getParameter("selectedItem");
              if (!oSel || !this._oUserActiveInput) { return; }

              var oObj = oSel.getBindingContext("vhUser").getObject();
              var sBname = String(oObj.Bname || "").trim();

              var oInp = this._oUserActiveInput;
              var oBI = oInp.getBindingInfo("value");

              if (oBI && oBI.parts && oBI.parts.length) {
                var sModelName = oBI.parts[0].model;
                var sPath = oBI.parts[0].path;

                if (sPath && sPath[0] !== "/") {
                  var oCtx = oInp.getBindingContext(sModelName);
                  if (oCtx) {
                    sPath = oCtx.getPath() + "/" + sPath;
                  } else {
                    sPath = "/" + sPath;
                  }
                }

                oInp.getModel(sModelName).setProperty(sPath, sBname);
              } else {
                oInp.setValue(sBname);
              }
            }.bind(this),
            cancel: function () { }
          });

          oView.addDependent(this._oUserVH);
        }

        var sCurrent = (oInput.getValue() || "").trim();
        this._oUserVH.open(sCurrent);
        this._applyUserSearchFilter(sCurrent);
      }.bind(this);

      var aCached = this._oUserJsonModel.getProperty("/results") || [];
      if (aCached.length > 0) {
        openDialog();
        return;
      }

      oODataModel.read("/UserAddrSet", {
        urlParameters: {
          "$select": "Bname",
          "$top": "5000"
        },
        success: function (oData) {
          var a = (oData && oData.results) ? oData.results : [];
          a = a.map(function (x) {
            var o = Object.assign({}, x);
            o.__bname = String(o.Bname || "").toLowerCase();
            return o;
          });
          this._oUserJsonModel.setProperty("/results", a);
          openDialog();
        }.bind(this),
        error: function (oErr) {
          sap.m.MessageToast.show(this.getResourceBundle().getText("cw.vh.user.loadError"));
          console.log(oErr);
        }
      });
    },

    // Wendet einen clientseitigen Suchfilter auf den User-Dialog an (case-insensitive) über ein vorbereitetes 
    // Hilfsfeld im JSON-Model.
    _applyUserSearchFilter: function (sValue) {
      if (!this._oUserVH) { return; }
      var s = String(sValue || "").trim().toLowerCase();
      var oBinding = this._oUserVH.getBinding("items");
      if (!oBinding) { return; }

      if (!s) {
        oBinding.filter([]);
        return;
      }

      oBinding.filter([
        new sap.ui.model.Filter("__bname", sap.ui.model.FilterOperator.Contains, s)
      ], "Application");
    },


    // Öffnet die Warengruppe-Werthilfe: lädt Warengruppen einmalig in ein JSON-Cache-Model, öffnet einen SelectDialog 
    // mit Suche und schreibt die Auswahl ins korrekt gebundene Feld.
    onValueHelpMatkl: function (oEvent) {
      var oView = this.getView();
      var oODataModel = this.getOwnerComponent().getModel();
      var oInput = oEvent.getSource();
      this._oMatklActiveInput = oInput;

      if (!this._oMatklJsonModel) {
        this._oMatklJsonModel = new sap.ui.model.json.JSONModel({ results: [] });
        oView.setModel(this._oMatklJsonModel, "vhMatkl");
      }

      var openDialog = function () {
        if (!this._oMatklVH) {
          this._oMatklVH = new sap.m.SelectDialog({
            title: this.getResourceBundle().getText("cw.vh.matkl.title"),
            items: {
              path: "vhMatkl>/results",
              template: new sap.m.StandardListItem({
                title: "{vhMatkl>Matkl}",
                description: "{vhMatkl>Wgbez60}"
              })
            },
            search: function (oEvt) {
              var sValue = (oEvt.getParameter("value") || "").trim().toLowerCase();
              this._applyMatklSearchFilter(sValue);
            }.bind(this),
            confirm: function (oEvt) {
              var oSel = oEvt.getParameter("selectedItem");
              if (!oSel || !this._oMatklActiveInput) { return; }

              var oObj = oSel.getBindingContext("vhMatkl").getObject();
              var sMatkl = String(oObj.Matkl || "").trim();

              var oInp = this._oMatklActiveInput;
              var oBI = oInp.getBindingInfo("value");

              if (oBI && oBI.parts && oBI.parts.length) {
                var sModelName = oBI.parts[0].model;
                var sPath = oBI.parts[0].path;

                if (sPath && sPath[0] !== "/") {
                  var oCtx = oInp.getBindingContext(sModelName);
                  if (oCtx) {
                    sPath = oCtx.getPath() + "/" + sPath;
                  } else {
                    sPath = "/" + sPath;
                  }
                }

                oInp.getModel(sModelName).setProperty(sPath, sMatkl);
              } else {
                oInp.setValue(sMatkl);
              }
            }.bind(this),
            cancel: function () { }
          });

          oView.addDependent(this._oMatklVH);
        }

        var sCurrent = (oInput.getValue() || "").trim();
        this._oMatklVH.open(sCurrent);
        this._applyMatklSearchFilter(sCurrent);
      }.bind(this);

      var aCached = this._oMatklJsonModel.getProperty("/results") || [];
      if (aCached.length > 0) {
        openDialog();
        return;
      }

      oODataModel.read("/HT023Set", {
        urlParameters: {
          "$select": "Matkl,Wgbez60",
          "$top": "5000"
        },
        success: function (oData) {
          var a = (oData && oData.results) ? oData.results : [];
          a = a.map(function (x) {
            var o = Object.assign({}, x);
            o.__matkl = String(o.Matkl || "").toLowerCase();
            o.__wgbez60 = String(o.Wgbez60 || "").toLowerCase();
            return o;
          });
          this._oMatklJsonModel.setProperty("/results", a);
          openDialog();
        }.bind(this),
        error: function (oErr) {
          sap.m.MessageToast.show(this.getResourceBundle().getText("cw.vh.matkl.loadError"));
          console.log(oErr);
        }
      });
    },

    // Wendet einen clientseitigen Suchfilter auf den Warengruppe-Dialog an (Nummer oder Text, case-insensitive) 
    // über vorberechnete Hilfsfelder im JSON-Model.
    _applyMatklSearchFilter: function (sValue) {
      if (!this._oMatklVH) { return; }
      var s = String(sValue || "").trim().toLowerCase();
      var oBinding = this._oMatklVH.getBinding("items");
      if (!oBinding) { return; }

      if (!s) {
        oBinding.filter([]);
        return;
      }

      oBinding.filter([
        new sap.ui.model.Filter({
          filters: [
            new sap.ui.model.Filter("__matkl", sap.ui.model.FilterOperator.Contains, s),
            new sap.ui.model.Filter("__wgbez60", sap.ui.model.FilterOperator.Contains, s)
          ],
          and: false
        })
      ], "Application");
    },


    // Öffnet die Sachkonto-Werthilfe: lädt Sachkonten einmalig in ein JSON-Cache-Model, öffnet einen SelectDialog 
    // mit Suche und schreibt die Auswahl ins korrekt gebundene Feld.
    onValueHelpGl: function (oEvent) {
      var oView = this.getView();
      var oODataModel = this.getOwnerComponent().getModel();
      var oInput = oEvent.getSource();
      this._oGlActiveInput = oInput;

      if (!this._oGlJsonModel) {
        this._oGlJsonModel = new sap.ui.model.json.JSONModel({ results: [] });
        oView.setModel(this._oGlJsonModel, "vhGl");
      }

      var openDialog = function () {
        if (!this._oGlVH) {
          this._oGlVH = new sap.m.SelectDialog({
            title: this.getResourceBundle().getText("cw.vh.gl.title"),
            items: {
              path: "vhGl>/results",
              template: new sap.m.StandardListItem({
                title: "{vhGl>Saknr}",
                description: "{vhGl>Txt50}"
              })
            },
            search: function (oEvt) {
              var sValue = (oEvt.getParameter("value") || "").trim().toLowerCase();
              this._applyGlSearchFilter(sValue);
            }.bind(this),
            confirm: function (oEvt) {
              var oSel = oEvt.getParameter("selectedItem");
              if (!oSel || !this._oGlActiveInput) { return; }

              var oObj = oSel.getBindingContext("vhGl").getObject();
              var sSaknr = String(oObj.Saknr || "").trim();

              var oInp = this._oGlActiveInput;
              var oBI = oInp.getBindingInfo("value");

              if (oBI && oBI.parts && oBI.parts.length) {
                var sModelName = oBI.parts[0].model;
                var sPath = oBI.parts[0].path;

                if (sPath && sPath[0] !== "/") {
                  var oCtx = oInp.getBindingContext(sModelName);
                  if (oCtx) {
                    sPath = oCtx.getPath() + "/" + sPath;
                  } else {
                    sPath = "/" + sPath;
                  }
                }

                oInp.getModel(sModelName).setProperty(sPath, sSaknr);
              } else {
                oInp.setValue(sSaknr);
              }
            }.bind(this),
            cancel: function () { }
          });

          oView.addDependent(this._oGlVH);
        }

        var sCurrent = (oInput.getValue() || "").trim();
        this._oGlVH.open(sCurrent);
        this._applyGlSearchFilter(sCurrent);
      }.bind(this);

      var aCached = this._oGlJsonModel.getProperty("/results") || [];
      if (aCached.length > 0) {
        openDialog();
        return;
      }

      oODataModel.read("/SakoCoreSet", {
        urlParameters: {
          "$select": "Saknr,Txt50",
          "$top": "5000"
        },
        success: function (oData) {
          var a = (oData && oData.results) ? oData.results : [];
          a = a.map(function (x) {
            var o = Object.assign({}, x);
            o.__saknr = String(o.Saknr || "").toLowerCase();
            o.__txt50 = String(o.Txt50 || "").toLowerCase();
            return o;
          });
          this._oGlJsonModel.setProperty("/results", a);
          openDialog();
        }.bind(this),
        error: function (oErr) {
          sap.m.MessageToast.show(this.getResourceBundle().getText("cw.vh.gl.loadError"));
          console.log(oErr);
        }
      });
    },

    // Wendet einen clientseitigen Suchfilter auf den Sachkonto-Dialog an (Nummer oder Text, case-insensitive) 
    // über vorberechnete Hilfsfelder im JSON-Model.
    _applyGlSearchFilter: function (sValue) {
      if (!this._oGlVH) { return; }
      var s = String(sValue || "").trim().toLowerCase();
      var oBinding = this._oGlVH.getBinding("items");
      if (!oBinding) { return; }

      if (!s) {
        oBinding.filter([]);
        return;
      }

      oBinding.filter([
        new sap.ui.model.Filter({
          filters: [
            new sap.ui.model.Filter("__saknr", sap.ui.model.FilterOperator.Contains, s),
            new sap.ui.model.Filter("__txt50", sap.ui.model.FilterOperator.Contains, s)
          ],
          and: false
        })
      ], "Application");
    },

    // Füllt leere Empfänger-Felder in den Warenkorbpositionen automatisch mit dem aktuellen SAP-User.
    _prefillReceiversWithCurrentUser: function () {
      // bewusst nicht awaiten, damit der Flow nicht blockiert
      this._getCurrentSapUserId().then(function (sUser) {
        if (!sUser) { return; }

        const oCartModel = this.getView().getModel("cartProducts");
        if (!oCartModel) { return; }

        const aItems = this._getCartEntries() || [];
        if (!aItems.length) { return; }

        aItems.forEach(function (it, idx) {
          const sExisting = String((it && it.receiver) || "").trim();
          if (!sExisting) {
            oCartModel.setProperty("/cartEntries/" + idx + "/receiver", sUser);
          }
        });

        oCartModel.refresh(true);
      }.bind(this));
    },

    // Ermittelt die aktuelle SAP-User-ID über FLP-UserInfo (synchron oder asynchron) und liefert sonst leer zurück.
    _getCurrentSapUserId: function () {
      return new Promise(function (resolve) {
        try {
          // Fall 1: FLP verfügbar (häufigster Fall)
          if (sap.ushell && sap.ushell.Container) {
            // synchron
            if (sap.ushell.Container.getUser) {
              const oUser = sap.ushell.Container.getUser();
              const sId = oUser && oUser.getId && oUser.getId();
              if (sId) {
                resolve(String(sId));
                return;
              }
            }

            // async Service (je nach System/Version)
            if (sap.ushell.Container.getServiceAsync) {
              sap.ushell.Container.getServiceAsync("UserInfo").then(function (oSvc) {
                // je nach API-Variante
                let sId = "";
                if (oSvc && typeof oSvc.getId === "function") {
                  sId = oSvc.getId();
                } else if (oSvc && typeof oSvc.getUser === "function") {
                  const oU = oSvc.getUser();
                  sId = oU && oU.getId && oU.getId();
                }
                resolve(sId ? String(sId) : "");
              }).catch(function () {
                resolve("");
              });
              return;
            }
          }
        } catch (e) {
          // ignorieren, fallback unten
        }

        // Fallback: nichts gefunden -> leer zurückgeben (keine Funktionsänderung, nur kein Default)
        resolve("");
      });
    },



    // Verarbeitet die Änderung „WE erwartet“ für Position und Kopf, setzt bei „Nein“ abhängige Kopf-Felder zurück 
    // und überträgt die Kopf-Auswahl auf Positionen.
    onWeChange: function (oEvent) {
      var iIdx = Number(oEvent.getParameter("selectedIndex")); // 0 = Ja, 1 = Nein

      // Fall 1: cart item (bleibt wie bisher)
      var oCtx = oEvent.getSource().getBindingContext("cartProducts");
      if (oCtx) {
        oCtx.getModel().setProperty(oCtx.getPath() + "/weExpectedIndex", iIdx);
      }

      // Fall 2: head
      var oHeadModel = this.getView().getModel("checkout");
      if (oHeadModel) {
        oHeadModel.setProperty("/head/weExpectedIndex", iIdx);

        if (iIdx === 1) {
          oHeadModel.setProperty("/head/AmtsvertragsbezugIndex", -1);
          oHeadModel.setProperty("/head/sigma", "");
          oHeadModel.setProperty("/head/avbNumber", "");
        }
      }

      this._syncHeadWeToCartItems();
    },



    // Übernimmt ausgewählte Dateien aus dem FileUploader ins Checkout-Model (/attachments) inkl. ObjectURL 
    // für Preview, setzt Default-Uploadstatus und leert optional die Auswahl im FileUploader.
    onAttachFUChange: function (oEvent) {
      const aFiles = oEvent.getParameter("files") || [];
      if (!aFiles.length) { return; }

      const oM = this.getView().getModel("checkout");
      const a = oM.getProperty("/attachments") || [];

      Array.from(aFiles).forEach(file => {
        a.push({
          id: Date.now() + "_" + Math.random().toString(36).slice(2),
          fileName: file.name,
          mediaType: file.type || "",
          size: file.size || 0,
          objectUrl: URL.createObjectURL(file),
          _file: file,

          uploadState: "PENDING",
          docId: "",
          error: ""
        });
      });


      oM.setProperty("/attachments", a);
      oM.refresh(true);

      // optional: denselben Dateinamen erneut wählen ermöglichen
      const oFU = oEvent.getSource();
      if (oFU && oFU.clear) { oFU.clear(); }
    },

    // Ermittelt die Basis-Service-URL des OData-Models ohne trailing Slash für manuelle Upload-Requests.
    _getServiceUrl: function () {
      const oModel = this.getOwnerComponent().getModel();
      let sBase = (oModel && oModel.sServiceUrl) || "";
      if (sBase.endsWith("/")) {
        sBase = sBase.slice(0, -1);
      }
      return sBase;
    },



    // Extrahiert eine DocId aus der Upload-Response (Location-Header oder JSON-Body) und liefert sie als String zurück.
    _extractDocIdFromUploadResponse: function (xhr) {
      // 1) Location Header
      const sLoc = xhr.getResponseHeader("location") || xhr.getResponseHeader("Location") || "";
      if (sLoc) {
        const m = sLoc.match(/Docid='([^']+)'/i) || sLoc.match(/DocId='([^']+)'/i);
        if (m && m[1]) {
          return decodeURIComponent(m[1]);
        }
      }

      // 2) JSON Body (falls Backend JSON zurückgibt)
      const sText = xhr.responseText || "";
      if (sText) {
        try {
          const o = JSON.parse(sText);
          const d = (o && o.d) ? o.d : o;
          return (d && (d.DocId || d.Docid || d.docId || d.docid || d.ZMM_WEBS_DOC_ID)) ? String(d.DocId || d.Docid || d.docId || d.docid || d.ZMM_WEBS_DOC_ID) : "";
        } catch (e) {
          // ignorieren
        }
      }

      return "";
    },


    // Lädt ein einzelnes Attachment per XMLHttpRequest gegen das OData-Upload-Endpoint hoch (inkl. CSRF-Token) 
    // und liefert DocId sowie Rohantwort als Promise-Ergebnis.
    _uploadSingleAttachment: function (oFile, sBanfn) {
      return new Promise((resolve, reject) => {
        const rb = this.getResourceBundle();

        if (!oFile) {
          reject(new Error(rb.getText("cw.upload.noFile")));
          return;
        }
        if (!sBanfn) {
          reject(new Error(rb.getText("cw.upload.noBanfn")));
          return;
        }

        const oModel = this.getOwnerComponent().getModel(); // OData V2
        const sFileName = oFile.name || "upload.bin";

        // Dateiname zusätzlich encodieren, damit Sonderzeichen nicht kaputtgehen
        const sSlug = String(sBanfn) + "|" + encodeURIComponent(sFileName);

        const sContentType = oFile.type || "application/octet-stream";

        const sUrl = this._getServiceUrl() + "/BanfAttachmentSet";

        const xhr = new XMLHttpRequest();
        xhr.open("POST", sUrl, true);

        xhr.setRequestHeader("Content-Type", sContentType);
        xhr.setRequestHeader("Slug", sSlug);
        xhr.setRequestHeader("Accept", "application/json");

        const onLoad = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            const sDocId = this._extractDocIdFromUploadResponse(xhr);
            resolve({ docId: sDocId, raw: xhr.responseText || "" });
          } else {
            const sMsg = rb.getText("cw.upload.failed", [
              String(xhr.status),
              String(xhr.responseText || "")
            ]);
            reject(new Error(sMsg));
          }
        };

        xhr.onload = onLoad;
        xhr.onerror = () => reject(new Error(rb.getText("cw.upload.networkError")));

        // CSRF-Token sicherstellen
        oModel.refreshSecurityToken(() => {
          try {
            const sToken = oModel.getSecurityToken();
            if (sToken) {
              xhr.setRequestHeader("x-csrf-token", sToken);
            }
          } catch (e) {
            // falls getSecurityToken nicht verfügbar ist, trotzdem versuchen
          }
          xhr.send(oFile);
        }, () => {
          reject(new Error(rb.getText("cw.upload.csrfError")));
        });
      });
    },



    // Lädt alle Attachments sequentiell für eine BANF hoch, pflegt Uploadstatus pro Attachment im Checkout-Model 
    // und bricht bei erstem Fehler mit Exception ab.
    _uploadAllAttachmentsForBanfn: async function (sBanfn) {
      const oCheckoutM = this.getView().getModel("checkout");
      const aAtt = oCheckoutM.getProperty("/attachments") || [];

      for (let i = 0; i < aAtt.length; i++) {
        const oAtt = aAtt[i];
        if (!oAtt || !oAtt._file) {
          continue;
        }

        oCheckoutM.setProperty("/attachments/" + i + "/uploadState", "UPLOADING");
        oCheckoutM.setProperty("/attachments/" + i + "/error", "");
        oCheckoutM.refresh(true);

        try {
          const res = await this._uploadSingleAttachment(oAtt._file, sBanfn);
          oCheckoutM.setProperty("/attachments/" + i + "/uploadState", "DONE");
          oCheckoutM.setProperty("/attachments/" + i + "/docId", res.docId || "");
        } catch (e) {
          oCheckoutM.setProperty("/attachments/" + i + "/uploadState", "ERROR");
          oCheckoutM.setProperty("/attachments/" + i + "/error", String(e && e.message ? e.message : e));

          throw e;
        }

        oCheckoutM.refresh(true);
      }
    },




    // Entfernt ein Attachment aus dem Checkout-Model (/attachments) anhand des List-Index und gibt die 
    // dazugehörige ObjectURL frei.
    onAttachDelete: function (oEvent) {
      const oItem = oEvent.getParameter("listItem") || oEvent.getParameter("item");
      const oCtx = oItem && oItem.getBindingContext("checkout");
      if (!oCtx) { return; }

      const sPath = oCtx.getPath();
      const iIdx = parseInt(sPath.split("/").pop(), 10);

      const oM = this.getView().getModel("checkout");
      const a = oM.getProperty("/attachments") || [];
      const att = a[iIdx];

      try { if (att && att.objectUrl) { URL.revokeObjectURL(att.objectUrl); } } catch (e) { }

      a.splice(iIdx, 1);
      oM.setProperty("/attachments", a);
      oM.refresh(true);
    },

    // Öffnet ein Attachment zur Vorschau in einem neuen Tab über die gespeicherte ObjectURL.
    onAttachOpen: function (oEvent) {
      const oSrc = oEvent.getSource();
      const oCtx =
        (oSrc && oSrc.getBindingContext && oSrc.getBindingContext("checkout")) ||
        (oEvent.getParameter("listItem") && oEvent.getParameter("listItem").getBindingContext("checkout")) ||
        (oEvent.getParameter("item") && oEvent.getParameter("item").getBindingContext("checkout"));

      const oAtt = oCtx && oCtx.getObject();
      if (oAtt && oAtt.objectUrl) {
        window.open(oAtt.objectUrl, "_blank");
      }
    },

    // Gibt beim Verlassen des Controllers alle erzeugten ObjectURLs frei, um Speicherlecks zu vermeiden.
    onExit: function () {
      const a = (this.getView().getModel("checkout").getProperty("/attachments") || []);
      a.forEach(x => { try { URL.revokeObjectURL(x.objectUrl); } catch (e) { } });
    },


    // Validiert den Formular-Schritt (aktuell immer true; Platzhalter für ggf. spätere Pflichtprüfungen).
    _validateStepForm: function () {
      return true;
    },

    // Verarbeitet die Änderung der Investmentart, schreibt den Key ins Checkout-Head-Model und 
    // setzt bei aktivierter Validierung ValueState/ValueStateText am Feld.
    onInvArtChange: function (oEvent) {
      const oCB = oEvent.getSource();
      const oItem = oEvent.getParameter("selectedItem");
      const sKey = oItem ? oItem.getKey() : (oCB.getSelectedKey() || "");

      this.getView().getModel("checkout").setProperty("/head/invArt", sKey);

      if (this.getView().getModel("checkoutWizard").getProperty("/validate")) {
        oCB.setValueState(sKey ? "None" : "Error");
        oCB.setValueStateText(sKey ? "" : this.getResourceBundle().getText("cw.invArt.mandatory"));
      }
    },



    // Validiert den Kopf-/Kontierungs-Schritt anhand von Pflichtfeldern und Regeln 
    // und zeigt bei Fehlern eine Sammelmeldung.
    _validateStepAccounting: function () {
      const rb = this.getResourceBundle();

      const oCheckout = this.getView().getModel("checkout");
      const h = oCheckout.getProperty("/head") || {};
      const missing = [];

      // 1) Wareneingang erwartet / Dienstleistung (Ja/Nein muss gewählt sein)
      if (!(h.weExpectedIndex === 0 || h.weExpectedIndex === 1)) {
        missing.push(rb.getText("cw.field.weOrService"));
      }

      // 2) Falls WE = Ja → Sigma + Amtsvertragsbezug
      if (h.weExpectedIndex === 0) {
        if (!h.sigma) { missing.push(rb.getText("cw.field.sigma")); }
        if (!(h.AmtsvertragsbezugIndex === 0 || h.AmtsvertragsbezugIndex === 1)) {
          missing.push(rb.getText("cw.field.avbRef"));
        }
        if (h.AmtsvertragsbezugIndex === 0) {
          const sAvbNum = h.avbNumber || "";
          if (!sAvbNum.trim()) { missing.push(rb.getText("cw.field.avbNumber")); }
        }
      }

      // 3) Bestellart (Verbrauch / Investition) muss gewählt sein
      if (!(h.materialTypeIndex === 0 || h.materialTypeIndex === 1)) {
        missing.push(rb.getText("cw.field.orderType"));
      }

      // 4) Investition → Kostenstelle (Kopf)
      if (h.materialTypeIndex === 1) {
        // direkt aus dem Input lesen
        const oInpInvKostl = this.byId("inpZKostl");
        const sKostlInv = oInpInvKostl && oInpInvKostl.getValue
          ? oInpInvKostl.getValue().trim()
          : "";

        if (!sKostlInv) {
          // vorhandener Key aus deinem Cart-Required-Set (bitte nur verwenden, wenn er bei dir existiert)
          // wenn du lieber einen neuen Key willst, sag kurz Bescheid
          missing.push(rb.getText("cw.field.costCenter"));
        }
      }

      const sInvArt = String(h.invArt || "").trim();
      if (!sInvArt) {
        missing.push(rb.getText("cw.field.invArt"));
      }

      // 5) Verbrauch → Kontierung der ersten Position
      if (h.materialTypeIndex === 0) {
        const aItems = this._getCartEntries() || [];
        const it0 = aItems[0];

        if (!it0) {
          missing.push(rb.getText("cw.field.accountType"));
        } else {
          const at = it0.accountType || "";

          if (!at) {
            missing.push(rb.getText("cw.field.accountType"));
          } else if (at === "gl" && !(it0.costCenter || "").trim()) {
            missing.push(rb.getText("cw.field.costCenter"));
          } else if (at === "io" && !(it0.internalOrder || "").trim()) {
            missing.push(rb.getText("cw.field.internalOrder"));
          } else if (at === "wbs" && !(it0.accountValue || "").trim()) {
            missing.push(rb.getText("cw.field.wbs"));
          }
        }
      }

      // 6) Klassifizierung, Werk, Umwelt (immer Pflicht)
      if (!Array.isArray(h.klass) || h.klass.length === 0) { missing.push(rb.getText("cw.field.classification")); }
      if (!h.werks) { missing.push(rb.getText("cw.field.plant")); }
      if (!(h.UmweltIndex === 0 || h.UmweltIndex === 1)) { missing.push(rb.getText("cw.field.sustainability")); }

      if (missing.length) {
        sap.m.MessageBox.warning(rb.getText("cw.msg.fillRequired") + " \n• " + missing.join("\n• "));
        return false;
      }
      return true;
    },



    // Liefert ein Default-Datenobjekt für das Checkout-Model inkl. Head-Struktur und Startwerten für Indizes und Felder.
    _createCheckoutDefaults: function () {
      return {
        banfn: "",
        plant: "",
        costCenter: "",
        note: "",
        attachments: [],
        head: {
          materialTypeIndex: -1,
          itRelvIndex: -1,
          hazardIndex: -1,
          exportIndex: -1,
          weExpectedIndex: -1,
          AmtsvertragsbezugIndex: -1,
          avbNumber: "",
          sigma: "",
          werks: "",
          ekorg: "",
          ekgrp: "",
          klass: [],
          UmweltIndex: -1,
          invArtKurz: "",
          invArt: "",
          invArtKeys: []
        }
      };
    },


    // Liest cartEntries aus dem Cart-Model robust als Array (auch wenn intern als Objekt gespeichert)
    //  und gibt die Einträge zurück.
    _getCartEntries: function () {
      const oCartModel = this.getView().getModel(CART_MODEL);
      const v = oCartModel && oCartModel.getProperty("/cartEntries");
      return Array.isArray(v) ? v : Object.values(v || {});
    },


    // Überträgt die WE-Auswahl aus dem Kopf (checkout/head/weExpectedIndex) auf Cart-Items, sofern 
    // deren weExpectedIndex noch nicht gesetzt ist, und aktualisiert das Cart-Model.
    _syncHeadWeToCartItems: function () {
      const oCheckout = this.getView().getModel("checkout");
      const oCart = this.getView().getModel("cartProducts");
      if (!oCheckout || !oCart) { return; }

      const iHead = Number(oCheckout.getProperty("/head/weExpectedIndex"));
      if (!(iHead === 0 || iHead === 1)) { return; }

      const aItems = this._getCartEntries() || [];
      aItems.forEach((it, idx) => {
        const iItem = Number(it.weExpectedIndex);
        if (!(iItem === 0 || iItem === 1)) {
          oCart.setProperty("/cartEntries/" + idx + "/weExpectedIndex", iHead);
        }
      });

      oCart.refresh(true);
    },


    // Reagiert auf Änderung des Kontierungstyps einer Position und leert nicht relevante Felder
    //  (Kostenstelle/Innenauftrag/PSP) im entsprechenden Cart-Item.
    onAccountTypeChange: function (oEvent) {
      const oSel = oEvent.getSource();
      const sKey = oSel.getSelectedKey();              // 'gl' | 'io' | 'wbs'
      const oCtx = oSel.getBindingContext("cartProducts");
      if (!oCtx) { return; }
      const m = oCtx.getModel(), p = oCtx.getPath();

      if (sKey !== "gl") { m.setProperty(p + "/costCenter", ""); }
      if (sKey !== "io") { m.setProperty(p + "/internalOrder", ""); }
      if (sKey !== "wbs") { m.setProperty(p + "/accountValue", ""); }
    },

    // Ergänzt fehlende Zusatzfelder in allen Cart-Items (z. B. Empfänger, Kontierung, Zusatztext, Wunschdatum, WE-Index) 
    // und schreibt die normalisierten Einträge zurück ins Cart-Model.
    _ensureCartItemExtensions: function () {
      const oCartModel = this.getView().getModel(CART_MODEL);
      if (!oCartModel) { return; }


      const aExt = this._getCartEntries().map(function (e) {
        return Object.assign(
          {},
          e, // Basisdaten zuerst übernehmen
          {
            receiver: e.receiver || "",
            accountType: e.accountType || "",
            costCenter: e.costCenter || "",
            internalOrder: e.internalOrder || "",
            accountValue: e.accountValue || "",
            Matkl: e.Matkl || "",
            Wlief: e.Wlief || "",
            Ekgrp: e.Ekgrp || "",
            Idnlf: e.Idnlf || "",
            addText: e.addText || e.freitextAddText || e.AddText || e.Zusatztext || e.zusatztext || "",
            desiredDate: e.desiredDate || null,
            glAccount: e.glAccount || "",
            weExpectedIndex: typeof e.weExpectedIndex === "number" ? e.weExpectedIndex : -1
          }
        );
      });

      oCartModel.setProperty("/cartEntries", aExt);
      oCartModel.refresh(true);
    }

  });
});
