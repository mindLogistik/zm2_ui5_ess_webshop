sap.ui.define([
    "./BaseController"
], function (BaseController) {
    "use strict";

    return BaseController.extend("diehlwebshop.controller.PurchaseRequestDetail", {
        onInit: function () {
            console.log("✅ PurchaseRequestDetail-Controller geladen.");
        }
    });
});
