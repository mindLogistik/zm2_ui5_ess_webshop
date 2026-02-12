sap.ui.define([
	"./BaseController",
	"../model/formatter",
	"sap/ui/model/Filter",
	"sap/ui/model/FilterOperator",
	"sap/ui/Device",
	"sap/ui/core/Fragment",
	"sap/m/SelectDialog",
	"sap/m/StandardListItem"
], (BaseController, formatter, Filter, FilterOperator, Device, Fragment, SelectDialog, StandardListItem) => {

	"use strict";

	return BaseController.extend("diehlwebshop.controller.Home", {
		formatter: formatter,
		onInit: function () {
			const oComponent = this.getOwnerComponent();

			// router
			this._router = oComponent.getRouter();
			this._router.getRoute("categories").attachMatched(this._onRouteMatched, this);

			// freitext-model
			this.getView().setModel(new sap.ui.model.json.JSONModel({ items: [] }), "freitext");

			const oAppView = oComponent.getModel("appView");
			if (oAppView && oAppView.getProperty("/cartOpen") == null) {
				oAppView.setProperty("/cartOpen", false);
			}

			this._router.attachRouteMatched(function (oEvent) {
				const sRouteName = oEvent.getParameter("name");
				const oAV = this.getOwnerComponent().getModel("appView");
				if (!oAV) { return; }

				const sPrevRouteName = oAV.getProperty("/_lastRouteName") || "";

				// Letzte Nicht-Cart-Route merken (für korrektes Zurücknavigieren beim Cart-Schließen)
				const bIsCartRoute =
					(sRouteName === "cart" || sRouteName === "productCart" || sRouteName === "purchaseRequestsCart");

				if (!bIsCartRoute) {
					oAV.setProperty("/lastNonCartRouteName", sRouteName);
					oAV.setProperty("/lastNonCartRouteArgs", oEvent.getParameter("arguments") || {});
				}

				// Route-Historie (nur Name) fortschreiben
				oAV.setProperty("/_lastRouteName", sRouteName);

				// Wenn aus Detail (product/category) zurück zu PR, Kategorien links zurücksetzen
				const bIsPR = (sRouteName === "purchaseRequests" || sRouteName === "purchaseRequestsCart");
				const bCameFromDetail = (sPrevRouteName === "product" || sPrevRouteName === "category" || sPrevRouteName === "checkoutWizard");
				if (bIsPR && bCameFromDetail && typeof this._resetCategoriesToRoot === "function") {
					this._resetCategoriesToRoot();
				}

				// Wenn Cart -> PR: Rebind der PR-Tabelle einmalig unterdrücken
				if (sPrevRouteName === "cart" && bIsPR) {
					oAV.setProperty("/skipNextPurchaseRequestsRebind", true);
				}

				// Layout-Steuerung
				if (sRouteName === "checkoutWizard") {
					oAV.setProperty("/layout", "MidColumnFullScreen");
					oAV.setProperty("/cartOpen", false);
					return;
				}

				if (bIsCartRoute) {
					oAV.setProperty("/layout", "ThreeColumnsMidExpanded");
					oAV.setProperty("/cartOpen", true);
				} else {
					oAV.setProperty("/layout", "TwoColumnsMidExpanded");
					oAV.setProperty("/cartOpen", false);
				}
			}, this);





			// Kategorienavigation
			const oCatNavModel = new sap.ui.model.json.JSONModel({
				currentParentId: "",
				pathStack: [],
				breadcrumbText: ""
			});
			this.getView().setModel(oCatNavModel, "catnav");

			this._autoOpenPurchaseRequestsIfAny();

			const sHash = sap.ui.core.routing.HashChanger.getInstance().getHash() || "";
			if (!sHash || sHash === "categories") {
				this._router.navTo("purchaseRequestsCart", {}, true);
			}

			// Initiale Filterung der Kategorieliste, sobald $metadata geladen ist
			const oModel = oComponent.getModel();
			oModel.metadataLoaded().then(function () {
				// Kleinen Tick warten, bis das binding steht
				setTimeout(function () {
					this._refreshCategoryList();
					this._loadOciCatalogs();
				}.bind(this), 0);
			}.bind(this));

		},


		// Optionale Auto-Navigation zur BANF-Übersicht, sobald das Backend Bestellanforderungen liefert 
		// (der eigentliche Read ist aktuell auskommentiert und dient als Vorlage/Guard für 501).
		_autoOpenPurchaseRequestsIfAny: function () {
			const oModel = this.getOwnerComponent().getModel();

			// Warten bis $metadata geladen ist, dann nur 1 Datensatz prüfen
			oModel.metadataLoaded().then(function () {
				/* oModel.read("/BestellanforderungSet", {            
					urlParameters: { "$top": 1 },
					success: function (oData) {
						const hasData = Array.isArray(oData && oData.results) && oData.results.length > 0;
						if (hasData && !this._bInitialLoadDone) {
							this._bInitialLoadDone = true;
							this.getOwnerComponent().getModel("appView").setProperty("/layout", "TwoColumnsMidExpanded");
							this.getOwnerComponent().getRouter().navTo("purchaseRequests");
						}
					}.bind(this),
					error: function (err) {
						// 501 = Backend-Methode noch nicht implementiert -> auf Home bleiben
						if (err && (err.statusCode === 501 || err.statusText === "Not Implemented")) {
							jQuery.sap.log.warning("BestellanforderungSet (GET_ENTITYSET) nicht implementiert – Navigation wird übersprungen.");
						} else {
							jQuery.sap.log.error("Read BestellanforderungSet fehlgeschlagen", err);
						}
					}.bind(this)
				}); */
			}.bind(this));
		},


		// Baut die OCI-Katalogliste aus der Kategoriehierarchie: findet den Ordner „Kataloge“, ermittelt 
		// dessen Kinder als externe Katalogeinträge und ergänzt immer einen Freitext-Eintrag als ersten Listeneintrag.
		_loadOciCatalogs: function () {
			const oOciModel = this.getOwnerComponent().getModel("ociCatalogs");
			const oModel = this.getOwnerComponent().getModel();

			if (!oOciModel || !oModel) {
				return;
			}

			oModel.read("/KatalogSet", {
				success: function (oData) {
					const aAll = (oData && oData.results) ? oData.results : [];

					const oFolder = aAll.find(x => String(x.ZmmWebsKatBez || "").toLowerCase() === "kataloge");
					if (!oFolder) {
						oOciModel.setData([{ type: "FREETEXT", katalogName: this.getResourceBundle().getText("freitextOpenDialogButtonText") }]);
						return;
					}

					const sFolderId = String(oFolder.ZmmWebsKatId || "");

					const aChildren = aAll
						.filter(x => String(x.ZmmWebsKatParentId || "") === sFolderId)
						.map(x => ({
							katalogName: String(x.ZmmWebsKatBez || ""),
							serviceId: String(x.WsiDescriptionText || "").trim()
						}));


					const aFinal = [
						{ type: "FREETEXT", katalogName: this.getResourceBundle().getText("freitextOpenDialogButtonText") },
						...aChildren
					];

					oOciModel.setData(aFinal);
				}.bind(this),
				error: function () {
					// Wenigstens Freitext anbieten
					oOciModel.setData([{ type: "FREETEXT", katalogName: this.getResourceBundle().getText("freitextOpenDialogButtonText") }]);
				}.bind(this)
			});
		},


		// Reagiert auf Klick in der BANF-Liste und zeigt eine einfache Info-Meldung mit BANF-Nummer 
		// (aktuell nur Toast, keine Navigation).
		onPurchaseRequestPress: function (oEvent) {
			var oItem = oEvent.getSource();
			var oContext = oItem.getBindingContext("purchaseRequest");
			var sBanfn = oContext.getProperty("Banfn");

			sap.m.MessageToast.show(this.getModel("i18n").getResourceBundle().getText("purchaseRequestDetailMessage", [sBanfn]));
		},


		// Setzt die Kategorienavigation (Breadcrumb/Stack) zurück auf Root, leert optional das Suchfeld, 
		// stellt die Sichtbarkeit von Kategorie- vs. Produktliste wieder her und aktualisiert die Kategorie-Filterung.
		_resetCategoriesToRoot: function () {
			const oCatNav = this.getView().getModel("catnav");
			if (!oCatNav) { return; }

			oCatNav.setProperty("/currentParentId", "");
			oCatNav.setProperty("/pathStack", []);
			oCatNav.setProperty("/breadcrumbText", "");

			// Optional: Suchfeld leeren, damit nicht versehentlich "Keine Produkte" über Suche entsteht
			const oSearch = this.byId("searchField");
			if (oSearch && oSearch.setValue) {
				oSearch.setValue("");
			}

			// Sicherstellen, dass Kategorie-Liste sichtbar ist
			const oProductList = this.byId("productHomeList");
			const oCategoryList = this.byId("categoryHomeList");
			if (oProductList && oProductList.setVisible) { oProductList.setVisible(false); }
			if (oCategoryList && oCategoryList.setVisible) { oCategoryList.setVisible(true); }

			this._refreshCategoryList();
		},


		// Filtert die gebundene Kategorie-Liste auf Root-Kategorien (ParentId leer/null) oder auf Kinder eines 
		// aktuellen ParentId aus dem catnav-Model.
		_refreshCategoryList: function () {
			const oList = this.byId("categoryHomeList");
			const oBinding = oList && oList.getBinding("items");
			if (!oBinding) return;

			const vParent = this.getView().getModel("catnav").getProperty("/currentParentId") || "";

			let oFilter;
			if (vParent === "") {
				oFilter = new sap.ui.model.Filter({
					and: false,
					filters: [
						new sap.ui.model.Filter("ZmmWebsKatParentId", sap.ui.model.FilterOperator.EQ, ""),
						new sap.ui.model.Filter("ZmmWebsKatParentId", sap.ui.model.FilterOperator.EQ, null)
					]
				});
			} else {
				oFilter = new sap.ui.model.Filter("ZmmWebsKatParentId", sap.ui.model.FilterOperator.EQ, vParent);
			}

			oBinding.filter([oFilter], "Application");
		},


		// Handler beim Betreten der categories-Route: stellt bei kleinem Screen One-Column-Layout ein, 
		// refresht Kategorien und springt automatisch eine Ebene hoch, wenn die aktuelle Ebene keine Items liefert (Leaf-Guard gegen Endlosschleifen).
		_onRouteMatched: function () {
			var bSmall = this.getModel("appView").getProperty("/smallScreenMode");
			if (bSmall) {
				this._setLayout("One");
			}

			setTimeout(function () {
				this._refreshCategoryList();

				// Wenn wir aus einer Leaf-Kategorie zurückkommen (keine Kinder),
				// ist die Liste leer -> automatisch eine Ebene hochspringen.
				var oList = this.byId("categoryHomeList");
				var oCatNav = this.getView().getModel("catnav");
				if (!oList || !oCatNav) {
					return;
				}

				// Guard, damit wir nicht in eine Schleife laufen
				if (this._bAutoLevelUpOnce) {
					this._bAutoLevelUpOnce = false;
					return;
				}

				oList.attachEventOnce("updateFinished", function () {
					var aItems = oList.getItems() || [];
					var aStack = oCatNav.getProperty("/pathStack") || [];

					if (aItems.length === 0 && aStack.length > 0) {
						this._bAutoLevelUpOnce = true;
						this.onCategoryLevelUp();
					}
				}, this);
			}.bind(this), 0);
		},



		// Einfache clientseitige Suche in der aktuellen Kategorie-Liste, indem ListItems je nach Treffer im 
		// Titel ein- oder ausgeblendet werden.
		onSearch: function (oEvent) {
			var sQuery = (oEvent.getSource().getValue() || "").toLowerCase();

			var oList = this.byId("categoryHomeList");
			if (!oList) { return; }

			oList.getItems().forEach(function (oItem) {
				var sTitle =
					(typeof oItem.getTitle === "function" ? oItem.getTitle() : "") ||
					(oItem.getBindingContext() && oItem.getBindingContext().getProperty("ZmmWebsKatBez")) ||
					"";

				var bMatch = !sQuery || sTitle.toLowerCase().indexOf(sQuery) > -1;
				oItem.setVisible(bMatch);
			});
		},

		// Validiert die externe Materialnummer im Freitextdialog (max. 35 Zeichen) und setzt 
		// ValueState/ValueStateText passend.
		onExtMatnrLiveChange: function (oEvent) {
			const oInput = oEvent.getSource();
			const rb = this.getResourceBundle();

			const sVal = oInput.getValue() || "";
			if (sVal.length > 35) {
				oInput.setValueState("Error");
				oInput.setValueStateText(rb.getText("freitext.err.extMatnrTooLong", [35]));
			} else {
				oInput.setValueState("None");
				oInput.setValueStateText("");
			}
		},



		// Öffnet eine Währungs-Werthilfe mit JSON-Cache: lädt Währungen einmalig per OData, öffnet SelectDialog, 
		// unterstützt Suche und schreibt die Auswahl in das aktive Input-Feld.
		onValueHelpCurrency: function (oEvent) {
			var oView = this.getView();
			var oODataModel = this.getOwnerComponent().getModel();
			var oInput = oEvent.getSource();
			this._oCurrActiveInput = oInput;

			// JSON-Cache (einmalig)
			if (!this._oCurrJsonModel) {
				this._oCurrJsonModel = new sap.ui.model.json.JSONModel({ results: [] });
				oView.setModel(this._oCurrJsonModel, "vhCurr");
			}

			var openDialog = function () {
				if (!this._oCurrVH) {
					this._oCurrVH = new sap.m.SelectDialog({
						title: this.getResourceBundle().getText("home.vh.currency.title"),
						items: {
							path: "vhCurr>/results",
							template: new sap.m.StandardListItem({
								title: "{vhCurr>Waers}"
							})
						},
						search: function (oEvt) {
							var sValue = (oEvt.getParameter("value") || "").trim().toLowerCase();
							this._applyCurrencySearchFilter(sValue);
						}.bind(this),
						confirm: function (oEvt) {
							var oSel = oEvt.getParameter("selectedItem");
							if (!oSel) { return; }
							var oObj = oSel.getBindingContext("vhCurr").getObject();
							var sWaers = String(oObj.Waers || "").trim();
							if (this._oCurrActiveInput) {
								this._oCurrActiveInput.setValue(sWaers);
							}
						}.bind(this),
						cancel: function () { }
					});

					oView.addDependent(this._oCurrVH);
				}

				var sCurrent = (oInput.getValue() || "").trim();
				this._oCurrVH.open(sCurrent);

				// Vorfilter direkt anwenden (case-insensitive)
				this._applyCurrencySearchFilter(sCurrent);
			}.bind(this);

			// Wenn schon geladen: direkt öffnen
			var aCached = this._oCurrJsonModel.getProperty("/results") || [];
			if (aCached.length > 0) {
				openDialog();
				return;
			}

			// Einmalig laden (ohne Filter)
			oODataModel.read("/IsoCurcSet", {
				urlParameters: {
					"$select": "Waers",
					"$top": "5000"
				},
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
					sap.m.MessageToast.show(this.getResourceBundle().getText("home.vh.currency.loadError"));
					console.log(oErr);
				}
			});
		},

		// Wendet einen clientseitigen Suchfilter auf den Währungs-Dialog an (case-insensitive) über ein
		//  normalisiertes Hilfsfeld im JSON-Model.
		_applyCurrencySearchFilter: function (sValue) {
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


		// Öffnet eine Einkäufergruppen-Werthilfe: lädt Ekgrp/Eknam einmalig per OData in ein JSON-Model und 
		// bietet eine lokale Suche über Nummer oder Name, schreibt die Auswahl ins aktive Input-Feld.
		onValueHelpEkgrp: function (oEvent) {
			var oView = this.getView();
			var oODataModel = this.getOwnerComponent().getModel();
			var oInput = oEvent.getSource();
			this._oEkgrpActiveInput = oInput;

			// 1) Daten einmalig laden und in JSON puffern
			if (!this._oEkgrpJsonModel) {
				this._oEkgrpJsonModel = new sap.ui.model.json.JSONModel({ results: [] });
				oView.setModel(this._oEkgrpJsonModel, "vhEkgrp");
			}

			var openDialog = function () {
				if (!this._oEkgrpVH) {
					this._oEkgrpVH = new sap.m.SelectDialog({
						title: this.getResourceBundle().getText("home.vh.ekgrp.title"),
						items: {
							path: "vhEkgrp>/results",
							template: new sap.m.StandardListItem({
								title: "{vhEkgrp>Ekgrp}",
								description: "{vhEkgrp>Eknam}"
							})
						},
						search: function (oEvt) {
							var sValue = (oEvt.getParameter("value") || "").trim();
							var oBinding = oEvt.getSource().getBinding("items");
							if (!oBinding) { return; }

							if (!sValue) {
								oBinding.filter([]);
								return;
							}

							oBinding.filter([
								new sap.ui.model.Filter({
									filters: [
										new sap.ui.model.Filter("Ekgrp", sap.ui.model.FilterOperator.Contains, sValue),
										new sap.ui.model.Filter("Eknam", sap.ui.model.FilterOperator.Contains, sValue)
									],
									and: false
								})
							]);
						}.bind(this),
						confirm: function (oEvt) {
							var oSel = oEvt.getParameter("selectedItem");
							if (!oSel) { return; }
							var oObj = oSel.getBindingContext("vhEkgrp").getObject();
							var sEkgrp = String(oObj.Ekgrp || "").trim();
							if (this._oEkgrpActiveInput) {
								this._oEkgrpActiveInput.setValue(sEkgrp);
							}
						}.bind(this),
						cancel: function () { }
					});

					oView.addDependent(this._oEkgrpVH);
				}

				// Vorfilter mit aktuellem Wert
				var sCurrent = (oInput.getValue() || "").trim();
				var oBinding = this._oEkgrpVH.getBinding("items");
				if (oBinding) {
					oBinding.filter(sCurrent ? [
						new sap.ui.model.Filter({
							filters: [
								new sap.ui.model.Filter("Ekgrp", sap.ui.model.FilterOperator.Contains, sCurrent),
								new sap.ui.model.Filter("Eknam", sap.ui.model.FilterOperator.Contains, sCurrent)
							],
							and: false
						})
					] : []);
				}

				this._oEkgrpVH.open(sCurrent);
			}.bind(this);

			// Wenn schon geladen, direkt öffnen
			var aCached = this._oEkgrpJsonModel.getProperty("/results") || [];
			if (aCached.length > 0) {
				openDialog();
				return;
			}

			// Sonst einmal OData lesen
			oODataModel.read("/HT024MeSet", {
				urlParameters: {
					"$select": "Ekgrp,Eknam",
					"$top": "5000"
				},
				success: function (oData) {
					var a = (oData && oData.results) ? oData.results : [];
					this._oEkgrpJsonModel.setProperty("/results", a);
					openDialog();
				}.bind(this),
				error: function (oErr) {
					sap.m.MessageToast.show(this.getResourceBundle().getText("home.vh.ekgrp.loadError"));
					console.log(oErr);
				}
			});
		},



		// Öffnet eine Mengeneinheit-Werthilfe mit JSON-Cache: lädt Einheiten einmalig per OData, öffnet 
		// SelectDialog, unterstützt Suche und schreibt die Auswahl in das aktive Input-Feld.
		onValueHelpUnit: function (oEvent) {
			var oView = this.getView();
			var oODataModel = this.getOwnerComponent().getModel();
			var oInput = oEvent.getSource();
			this._oUnitActiveInput = oInput;

			// JSON-Cache (einmalig)
			if (!this._oUnitJsonModel) {
				this._oUnitJsonModel = new sap.ui.model.json.JSONModel({ results: [] });
				oView.setModel(this._oUnitJsonModel, "vhUnit");
			}

			var openDialog = function () {
				if (!this._oUnitVH) {
					this._oUnitVH = new sap.m.SelectDialog({
						title: this.getResourceBundle().getText("home.vh.unit.title"),
						items: {
							path: "vhUnit>/results",
							template: new sap.m.StandardListItem({
								title: "{vhUnit>Meins}"
							})
						},
						search: function (oEvt) {
							var sValue = (oEvt.getParameter("value") || "").trim().toLowerCase();
							this._applyUnitSearchFilter(sValue);
						}.bind(this),
						confirm: function (oEvt) {
							var oSel = oEvt.getParameter("selectedItem");
							if (!oSel) { return; }
							var oObj = oSel.getBindingContext("vhUnit").getObject();
							var sMeins = String(oObj.Meins || "").trim();
							if (this._oUnitActiveInput) {
								this._oUnitActiveInput.setValue(sMeins);
							}
						}.bind(this),
						cancel: function () { }
					});

					oView.addDependent(this._oUnitVH);
				}

				var sCurrent = (oInput.getValue() || "").trim();
				this._oUnitVH.open(sCurrent);

				// Vorfilter direkt anwenden (case-insensitive)
				this._applyUnitSearchFilter(sCurrent);
			}.bind(this);

			// Wenn schon geladen: direkt öffnen
			var aCached = this._oUnitJsonModel.getProperty("/results") || [];
			if (aCached.length > 0) {
				openDialog();
				return;
			}

			// Einmalig laden (ohne Filter)
			oODataModel.read("/WrfPohfMeinsSet", {
				urlParameters: {
					"$select": "Meins",
					"$top": "5000"
				},
				success: function (oData) {
					var a = (oData && oData.results) ? oData.results : [];
					a = a.map(function (x) {
						var o = Object.assign({}, x);
						o.__meins = String(o.Meins || "").toLowerCase();
						return o;
					});
					this._oUnitJsonModel.setProperty("/results", a);
					openDialog();
				}.bind(this),
				error: function (oErr) {
					sap.m.MessageToast.show(this.getResourceBundle().getText("home.vh.unit.loadError"));
					console.log(oErr);
				}
			});
		},

		// Wendet einen clientseitigen Suchfilter auf den Mengeneinheit-Dialog an (case-insensitive) über ein 
		// normalisiertes Hilfsfeld im JSON-Model.
		_applyUnitSearchFilter: function (sValue) {
			if (!this._oUnitVH) { return; }
			var s = String(sValue || "").trim().toLowerCase();
			var oBinding = this._oUnitVH.getBinding("items");
			if (!oBinding) { return; }

			if (!s) {
				oBinding.filter([]);
				return;
			}

			oBinding.filter([
				new sap.ui.model.Filter("__meins", sap.ui.model.FilterOperator.Contains, s)
			], "Application");
		},




		// Öffnet eine SAP-User-Werthilfe mit JSON-Cache: lädt User einmalig per OData, öffnet SelectDialog, 
		// unterstützt Suche und schreibt die Auswahl in das aktive Input-Feld.
		onValueHelpUser: function (oEvent) {
			var oView = this.getView();
			var oODataModel = this.getOwnerComponent().getModel();
			var oInput = oEvent.getSource();
			this._oUserActiveInput = oInput;

			// JSON-Cache (einmalig)
			if (!this._oUserJsonModel) {
				this._oUserJsonModel = new sap.ui.model.json.JSONModel({ results: [] });
				oView.setModel(this._oUserJsonModel, "vhUser");
			}

			var openDialog = function () {
				if (!this._oUserVH) {
					this._oUserVH = new sap.m.SelectDialog({
						title: this.getResourceBundle().getText("home.vh.user.title"),
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
							if (!oSel) { return; }

							var oObj = oSel.getBindingContext("vhUser").getObject();
							var sBname = String(oObj.Bname || "").trim();
							if (this._oUserActiveInput) {
								this._oUserActiveInput.setValue(sBname);
							}
						}.bind(this),
						cancel: function () { }
					});

					oView.addDependent(this._oUserVH);
				}

				var sCurrent = (oInput.getValue() || "").trim();
				this._oUserVH.open(sCurrent);

				// Vorfilter direkt anwenden (case-insensitive)
				this._applyUserSearchFilter(sCurrent);
			}.bind(this);

			// Wenn schon geladen: direkt öffnen
			var aCached = this._oUserJsonModel.getProperty("/results") || [];
			if (aCached.length > 0) {
				openDialog();
				return;
			}

			// Einmalig laden (ohne Filter)
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
					sap.m.MessageToast.show(this.getResourceBundle().getText("home.vh.user.loadError"));
					console.log(oErr);
				}
			});
		},

		// Wendet einen clientseitigen Suchfilter auf den User-Dialog an (case-insensitive) über ein 
		// normalisiertes Hilfsfeld im JSON-Model.
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




		// Liest die Freitext-Dialogfelder aus, setzt ValueStates zurück, validiert Pflichtfelder und Zahlenwerte, 
		// prüft externe Materialnummer, baut ein Freitext-Item (inkl. addText/AddText) und fügt es zentral 
		// über _addToCart dem Warenkorb hinzu; schließt anschließend den Dialog.
		onAddFreitextItem: function () {
			const v = (id) => this.byId(id);
			const rb = this.getResourceBundle();

			const sDesc = String(v("freitextInputDescription").getValue() || "").trim();
			const sReceiver = String(v("freitextInputRequester").getValue() || "").trim();
			const sQtyStr = String(v("freitextInputQuantity").getValue() || "");
			const sPriceStr = String(v("freitextInputPrice").getValue() || "");
			const sUnit = String(v("freitextInputUnit").getValue() || "ST").trim();
			const sCurr = String(v("freitextInputCurrency").getValue() || "EUR").trim();
			const sSupplier = String(v("freitextInputSupplier").getValue() || "").trim();
			const sEkgrp = String(v("freitextInputEkgrp").getValue() || "").trim();
			const sExtMatnr = String(v("freitextInputExtMatnr").getValue() || "").trim();
			const sAddText = String(v("freitextInputAddText").getValue() || "").trim();



			// ValueStates zurücksetzen
			[
				"freitextInputDescription",
				"freitextInputRequester",
				"freitextInputQuantity",
				"freitextInputPrice",
				"freitextInputExtMatnr",
				"freitextInputAddText"
			].forEach((id) => {
				const c = v(id);
				if (c && c.setValueState) {
					c.setValueState("None");
					c.setValueStateText("");
				}
			});

			// Zahlen robust parsen
			const NF = sap.ui.core.format.NumberFormat.getFloatInstance();
			const fQty = NF.parse(sQtyStr);
			const fPrice = NF.parse(sPriceStr);

			// Harte Regel: ext. Matnr max 35 Zeichen
			if (sExtMatnr.length > 35) {
				const c = v("freitextInputExtMatnr");
				if (c) {
					c.setValueState("Error");
					c.setValueStateText(rb.getText("freitext.err.extMatnrTooLong", [35]));
				}
				sap.m.MessageBox.information(rb.getText("freitext.msg.extMatnrTooLong", [35]));
				return;
			}

			const missing = [];
			const err = (id, msgKey, fieldKey) => {
				const c = v(id);
				if (c) {
					c.setValueState("Error");
					c.setValueStateText(rb.getText(msgKey));
				}
				missing.push(rb.getText(fieldKey));
			};

			if (!sDesc) err("freitextInputDescription", "freitext.err.descRequired", "freitext.field.description");
			if (!sReceiver) err("freitextInputRequester", "freitext.err.receiverRequired", "freitext.field.receiver");
			if (!(fQty > 0)) err("freitextInputQuantity", "freitext.err.qtyRequired", "freitext.field.quantity");
			if (!(fPrice >= 0)) err("freitextInputPrice", "freitext.err.priceRequired", "freitext.field.price");

			if (missing.length) {
				sap.m.MessageBox.information(rb.getText("freitext.msg.missingIntro") + "\n\n• " + missing.join("\n• "));
				return;
			}

			const iQty = Math.max(1, parseInt(fQty, 10) || 1);
			const nPrice = Number(isNaN(fPrice) ? 0 : fPrice);

			// addText (nicht ddText) setzen, damit CheckoutWizard es 1:1 findet
			const oItem = {
				ZmmWebsArtikelId: "FREETEXT-" + Date.now(),
				ZmmWebsKatId: "FREETEXT",
				ZmmWebsKatBez: sDesc,
				ZmmWebsArtBez: sDesc,

				MENGE: iQty,
				Meins: sUnit,
				Bapre: nPrice,
				Waers: sCurr,


				receiver: sReceiver,
				Wlief: sSupplier,
				Ekgrp: sEkgrp,
				Idnlf: sExtMatnr.slice(0, 35),

				addText: sAddText,
				AddText: sAddText,

				// Defaults
				weExpectedIndex: -1,
				accountType: "",
				accountValue: "",
				glAccount: "",
				Matkl: "",
				STATUS: "A"
			};

			this._addToCart(oItem, iQty);

			if (this.onCloseFreitextDialog) {
				this.onCloseFreitextDialog();
			}

		},




		// Factory für die OCI-Katalogliste: rendert den Freitext-Eintrag als eigenes aktives ListItem (mit Icon) 
		// und alle anderen Einträge als aktive Katalog-ListItems mit stabiler ID.
		ociCatalogItemFactory: function (sId, oCtx) {
			const oObj = oCtx.getObject();


			// Freitext-Eintrag als eigenes ListItem rendern
			if (oObj && oObj.type === "FREETEXT") {
				return new sap.m.StandardListItem(
					this.createId("ociCatalogItem-FREETEXT"),
					{
						title: "{i18n>freitextOpenDialogButtonText}",
						type: "Active",
						icon: "sap-icon://add-document",
						press: this.onOpenFreitextDialog.bind(this)
					}
				);
			}

			// OCI-Kataloge
			const sSafeId = (oObj && oObj.serviceId ? String(oObj.serviceId) : "oci").replace(/[^\w\-:.]/g, "_");
			return new sap.m.StandardListItem(
				this.createId("ociCatalogItem-" + sSafeId),
				{
					title: "{ociCatalogs>katalogName}",
					type: "Active",
					press: this.onOpenExternalWebshop.bind(this)
				}
			);
		},

		// Öffnet einen externen OCI-Katalog basierend auf dem ausgewählten Eintrag aus dem ociCatalogs-Model, 
		// ermittelt die KatalogID und delegiert an _openOciCatalogById.
		onOpenExternalWebshop: function (oEvent) {
			const oCtx = oEvent.getSource().getBindingContext("ociCatalogs");
			if (!oCtx) {
				sap.m.MessageToast.show(this.getResourceBundle().getText("oci.msg.noCatalogSelected"));
				return;
			}

			const oCat = oCtx.getObject();

			const sCatalogId = oCat.serviceId || oCat.katalogName;

			this._openOciCatalogById(sCatalogId);
		},

		// Versucht mehrere mögliche Katalog-IDs nacheinander zu öffnen (Fallback-Kette) und zeigt eine Meldung, 
		// wenn keine Kandidaten vorhanden sind oder kein Customizing gefunden wird.
		_openOciCatalogByCandidates: function (aCandidates) {
			const a = (aCandidates || [])
				.map(v => (v === undefined || v === null) ? "" : String(v).trim())
				.filter(Boolean)
				.filter((v, i, self) => self.indexOf(v) === i);

			if (a.length === 0) {
				sap.m.MessageToast.show(this.getResourceBundle().getText("oci.msg.noCatalogIdFound"));
				return;
			}

			const tryNext = (idx) => {
				if (idx >= a.length) {
					sap.m.MessageToast.show(this.getResourceBundle().getText("oci.msg.noActionInCustomizing"));
					return;
				}
				this._openOciCatalogById(a[idx], function () {
					tryNext(idx + 1);
				});
			};

			tryNext(0);
		},



		// Liest OCI-Customizing (action + POST-Felder) zur KatalogID, öffnet ein Zwischen-HTML in einem benannten 
		// Fenster und postet die Form-Daten per postMessage an das Ziel-Fenster
		_openOciCatalogById: function (sCatalogId) {
			console.log("OPEN OCI CATALOG BY ID:", sCatalogId);

			if (!sCatalogId) {
				sap.m.MessageToast.show(this.getResourceBundle().getText("oci.msg.noCatalogIdFound"));
				return;
			}

			const oModel = this.getOwnerComponent().getModel();

			oModel.read("/OCIKatalogParamsSet", {
				filters: [
					new sap.ui.model.Filter("KatalogID", sap.ui.model.FilterOperator.EQ, String(sCatalogId).trim())
				],
				success: function (oData) {
					const aParams = (oData && oData.results) ? oData.results : [];

					if (aParams.length === 0) {
						sap.m.MessageToast.show(this.getResourceBundle().getText("oci.msg.noCustomizingForCatalog", [String(sCatalogId).trim()]));
						return;
					}

					const oAction = aParams.find(p => !p.Fieldnam || String(p.Fieldnam).trim() === "");
					const sAction = oAction && oAction.Fieldval;

					if (!sAction) {
						sap.m.MessageToast.show(this.getResourceBundle().getText("oci.msg.noActionForCatalog", [String(sCatalogId).trim()]));
						return;
					}

					const fieldsForPost = aParams
						.filter(p => p.Fieldnam && String(p.Fieldnam).trim().length > 0)
						.map(p => ({
							name: String(p.Fieldnam),
							value: (p.Fieldval === undefined || p.Fieldval === null) ? "" : String(p.Fieldval)
						}));

					const sHtml = sap.ui.require.toUrl("diehlwebshop/webshop/ExternerWebshop.html");

					let sTabId = sessionStorage.getItem("OCI_TAB_ID");
					if (!sTabId) {
						sTabId = String(Date.now()) + "_" + Math.random().toString(16).slice(2);
						sessionStorage.setItem("OCI_TAB_ID", sTabId);
					}
					let sWinName = "OCI_CATALOG_WIN_" + sTabId;
					if (window.name === sWinName) {
						sWinName = sWinName + "_POP";
					}

					const upsertField = (name, value) => {
						const i = fieldsForPost.findIndex(f => String(f.name).toUpperCase() === String(name).toUpperCase());
						if (i > -1) {
							fieldsForPost[i].value = value;
						} else {
							fieldsForPost.push({ name, value });
						}
					};

					upsertField("~TARGET", sWinName);
					upsertField("returntarget", window.name);

					// Lifnr aus dem Customizing-Feldsatz extrahieren und merken
					const oLifnrField = fieldsForPost.find(f => String(f.name || "").trim().toUpperCase() === "LIFNR");
					const sLifnr = oLifnrField ? String(oLifnrField.value || "").trim() : "";

					try {
						const oCtx = {
							catalogId: String(sCatalogId).trim(),
							lifnr: sLifnr,
							winName: sWinName,
							ts: Date.now()
						};
						sessionStorage.setItem("OCI_LAST_CTX", JSON.stringify(oCtx));
						sessionStorage.setItem("OCI_CTX_" + sWinName, JSON.stringify(oCtx));
					} catch (e) {
						// wenn sessionStorage blockiert ist, nicht abbrechen
					}

					// DEBUG: vor dem Absprung im Hauptfenster loggen (Passwort wird maskiert)
					const maskIfSecret = (n, v) => {
						const k = String(n || "").toUpperCase();
						const isSecret = ["KENNWORT", "PASSWORD", "PASSWD", "PWD", "SECRET"].some(x => k.includes(x));
						return isSecret ? "********" : v;
					};

					console.group("OCI DEBUG: Absprung vorbereiten");
					console.log("KatalogID:", sCatalogId);
					console.log("action:", sAction);
					console.log("method:", "POST");
					console.log("target window:", sWinName);
					console.log("gemerkte Lifnr:", sLifnr || "(leer)");
					console.table(fieldsForPost.map(f => ({ name: f.name, value: maskIfSecret(f.name, f.value) })));
					console.groupEnd();

					const win = window.open(sHtml, sWinName);
					if (!win) {
						sap.m.MessageToast.show(this.getResourceBundle().getText("oci.msg.popupBlocked"));
						return;
					}

					const targetOrigin = window.location.origin;

					const onReady = (evt) => {
						if (evt.source === win && evt.origin === targetOrigin && evt.data && evt.data.type === "OCI_READY") {
							window.removeEventListener("message", onReady);

							win.postMessage({
								type: "OCI_POST",
								payload: {
									action: sAction,
									method: "POST",
									fields: fieldsForPost
								}
							}, targetOrigin);
						}
					};
					window.addEventListener("message", onReady);

					setTimeout(function () {
						try { if (!win.closed) { win.postMessage({ type: "OCI_PING" }, targetOrigin); } } catch (e) { }
					}, 1000);
				}.bind(this),

				error: function (oErr) {
					sap.m.MessageToast.show(this.getResourceBundle().getText("oci.msg.readParamsFailed"));
					console.log(oErr);
				}
			});
		},




		// Hängt an ein Input ein Keydown-Guard an, der nur numerische Eingaben (Ziffern, Komma, Punkt) 
		// plus Steuer- und Copy/Paste-Tasten erlaubt und bei Verstoß kurz ValueState/Toast zeigt.
		_attachNumericGuard: function (oInput) {
			if (!oInput) { return; }
			oInput.addEventDelegate({
				onkeydown: function (oEvent) {
					const e = oEvent.originalEvent || oEvent;
					const key = e.key;
					const ctrl = e.ctrlKey || e.metaKey;

					const allowed =
						// steuer-tasten
						["Backspace", "Tab", "Delete", "ArrowLeft", "ArrowRight", "Home", "End", "Enter", "Escape"].includes(key) ||
						// copy/paste/select-all
						(ctrl && ["a", "c", "v", "x", "A", "C", "V", "X"].includes(key)) ||
						// ziffern, komma, punkt
						(/^[0-9]$/.test(key) || key === "," || key === ".");

					if (!allowed) {
						if (!this._numWarnTs || Date.now() - this._numWarnTs > 1200) {
							sap.m.MessageToast.show(this.getResourceBundle().getText("home.input.numericOnlyToast"));
							this._numWarnTs = Date.now();
						}
						oInput.setValueState("Error");
						oInput.setValueStateText(this.getResourceBundle().getText("home.input.numericOnlyState"));
						setTimeout(() => oInput.setValueState("None"), 1000);
						e.preventDefault();
					}
				}.bind(this)
			});
		},




		// Öffnet den Freitext-Dialog (Fragment einmalig erstellen), hängt zusätzlich den Numeric-Guard an 
		// Mengen- und Preisfeld.
		onOpenFreitextDialog: function () {
			if (!this._oFreitextDialog) {
				this._oFreitextDialog = sap.ui.xmlfragment(this.getView().getId(),
					"diehlwebshop.view.FreitextDialog", this);
				this.getView().addDependent(this._oFreitextDialog);
			}
			this._oFreitextDialog.open();

			// Tastaturwarnung für Zahlenfelder
			this._attachNumericGuard(this.byId("freitextInputQuantity"));
			this._attachNumericGuard(this.byId("freitextInputPrice"));
		},



		// Schließt den Freitext-Dialog, falls er existiert.
		onCloseFreitextDialog: function () {
			if (this._oFreitextDialog) {
				this._oFreitextDialog.close();
			}
		},

		// Öffnet eine Lieferanten-Werthilfe mit JSON-Cache: lädt Lieferanten einmalig per OData, 
		// reichert normalisierte Suchfelder an, öffnet SelectDialog und schreibt die Auswahl (Lifnr) 
		// ins aktive Input-Feld; nutzt danach _applySupplierSearchFilter für echte case-insensitive Suche.
		onValueHelpSupplier: function (oEvent) {
			var oView = this.getView();
			var oODataModel = this.getOwnerComponent().getModel();
			var oInput = oEvent.getSource();
			this._oSuppActiveInput = oInput;

			// 1) Daten einmalig laden und in JSON puffern (wie bei Ekgrp)
			if (!this._oSuppJsonModel) {
				this._oSuppJsonModel = new sap.ui.model.json.JSONModel({ results: [] });
				oView.setModel(this._oSuppJsonModel, "vhSupp");
			}

			var openDialog = function () {
				if (!this._oSuppVH) {
					this._oSuppVH = new sap.m.SelectDialog({
						title: "Wunschlieferant wählen",
						items: {
							path: "vhSupp>/results",
							template: new sap.m.StandardListItem({
								// Anzeige: Kurzname + Nummer
								title: "{vhSupp>Sortl}",
								description: "{vhSupp>Lifnr}"

							})
						},

						// 2) Suche lokal (teilstring + case-insensitive)
						search: function (oEvt) {
							var sValue = (oEvt.getParameter("value") || "").trim().toLowerCase();
							var oBinding = oEvt.getSource().getBinding("items");
							if (!oBinding) { return; }

							if (!sValue) {
								oBinding.filter([]);
								return;
							}

							oBinding.filter([
								new sap.ui.model.Filter({
									filters: [
										new sap.ui.model.Filter({
											path: "Lifnr",
											operator: sap.ui.model.FilterOperator.Contains,
											value1: sValue
										}),
										new sap.ui.model.Filter({
											path: "Sortl",
											operator: sap.ui.model.FilterOperator.Contains,
											value1: sValue
										}),
										new sap.ui.model.Filter({
											path: "Mcod1",
											operator: sap.ui.model.FilterOperator.Contains,
											value1: sValue
										})
									],
									and: false
								})
							], "Application");

							// FilterOperator.Contains ist hier auf JSONModel-Binding.
							// Das ist case-sensitive. Deshalb Nutzung eines Tricks:
							// Wir speichern im Model zusätzlich Normalized-Felder (siehe unten) oder filtern per custom.
						}.bind(this),

						confirm: function (oEvt) {
							var oSel = oEvt.getParameter("selectedItem");
							if (!oSel) { return; }

							var oObj = oSel.getBindingContext("vhSupp").getObject();
							var sLifnr = String(oObj.Lifnr || "").trim();

							if (this._oSuppActiveInput) {
								this._oSuppActiveInput.setValue(sLifnr);
							}
						}.bind(this),

						cancel: function () { }
					});

					oView.addDependent(this._oSuppVH);

					// Override für echte case-insensitive Suche auf JSON-Daten:
					// Wir hängen uns an liveChange vom internen SearchField.
					// SelectDialog feuert search, aber der Standard-Filter bleibt case-sensitive.
					var oSF = this._oSuppVH.getSubHeader && this._oSuppVH.getSubHeader();
				}

				// Vorfilter mit aktuellem Wert
				var sCurrent = (oInput.getValue() || "").trim();
				this._oSuppVH.open(sCurrent);

				this._applySupplierSearchFilter(sCurrent);
			}.bind(this);

			// Wenn schon geladen, direkt öffnen
			var aCached = this._oSuppJsonModel.getProperty("/results") || [];
			if (aCached.length > 0) {
				openDialog();
				return;
			}

			oODataModel.read("/KredaSet", {
				urlParameters: {
					"$select": "Lifnr,Sortl,Mcod1",
					"$top": "5000"
				},
				success: function (oData) {
					var a = (oData && oData.results) ? oData.results : [];

					// Normalisierte Felder, um case-insensitive filtern zu können
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
					sap.m.MessageToast.show("Lieferanten konnten nicht geladen werden.");
					console.log(oErr);
				}
			});
		},

		// Wendet einen clientseitigen Suchfilter auf den Lieferanten-Dialog an (case-insensitive, teilstring) 
		// über normalisierte Hilfsfelder (__lifnr/__sortl/__mcod1).
		_applySupplierSearchFilter: function (sValue) {
			if (!this._oSuppVH) { return; }
			var s = String(sValue || "").trim().toLowerCase();
			var oBinding = this._oSuppVH.getBinding("items");
			if (!oBinding) { return; }

			if (!s) {
				oBinding.filter([]);
				return;
			}

			// Filter auf normalisierte Hilfsfelder (case-insensitive, Teilstring)
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
		}
		,



		// Setzt alle Eingabefelder und ValueStates im Freitext-Dialog auf Default zurück 
		_resetFreitextInputs: function () {
			const aIds = [
				"freitextInputDescription",
				"freitextInputAddText",
				"freitextInputRequester",
				"freitextInputSupplier",
				"freitextInputEkgrp",
				"freitextInputExtMatnr",
				"freitextInputQuantity",
				"freitextInputPrice"
			];

			aIds.forEach((sId) => {
				const oCtrl = this.byId(sId);
				if (oCtrl && oCtrl.setValue) {
					oCtrl.setValue("");
				}
				if (oCtrl && oCtrl.setValueState) {
					oCtrl.setValueState("None");
				}
				if (oCtrl && oCtrl.setValueStateText) {
					oCtrl.setValueStateText("");
				}
			});

			const oUnit = this.byId("freitextInputUnit");
			if (oUnit && oUnit.setValue) {
				oUnit.setValue("ST");
			}

			const oCurr = this.byId("freitextInputCurrency");
			if (oCurr && oCurr.setValue) {
				oCurr.setValue("EUR");
			}
		},


		// Refresh-Handler für PullToRefresh: wartet auf DataReceived der Produktliste, versteckt dann den 
		// PullToRefresh und startet die Suche erneut.
		onRefresh: function () {
			var oProductList = this.byId("productHomeList");
			var oBinding = oProductList.getBinding("items");
			var fnHandler = function () {
				this.byId("pullToRefresh").hide();
				oBinding.detachDataReceived(fnHandler);
			}.bind(this);
			oBinding.attachDataReceived(fnHandler);
			this._search();
		},


		// Führt die lokale Suche aus: schaltet je nach Suchbegriff zwischen Kategorie- und Produktliste um 
		// und filtert die Produktliste clientseitig nach Konzeptfeldern (Bezeichnung, Lieferant, Artikel-ID, Warengruppe).
		_search: function () {
			const oV = this.getView();
			const oProductList = oV.byId("productHomeList");
			const oCategoryList = oV.byId("categoryHomeList");
			const oSearchField = oV.byId("searchField");

			const sQuery = (oSearchField.getValue() || "").trim().toLowerCase();

			// Sichtbarkeit umschalten: ohne Suchbegriff → Kataloge, mit Suchbegriff → Produkte
			const bShowProducts = sQuery.length > 0;
			oProductList.setVisible(bShowProducts);
			oCategoryList.setVisible(!bShowProducts);

			// Wenn keine Suche aktiv ist oder Liste (noch) nicht gebunden ist: fertig
			if (!bShowProducts) { return; }
			const aItems = oProductList.getItems();
			if (!Array.isArray(aItems) || aItems.length === 0) { return; }

			// Lokales Filtern auf Konzept-Felder
			aItems.forEach(function (oItem) {
				const oCtx = oItem.getBindingContext();
				const oData = oCtx && oCtx.getObject ? oCtx.getObject() : null;
				if (!oData) { oItem.setVisible(false); return; }

				const sBez = (oData.ZmmWebsKatBez || oData.ZmmWebsArtBez || "").toLowerCase();
				const sSupp = (oData.Wlief || "").toLowerCase();
				const sId = (oData.ZmmWebsArtikelId || "").toLowerCase();
				const sMatkl = (oData.Matkl || "").toLowerCase();

				const bVisible = [sBez, sSupp, sId, sMatkl].some(s => s.includes(sQuery));
				oItem.setVisible(bVisible);
			});
		},




		// Handler für Klick auf eine Kategorie: erkennt OCI-Katalog-Sprung (WsiDescriptionText) und öffnet 
		// externen Katalog oder navigiert in der Kategoriehierarchie weiter; wenn Leaf (keine Kinder) 
		// wird zur Category-Route (Produktliste) navigiert.
		onCategoryListItemPress: function (oEvent) {
			const oItem = oEvent.getSource();
			const oCtx = oItem.getBindingContext();
			const oObj = oCtx && oCtx.getObject ? oCtx.getObject() : null;

			const sCategoryId = oObj && String(oObj.ZmmWebsKatId || "").trim();
			const sCategoryText = oObj && String(oObj.ZmmWebsKatBez || "").trim();

			if (!sCategoryId) {
				sap.m.MessageToast.show(this.getResourceBundle().getText("home.msg.noCategoryId"));
				return;
			}

			const oList = this.byId("categoryHomeList");
			const oCatNav = this.getView().getModel("catnav");

			const aStackBefore = (oCatNav.getProperty("/pathStack") || []).slice();
			const sParentText = aStackBefore.length
				? String(aStackBefore[aStackBefore.length - 1].text || "").trim().toLowerCase()
				: "";


			const sJumpId = oObj && String(oObj.WsiDescriptionText || "").trim();

			if (sJumpId) {
				this._openOciCatalogById(sJumpId);
				return;
			}

			// normales Verhalten: weiter in der Katalog-Hierarchie
			const aStackNew = aStackBefore.slice();
			aStackNew.push({ id: sCategoryId, text: sCategoryText });

			oCatNav.setProperty("/pathStack", aStackNew);
			oCatNav.setProperty("/currentParentId", sCategoryId);
			oCatNav.setProperty("/breadcrumbText", aStackNew.map(x => x.text).join(" / "));

			this._refreshCategoryList();

			// Leaf-Erkennung: wenn keine Kinderkategorien, dann zur Produktliste (Category-Route)
			oList.attachEventOnce("updateFinished", function () {
				if (oList.getItems().length === 0) {
					this._router.navTo("category", { id: sCategoryId }, !Device.system.phone);
				}

			}, this);
		},


		// Navigiert in der Kategoriehierarchie eine Ebene nach oben (Breadcrumb-Stack pop), 
		// setzt ParentId/Breadcrumb neu und aktualisiert die Kategorie-Liste.
		onCategoryLevelUp: function () {
			const m = this.getView().getModel("catnav");
			const stack = (m.getProperty("/pathStack") || []).slice();
			stack.pop();
			const newParent = stack.length ? stack[stack.length - 1].id : "";
			m.setProperty("/pathStack", stack);
			m.setProperty("/currentParentId", newParent);
			m.setProperty("/breadcrumbText", stack.map(x => x.text).join(" / "));
			this._refreshCategoryList();
		},


		// Handler für Auswahl in der Produktliste (Select): delegiert an _showProduct mit dem ausgewählten ListItem.
		onProductListSelect: function (oEvent) {
			var oItem = oEvent.getParameter("listItem");
			this._showProduct(oItem);
		},

		// Handler für Press auf ein Produkt-ListItem: delegiert an _showProduct mit dem gedrückten ListItem 
		onProductListItemPress: function (oEvent) {
			console.log("✅ onProductListItemPress wurde aufgerufen");
			var oItem = oEvent.getSource();
			this._showProduct(oItem);
		},

		// Navigiert zur Produktdetail-Route mit Kategorie-ID und Artikel-ID aus dem gebundenen Kontext; 
		// berücksichtigt Phone-Verhalten über Replace-Flag.
		_showProduct: function (oItem) {
			const oEntry = oItem.getBindingContext().getObject();
			this._router.navTo("product", {
				id: String(oEntry.ZmmWebsKatId),          // statt oEntry.Category
				productId: String(oEntry.ZmmWebsArtikelId) // statt oEntry.Produktid
			}, !Device.system.phone);
		},

		/**
		 * Immer zu home zurücknavigieren
		 * @override
		 */
		onBack: function () {
			this.getRouter().navTo("home");
		},

	});
});