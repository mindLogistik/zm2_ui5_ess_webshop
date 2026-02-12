sap.ui.define([
  "sap/ui/model/json/JSONModel",
  "sap/ui/Device"
], function (JSONModel, Device) {
  "use strict";

  // Zentrale Stelle für Models (aktuell nur: Geräte-Modell).
  return {
    /**
     * Erzeugt ein JSONModel mit den Merkmalen aus sap/ui/Device.
     * Typische Pfade:
     *  - device>/system/phone       (Boolean: läuft die App auf einem Telefon?)
     *  - device>/support/touch      (Boolean: hat das Gerät Touch?)
     *  - device>/orientation/landscape (Boolean: Querformat?)
     *
     * Binding-Modus: OneWay – UI liest nur, schreibt nicht zurück.
     *
     * @returns {sap.ui.model.json.JSONModel} Geräte-Modell für responsive Bindings
     */
    createDeviceModel: function () {
      var oModel = new JSONModel(Device);
      oModel.setDefaultBindingMode("OneWay");
      return oModel;
    }
  };
});
