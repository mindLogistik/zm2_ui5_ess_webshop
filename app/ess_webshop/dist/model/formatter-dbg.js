sap.ui.define([
  "sap/ui/core/format/NumberFormat"
], function (NumberFormat) {
  "use strict";

  // Abbildung Produkt-Status → UI5-State (für Farben von Badges, Icons usw.)
  var mStatusState = {
    "A": "Success",  // z. B. verfügbar
    "O": "Warning",  // z. B. begrenzt
    "D": "Error"     // z. B. nicht verfügbar
  };

  var formatter = {
    /**
     * Formatiert einen Preis mit Tausendertrennung und genau zwei Nachkommastellen.
     * Beispiel-Ausgabe: "1.234,50" (je nach Locale).
     * @param {string|number} sValue Preiswert
     * @return {string} Formatierter Preis
     */
    price: function (sValue) {
      var numberFormat = NumberFormat.getFloatInstance({
        maxFractionDigits: 2,
        minFractionDigits: 2,
        groupingEnabled: true
      });
      return numberFormat.format(sValue);
    },

    /**
     * Summiert die Preise aller Produkte im Warenkorb und liefert einen I18n-Text.
     * Erwartet ein Objekt/Array der Cart-Einträge (cartProducts>/cartEntries).
     * @param {object} oCartEntries Aktuelle Warenkorb-Einträge
     * @return {string} I18n-Text mit Gesamtbetrag (z. B. "Gesamt: 99,00")
     */
    totalPrice: function (oCartEntries) {
      var oBundle = this.getResourceBundle(), fTotal = 0;
      Object.keys(oCartEntries || {}).forEach(function (k) {
        var p = oCartEntries[k];
        var fPrice = parseFloat(p.Bapre ?? p.Bapre ?? 0);
        var fQty = p.MENGE ?? 1;
        fTotal += fPrice * fQty;
      });
      return oBundle.getText("cartTotalPrice", [formatter.price(fTotal)]);
    },

    /**
     * Liefert den Status-Text (aus I18n) zum Produktstatus.
     * @param {string} sStatus Produktstatus (A|O|D)
     * @return {string} Übersetzter Text oder der Originalwert
     */
    statusText: function (sStatus) {
      var oBundle = this.getResourceBundle();
      var mStatusText = {
        "A": oBundle.getText("statusA"),
        "O": oBundle.getText("statusO"),
        "D": oBundle.getText("statusD")
      };
      return mStatusText[sStatus] || sStatus;
    },

    /**
     * Liefert den UI5-State (Success/Warning/Error/None) zum Produktstatus.
     * @param {string} sStatus Produktstatus (A|O|D)
     * @return {string} State-String für Controls (z. B. ObjectStatus)
     */
    statusState: function (sStatus) {
      return mStatusState[sStatus] || "None";
    },

    /**
     * Bereinigt Bild-URLs aus lokalen Quellen (z. B. entfernt vorgelagerte http://localhost-Teile).
     * @param {string} sUrl Bild-URL
     * @return {string|undefined} Bereinigte relative URL oder undefined
     */
    pictureUrl: function (sUrl) {
      if (!sUrl) {
        return undefined;
      }
      if (sUrl.startsWith("http://localhost")) {
        const sSecondHttp = sUrl.indexOf("http", 10); // Den ersten "http"-Block überspringen
        return sUrl.substring(sSecondHttp);
      }
      return sUrl;
    },

    /**
     * Liefert die Bild-URL zu einer Artikel-ID oder einen Platzhalter, wenn keine ID vorhanden ist.
     * Erwartet, dass Bilder unter /img/products/<ID>.jpg liegen.
     * @param {string} sId Artikel-ID
     * @return {string} Aufgelöste URL zum Bild
     */
    articleImageUrl: function (sId) {
      const ns = "diehlwebshop";
      const placeholder = sap.ui.require.toUrl(`${ns}/img/placeholder.png`);
      if (!sId) return placeholder;
      return sap.ui.require.toUrl(`${ns}/img/products/${encodeURIComponent(sId)}.jpg`);
    },

    /**
     * Prüft, ob mindestens eine der Sammlungen Einträge enthält.
     * Funktioniert für Arrays und für Objekt-Maps.
     * @param {object} oCollection1 Erste Sammlung
     * @param {object} oCollection2 Zweite Sammlung
     * @return {boolean} true, wenn mindestens eine nicht leer ist
     */
    hasItems: function (oCollection1, oCollection2) {
      var bCollection1Filled = !!(oCollection1 && Object.keys(oCollection1).length);
      var bCollection2Filled = !!(oCollection2 && Object.keys(oCollection2).length);
      return bCollection1Filled || bCollection2Filled;
    },

    /**
     * Kombiniert Menge und Einheit zu einem lesbaren String (z. B. "5 Stück").
     * @param {number|string} fQuantity Menge
     * @param {string} sUnit Einheit (z. B. "Stück", "kg")
     * @return {string} Formatierter Text oder leerer String
     */
    quantityWithUnit: function (fQuantity, sUnit) {
      if (!fQuantity || !sUnit) {
        return "";
      }
      return fQuantity + " " + sUnit;
    },

    /**
     * Konvertiert einen Zählerwert aus der View (String) robust in eine Zahl.
     * @param {string} sValue Zählerwert als String
     * @return {int} Zählerwert als Integer (oder 0)
     */
    formatCounter: function (sValue) {
      return parseInt(sValue, 10) || 0;
    },

    categoryThumbIconFromDocId: function (sArtikelId, sDocId) {
      try {
        if (!sArtikelId || !sDocId) {
          return "";
        }

        let oModel = null;

        // 1) bevorzugt: Controller
        if (this && typeof this.getOwnerComponent === "function") {
          const oComp = this.getOwnerComponent();
          if (oComp && typeof oComp.getModel === "function") {
            oModel = oComp.getModel();
          }
        }

        // 2) Control-Fallback
        if (!oModel && this && typeof this.getModel === "function") {
          oModel = this.getModel();
        }

        if (!oModel || typeof oModel.createKey !== "function") {
          return "";
        }

        let sBase = oModel.sServiceUrl || "";
        if (sBase && sBase.endsWith("/")) {
          sBase = sBase.slice(0, -1);
        }

        const sKeyPath = oModel.createKey("BildmediaSet", {
          ArtikelId: String(sArtikelId).trim(),
          DocId: String(sDocId).trim()
        });

        return sBase + "/" + sKeyPath + "/$value";
      } catch (e) {
        return "";
      }
    },


    articleImage: function (sId) {
      return formatter.articleImageUrl(sId);
    },



    /* =========================
     * Wizard-Step-Hilfen (für Footer-Buttons / Sichtbarkeit)
     * ========================= */

    /**
     * @param {string} s Step-Bezeichner
     * @return {boolean} true, wenn aktueller Step "stepHead" ist
     */
    isStepHead: function (s) { return s === "stepHead"; },
    /**
     * @param {string} s Step-Bezeichner
     * @return {boolean} true, wenn aktueller Step "stepForm" ist
     */
    isStepForm: function (s) { return s === "stepForm"; },

    /**
    * @param {string} s Step-Bezeichner
    * @return {boolean} true, wenn aktueller Step "stepCart" ist
    */
    isStepCart: function (s) { return s === "stepCart"; },
  };

  return formatter;
});
