sap.ui.define([
  "sap/ui/core/UIComponent",
  "./model/IndexedDBModel",
  "./model/models",
  "sap/ui/Device",
  "sap/ui/model/json/JSONModel",
  "sap/ui/model/resource/ResourceModel"
], function (UIComponent, IndexedDBModel, models, Device, JSONModel, ResourceModel) {
  "use strict";

  // Haupt-Komponente der App: Wird beim App-Start einmalig instanziiert und lebt über alle Views hinweg.
  return UIComponent.extend("diehlwebshop.Component", {
    metadata: {
      // Verknüpft die Komponente mit der manifest.json (Routing, Datenquellen, Ressourcen).
      manifest: "json",
      // Erlaubt asynchrone Inhaltserzeugung zur Verbesserung der Start-Performance.
      interfaces: ["sap.ui.core.IAsyncContentCreation"]
    },

    // Lebenszyklus: Wird genau einmal beim App-Start aufgerufen.
    init: function () {

      // Hauptfenster eindeutig benennen (damit returntarget immer hierher kann)
      if (!window.name || !window.name.startsWith("WEBSHOP_MAIN_")) {
        let id = localStorage.getItem("WEBSHOP_MAIN_ID");
        if (!id) {
          id = String(Date.now()) + "_" + Math.random().toString(16).slice(2);
          localStorage.setItem("WEBSHOP_MAIN_ID", id);
        }
        window.name = "WEBSHOP_MAIN_" + id;
      }



      // 1) I18n-Modell setzen, basierend auf der aktuellen Sprache des UI5-Cores.
      const sLanguage = sap.ui.getCore().getConfiguration().getLanguage();
      const oI18nModel = new ResourceModel({
        bundleName: "diehlwebshop.i18n.i18n",
        bundleLocale: sLanguage
      });
      this.setModel(oI18nModel, "i18n");

      this.setModel(new JSONModel({
        delay: 0,
        layout: "TwoColumnsMidExpanded",
        cartOpen: false
      }), "appView");




      // 3) Warenkorb-Modell mit lokaler Persistenz (LocalStorage-Key: SHOPPING_CART).
      const oCartModel = new IndexedDBModel("SHOPPING_CART", {
        cartEntries: [],
        savedForLaterEntries: [],
        totalPrice: 0,
        showProceedButton: false,
        showEditButton: false
      });
      // Zwei-Wege-Binding: Änderungen in UI und Modell halten sich gegenseitig aktuell.
      oCartModel.setDefaultBindingMode(sap.ui.model.BindingMode.TwoWay);
      this.setModel(oCartModel, "cartProducts");

      // 3a) Kompatibilitäts-Fix: Falls ältere Daten als Objekt statt Array gespeichert wurden.
      const vCE = oCartModel.getProperty("/cartEntries");
      if (vCE && !Array.isArray(vCE)) {
        oCartModel.setProperty("/cartEntries", Object.values(vCE));
      }
      const vSFL = oCartModel.getProperty("/savedForLaterEntries");
      if (vSFL && !Array.isArray(vSFL)) {
        oCartModel.setProperty("/savedForLaterEntries", Object.values(vSFL));
      }

      // 4) Vergleichs-Modell (ebenfalls lokal, eigener LocalStorage-Key).
      this.setModel(new IndexedDBModel("PRODUCT_COMPARISON", {
        category: "",
        item1: "",
        item2: ""
      }), "comparison");

      // OCI-Katalogliste: wird im Home-Controller aus OData gefüllt
      const oOciCatalogs = new sap.ui.model.json.JSONModel([]);
      this.setModel(oOciCatalogs, "ociCatalogs");

      // Freitextbestellung als ersten Eintrag in die OCI-Liste einfügen (lokal im JSONModel)
      (function () {
        const rb = this.getModel("i18n").getResourceBundle();
        const a = oOciCatalogs.getData();
        const aList = Array.isArray(a) ? a.slice() : [];

        if (!aList.some(x => x && x.type === "FREETEXT")) {
          aList.unshift({
            type: "FREETEXT",
            katalogName: rb.getText("freitextOpenDialogButtonText")
          });
          oOciCatalogs.setData(aList);
        }
      }.bind(this))();




      // 6) Geräte-Modell (Touch, System, Orientierung) für responsives Verhalten.
      this.setModel(models.createDeviceModel(), "device");

      // 7) Basis-Initialisierung der UI5-Komponente:
      UIComponent.prototype.init.apply(this, arguments);

      // 8) Router starten: Wertet die aktuelle URL aus und lädt die passende View.
      const sOciRaw = this._getOciRawParam();   // wichtig: vor Hash-Änderung sichern
      const bHadOci = !!sOciRaw;

      if (bHadOci) {
        this._forceHomeHash(); // ok: jetzt darfst du den Hash umstellen
      }

      this.getRouter().initialize();

      if (bHadOci) {
        setTimeout(function () {
          console.log("OCI DEBUG starting delayed import");
          const ok = this._importOciFromUrlIfPresent();
          console.log("OCI DEBUG delayed import result:", ok);
          console.log("OCI DEBUG cartEntries now:", this.getModel("cartProducts").getProperty("/cartEntries"));
        }.bind(this), 300);
      }



      // 9) Dokumenttitel bei Routenwechseln aktualisieren (z. B. für den Browser-Tab).
      this.getRouter().attachTitleChanged(function (oEvent) {
        document.title = oEvent.getParameter("title") || document.title;
      });
    },


    // Parst einen roh übergebenen OCI-Parameter (URL-encoded JSON) und merged die enthaltenen Items in den Warenkorb.
    _importOciFromRaw: function (sRaw) {
      try {
        const payload = JSON.parse(decodeURIComponent(sRaw));
        const aItems = Array.isArray(payload) ? payload : (payload.items || []);
        if (Array.isArray(aItems) && aItems.length > 0) {
          this._mergeItemsIntoCart(aItems);
        }
      } catch (e) {
        console.warn("OCI: Konnte Payload nicht parsen", e);
      }
    },



    // Merged eine Liste importierter Items in cartEntries (Mengen werden addiert, fehlende Felder ergänzt) 
    // und aktualisiert anschließend die Warenkorb-UI-Flags.
    _mergeItemsIntoCart: function (aIncoming, sDefaultWlief) {
      const oCartModel = this.getModel("cartProducts");
      if (!oCartModel) {
        return;
      }

      const vExisting = oCartModel.getProperty("/cartEntries");
      let aExisting = Array.isArray(vExisting) ? vExisting.slice() : Object.values(vExisting || {});
      if (!Array.isArray(aExisting)) {
        aExisting = [];
      }

      aIncoming.forEach((it) => {
        const oNorm = this._normalizeIncomingItem(it, sDefaultWlief);
        if (!oNorm) {
          return;
        }

        const idx = aExisting.findIndex(e => String(e.ZmmWebsArtikelId) === String(oNorm.ZmmWebsArtikelId));
        if (idx > -1) {
          const oldQty = parseInt(aExisting[idx].MENGE, 10) || 0;
          aExisting[idx].MENGE = oldQty + oNorm.MENGE;
          aExisting[idx].Quantity = aExisting[idx].MENGE;

          // fehlende Felder ergänzen
          aExisting[idx].ZmmWebsArtBez = aExisting[idx].ZmmWebsArtBez || oNorm.ZmmWebsArtBez;

          // Wlief: wenn bisher leer, aus Import (oder Default) ergänzen
          aExisting[idx].Wlief = aExisting[idx].Wlief || oNorm.Wlief;

          aExisting[idx].Meins = aExisting[idx].Meins || oNorm.Meins;
          aExisting[idx].Waers = aExisting[idx].Waers || oNorm.Waers;

          if (aExisting[idx].Bapre === undefined || aExisting[idx].Bapre === null) {
            aExisting[idx].Bapre = oNorm.Bapre;
          }
        } else {
          aExisting.push(oNorm);
        }
      });

      oCartModel.setProperty("/cartEntries", aExisting);

      if (typeof oCartModel.updateBindings === "function") {
        oCartModel.updateBindings(true);
      }
      oCartModel.refresh(true);

      const bHas = aExisting.length > 0;
      oCartModel.setProperty("/showProceedButton", bHas);
      oCartModel.setProperty("/showEditButton", bHas);

      oCartModel.refresh(true);
    },



    // Prüft, ob in der aktuellen URL ein OCI-Parameter vorhanden ist (entweder als Query vor dem Hash 
    // oder als Query im Hash).
    _hasOciParam: function () {
      // 1) klassisch: ?oci=... vor dem #
      if (new URLSearchParams(window.location.search).has("oci")) {
        return true;
      }

      // 2) alternativ: oci im hash: #/route?oci=...
      const h = String(window.location.hash || "");
      const iQ = h.indexOf("?");
      if (iQ >= 0) {
        return new URLSearchParams(h.slice(iQ + 1)).has("oci");
      }

      return false;
    },




    // Setzt den Hash der URL defensiv auf die Home-Route, damit die App nach einem OCI-Return kontrolliert 
    // initialisieren kann.
    _forceHomeHash: function () {
      try {
        const oUrl = new URL(window.location.href);
        // home-route bei dir ist pattern ""
        oUrl.hash = "#/";
        window.history.replaceState({}, document.title, oUrl.toString());
      } catch (e) {
        console.warn("OCI: Konnte Hash nicht auf home setzen", e);
      }
    },


    // Normalisiert ein eingehendes Item (aus OCI oder anderen Quellen) auf das interne Warenkorbformat 
    // und ermittelt dabei u. a. Menge, Preis, Einheit, Währung und die Lieferantennummer (Wlief).
    _normalizeIncomingItem: function (it) {
      const sId = String(
        it.ZmmWebsArtikelId ||
        it.Produktid ||
        it.ProductId ||
        it.id ||
        ""
      ).trim();

      if (!sId) {
        return null;
      }

      const iQty = Math.max(
        1,
        parseInt(it.MENGE ?? it.Quantity ?? it.qty ?? 1, 10) || 1
      );

      const fPrice = Number(it.Bapre ?? it.price ?? 0);

      // Einheit normalisieren (OCI liefert z. B. PCE)
      const sUnitRaw = String(it.Meins || it.Mengeneinheit || it.unit || "ST").trim();
      const sUnitUpper = sUnitRaw.toUpperCase();

      const mUnitMap = {
        "PCE": "ST",
        "PC": "ST",
        "PCS": "ST",
        "EA": "ST",
        "ST": "ST"
      };
      const sUnit = mUnitMap[sUnitUpper] || sUnitRaw;

      const sCurr = String(it.Waers || it.Currency || it.curr || "EUR").trim();

      // Lifnr ermitteln:
      // 1) Falls Return-Payload bereits eine Nummer liefert (unterschiedliche Feldnamen möglich)
      const sLifnrDirect = String(
        it.Lifnr ||
        it.LIFNR ||
        it.SupplierId ||
        it.SUPPLIER_ID ||
        it.vendorNo ||
        it.VENDOR_NO ||
        ""
      ).trim();

      // 2) Sonst aus dem gemerkten OCI-Kontext (Absprung-Customizing)
      let sLifnrCtx = "";
      if (!sLifnrDirect) {
        try {
          const s = sessionStorage.getItem("OCI_LAST_CTX");
          if (s) {
            const o = JSON.parse(s);
            sLifnrCtx = String(o && o.lifnr ? o.lifnr : "").trim();
          }
        } catch (e) {
          sLifnrCtx = "";
        }
      }

      const sLifnr = sLifnrDirect || sLifnrCtx;

      const sSupplierText = String(it.Wlief || it.Lieferant || it.manuf || it.Manufacturer || "").trim();

      const oNorm = {
        ZmmWebsArtikelId: sId,
        ZmmWebsKatId: String(it.ZmmWebsKatId || it.Kategorieid || "OCI").trim(),
        ZmmWebsKatBez: String(it.ZmmWebsKatBez || "").trim(),
        ZmmWebsArtBez: String(it.ZmmWebsArtBez || it.Artikelbezeichnung || it.desc || sId).trim(),

        // Entscheidend für BANF: Wlief muss die Lieferantennummer sein
        Wlief: sLifnr || "",

        WliefText: sSupplierText,

        Meins: sUnit,
        Waers: sCurr,
        Bapre: isNaN(fPrice) ? 0 : fPrice,
        MENGE: iQty,

        // optional für andere Bindings
        Quantity: iQty
      };

      return oNorm;
    },



    // Importiert ein OCI-Payload aus dem URL-Parameter oci, merged die Items in den Warenkorb, 
    // bereinigt danach die URL und räumt ggf. gemerkte OCI-Sessionwerte auf.
    _importOciFromUrlIfPresent: function () {
      console.log("OCI DEBUG import function entered");

      const payload = this._getOciPayloadFromUrl();
      console.log("OCI DEBUG payload:", payload);

      if (!payload) {
        return false;
      }

      // Default-Lifnr aus dem Absprung merken (falls vorhanden)
      let sDefaultWlief = "";
      try {
        sDefaultWlief = String(sessionStorage.getItem("OCI_LAST_LIFNR") || "").trim();
      } catch (e) {
        sDefaultWlief = "";
      }
      console.log("OCI DEBUG default Wlief (LIFNR) from session:", sDefaultWlief || "(leer)");

      // erlaubt: { items: [...] } oder direkt [...]
      const aItems = Array.isArray(payload) ? payload : (payload.items || []);
      if (!Array.isArray(aItems) || aItems.length === 0) {
        this._cleanupOciParamInUrl();
        return true;
      }

      this._mergeItemsIntoCart(aItems, sDefaultWlief);
      console.log("OCI DEBUG imported items:", aItems.length);
      console.log("OCI DEBUG cartEntries after import:", this.getModel("cartProducts").getProperty("/cartEntries"));

      // URL bereinigen
      this._cleanupOciParamInUrl();

      // optional: Default wieder entfernen, damit es nicht fälschlich auf spätere Importe wirkt
      try {
        sessionStorage.removeItem("OCI_LAST_LIFNR");
        sessionStorage.removeItem("OCI_LAST_CATALOG_ID");
        sessionStorage.removeItem("OCI_LAST_TS");
      } catch (e) { }

      return true;
    },


    // Liest den rohen OCI-Parameter aus der URL (vor dem Hash oder innerhalb des Hash) und 
    // gibt ihn als String zurück (oder null).
    _getOciRawParam: function () {
      try {
        // 1) klassisch vor dem Hash: ...index.html?oci=...
        const oUrl = new URL(window.location.href);
        const s1 = oUrl.searchParams.get("oci");
        if (s1) {
          return s1;
        }

        // 2) hinter dem Hash: ...index.html#/route?oci=...
        const sHash = oUrl.hash || "";
        const sQuery = (sHash.split("?")[1] || "");
        const oHashParams = new URLSearchParams(sQuery);
        const s2 = oHashParams.get("oci");
        return s2 || null;
      } catch (e) {
        console.warn("OCI: Konnte oci Parameter nicht lesen", e);
        return null;
      }
    },


    // Parst den OCI-Parameter aus der URL als JSON und liefert das Payload-Objekt zurück (oder null bei Fehler/Abwesenheit).
    _getOciPayloadFromUrl: function () {
      try {
        const oUrl = new URL(window.location.href);
        const sRaw = oUrl.searchParams.get("oci"); // ist bereits decodiert
        if (!sRaw) {
          return null;
        }
        return JSON.parse(sRaw);
      } catch (e) {
        console.warn("OCI: Konnte URL-Payload nicht lesen/parsen", e);
        return null;
      }
    },


    // Entfernt den OCI-Parameter aus der URL (sowohl vor dem Hash als auch im Hash), ohne einen Reload auszulösen.
    _cleanupOciParamInUrl: function () {
      try {
        const oUrl = new URL(window.location.href);

        // Fall 1: oci vor dem Hash entfernen
        if (oUrl.searchParams.has("oci")) {
          oUrl.searchParams.delete("oci");
        }

        // Fall 2: oci hinter dem Hash entfernen
        if (oUrl.hash && oUrl.hash.indexOf("?") > -1) {
          const a = oUrl.hash.split("?");
          const sPath = a[0]; // "#/route"
          const sQuery = a[1] || "";
          const p = new URLSearchParams(sQuery);
          if (p.has("oci")) {
            p.delete("oci");
            const sNewQuery = p.toString();
            oUrl.hash = sNewQuery ? (sPath + "?" + sNewQuery) : sPath;
          }
        }

        window.history.replaceState({}, document.title, oUrl.toString());
      } catch (e) {
        console.warn("OCI: Konnte URL nicht bereinigen", e);
      }
    },



    // Liefert die passende Content-Density-Klasse (Compact/Cozy) abhängig von 
    // Touch-Unterstützung und bereits gesetzten Body-Klassen.
    getContentDensityClass: function () {
      if (this._sContentDensityClass === undefined) {
        // Falls bereits global gesetzt, nichts überschreiben.
        if (document.body.classList.contains("sapUiSizeCozy") || document.body.classList.contains("sapUiSizeCompact")) {
          this._sContentDensityClass = "";
        } else if (!Device.support.touch) {
          // Desktop ohne Touch → Compact.
          this._sContentDensityClass = "sapUiSizeCompact";
        } else {
          // Touch-Geräte → Cozy.
          this._sContentDensityClass = "sapUiSizeCozy";
        }
      }
      return this._sContentDensityClass;
    }
  });
});
