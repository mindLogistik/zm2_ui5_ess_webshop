sap.ui.define([
	"./BaseController"
], function (BaseController) {
	"use strict";

	return BaseController.extend("diehlwebshop.controller.App", {
		onInit: function () {
			var oRouter = this.getOwnerComponent().getRouter();
			var oAppViewModel = this.getOwnerComponent().getModel("appView");
		}
	});
});
