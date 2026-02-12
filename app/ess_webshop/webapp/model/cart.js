sap.ui.define([
    "sap/m/MessageBox",
    "sap/m/MessageToast"
], function (
    MessageBox,
    MessageToast
) {
    "use strict";

    return {
        /**
         * Fügt ein Produkt abhängig vom Status in den Warenkorb ein oder verhindert das Hinzufügen mit Meldung.
         * Bei Status "O" wird der Nutzer gefragt, ob trotzdem bestellt werden soll.
         * @public
         * @param {Object} oBundle ResourceBundle für i18n-Texte
         * @param {Object} oProduct Produktobjekt (optional als Wrapper mit Property "Product")
         * @param {Object} oCartModel JSONModel des Warenkorbs
         */
        addToCart: function (oBundle, oProduct, oCartModel) {
            if (oProduct.Product !== undefined) {
                oProduct = oProduct.Product;
            }

            switch (oProduct.Status) {
                case "D":
                    MessageBox.show(
                        oBundle.getText("productStatusDiscontinuedMsg"),
                        {
                            icon: MessageBox.Icon.ERROR,
                            title: oBundle.getText("productStatusDiscontinuedTitle"),
                            actions: [MessageBox.Action.CLOSE]
                        }
                    );
                    break;

                case "O":
                    MessageBox.show(
                        oBundle.getText("productStatusOutOfStockMsg"),
                        {
                            icon: MessageBox.Icon.QUESTION,
                            title: oBundle.getText("productStatusOutOfStockTitle"),
                            actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
                            onClose: function (oAction) {
                                if (MessageBox.Action.OK === oAction) {
                                    this._updateCartItem(oBundle, oProduct, oCartModel);
                                }
                            }.bind(this)
                        }
                    );
                    break;

                case "A":
                default:
                    this._updateCartItem(oBundle, oProduct, oCartModel);
                    break;
            }
        },

        /**
         * Erstellt einen neuen Warenkorbeintrag oder erhöht die Menge eines bestehenden Eintrags um 1.
         * Aktualisiert das Cart-Model und zeigt danach eine Toast-Meldung.
         * @private
         * @param {Object} oBundle ResourceBundle für i18n-Texte
         * @param {Object} oProductToBeAdded Produkt, das in den Warenkorb übernommen wird
         * @param {Object} oCartModel JSONModel des Warenkorbs
         */
        _updateCartItem: function (oBundle, oProductToBeAdded, oCartModel) {
            var oCollectionEntries = Object.assign({}, oCartModel.getData()["cartEntries"]);
            var oCartEntry = oCollectionEntries[oProductToBeAdded.Produktid];

            if (oCartEntry === undefined) {
                oCartEntry = Object.assign({}, oProductToBeAdded);
                oCartEntry.Menge = 1;
                oCollectionEntries[oProductToBeAdded.Produktid] = oCartEntry;
            } else {
                oCartEntry.Menge += 1;
            }

            oCartModel.setProperty("/cartEntries", Object.assign({}, oCollectionEntries));
            oCartModel.refresh(true);

            MessageToast.show(
                oBundle.getText("productMsgAddedToCart", [oProductToBeAdded.Artikelbezeichnung])
            );
        }
    };
});
