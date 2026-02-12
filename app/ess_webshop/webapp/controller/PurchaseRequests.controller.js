sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/m/ListType",
  "sap/ui/model/Filter",
  "sap/ui/model/FilterOperator",
  "sap/ui/model/type/Float"
], function (Controller, ListType, Filter, FilterOperator, FloatType) {

  "use strict";

  return Controller.extend("diehlwebshop.controller.PurchaseRequests", {

    onInit: function () {
      console.log("PurchaseRequests onInit", Date.now());
      var oRouter = this.getOwnerComponent().getRouter();

      oRouter.getRoute("purchaseRequests").attachPatternMatched(this._onRouteMatched, this);

      if (oRouter.getRoute("purchaseRequestsCart")) {
        oRouter.getRoute("purchaseRequestsCart").attachPatternMatched(this._onRouteMatched, this);
      }


      var oSmartTable = this.byId("banfSmartTable");
      var oSFB = this.byId("prFilterBar");

      oSmartTable.attachInitialise(function () {
        var oTable = oSmartTable.getTable();

        if (oTable && !this._bBapreFmtAttached) {
          this._bBapreFmtAttached = true;
          oTable.attachUpdateFinished(this._applyBapreScale2, this);
        }
        this._applyBapreScale2();



        if (oTable && oTable.setMode) {
          oTable.setMode("MultiSelect");
          oTable.attachSelectionChange(this._onSelectionChanged, this);
        }

        var oBI = oTable.getBindingInfo("items");
        if (oBI && oBI.template) {
          oBI.template.setType(sap.m.ListType.Navigation);
        }
        oTable.attachItemPress(this.onRowPress, this);


        if (oSmartTable.attachPersonalisationChanged) {
          oSmartTable.attachPersonalisationChanged(function () {
            oSmartTable.rebindTable(true);
          });
        }
      }, this);

      oSmartTable.attachBeforeRebindTable(this._onBeforeRebindTable, this);
      if (oSFB) { oSFB.attachFilterChange(function () { oSFB.search(); }); }
    },


    // Erzwingt für den Bewertungspreis (Bapre) eine Anzeige mit genau zwei Nachkommastellen.
    _applyBapreScale2: function () {
      var oSmartTable = this.byId("banfSmartTable");
      if (!oSmartTable) { return; }

      var oTable = oSmartTable.getTable();
      if (!oTable) { return; }

      var oType = new FloatType({ minFractionDigits: 2, maxFractionDigits: 2 });

      var fnIsBapreTextBinding = function (oCell) {
        if (!oCell || !oCell.getBindingInfo) { return false; }
        var oB = oCell.getBindingInfo("text");
        if (!oB) { return false; }
        if (oB.path === "Bapre") { return true; }
        if (Array.isArray(oB.parts) && oB.parts.some(function (p) { return p && p.path === "Bapre"; })) { return true; }
        return false;
      };

      var fnApply = function (oCell) {
        if (!oCell || !oCell.bindProperty) { return false; }
        if (!fnIsBapreTextBinding(oCell)) { return false; }
        oCell.bindProperty("text", { path: "Bapre", type: oType });
        return true;
      };

      var iBapreIndex = -1;

      var oBI = oTable.getBindingInfo("items");
      var oTemplate = oBI && oBI.template;

      if (oTemplate && oTemplate.getCells) {
        var aTemplateCells = oTemplate.getCells() || [];
        for (var i = 0; i < aTemplateCells.length; i++) {
          if (fnIsBapreTextBinding(aTemplateCells[i])) {
            iBapreIndex = i;
            fnApply(aTemplateCells[i]);
            break;
          }
        }
      }

      var aItems = oTable.getItems ? oTable.getItems() : [];
      for (var r = 0; r < aItems.length; r++) {
        var aCells = aItems[r] && aItems[r].getCells ? aItems[r].getCells() : null;
        if (!aCells || !aCells.length) { continue; }

        if (iBapreIndex >= 0 && aCells[iBapreIndex]) {
          fnApply(aCells[iBapreIndex]);
        } else {
          for (var c = 0; c < aCells.length; c++) {
            if (fnApply(aCells[c])) { break; }
          }
        }
      }
    },



    // Wird beim Match der PurchaseRequests-Route aufgerufen; unterdrückt einmalig das Rebind, 
    // wenn appView/skipNextPurchaseRequestsRebind gesetzt ist, sonst rebinding der SmartTable
    _onRouteMatched: function () {
      var oAppView = this.getOwnerComponent().getModel("appView");
      var bSkip = !!(oAppView && oAppView.getProperty("/skipNextPurchaseRequestsRebind"));

      if (bSkip && oAppView) {
        oAppView.setProperty("/skipNextPurchaseRequestsRebind", false);
        return;
      }

      var oSmartTable = this.byId("banfSmartTable");
      if (!oSmartTable) { return; }


      if (oSmartTable.rebindTable) {
        oSmartTable.rebindTable(true);
      } else {
        var oTable = oSmartTable.getTable && oSmartTable.getTable();
        var oBinding = oTable && oTable.getBinding && oTable.getBinding("items");
        if (oBinding && oBinding.refresh) {
          oBinding.refresh(true);
        }
      }
    },



    // Reagiert auf Auswahländerungen in der Tabelle, zählt selektierte Items und aktiviert/deaktiviert 
    // den Re-Add-Button entsprechend.
    _onSelectionChanged: function () {
      var oTable = this.byId("banfSmartTable").getTable();
      var iCount = oTable && oTable.getSelectedItems ? oTable.getSelectedItems().length : 0;
      this.byId("btnReAdd").setEnabled(iCount > 0);
    },


    // Übernimmt alle selektierten BANF-Positionen zurück in den Warenkorb (cartProducts/cartEntries); 
    // mappt Zeilen in Cart-Items, merged nach ZmmWebsArtikelId (Menge addieren), setzt 
    // Proceed/Edit-Flags, refresht Model, zeigt Toast und räumt Selektion auf.
    onReAddSelected: function () {
      var oTable = this.byId("banfSmartTable").getTable();
      if (!oTable || !oTable.getSelectedContexts) { return; }

      var aCtx = oTable.getSelectedContexts();
      if (!aCtx.length) { return; }

      var oCartModel = this.getOwnerComponent().getModel("cartProducts");
      var aCart = oCartModel.getProperty("/cartEntries") || [];

      aCtx.forEach(function (oCtx) {
        var oRow = oCtx.getObject();
        var oItem = this._mapPurchaseRequestToCartItem(oRow);
        if (!oItem) { return; }

        var sId = String(oItem.ZmmWebsArtikelId || "");
        var i = aCart.findIndex(function (e) { return String(e.ZmmWebsArtikelId) === sId; });
        if (i === -1) {
          aCart.push(oItem);
        } else {
          aCart[i].MENGE = (parseInt(aCart[i].MENGE, 10) || 0) + (parseInt(oItem.MENGE, 10) || 1);
        }
      }.bind(this));

      oCartModel.setProperty("/cartEntries", aCart);
      oCartModel.setProperty("/showProceedButton", aCart.length > 0);
      oCartModel.setProperty("/showEditButton", aCart.length > 0);
      oCartModel.refresh(true);

      sap.m.MessageToast.show(this.getOwnerComponent().getModel("i18n").getResourceBundle().getText("reAddSuccess", [aCtx.length]));

      oTable.removeSelections();
      this.byId("btnReAdd").setEnabled(false);
    },


    // Mappt eine BANF-Zeile auf ein Warenkorb-Item; wenn ZmmWebsArtikelId vorhanden ist, wird 
    // die Zeile (mit Default-MENGE=1) kopiert, sonst wird ein REORDER-Fallback-Objekt mit generierter 
    // ArtikelId (BANF-Banfn-Bnfpo) aufgebaut.
    _mapPurchaseRequestToCartItem: function (row) {
      if (!row) { return null; }

      if (row.ZmmWebsArtikelId) {
        var copy = Object.assign({}, row);
        if (!copy.MENGE) { copy.MENGE = 1; }
        return copy;
      }

      return {
        ZmmWebsArtikelId: "BANF-" + String(row.Banfn || "") + "-" + String(row.Bnfpo || ""),
        ZmmWebsKatId: "REORDER",
        ZmmWebsKatBez: row.Txz01 || "",
        ZmmWebsArtBez: row.Txz01 || "",
        Bapre: Number(row.Bapre || 0),
        Waers: row.Waers || "EUR",
        Meins: row.Meins || "ST",
        Wlief: row.Lifnr || "",
        MENGE: 1,
        STATUS: "A"
      };

    },



    // Hook vor dem SmartTable-Rebind: unterdrückt das Rebind einmalig bei skipNextPurchaseRequestsRebind 
    // (preventTableBind=true) und normalisiert ansonsten Textfilterwerte (Trim + Capitalize) für bestimmte 
    // Felder, auch rekursiv bei MultiFilter-Strukturen.
    _onBeforeRebindTable: function (oEvent) {
      var mParams = oEvent.getParameter("bindingParams");
      if (!mParams) {
        return;
      }

      // 1) Einmal laden, danach im Frontend filtern/sortieren
      mParams.parameters = mParams.parameters || {};
      mParams.parameters.operationMode = "Client";
      mParams.parameters.threshold = 5000;

      // 2) Standardfilter der SmartFilterBar übernehmen 
      var oSfb = this.byId("prFilterBar");
      if (!oSfb) {
        return;
      }

      var aSfbFilters = [];
      try {
        aSfbFilters = oSfb.getFilters() || [];
      } catch (e) {
        aSfbFilters = [];
      }

      // 3) FilterData holen (für Wildcard-Patch)
      var oFd = (oSfb.getFilterData && oSfb.getFilterData(true)) ? oSfb.getFilterData(true) : {};

      // 4) Banfn normalisierenn
      var sBanfn = "";
      var oBanfn = oFd.Banfn;

      if (oBanfn && Array.isArray(oBanfn.ranges) && oBanfn.ranges.length) {
        var r0 = oBanfn.ranges[0] || {};
        sBanfn = r0.value1 || r0.low || r0.value || "";
      }

      sBanfn = String(sBanfn || "").trim();
      var bHadWildcardBanfn = sBanfn.indexOf("*") >= 0;
      if (sBanfn) {
        sBanfn = sBanfn.replace(/\*/g, "").trim();
      }

      var aFilters = Array.isArray(aSfbFilters) ? aSfbFilters.slice() : [];

      // Banfn-Filter nur dann ersetzen, wenn der User Wildcards genutzt hat

      if (bHadWildcardBanfn && sBanfn) {
        aFilters = aFilters.filter(function (f) {
          return !(f && f.sPath === "Banfn");
        });
        aFilters.push(new sap.ui.model.Filter("Banfn", sap.ui.model.FilterOperator.Contains, sBanfn));
      }

      // 5) Custom-Control Inputs zusätzlich filtern (sonst werden sie nicht berücksichtigt)
      var addContainsFromInput = function (sInputId, sPath) {
        var oInp = this.byId(sInputId);
        if (!oInp || !oInp.getValue) {
          return;
        }
        var sVal = String(oInp.getValue() || "").trim();
        if (!sVal) {
          return;
        }
        sVal = sVal.replace(/\*/g, "").trim();
        if (!sVal) {
          return;
        }
        aFilters.push(new sap.ui.model.Filter(sPath, sap.ui.model.FilterOperator.Contains, sVal));
      }.bind(this);

      addContainsFromInput("sfbCurrency", "Waers");
      addContainsFromInput("sfbSupplier", "Lifnr");
      addContainsFromInput("sfbStatusWe", "ZmmWebsStatusWe");

      // 6) Filter zurückgeben
      mParams.filters = aFilters;

    },


    onValueHelpCurrency: function (oEvent) {
      var oView = this.getView();
      var oODataModel = this.getOwnerComponent().getModel();
      this._oCurrActiveInput = this.byId("sfbCurrency");

      if (!this._oCurrJsonModel) {
        this._oCurrJsonModel = new sap.ui.model.json.JSONModel({ results: [] });
        oView.setModel(this._oCurrJsonModel, "vhCurrPR");
      }

      var openDialog = function () {
        if (!this._oCurrVH) {
          this._oCurrVH = new sap.m.SelectDialog({
            title: this.getOwnerComponent().getModel("i18n").getResourceBundle().getText("vh.currency.title"),
            items: {
              path: "vhCurrPR>/results",
              template: new sap.m.StandardListItem({ title: "{vhCurrPR>Waers}" })
            },
            search: function (oEvt) {
              var sValue = (oEvt.getParameter("value") || "").trim().toLowerCase();
              this._applyCurrencySearchFilterPR(sValue);
            }.bind(this),
            confirm: function (oEvt) {
              var oSel = oEvt.getParameter("selectedItem");
              if (!oSel) { return; }
              var oObj = oSel.getBindingContext("vhCurrPR").getObject();
              var sWaers = String(oObj.Waers || "").trim();
              if (this._oCurrActiveInput) {
                this._oCurrActiveInput.setValue(sWaers);
              }
              this._triggerPrSearch();
            }.bind(this),
            cancel: function () { }
          });
          oView.addDependent(this._oCurrVH);
        }

        var sCurrent = (this._oCurrActiveInput.getValue() || "").trim();
        this._oCurrVH.open(sCurrent);
        this._applyCurrencySearchFilterPR(sCurrent);
      }.bind(this);

      var aCached = this._oCurrJsonModel.getProperty("/results") || [];
      if (aCached.length > 0) {
        openDialog();
        return;
      }

      oODataModel.read("/IsoCurcSet", {
        urlParameters: { "$select": "Waers", "$top": "5000" },
        success: function (oData) {
          var a = (oData && oData.results) ? oData.results : [];
          a = a.map(function (x) {
            var o = Object.assign({}, x);
            o.__waers = String(o.Waers || "").toLowerCase();
            return o;
          });
          this._oCurrJsonModel.setProperty("/results", a);
          openDialog();
        }.bind(this),
        error: function (oErr) {
          sap.m.MessageToast.show(this.getOwnerComponent().getModel("i18n").getResourceBundle().getText("vh.currency.loadError"));
          console.log(oErr);
        }
      });
    },

    _applyCurrencySearchFilterPR: function (sValue) {
      if (!this._oCurrVH) { return; }
      var s = String(sValue || "").trim().toLowerCase();
      var oBinding = this._oCurrVH.getBinding("items");
      if (!oBinding) { return; }

      if (!s) {
        oBinding.filter([]);
        return;
      }

      oBinding.filter([
        new sap.ui.model.Filter("__waers", sap.ui.model.FilterOperator.Contains, s)
      ], "Application");
    },


    onValueHelpSupplier: function (oEvent) {
      var oView = this.getView();
      var oODataModel = this.getOwnerComponent().getModel();
      this._oSuppActiveInput = this.byId("sfbSupplier");

      if (!this._oSuppJsonModel) {
        this._oSuppJsonModel = new sap.ui.model.json.JSONModel({ results: [] });
        oView.setModel(this._oSuppJsonModel, "vhSuppPR");
      }

      var openDialog = function () {
        if (!this._oSuppVH) {
          this._oSuppVH = new sap.m.SelectDialog({
            title: this.getOwnerComponent().getModel("i18n").getResourceBundle().getText("vh.supplier.title"),
            items: {
              path: "vhSuppPR>/results",
              template: new sap.m.StandardListItem({
                title: "{vhSuppPR>Sortl}",
                description: "{vhSuppPR>Lifnr}"
              })
            },
            search: function (oEvt) {
              var sValue = (oEvt.getParameter("value") || "").trim().toLowerCase();
              this._applySupplierSearchFilterPR(sValue);
            }.bind(this),
            confirm: function (oEvt) {
              var oSel = oEvt.getParameter("selectedItem");
              if (!oSel) { return; }
              var oObj = oSel.getBindingContext("vhSuppPR").getObject();
              var sLifnr = String(oObj.Lifnr || "").trim();
              if (this._oSuppActiveInput) {
                this._oSuppActiveInput.setValue(sLifnr);
              }
              this._triggerPrSearch();
            }.bind(this),
            cancel: function () { }
          });

          oView.addDependent(this._oSuppVH);
        }

        var sCurrent = (this._oSuppActiveInput.getValue() || "").trim();
        this._oSuppVH.open(sCurrent);
        this._applySupplierSearchFilterPR(sCurrent);
      }.bind(this);

      var aCached = this._oSuppJsonModel.getProperty("/results") || [];
      if (aCached.length > 0) {
        openDialog();
        return;
      }

      oODataModel.read("/KredaSet", {
        urlParameters: { "$select": "Lifnr,Sortl,Mcod1", "$top": "5000" },
        success: function (oData) {
          var a = (oData && oData.results) ? oData.results : [];
          a = a.map(function (x) {
            var o = Object.assign({}, x);
            o.__lifnr = String(o.Lifnr || "").toLowerCase();
            o.__sortl = String(o.Sortl || "").toLowerCase();
            o.__mcod1 = String(o.Mcod1 || "").toLowerCase();
            return o;
          });
          this._oSuppJsonModel.setProperty("/results", a);
          openDialog();
        }.bind(this),
        error: function (oErr) {
          sap.m.MessageToast.show(this.getOwnerComponent().getModel("i18n").getResourceBundle().getText("vh.supplier.loadError"));
          console.log(oErr);
        }
      });
    },

    _applySupplierSearchFilterPR: function (sValue) {
      if (!this._oSuppVH) { return; }
      var s = String(sValue || "").trim().toLowerCase();
      var oBinding = this._oSuppVH.getBinding("items");
      if (!oBinding) { return; }

      if (!s) {
        oBinding.filter([]);
        return;
      }

      oBinding.filter([
        new sap.ui.model.Filter({
          filters: [
            new sap.ui.model.Filter("__lifnr", sap.ui.model.FilterOperator.Contains, s),
            new sap.ui.model.Filter("__sortl", sap.ui.model.FilterOperator.Contains, s),
            new sap.ui.model.Filter("__mcod1", sap.ui.model.FilterOperator.Contains, s)
          ],
          and: false
        })
      ], "Application");
    },


    // Status Wareneingang: ValueHelp wie Lieferant (JSON-Cache + lokale Suche)
    onValueHelpStatusWe: function (oEvent) {
      var oView = this.getView();
      var oODataModel = this.getOwnerComponent().getModel();
      var oInput = oEvent.getSource();
      this._oStatusWeActiveInput = oInput;

      if (!this._oStatusWeJsonModel) {
        this._oStatusWeJsonModel = new sap.ui.model.json.JSONModel({ results: [] });
        oView.setModel(this._oStatusWeJsonModel, "vhStatusWe");
      }

      var openDialog = function () {
        if (!this._oStatusWeVH) {
          this._oStatusWeVH = new sap.m.SelectDialog({
            title: this.getOwnerComponent().getModel("i18n").getResourceBundle().getText("vh.statusWe.title"),
            items: {
              path: "vhStatusWe>/results",
              template: new sap.m.StandardListItem({
                title: "{vhStatusWe>code}",
                description: "{vhStatusWe>text}"
              })
            },
            search: function (oEvt) {
              var sValue = (oEvt.getParameter("value") || "").trim().toLowerCase();
              this._applyStatusWeSearchFilter(sValue);
            }.bind(this),
            confirm: function (oEvt) {
              var oSel = oEvt.getParameter("selectedItem");
              if (!oSel || !this._oStatusWeActiveInput) { return; }

              var oObj = oSel.getBindingContext("vhStatusWe").getObject();
              var sCode = String(oObj.code || "").trim();

              // Filterfeld befüllen (SmartFilterBar liest den Wert aus dem Input)
              this._oStatusWeActiveInput.setValue(sCode);
            }.bind(this),
            cancel: function () { }
          });

          oView.addDependent(this._oStatusWeVH);
        }

        var sCurrent = (oInput.getValue() || "").trim();
        this._oStatusWeVH.open(sCurrent);
        this._applyStatusWeSearchFilter(sCurrent);
      }.bind(this);

      // Wenn schon geladen -> direkt öffnen
      var aCached = this._oStatusWeJsonModel.getProperty("/results") || [];
      if (aCached.length > 0) {
        openDialog();
        return;
      }

      // EntitySet-Pfad ermitteln (aus Metadaten, ohne Annahmen)
      this._resolveStatusWeEntitySetPath().then(function (sPath) {
        oODataModel.read(sPath, {
          urlParameters: { "$top": "5000" },
          success: function (oData) {
            var a = (oData && oData.results) ? oData.results : [];

            // Robust mappen (weil Propertynamen je nach Service unterschiedlich sein können)
            a = a.map(function (x) {
              var sCode =
                x.ZmmDeWebsStatusWe ||
                x.ZmmWebsStatusWe ||
                x.StatusWe ||
                x.STATUS_WE ||
                x.Code ||
                "";

              var sText =
                x.ZmmDeWebsStatusWeBez ||
                x.ZmmWebsStatusWeBez ||
                x.StatusWeBez ||
                x.STATUS_WE_BEZ ||
                x.Text ||
                "";

              sCode = String(sCode || "").trim();
              sText = String(sText || "").trim();

              var o = Object.assign({}, x);
              o.code = sCode;
              o.text = sText;

              o.__code = sCode.toLowerCase();
              o.__text = sText.toLowerCase();
              return o;
            });

            // Optional: leere Codes rausfiltern
            a = a.filter(function (x) { return (x.code || "").trim().length > 0; });

            this._oStatusWeJsonModel.setProperty("/results", a);
            openDialog();
          }.bind(this),
          error: function (oErr) {
            sap.m.MessageToast.show(this.getOwnerComponent().getModel("i18n").getResourceBundle().getText("vh.statusWe.loadError"));
            console.log(oErr);
          }
        });
      }.bind(this)).catch(function (e) {
        sap.m.MessageToast.show(this.getOwnerComponent().getModel("i18n").getResourceBundle().getText("vh.statusWe.entitySetNotFound"));
        console.log(e);
      });
    },


    // Case-insensitive Suche (Teilstring) über normalisierte Hilfsfelder
    _applyStatusWeSearchFilter: function (sValue) {
      if (!this._oStatusWeVH) { return; }

      var s = String(sValue || "").trim().toLowerCase();
      var oBinding = this._oStatusWeVH.getBinding("items");
      if (!oBinding) { return; }

      if (!s) {
        oBinding.filter([]);
        return;
      }

      oBinding.filter([
        new sap.ui.model.Filter({
          filters: [
            new sap.ui.model.Filter("__code", sap.ui.model.FilterOperator.Contains, s),
            new sap.ui.model.Filter("__text", sap.ui.model.FilterOperator.Contains, s)
          ],
          and: false
        })
      ], "Application");
    },


    // Ermittelt den richtigen EntitySet-Pfad aus den Metadaten.
    // Dadurch musst du keinen Namen raten (und es bleibt stabil bei Service-Änderungen).
    _resolveStatusWeEntitySetPath: function () {
      var oModel = this.getOwnerComponent().getModel();
      var oMeta = oModel && oModel.getMetaModel ? oModel.getMetaModel() : null;

      var aCandidates = [
        "ZmmWebsShStWeSet",
        "ZmmWebsShStWe",
        "ZmmWebsStatusWeSet",
        "StatusWeSet"
      ];

      if (!oMeta || !oMeta.loaded) {
        // Fallback ohne Metadaten: erster Kandidat
        return Promise.resolve("/" + aCandidates[0]);
      }

      return oMeta.loaded().then(function () {
        var oCont = oMeta.getODataEntityContainer && oMeta.getODataEntityContainer();
        var aSets = (oCont && oCont.entitySet) ? oCont.entitySet : [];

        var sFound = "";
        aCandidates.some(function (sName) {
          var b = aSets.some(function (es) { return es && es.name === sName; });
          if (b) { sFound = sName; }
          return b;
        });

        if (sFound) {
          return "/" + sFound;
        }

        // Wenn keiner gefunden wurde: Fallback auf ersten Kandidaten
        return "/" + aCandidates[0];
      });
    },


    _triggerPrSearch: function () {
      var oSfb = this.byId("prFilterBar");
      if (oSfb && oSfb.search) {
        oSfb.search(); // liveMode ist true, aber nach ValueHelp-Auswahl ist das der sichere Trigger
      }
    },



    // Navigiert beim Press auf eine Tabellenzeile in die Detailroute purchaseRequestDetail mit Banfn aus dem BindingContext.
    onRowPress: function (oEvent) {
      var sBanfn = oEvent.getParameter("listItem").getBindingContext().getProperty("Banfn");
      this.getOwnerComponent().getRouter().navTo("purchaseRequestDetail", { banfn: sBanfn });
    },


    // Toggle-Logik für den Warenkorb-Button: nutzt bevorzugt toggleCart (falls vorhanden), sonst Fallback 
    // über appView/cartOpen und Hash-Sicherung (lastNonCartHash); öffnet per Nav zu cart und schließt 
    // per replaceHash oder Nav zu purchaseRequests.
    onCartButtonPress: function () {
      if (typeof this.toggleCart === "function") {
        this.toggleCart();
        return;
      }

      // Fallback, falls PurchaseRequests nicht von BaseController erbt:
      var oAppView = this.getOwnerComponent().getModel("appView");
      if (!oAppView) { return; }

      var bOpen = !!oAppView.getProperty("/cartOpen");
      if (bOpen) {
        oAppView.setProperty("/cartOpen", false);
        var sBackHash = oAppView.getProperty("/lastNonCartHash");
        if (sBackHash) {
          sap.ui.core.routing.HashChanger.getInstance().replaceHash(sBackHash);
        } else {
          this.getOwnerComponent().getRouter().navTo("purchaseRequests", {}, true);
        }
      } else {
        var sHash = sap.ui.core.routing.HashChanger.getInstance().getHash() || "";
        var bIsCartHash = sHash === "cart" || sHash.endsWith("/cart") || sHash.indexOf("purchaseRequests/cart") === 0;
        if (!bIsCartHash) {
          oAppView.setProperty("/lastNonCartHash", sHash);
        }
        oAppView.setProperty("/cartOpen", true);
        this.getOwnerComponent().getRouter().navTo("cart", {}, false);
      }
    }


  });
});

