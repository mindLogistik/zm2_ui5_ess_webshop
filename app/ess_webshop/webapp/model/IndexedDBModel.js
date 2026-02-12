sap.ui.define(["sap/ui/model/json/JSONModel"], (JSONModel) => {
  "use strict";

  const DB_NAME  = "webshop-db";
  const STORE    = "webshop";
  const DEBOUNCE_MS = 150;

  function openDB() {
    return new Promise((res, rej) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => res(req.result);
      req.onerror   = () => rej(req.error);
    });
  }

  function idbGet(key) {
    return openDB().then((db) => {
      return new Promise((res, rej) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).get(key);
        req.onsuccess = () => res(req.result);
        req.onerror   = () => rej(req.error);
      });
    });
  }

  function idbSet(key, val) {
    return openDB().then((db) => {
      return new Promise((res, rej) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(val, key);
        tx.oncomplete = () => res();
        tx.onerror    = () => rej(tx.error);
      });
    });
  }

  return JSONModel.extend("diehlwebshop.model.IndexedDBModel", {
    _STORAGE_KEY: "LOCALSTORAGE_MODEL",

    /**
     * Erstellt ein persistentes JSONModel, das Änderungen automatisch nach IndexedDB (oder Fallback localStorage) schreibt.
     * Lädt beim Start vorhandene Daten unter dem angegebenen Storage-Key in das Model.
     */
    constructor: function (sStorageKey, oInitialData) {
      JSONModel.apply(this, [].slice.call(arguments, 1));
      this.setSizeLimit(1000000);

      if (sStorageKey) {
        this._STORAGE_KEY = sStorageKey;
      }

      this._useIdb = typeof indexedDB !== "undefined";
      this._saveTimer = null;

      this._loadData();
      return this;
    },

    /**
     * Lädt persistierte Model-Daten aus IndexedDB oder localStorage und setzt sie als Model-Data.
     * Setzt danach ein Flag, damit spätere setData-Aufrufe wieder speichern dürfen.
     */
    async _loadData() {
      try {
        if (this._useIdb) {
          const val = await idbGet(this._STORAGE_KEY);
          if (val) { this.setData(val); }
        } else {
          const s = window.localStorage.getItem(this._STORAGE_KEY);
          if (s) { this.setData(JSON.parse(s)); }
        }
      } catch (e) {
        jQuery.sap.log.warning("Konnte Daten nicht laden", e);
      }
      this._bDataLoaded = true;
    },

    /**
     * Persistiert den aktuellen Model-Stand sofort, ohne Debounce, in IndexedDB oder localStorage.
     * Wird intern vom Debounce-Timer aufgerufen.
     */
    _storeDataNow: async function () {
      try {
        const data = this.getData();
        if (this._useIdb) {
          await idbSet(this._STORAGE_KEY, data);
        } else {
          window.localStorage.setItem(this._STORAGE_KEY, JSON.stringify(data));
        }
      } catch (e) {
        jQuery.sap.log.error("Konnte Daten nicht speichern", e);
      }
    },

    /**
     * Plant das Speichern verzögert ein, damit viele schnelle Änderungen nicht zu vielen Writes führen.
     * Überschreibt den Timer bei jeder weiteren Änderung innerhalb des Debounce-Fensters.
     */
    _storeData: function () {
      clearTimeout(this._saveTimer);
      this._saveTimer = setTimeout(() => this._storeDataNow(), DEBOUNCE_MS);
    },

    /**
     * Erweitert setProperty um automatische Persistierung nach jeder Property-Änderung.
     */
    setProperty: function () {
      JSONModel.prototype.setProperty.apply(this, arguments);
      this._storeData();
    },

    /**
     * Erweitert setData um automatische Persistierung, jedoch erst nachdem die Initialdaten geladen wurden.
     */
    setData: function () {
      JSONModel.prototype.setData.apply(this, arguments);
      if (this._bDataLoaded) {
        this._storeData();
      }
    },

    /**
     * Erweitert refresh um Persistierung, damit auch UI-getriggerte Updates gespeichert werden.
     */
    refresh: function () {
      JSONModel.prototype.refresh.apply(this, arguments);
      this._storeData();
    }
  });
});

