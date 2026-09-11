/* =====================================================
   FUTURES SIGNAL SCANNER V2
   AŞAMA 2 — TEMEL UYGULAMA KONTROLÜ
   ===================================================== */

'use strict';

/* =====================================================
   UYGULAMA DURUMU
   ===================================================== */

const appState = {
    currentView: 'markets',
    scanning: false,
    marketCount: 0,
    longCount: 0,
    shortCount: 0,
    lastStatus: 'Sistem başlatıldı.'
};

/* =====================================================
   KISA DOM YARDIMCISI
   ===================================================== */

function $(id) {
    return document.getElementById(id);
}

/* =====================================================
   DURUM GÖSTERİMİ
   ===================================================== */

function setStatus(message) {

    appState.lastStatus = message;

    const statusBox = $('statusBox');

    if (statusBox) {
        statusBox.textContent = message;
    }

}

/* =====================================================
   BAĞLANTI DURUMU
   ===================================================== */

function setConnection(status, text) {

    const dot = $('connectionDot');
    const label = $('connectionText');

    if (dot) {
        dot.classList.remove('online', 'offline');

        if (status === 'online') {
            dot.classList.add('online');
        }

        if (status === 'offline') {
            dot.classList.add('offline');
        }
    }

    if (label) {
        label.textContent = text;
    }

}

/* =====================================================
   SAYAÇLARI GÜNCELLE
   ===================================================== */

function renderStats() {

    const marketCount = $('marketCount');
    const longCount = $('longCount');
    const shortCount = $('shortCount');

    if (marketCount) {
        marketCount.textContent = appState.marketCount;
    }

    if (longCount) {
        longCount.textContent = appState.longCount;
    }

    if (shortCount) {
        shortCount.textContent = appState.shortCount;
    }

}

/* =====================================================
   GÖRÜNÜM DEĞİŞTİRME
   ===================================================== */

function showView(viewName) {

    const views = {
        markets: $('viewMarkets'),
        trade: $('viewTrade'),
        position: $('viewPosition'),
        settings: $('viewSettings')
    };

    Object.keys(views).forEach(function(key) {

        const view = views[key];

        if (!view) {
            return;
        }

        view.classList.toggle(
            'active',
            key === viewName
        );

    });

    document
        .querySelectorAll('.nav-btn')
        .forEach(function(button) {

            button.classList.toggle(
                'active',
                button.dataset.view === viewName
            );

        });

    appState.currentView = viewName;

}

/* =====================================================
   BOŞ SİNYAL ALANI
   ===================================================== */

function renderEmptySignals() {

    const empty = $('signalsEmpty');

    if (empty) {
        empty.style.display = 'block';
        empty.textContent =
            'Henüz sinyal bulunmuyor. Tarama başlatıldığında sonuçlar burada görünecek.';
    }

}

/* =====================================================
   DEMO TARAMA
   ===================================================== */

function runDemoScan() {

    if (appState.scanning) {
        return;
    }

    appState.scanning = true;

    const scanButton = $('scanButton');

    if (scanButton) {
        scanButton.disabled = true;
        scanButton.textContent = 'Taranıyor...';
    }

    setConnection('online', 'Demo bağlantı');

    setStatus('Piyasa taraması başlatıldı...');

    setTimeout(function() {

        /*
         * Bu aşamadaki veriler yalnızca test amaçlıdır.
         * Henüz Binance verisi kullanılmıyor.
         */

        appState.marketCount = 0;
        appState.longCount = 0;
        appState.shortCount = 0;

        renderStats();
        renderEmptySignals();

        appState.scanning = false;

        if (scanButton) {
            scanButton.disabled = false;
            scanButton.textContent = 'Taramayı başlat';
        }

        setStatus(
            'Demo tarama tamamlandı. Binance bağlantısı sonraki aşamada eklenecek.'
        );

    }, 1200);

}

/* =====================================================
   TEMİZLE
   ===================================================== */

function clearApp() {

    appState.marketCount = 0;
    appState.longCount = 0;
    appState.shortCount = 0;

    renderStats();
    renderEmptySignals();

    setStatus('Ekran temizlendi.');

}

/* =====================================================
   ALT MENÜ BAĞLANTILARI
   ===================================================== */

function bindNavigation() {

    document
        .querySelectorAll('.nav-btn')
        .forEach(function(button) {

            button.addEventListener(
                'click',
                function() {

                    const viewName =
                        button.dataset.view;

                    if (!viewName) {
                        return;
                    }

                    showView(viewName);

                }
            );

        });

}

/* =====================================================
   BUTON BAĞLANTILARI
   ===================================================== */

function bindActions() {

    const scanButton = $('scanButton');
    const clearButton = $('clearButton');

    if (scanButton) {
        scanButton.addEventListener(
            'click',
            runDemoScan
        );
    }

    if (clearButton) {
        clearButton.addEventListener(
            'click',
            clearApp
        );
    }

}

/* =====================================================
   UYGULAMAYI BAŞLAT
   ===================================================== */

function initApp() {

    renderStats();
    renderEmptySignals();

    showView('markets');

    bindNavigation();
    bindActions();

    setConnection('online', 'Hazır');

    setStatus(
        'Temel uygulama hazır. Binance bağlantısı sonraki aşamada eklenecek.'
    );

    console.log(
        'Futures Signal Scanner V2 başlatıldı.'
    );

}

/* =====================================================
   BAŞLATMA
   ===================================================== */

if (
    document.readyState === 'loading'
) {

    document.addEventListener(
        'DOMContentLoaded',
        initApp
    );

} else {

    initApp();

}
