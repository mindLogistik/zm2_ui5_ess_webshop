sap.ui.define([
  "./BaseController",
  "../model/formatter",
  "sap/ui/model/json/JSONModel",
  "sap/ui/model/Filter",
  "sap/ui/model/FilterOperator"
], (BaseController, formatter, JSONModel, Filter, FilterOperator) => {
  "use strict";

  return BaseController.extend("diehlwebshop.controller.Product", {
    formatter: formatter,

    onInit: function () {
      const oComponent = this.getOwnerComponent();
      this._router = oComponent.getRouter();

      // Model für das Karussell (wird mit Bild-Objekten {src, order, title} befüllt)
      this.getView().setModel(new JSONModel([]), "productImages");

      this._pImageGalleryDialog = null;   // Promise-Guard
      this._oImageGalleryDialog = null;

      this._router.getRoute("product").attachPatternMatched(this._onRouteMatched, this);
      this._router.getTarget("product").attachDisplay(function (oEvent) {
        this._bindProductById(oEvent.getParameter("data").productId);
      }, this);
    },


    // Reagiert auf das Matchen der Produkt-Route und bindet das Produkt anhand der übergebenen productId an die View.
    _onRouteMatched: function (oEvent) {
      this._bindProductById(oEvent.getParameter("arguments").productId);
    },


    // Bindet die View auf ArtikelSet(ZmmWebsArtikelId=...) und lädt nach Datenempfang bzw. bei 
    // Binding-Änderung Verfügbarkeit und Bilder nach.
    _bindProductById: function (sProductId) {
      const oView = this.getView();
      const oModel = oView.getModel();

      oModel.metadataLoaded().then(function () {
        const sPath = "/" + oModel.createKey("ArtikelSet", { ZmmWebsArtikelId: sProductId });

        oView.bindElement({
          path: sPath,
          events: {
            dataRequested: () => oView.setBusy(true),
            dataReceived: () => {
              oView.setBusy(false);
              this._checkIfProductAvailable(sPath);
              this._loadProductImages(sProductId);
            },
            change: () => {
              this._checkIfProductAvailable(sPath);
              this._loadProductImages(sProductId);
            }
          }
        });
      }.bind(this));
    },


    // Lädt (oder reused) den Bildgalerie-Dialog aus dem Fragment, setzt die benötigten Models und verhindert 
    // paralleles Laden über einen Promise-Guard.
    _getImageGalleryDialog: function () {
      const sViewId = this.getView().getId();
      const sDialogId = sViewId + "--imageGalleryDialog";

      // Falls der Dialog bereits existiert, wiederverwenden
      const oExistingDialog = sap.ui.getCore().byId(sDialogId);
      if (oExistingDialog) {
        this._oImageGalleryDialog = oExistingDialog;

        oExistingDialog.setModel(this.getView().getModel("productImages"), "productImages");
        oExistingDialog.setModel(this.getOwnerComponent().getModel("i18n"), "i18n");
        oExistingDialog.setModel(this.getOwnerComponent().getModel("device"), "device");

        this._pImageGalleryDialog = Promise.resolve(oExistingDialog);
        return this._pImageGalleryDialog;
      }

      // Wenn gerade geladen wird: denselben Promise zurückgeben
      if (this._pImageGalleryDialog) {
        return this._pImageGalleryDialog;
      }

      // Sonst laden
      this._pImageGalleryDialog = sap.ui.core.Fragment.load({
        id: sViewId,
        name: "diehlwebshop.view.fragments.ImageGalleryDialog",
        controller: this
      }).then(function (oDialog) {
        this._oImageGalleryDialog = oDialog;
        this.getView().addDependent(oDialog);

        oDialog.setModel(this.getView().getModel("productImages"), "productImages");
        oDialog.setModel(this.getOwnerComponent().getModel("i18n"), "i18n");
        oDialog.setModel(this.getOwnerComponent().getModel("device"), "device");

        return oDialog;
      }.bind(this)).catch(function (e) {
        this._pImageGalleryDialog = null;
        throw e;
      }.bind(this));

      return this._pImageGalleryDialog;
    },


    // Merkt sich den Index der aktuell aktiven Seite im Produkt-Carousel, um ihn später 
    // (z. B. beim Öffnen der Galerie) wieder zu verwenden.
    onProductCarouselPageChanged: function (oEvent) {
      const sNewId = oEvent.getParameter("newActivePageId");
      const oNewPage = sNewId ? sap.ui.getCore().byId(sNewId) : null;

      const oCtx = oNewPage && oNewPage.getBindingContext("productImages");
      const sPath = oCtx && oCtx.getPath ? oCtx.getPath() : "";

      const iIndex = parseInt(String(sPath).split("/").pop(), 10);
      this._iLastProductCarouselIndex = Number.isInteger(iIndex) ? iIndex : 0;
    },


    // Öffnet den Bildgalerie-Dialog und setzt nach dem Öffnen das aktive Galerie-Bild passend 
    // zum geklickten/aktiven Produkt-Carousel-Bild.
    onOpenImageGallery: async function (oEvent) {
      const oDialog = await this._getImageGalleryDialog();

      let iIndex = -1;

      // a) Index über BindingContext des geklickten Images (falls vorhanden)
      const oSrc = oEvent && oEvent.getSource ? oEvent.getSource() : null;
      const oCtx = oSrc && oSrc.getBindingContext ? oSrc.getBindingContext("productImages") : null;
      if (oCtx) {
        const sPath = oCtx.getPath();
        const i = parseInt(String(sPath).split("/").pop(), 10);
        if (Number.isInteger(i)) {
          iIndex = i;
        }
      }

      // b) Fallback: Index über aktives Page im Produkt-Carousel
      if (!Number.isInteger(iIndex) || iIndex < 0) {
        const oMainCarousel = this.byId("productCarousel");
        if (oMainCarousel) {
          const sActivePageId = oMainCarousel.getActivePage();
          const oActivePage = sActivePageId && sap.ui.getCore().byId(sActivePageId);
          if (oActivePage) {
            iIndex = oMainCarousel.indexOfPage(oActivePage);
          }
        }
      }

      const fnAfterOpen = function () {
        oDialog.detachAfterOpen(fnAfterOpen);

        const oGalleryCarousel = sap.ui.core.Fragment.byId(this.getView().getId(), "imageGalleryCarousel");
        if (!oGalleryCarousel) { return; }

        const aPages = oGalleryCarousel.getPages();
        if (!aPages || !aPages.length) { return; }

        const iSafe = (Number.isInteger(iIndex) && aPages[iIndex]) ? iIndex : 0;
        oGalleryCarousel.setActivePage(aPages[iSafe].getId());

        this._applyContainToGalleryImages();
      }.bind(this);

      oDialog.attachAfterOpen(fnAfterOpen);
      oDialog.open();
    },


    // Schließt den Bildgalerie-Dialog, falls er existiert.
    onCloseImageGallery: function () {
      if (this._oImageGalleryDialog) {
        this._oImageGalleryDialog.close();
      }
    },


    // Springt im Galerie-Carousel ein Bild zurück und erzwingt anschließend object-fit=contain für alle Galerie-Bilder.
    onPrevImage: function () {
      const oCarousel = sap.ui.core.Fragment.byId(this.getView().getId(), "imageGalleryCarousel");
      if (oCarousel) {
        oCarousel.previous();
        this._applyContainToGalleryImages();
      }
    },


    // Springt im Galerie-Carousel ein Bild vor und erzwingt anschließend object-fit=contain für alle Galerie-Bilder.
    onNextImage: function () {
      const oCarousel = sap.ui.core.Fragment.byId(this.getView().getId(), "imageGalleryCarousel");
      if (oCarousel) {
        oCarousel.next();
        this._applyContainToGalleryImages();
      }
    },


    // Räumt beim Verlassen des Controllers den Galerie-Dialog auf (destroy) und setzt den Promise-Guard zurück.
    onExit: function () {
      if (this._oImageGalleryDialog) {
        this._oImageGalleryDialog.destroy();
        this._oImageGalleryDialog = null;
      }
      this._pImageGalleryDialog = null;
    },


    // Erzwingt im geöffneten Galerie-Dialog per DOM-Manipulation object-fit=contain und volle Bildabmessungen,
    //  um Verzerrungen zu vermeiden.
    _applyContainToGalleryImages: function () {
      if (!this._oImageGalleryDialog) { return; }

      const $dlg = this._oImageGalleryDialog.$();
      if (!$dlg || $dlg.length === 0) { return; }

      $dlg.find("img").each(function () {
        this.style.objectFit = "contain";
        this.style.width = "100%";
        this.style.height = "100%";
        this.style.maxWidth = "100%";
        this.style.maxHeight = "100%";
        this.style.display = "block";
      });
    },


    // Liest alle Bilder zu einer ArtikelId aus ArtiikelbildSet, baut pro Bild eine $value-URL über 
    // BildmediaSet(ArtikelId,DocId) und schreibt die sortierte Liste ins Model productImages.
    _loadProductImages: function (sProductId) {
      const oImgModel = this.getView().getModel("productImages");

      if (!sProductId) {
        oImgModel.setData([]);
        oImgModel.updateBindings(true);
        return;
      }

      const oModel = this.getView().getModel();
      const oMeta = oModel.getMetaModel();

      const oEntitySet = oMeta.getODataEntitySet("ArtiikelbildSet");
      if (!oEntitySet) {
        oImgModel.setData([]);
        oImgModel.updateBindings(true);
        return;
      }

      const aFilters = [
        new Filter("ArtikelId", FilterOperator.EQ, String(sProductId))
      ];

      oModel.read("/ArtiikelbildSet", {
        filters: aFilters,
        success: function (oData) {
          const aResults = (oData && oData.results) ? oData.results : [];

          if (!aResults.length) {
            oImgModel.setData([]);
            oImgModel.updateBindings(true);
            return;
          }

          let sBase = oModel.sServiceUrl || "";
          if (sBase.endsWith("/")) {
            sBase = sBase.slice(0, -1);
          }

          const aImgs = aResults.map(function (row) {
            const sArtikelId = row.ArtikelId;
            const sDocId = row.DocId;

            if (!sArtikelId || !sDocId) {
              return null;
            }

            const sKeyPath = oModel.createKey("BildmediaSet", {
              ArtikelId: sArtikelId,
              DocId: sDocId
            });

            const sSrc = sBase + "/" + sKeyPath + "/$value";

            const orderCandidate =
              row.ImageOrder ?? row.ORDER ?? row.SeqNr ?? row.SEQNR ?? row.Sort ?? row.SORT_NR ?? 0;

            return {
              src: sSrc,
              order: parseInt(orderCandidate, 10) || 0,
              title: row.Filename || row.TITLE || row.ALT || row.BEZEICHNUNG || ""
            };
          }).filter(Boolean);

          aImgs.sort((a, b) => a.order - b.order);

          oImgModel.setData(aImgs);
          oImgModel.updateBindings(true);
        }.bind(this),
        error: function () {
          oImgModel.setData([]);
          oImgModel.updateBindings(true);
        }
      });
    },


    // Prüft, ob das gebundene Produkt geladen wurde; wenn nicht, wird das NotFound-Target angezeigt.
    _checkIfProductAvailable: function (sPath) {
      const oData = this.getModel().getProperty(sPath);
      if (oData == null) {
        this._router.getTargets().display("notFound");
      }
    },


    // Schaltet den Warenkorb-Kontext für die Produktseite um, indem zwischen productCart und product 
    // (ohne /cart) navigiert wird.
    onToggleCart: function (oEvent) {
      const bPressed = !!oEvent.getParameter("pressed");
      const oCtx = this.getView().getBindingContext();
      const oEntry = oCtx && oCtx.getObject ? oCtx.getObject() : null;

      if (!oEntry || !oEntry.ZmmWebsKatId || !oEntry.ZmmWebsArtikelId) {
        return;
      }

      if (bPressed) {
        this.getRouter().navTo("productCart", {
          id: oEntry.ZmmWebsKatId,
          productId: oEntry.ZmmWebsArtikelId
        }, true);
      } else {
        this.getRouter().navTo("product", {
          id: oEntry.ZmmWebsKatId,
          productId: oEntry.ZmmWebsArtikelId
        }, true);
      }
    },


    // Liest die gewünschte Menge aus dem StepInput und fügt das aktuell gebundene Produkt über die zentrale 
    // _addToCart-Logik dem Warenkorb hinzu.
    onAddToCart: function () {
      const oView = this.getView();
      const oSi = oView.byId("siQtyProduct") || oView.byId("siQtySnapped");
      const iQty = parseInt(oSi && oSi.getValue ? oSi.getValue() : 1, 10) || 1;

      const oProd = oView.getBindingContext() && oView.getBindingContext().getObject
        ? oView.getBindingContext().getObject()
        : null;

      this._addToCart(oProd, iQty);
    },


    // Setzt Layout und cartOpen auf Standard zurück und navigiert ohne Historieneintrag zur PurchaseRequests-Ansicht.
    onBackToHome: function () {
      const oAppView = this.getOwnerComponent().getModel("appView");
      if (oAppView) {
        oAppView.setProperty("/cartOpen", false);
        oAppView.setProperty("/layout", "TwoColumnsMidExpanded");
      }
      this.getRouter().navTo("purchaseRequests", {}, true);
    },


    // Fügt das aktuell gebundene Produkt in die Merkliste (savedForLaterEntries) ein oder erhöht dort 
    // die Menge und aktualisiert das Model.
    onAddToWatchlist: function () {
      const oView = this.getView();
      const oQtyCtrl = oView.byId("siQtyProduct");
      const iQty = parseInt(oQtyCtrl && oQtyCtrl.getValue ? oQtyCtrl.getValue() : 1, 10) || 1;

      const oProdCtx = oView.getBindingContext();
      if (!oProdCtx) { return; }
      const oProd = oProdCtx.getObject();

      const oCartModel = this.getOwnerComponent().getModel("cartProducts");
      let aSaved = oCartModel.getProperty("/savedForLaterEntries") || [];
      if (!Array.isArray(aSaved)) { aSaved = Object.values(aSaved); }

      const sId = String(oProd.ZmmWebsArtikelId);
      const iIdx = aSaved.findIndex(e => String(e.ZmmWebsArtikelId) === sId);

      if (iIdx === -1) {
        const oCopy = Object.assign({}, oProd, { MENGE: iQty });
        aSaved.push(oCopy);
        oCartModel.setProperty("/savedForLaterEntries", aSaved);
        oCartModel.refresh(true);
        sap.m.MessageToast.show(this.getResourceBundle().getText(
          "productAddedToWatchlist", [oProd.ZmmWebsArtBez]
        ));
      } else {
        const iCurrent = parseInt(aSaved[iIdx].MENGE, 10) || 0;
        aSaved[iIdx].MENGE = iCurrent + iQty;
        oCartModel.setProperty("/savedForLaterEntries", aSaved);
        oCartModel.refresh(true);
        const rb = this.getResourceBundle();
        sap.m.MessageToast.show(this.getResourceBundle().getText(
          "watchlistQuantityUpdated",
          [aSaved[iIdx].MENGE, oProd.ZmmWebsArtBez]
        ));
      }
    }
  });
});


