sap.ui.define([
  "./BaseController",
  "../model/formatter",
  "sap/ui/Device",
  "sap/ui/model/Filter",
  "sap/ui/model/FilterOperator",
  "sap/ui/model/json/JSONModel",
  "sap/ui/core/Fragment"
], (BaseController, formatter, Device, Filter, FilterOperator, JSONModel, Fragment) => {
  "use strict";

  return BaseController.extend("diehlwebshop.controller.Category", {
    formatter: formatter,

    _iLowFilterPreviousValue: 0,
    _iHighFilterPreviousValue: 5000,
    onInit: function () {
      var oViewModel = new JSONModel({
        Suppliers: []
      });
      this.getView().setModel(oViewModel, "view");


      var oComponent = this.getOwnerComponent();
      this._oRouter = oComponent.getRouter();
      this._oRouter.getRoute("category").attachMatched(this._loadCategories, this);
      this._oRouter.getRoute("product").attachMatched(this._loadCategories, this);
      this._oRouter.getRoute("productCart").attachMatched(this._loadCategories, this);

      this._oRouter.getRoute("category").attachMatched(function () {
        console.log("ROUTE MATCHED: category");
      }, this);



      var oTemplate = this.byId("bildUrlCategoryPage");
      if (oTemplate) {
        this._oProductTemplate = oTemplate.clone();
      } else {
        console.error("Template-Element 'bildUrlCategoryPage' nicht gefunden!");
      }
    },

    // Filtert die bereits gebundenen Listeneinträge clientseitig nach Suchbegriff (Produktname oder Lieferant) 
    // und blendet Items per setVisible ein oder aus.
onCategorySearch: function (oEvent) {
      const sQuery = oEvent.getSource().getValue().toLowerCase();
      const oList = this.byId("productListCategory");
      const aItems = oList.getItems();

      aItems.forEach(oItem => {
        const oContext = oItem.getBindingContext();
        if (oContext) {
          const oData = oContext.getObject();
          const sName = (oData.ZmmWebsArtBez || "").toLowerCase(); // Produktname
          const sSupplier = (oData.Wlief || "").toLowerCase();            // optional: Lieferant
          const bVisible = sName.includes(sQuery) || sSupplier.includes(sQuery);
          oItem.setVisible(bVisible);
        }
      });
    },




    // Lädt/aktualisiert die Kategorieansicht bei Routenwechsel: setzt Layout abhängig vom Cart-Status, 
    // aktualisiert Titel und Lieferantenliste, selektiert optional ein Deep-Link-Produkt und 
    // bindet die Artikel-Liste nur neu, wenn die Kategorie tatsächlich wechselt.
_loadCategories: function (oEvent) {
      const oAV = this.getOwnerComponent().getModel("appView");
      const oModel = this.getModel();
      const oList = this.byId("productListCategory");

      const sId = oEvent.getParameter("arguments").id;
      this._sProductId = oEvent.getParameter("arguments").productId || null;

      this._updateCategoryTitle(sId);
      this._loadSuppliers();

      const bCartOpen = !!(oAV && oAV.getProperty("/cartOpen"));
      if (oAV) {
        oAV.setProperty("/layout", bCartOpen ? "ThreeColumnsMidExpanded" : "TwoColumnsMidExpanded");
      }


      // --------------------------------------------
      // Wenn gleiche Kategorie + Binding existiert, NICHT neu binden
      // (sonst werden Items neu gerendert und Icons/Bilder laden neu)
      // --------------------------------------------
      const sLastId = this._sLastCategoryId;
      const bSameCategory = sLastId && String(sLastId) === String(sId);
      const oExistingBinding = oList && oList.getBinding("items");

      if (bSameCategory && oExistingBinding) {
        if (this._sProductId && oList) {
          const aItems = oList.getItems();
          aItems.some(function (it) {
            const ctx = it.getBindingContext();
            const hit = ctx && ctx.getProperty("ZmmWebsArtikelId") === this._sProductId;
            if (hit) { oList.setSelectedItem(it); }
            return hit;
          }.bind(this));
        }
        return;
      }

      // ab hier: neue kategorie -> neu binden
      this._sLastCategoryId = sId;

      // --------------------------------------------
      // ALT (bleibt): altes binding lösen und busy setzen
      // --------------------------------------------
      if (oList) { oList.unbindItems(); oList.setBusy(true); }

      oModel.metadataLoaded().then(function () {
        if (!this._oProductTemplate) {
          jQuery.sap.log.error("Kein gespeichertes Template vorhanden!");
          oList.setBusy(false);
          return;
        }

        const fnOnce = (e) => {
          oModel.detachRequestSent(fnOnce);
          const p = e.getParameters && e.getParameters();
        };
        oModel.attachRequestSent(fnOnce);

        oList.bindItems({
          path: "/ArtikelSet",
          filters: [new sap.ui.model.Filter("ZmmWebsKatId", sap.ui.model.FilterOperator.EQ, sId)],
          parameters: { operationMode: "Server" },
          template: this._oProductTemplate.clone(),
          templateShareable: false
        });

        const oBinding = oList.getBinding("items");
        if (oBinding) {
          oBinding.attachDataReceived(function () {
            oList.setBusy(false);

            const a = oList.getItems().map(it => {
              const o = it.getBindingContext()?.getObject();
              return {
                id: o?.ZmmWebsArtikelId,
                docId: o?.ZmmWebsDocId
              };
            });
            console.table(a);

            if (this._sProductId) {
              const aItems = oList.getItems();
              aItems.some(function (it) {
                const ctx = it.getBindingContext();
                const hit = ctx && ctx.getProperty("ZmmWebsArtikelId") === this._sProductId;
                if (hit) { oList.setSelectedItem(it); }
                return hit;
              }.bind(this));
            }
          }.bind(this));
        } else {
          oList.setBusy(false);
        }
      }.bind(this));
    },



    // Liest alle Artikel, extrahiert eindeutige Lieferantennamen, sortiert sie 
    // und schreibt sie ins ViewModel; setzt optional die Vergleichsauswahl zurück und behandelt Fehlerfälle.
_loadSuppliers: function () {
      var oModel = this.getModel();

      oModel.read("/ArtikelSet", {
        success: function (oData) {
          var aArticles = (oData && oData.results) || [];

          var aNames = aArticles
            .map(function (oArt) {
              return (oArt.Lieferant || oArt.Wlief || "").trim();
            })
            .filter(Boolean);

          var aUniqueSorted = Array.from(new Set(aNames)).sort(function (a, b) {
            return a.localeCompare(b, "de");
          });

          var aSupplierObjects = aUniqueSorted.map(function (sName) {
            return {
              Lieferant: sName,
              SupplierName: sName
            };
          });

          this.getModel("view").setProperty("/Suppliers", aSupplierObjects);
        }.bind(this),

        error: function (oErr) {
          jQuery.sap.log.error("Lieferanten konnten nicht geladen werden", oErr, "diehlwebshop.controller.Category");
          this.getModel("view").setProperty("/Suppliers", []);
        }.bind(this)
      });

      if (this._clearComparison) {
        this._clearComparison();
      }
    },



    // Reagiert auf Auswahl in der Produktliste und delegiert zur Anzeige der Produktdetails.
onProductListSelect: function (oEvent) {
      var oList = this.byId("productListCategory");
      var aListItems = oList.getItems();
      aListItems.some(function (oItem) {
        if (oItem.getBindingContext().getPath() === "/ArtikelSet('" + this._sProductId + "')") {
          oList.setSelectedItem(oItem);
          return true;
        }
      }.bind(this));
    },

    /**
     * @param {sap.ui.base.Event} oEvent the list select event
     */
// Reagiert auf Auswahl in der Produktliste und delegiert zur Anzeige der Produktdetails.
onProductListSelect: function (oEvent) {
      this._showProduct(oEvent);
    },

    /**
     * @param {sap.ui.base.Event} oEvent the sap.m.ObjectListItem press event
     */


    // Öffnet die Produktdetailansicht für das ausgewählte Item (aus Selection oder Press), 
    // passt das Layout abhängig vom Cart-Status an und navigiert zur passenden Route (product oder productCart).
onProductDetails: function (oEvent) {
      const oItem = oEvent.getParameter("listItem") || oEvent.getSource();
      const oCtx = oItem && oItem.getBindingContext();
      if (!oCtx) { return; }

      const oObj = oCtx.getObject();
      const sCategoryId = String(oObj.ZmmWebsKatId);
      const sProductId = String(oObj.ZmmWebsArtikelId);

      const oAV = this.getOwnerComponent().getModel("appView");
      const bCartVisible = oAV && (oAV.getProperty("/layout") || "").startsWith("Three");
      if (oAV) {
        const bCartOpen = !!oAV.getProperty("/cartOpen");
        oAV.setProperty("/layout", bCartOpen ? "ThreeColumnsMidExpanded" : "TwoColumnsMidExpanded");
      }

      this._oRouter.navTo(bCartVisible ? "productCart" : "product", {
        id: sCategoryId,
        productId: sProductId
      }, !sap.ui.Device.system.phone);
    },




    /** 
     * @param {sap.ui.base.Event} oEvent the press event of the sap.m.Button
     * @private
     */
    // Baut aus den ausgewählten Dialog-Filtern (Status, Preisbereich, Lieferant) UI5-Filter zusammen, 
    // wendet sie auf das List-Binding an und zeigt/aktualisiert die InfoToolbar 
    // mit einer textuellen Filter-Zusammenfassung.
_applyFilter: function (oEvent) {
      var oList = this.byId("productListCategory"),
        oBinding = oList.getBinding("items"),
        aSelectedFilterItems = oEvent.getParameter("filterItems"),
        oCustomFilter = this.byId("categoryFilterDialog").getFilterItems()[1],
        oFilter,
        oCustomKeys = {},
        aFilters = [],
        aAvailableFilters = [],
        aPriceFilters = [],
        aSupplierFilters = [];

      if (oCustomFilter.getCustomControl().getAggregation("content")[0].getValue() !== oCustomFilter.getCustomControl().getAggregation("content")[0].getMin() ||
        oCustomFilter.getCustomControl().getAggregation("content")[0].getValue2() !== oCustomFilter.getCustomControl().getAggregation("content")[0].getMax()) {
        aSelectedFilterItems.push(oCustomFilter);
      }
      aSelectedFilterItems.forEach(function (oItem) {
        var sFilterKey = oItem.getProperty("key"),
          iValueLow,
          iValueHigh;
        switch (sFilterKey) {
          case "Available":
            // ALT: "Status"
            oFilter = new Filter("STATUS", FilterOperator.EQ, "A");
            aAvailableFilters.push(oFilter);
            break;

          case "OutOfStock":
            oFilter = new Filter("STATUS", FilterOperator.EQ, "O");
            aAvailableFilters.push(oFilter);
            break;

          case "Discontinued":
            oFilter = new Filter("STATUS", FilterOperator.EQ, "D");
            aAvailableFilters.push(oFilter);
            break;

          case "Price":
            iValueLow = oItem.getCustomControl().getAggregation("content")[0].getValue();
            iValueHigh = oItem.getCustomControl().getAggregation("content")[0].getValue2();
            // ALT: "Price"
            oFilter = new Filter("Bapre", FilterOperator.BT, iValueLow, iValueHigh);
            aPriceFilters.push(oFilter);
            oCustomKeys["priceKey"] = { Price: true };
            break;

          default:
            // ALT: "SupplierName"
            oFilter = new Filter("Wlief", FilterOperator.EQ, sFilterKey);
            aSupplierFilters.push(oFilter);
        }
      });
      if (aAvailableFilters.length > 0) {
        aFilters.push(new Filter({ filters: aAvailableFilters }));
      }
      if (aPriceFilters.length > 0) {
        aFilters.push(new Filter({ filters: aPriceFilters }));
      }
      if (aSupplierFilters.length > 0) {
        aFilters.push(new Filter({ filters: aSupplierFilters }));
      }
      oFilter = new Filter({ filters: aFilters, and: true });
      if (aFilters.length > 0) {
        oBinding.filter(oFilter);
        this.byId("categoryInfoToolbar").setVisible(true);
        var sText = this.getResourceBundle().getText("filterByText") + " ";
        var sSeparator = "";
        var oFilterKey = oEvent.getParameter("filterCompoundKeys");
        var oKeys = Object.assign(oFilterKey, oCustomKeys);
        for (var key in oKeys) {
          if (oKeys.hasOwnProperty(key)) {
            sText = sText + sSeparator + this.getResourceBundle().getText(key, [this._iLowFilterPreviousValue, this._iHighFilterPreviousValue]);
            sSeparator = ", ";
          }
        }
        this.byId("categoryInfoToolbarTitle").setText(sText);
      } else {
        oBinding.filter(null);
        this.byId("categoryInfoToolbar").setVisible(false);
        this.byId("categoryInfoToolbarTitle").setText("");
      }
    },


    // Lädt den Filter-Dialog als Fragment lazy (einmalig), hängt ihn an die View und öffnet ihn.
onFilter: function () {
      if (!this._pCategoryFilterDialog) {
        this._pCategoryFilterDialog = Fragment.load({
          id: this.getView().getId(),
          name: "sap.ui.demo.cart.view.CategoryFilterDialog",
          controller: this
        }).then(function (oDialog) {
          this.getView().addDependent(oDialog);
          oDialog.addStyleClass(this.getOwnerComponent().getContentDensityClass());
          return oDialog;
        }.bind(this));
      }
      this._pCategoryFilterDialog.then(function (oDialog) {
        oDialog.open();
      });
    },

    /**
     * 
     * @param {sap.ui.base.Event} oEvent the press event of the sap.m.Button
     */
    // Übernimmt den aktuellen RangeSlider-Stand als „letzte Werte“ und wendet die Filterauswahl über _applyFilter an.
handleConfirm: function (oEvent) {
      var oCustomFilter = this.byId("categoryFilterDialog").getFilterItems()[1];
      var oSlider = oCustomFilter.getCustomControl().getAggregation("content")[0];
      this._iLowFilterPreviousValue = oSlider.getValue();
      this._iHighFilterPreviousValue = oSlider.getValue2();
      this._applyFilter(oEvent);
    },


    // Stellt den RangeSlider im Filterdialog auf die zuletzt bestätigten Werte zurück und aktualisiert 
    // den FilterCount des Custom-Filters.
handleCancel: function () {
      var oCustomFilter = this.byId("categoryFilterDialog").getFilterItems()[1];
      var oSlider = oCustomFilter.getCustomControl().getAggregation("content")[0];
      oSlider.setValue(this._iLowFilterPreviousValue).setValue2(this._iHighFilterPreviousValue);
      if (this._iLowFilterPreviousValue > oSlider.getMin() || this._iHighFilterPreviousValue !== oSlider.getMax()) {
        oCustomFilter.setFilterCount(1);
      } else {
        oCustomFilter.setFilterCount(0);
      }
    },


    /**
     * 
     * @param {sap.ui.base.Event} oEvent the change event of the sap.m.RangeSlider
     */
    // Aktualisiert während der Slider-Bewegung den FilterCount des Custom-Filters abhängig davon,
    //  ob der Bereich vom Min/Max abweicht.
handleChange: function (oEvent) {
      var oCustomFilter = this.byId("categoryFilterDialog").getFilterItems()[1];
      var oSlider = oCustomFilter.getCustomControl().getAggregation("content")[0];
      var iLowValue = oEvent.getParameter("range")[0];
      var iHighValue = oEvent.getParameter("range")[1];
      if (iLowValue !== oSlider.getMin() || iHighValue !== oSlider.getMax()) {
        oCustomFilter.setFilterCount(1);
      } else {
        oCustomFilter.setFilterCount(0);
      }
    },


    // Setzt den Preis-RangeSlider im Filterdialog auf Min/Max zurück und entfernt die Kennzeichnung (FilterCount) 
    // für den Custom-Filter.
handleResetFilters: function () {
      var oCustomFilter = this.byId("categoryFilterDialog").getFilterItems()[1];
      var oSlider = oCustomFilter.getCustomControl().getAggregation("content")[0];
      oSlider.setValue(oSlider.getMin());
      oSlider.setValue2(oSlider.getMax());
      oCustomFilter.setFilterCount(0);
    },

    /**
     * 
     * @param {sap.ui.base.Event} oEvent the press event of the link text in sap.m.ObjectListItem
     */
    // Navigiert zur Vergleichsansicht und setzt item1/item2 anhand der aktuellen Vergleichsauswahl 
    // im comparison-Model sowie des geklickten Produkts.
compareProducts: function (oEvent) {
      var oProduct = oEvent.getSource().getBindingContext().getObject();
      var sItem1Id = this.getModel("comparison").getProperty("/item1");
      var sItem2Id = this.getModel("comparison").getProperty("/item2");
      this._oRouter.navTo("comparison", {
        id: oProduct.Category,
        item1Id: (sItem1Id ? sItem1Id : oProduct.ProductId),
        item2Id: (sItem1Id && sItem1Id != oProduct.ProductId ? oProduct.ProductId : sItem2Id)
      }, true);
    },

    // Liest den Kategorie-Titel (ZmmWebsKatBez) per Key-Read aus KatalogSet und schreibt 
    // ihn ins ViewModel; fällt bei Fehler auf einen i18n-Defaulttitel zurück.
_updateCategoryTitle: function (sCategoryId) {
      const oModel = this.getModel();

      this.getModel("view").setProperty("/categoryTitle", "");

      const sPath = "/" + oModel.createKey("KatalogSet", {
        ZmmWebsKatId: String(sCategoryId || "").trim()
      });

      oModel.read(sPath, {
        urlParameters: { "$select": "ZmmWebsKatBez" },
        success: function (oData) {
          const sTitle = (oData && oData.ZmmWebsKatBez) ? String(oData.ZmmWebsKatBez) : "";
          this.getModel("view").setProperty("/categoryTitle", sTitle);
        }.bind(this),
        error: function () {
          this.getModel("view").setProperty(
            "/categoryTitle",
            this.getResourceBundle().getText("Category_title")
          );
        }.bind(this)
      });
    },


    /**
     * 
     * @override
     */
    onBack: function () {
      this.getRouter().navTo("categories");
    }
  });
});